import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import {
  BedrockRuntimeClient,
  ConverseStreamCommand,
} from '@aws-sdk/client-bedrock-runtime';
import {
  BedrockProvider,
  buildConverseInput,
  friendlyModelName,
  translateConverseStream,
} from './bedrock.provider';
import type { LlmConverseParamsInterface, LlmStreamChunkType } from './llm-provider.interface';

/** Transforma um array em async iterable (simula o stream do Bedrock). */
// eslint-disable-next-line @typescript-eslint/require-await -- the async generator turns in-memory items into the async stream the code under test reads; there is nothing to await
async function* streamOf<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) {
    yield item;
  }
}

/** Coleta todos os chunks de um async iterable. */
async function collect(stream: AsyncIterable<LlmStreamChunkType>): Promise<LlmStreamChunkType[]> {
  const out: LlmStreamChunkType[] = [];

  for await (const chunk of stream) {
    out.push(chunk);
  }

  return out;
}

describe('buildConverseInput', () => {
  const params: LlmConverseParamsInterface = {
    system: 'sou a Atena',
    messages: [
      {
        role: 'user',
        content: 'oi',
      },
      {
        role: 'assistant',
        content: {
          tool_use: {
            id: 'tu-1',
            name: 'search_shippings',
            args: { phone: '+5511' },
          },
        },
      },
      {
        role: 'tool',
        content: {
          id: 'tu-1',
          name: 'search_shippings',
          result: { rows: [] },
        },
      },
    ],
    tools: [{
      name: 'search_shippings',
      description: 'busca mensagens',
      inputSchema: { type: 'object' },
    }],
  };

  it('mapeia system, modelId, maxTokens e toolConfig', () => {
    const input = buildConverseInput(
      'us.amazon.nova-pro-v1:0',
      512,
      params,
    );

    expect(input.modelId).toBe('us.amazon.nova-pro-v1:0');
    expect(input.system).toEqual([{ text: 'sou a Atena' }]);
    expect(input.inferenceConfig).toEqual({ maxTokens: 512 });

    expect(input.toolConfig?.tools?.[0]).toEqual({
      toolSpec: {
        name: 'search_shippings',
        description: 'busca mensagens',
        inputSchema: { json: { type: 'object' } },
      },
    });
  });

  it('mapeia texto, tool_use e tool_result (com toolUseId) nas mensagens', () => {
    const input = buildConverseInput(
      'm',
      16,
      params,
    );

    expect(input.messages?.[0]).toEqual({
      role: 'user',
      content: [{ text: 'oi' }],
    });

    expect(input.messages?.[1]).toEqual({
      role: 'assistant',
      content: [{
        toolUse: {
          toolUseId: 'tu-1',
          name: 'search_shippings',
          input: { phone: '+5511' },
        },
      }],
    });

    // tool → role 'user' com bloco toolResult correlacionado pelo toolUseId
    expect(input.messages?.[2]).toEqual({
      role: 'user',
      content: [{
        toolResult: {
          toolUseId: 'tu-1',
          content: [{ json: { rows: [] } }],
        },
      }],
    });
  });

  it('funde várias tools de um turno: UMA msg assistant (N toolUse) + UMA user (N toolResult, na ordem)', () => {
    const input = buildConverseInput(
      'm',
      16,
      {
        messages: [
          {
            role: 'user',
            content: 'compare os dois clientes',
          },
          // O orquestrador empilha UMA mensagem por tool (assistant) e UMA por resultado (tool);
          // o Converse exige que cada turno seja UMA mensagem com vários blocos, na MESMA ordem.
          {
            role: 'assistant',
            content: {
              tool_use: {
                id: 'tu-A',
                name: 'list_customers',
                args: { date_range: '24h' },
              },
            },
          },
          {
            role: 'assistant',
            content: {
              tool_use: {
                id: 'tu-B',
                name: 'search_shippings',
                args: { customer_id: '7383' },
              },
            },
          },
          {
            role: 'tool',
            content: {
              id: 'tu-A',
              name: 'list_customers',
              result: { customers: ['7383'] },
            },
          },
          {
            role: 'tool',
            content: {
              id: 'tu-B',
              name: 'search_shippings',
              result: { rows: [] },
            },
          },
        ],
      },
    );

    // 3 mensagens (não 5): user, assistant(2 toolUse), user(2 toolResult).
    expect(input.messages).toHaveLength(3);

    expect(input.messages?.[1]).toEqual({
      role: 'assistant',
      content: [
        {
          toolUse: {
            toolUseId: 'tu-A',
            name: 'list_customers',
            input: { date_range: '24h' },
          },
        },
        {
          toolUse: {
            toolUseId: 'tu-B',
            name: 'search_shippings',
            input: { customer_id: '7383' },
          },
        },
      ],
    });

    expect(input.messages?.[2]).toEqual({
      role: 'user',
      content: [
        {
          toolResult: {
            toolUseId: 'tu-A',
            content: [{ json: { customers: ['7383'] } }],
          },
        },
        {
          toolResult: {
            toolUseId: 'tu-B',
            content: [{ json: { rows: [] } }],
          },
        },
      ],
    });
  });

  it('resultado de tool nulo vira documento JSON não-nulo (Bedrock rejeita `json: null`)', () => {
    const input = buildConverseInput(
      'm',
      16,
      {
        messages: [
          {
            role: 'user',
            content: 'abra a trilha',
          },
          {
            role: 'assistant',
            content: {
              tool_use: {
                id: 'tu-1',
                name: 'get_shipping_trail',
                args: { shipping_id: 'x' },
              },
            },
          },
          // Trilha não encontrada na janela do LLM → result `null`.
          {
            role: 'tool',
            content: {
              id: 'tu-1',
              name: 'get_shipping_trail',
              result: null,
            },
          },
        ],
      },
    );

    expect(input.messages?.[2]).toEqual({
      role: 'user',
      content: [{
        toolResult: {
          toolUseId: 'tu-1',
          content: [{ json: { result: null } }],
        },
      }],
    });
  });

  it('resultado de tool em ARRAY é embrulhado em objeto (Bedrock rejeita array no topo do json)', () => {
    const input = buildConverseInput(
      'm',
      16,
      {
        messages: [
          {
            role: 'user',
            content: 'liste os provedores',
          },
          {
            role: 'assistant',
            content: {
              tool_use: {
                id: 'tu-1',
                name: 'list_providers',
                args: {},
              },
            },
          },
          // list_providers/list_customers devolvem string[] — array no topo é inválido p/ o Converse.
          {
            role: 'tool',
            content: {
              id: 'tu-1',
              name: 'list_providers',
              result: [
                'sinch',
                'voicecarrier',
              ],
            },
          },
        ],
      },
    );

    expect(input.messages?.[2]).toEqual({
      role: 'user',
      content: [{
        toolResult: {
          toolUseId: 'tu-1',
          content: [{
            json: {
              result: [
                'sinch',
                'voicecarrier',
              ],
            },
          }],
        },
      }],
    });
  });

  it('omite system e toolConfig quando ausentes', () => {
    const input = buildConverseInput(
      'm',
      16,
      {
        messages: [{
          role: 'user',
          content: 'oi',
        }],
      },
    );

    expect(input.system).toBeUndefined();
    expect(input.toolConfig).toBeUndefined();
  });
});

describe('translateConverseStream', () => {
  it('traduz texto, tool_use (input fragmentado), usage e stop', async () => {
    const chunks = await collect(translateConverseStream(streamOf([
      { contentBlockDelta: { delta: { text: 'Olá ' } } },
      { contentBlockDelta: { delta: { text: 'mundo' } } },
      {
        contentBlockStart: {
          start: {
            toolUse: {
              toolUseId: 'tu-1',
              name: 'search_shippings',
            },
          },
        },
      },
      { contentBlockDelta: { delta: { toolUse: { input: '{"phone":' } } } },
      { contentBlockDelta: { delta: { toolUse: { input: '"+5511"}' } } } },
      { contentBlockStop: {} },
      {
        metadata: {
          usage: {
            inputTokens: 100,
            outputTokens: 20,
          },
        },
      },
      { messageStop: { stopReason: 'tool_use' } },
    ])));

    expect(chunks).toEqual([
      {
        type: 'text_delta',
        delta: 'Olá ',
      },
      {
        type: 'text_delta',
        delta: 'mundo',
      },
      {
        type: 'tool_use',
        id: 'tu-1',
        name: 'search_shippings',
        args: { phone: '+5511' },
      },
      {
        type: 'usage',
        inputTokens: 100,
        outputTokens: 20,
      },
      {
        type: 'stop',
        reason: 'tool_use',
      },
    ]);
  });

  it('mapeia content_filtered/guardrail para refusal e o resto para end_turn', async () => {
    const refusal = await collect(translateConverseStream(streamOf([
      { messageStop: { stopReason: 'content_filtered' } },
    ])));

    expect(refusal).toEqual([{
      type: 'stop',
      reason: 'refusal',
    }]);

    const endTurn = await collect(translateConverseStream(streamOf([
      { messageStop: { stopReason: 'max_tokens' } },
    ])));

    expect(endTurn).toEqual([{
      type: 'stop',
      reason: 'end_turn',
    }]);
  });
});

describe('friendlyModelName', () => {
  it('formata ids do Bedrock (vendor + palavras, versão minúscula, sem sufixo :N) — ex.: Nova Pro', () => {
    expect(friendlyModelName('us.amazon.nova-pro-v1:0')).toBe('Amazon Nova Pro v1');
    expect(friendlyModelName('amazon.nova-lite-v1:0')).toBe('Amazon Nova Lite v1');
  });

  it('cai no fallback `Bedrock` quando o id é vazio', () => {
    expect(friendlyModelName('')).toBe('Bedrock');
  });
});

describe('buildConverseInput (content edge cases)', () => {
  it('falls back to empty ids and a null result when tool messages lack them', () => {
    const input = buildConverseInput(
      'm',
      16,
      {
        messages: [
          {
            role: 'assistant',
            content: {
              tool_use: {
                name: 'list_providers',
                args: {},
              },
            },
          },
          {
            role: 'tool',
            content: null,
          },
        ],
      },
    );

    expect(input.messages).toEqual([
      {
        role: 'assistant',
        content: [{
          toolUse: {
            toolUseId: '',
            name: 'list_providers',
            input: {},
          },
        }],
      },
      {
        role: 'user',
        content: [{
          toolResult: {
            toolUseId: '',
            content: [{ json: { result: null } }],
          },
        }],
      },
    ]);
  });

  it('serializes a non-tool object content as a JSON text block', () => {
    const input = buildConverseInput(
      'm',
      16,
      {
        messages: [{
          role: 'user',
          content: { note: 'structured' },
        }],
      },
    );

    expect(input.messages).toEqual([{
      role: 'user',
      content: [{ text: '{"note":"structured"}' }],
    }]);
  });
});

describe('translateConverseStream (partial events)', () => {
  it('emits empty args when a tool block carries no input', async () => {
    const chunks = await collect(translateConverseStream(streamOf([
      { contentBlockStart: { start: { toolUse: {} } } },
      { contentBlockStop: {} },
    ])));

    expect(chunks).toEqual([{
      type: 'tool_use',
      id: '',
      name: '',
      args: {},
    }]);
  });

  it('emits empty args when the accumulated input is not a JSON object', async () => {
    const scalar = await collect(translateConverseStream(streamOf([
      {
        contentBlockStart: {
          start: {
            toolUse: {
              toolUseId: 'tu-1',
              name: 'search_shippings',
            },
          },
        },
      },
      { contentBlockDelta: { delta: { toolUse: { input: '42' } } } },
      { contentBlockStop: {} },
    ])));

    const invalid = await collect(translateConverseStream(streamOf([
      {
        contentBlockStart: {
          start: {
            toolUse: {
              toolUseId: 'tu-2',
              name: 'search_shippings',
            },
          },
        },
      },
      { contentBlockDelta: { delta: { toolUse: { input: '{"phone":' } } } },
      { contentBlockStop: {} },
    ])));

    expect(scalar).toEqual([{
      type: 'tool_use',
      id: 'tu-1',
      name: 'search_shippings',
      args: {},
    }]);

    expect(invalid).toEqual([{
      type: 'tool_use',
      id: 'tu-2',
      name: 'search_shippings',
      args: {},
    }]);
  });

  it('ignores tool input deltas outside a tool block and empty events', async () => {
    const chunks = await collect(translateConverseStream(streamOf([
      { contentBlockDelta: { delta: { toolUse: { input: '{"phone":"+5511"}' } } } },
      { contentBlockStop: {} },
      {},
    ])));

    expect(chunks).toEqual([]);
  });

  it('reports zero tokens when the usage event omits the counters', async () => {
    const chunks = await collect(translateConverseStream(streamOf([
      { metadata: { usage: {} } },
    ])));

    expect(chunks).toEqual([{
      type: 'usage',
      inputTokens: 0,
      outputTokens: 0,
    }]);
  });

  it('flushes a pending tool_use before the stop when the stream ends mid-tool (max_tokens)', async () => {
    const chunks = await collect(translateConverseStream(streamOf([
      {
        contentBlockStart: {
          start: {
            toolUse: {
              toolUseId: 'tu-9',
              name: 'get_shipping_trail',
            },
          },
        },
      },
      { contentBlockDelta: { delta: { toolUse: { input: '{"id":"abc"}' } } } },
      { messageStop: { stopReason: 'max_tokens' } },
    ])));

    expect(chunks).toEqual([
      {
        type: 'tool_use',
        id: 'tu-9',
        name: 'get_shipping_trail',
        args: { id: 'abc' },
      },
      {
        type: 'stop',
        reason: 'end_turn',
      },
    ]);
  });

  it('maps guardrail_intervened to refusal', async () => {
    const chunks = await collect(translateConverseStream(streamOf([
      { messageStop: { stopReason: 'guardrail_intervened' } },
    ])));

    expect(chunks).toEqual([{
      type: 'stop',
      reason: 'refusal',
    }]);
  });
});

describe('friendlyModelName (unparseable ids)', () => {
  it('returns the raw id when no word survives the cleanup', () => {
    expect(friendlyModelName(':0')).toBe(':0');
    expect(friendlyModelName('us.--')).toBe('us.--');
  });
});

/** ConfigService fake backed by a plain key → value map. */
function configOf(values: Record<string, unknown>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

const CONFIGURED = {
  'aws.region': 'us-east-1',
  'bedrock.apiKey': 'test-key',
  'bedrock.modelId': 'us.amazon.nova-pro-v1:0',
  'bedrock.maxTokens': 256,
};

const TURN: LlmConverseParamsInterface = {
  system: 'sou a Atena',
  messages: [{
    role: 'user',
    content: 'oi',
  }],
};

describe('BedrockProvider', () => {
  let send: jest.SpyInstance;
  let logError: jest.SpyInstance;
  let logWarn: jest.SpyInstance;
  let logDebug: jest.SpyInstance;

  beforeEach(() => {
    send = jest.spyOn(
      BedrockRuntimeClient.prototype,
      'send',
    );

    logError = jest.spyOn(
      Logger.prototype,
      'error',
    ).mockImplementation(() => undefined);

    logWarn = jest.spyOn(
      Logger.prototype,
      'warn',
    ).mockImplementation(() => undefined);

    logDebug = jest.spyOn(
      Logger.prototype,
      'debug',
    ).mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('describes itself as bedrock with the friendly model label', () => {
    const provider = new BedrockProvider(configOf(CONFIGURED));

    expect(provider.describe()).toEqual({
      provider: 'bedrock',
      model: 'Amazon Nova Pro v1',
    });
  });

  it('defaults the model to an empty id (label Bedrock) and maxTokens to 1024 when unconfigured', async () => {
    send.mockResolvedValue({ $metadata: {} });

    const provider = new BedrockProvider(configOf({}));

    const chunks = await collect(provider.converseStream(TURN));

    expect(provider.describe().model).toBe('Bedrock');
    expect(chunks).toEqual([]);

    const command = send.mock.calls[0][0] as ConverseStreamCommand;

    expect(command).toBeInstanceOf(ConverseStreamCommand);
    expect(command.input.modelId).toBe('');
    expect(command.input.inferenceConfig).toEqual({ maxTokens: 1024 });
    expect(logWarn).toHaveBeenCalledWith(expect.stringContaining('req=? http=? tries=1'));
  });

  it('sends the converse input and relays the translated stream chunks', async () => {
    send.mockResolvedValue({
      $metadata: {
        requestId: 'req-1',
        httpStatusCode: 200,
        attempts: 2,
      },
      stream: streamOf([
        { contentBlockDelta: { delta: { text: 'Olá' } } },
        { messageStop: { stopReason: 'end_turn' } },
      ]),
    });

    const provider = new BedrockProvider(configOf(CONFIGURED));

    const chunks = await collect(provider.converseStream({
      ...TURN,
      messages: [
        ...TURN.messages,
        {
          role: 'assistant',
          content: {
            tool_use: {
              id: 'tu-1',
              name: 'list_providers',
              args: {},
            },
          },
        },
        {
          role: 'tool',
          content: {
            id: 'tu-1',
            result: ['Twilio'],
          },
        },
      ],
    }));

    expect(chunks).toEqual([
      {
        type: 'text_delta',
        delta: 'Olá',
      },
      {
        type: 'stop',
        reason: 'end_turn',
      },
    ]);

    const command = send.mock.calls[0][0] as ConverseStreamCommand;

    expect(command.input.modelId).toBe('us.amazon.nova-pro-v1:0');
    expect(command.input.inferenceConfig).toEqual({ maxTokens: 256 });

    expect(logDebug).toHaveBeenCalledWith(expect.stringMatching(
      /^\[converse\] 3msg user\(text\) → assistant\(toolUse\) → user\(toolResult\) \| .*2 chunks.*req=req-1 http=200 tries=2$/,
    ));
  });

  it('logs and rethrows when the send fails', async () => {
    const failure = new Error('ValidationException');

    send.mockRejectedValue(failure);

    const provider = new BedrockProvider(configOf(CONFIGURED));

    await expect(collect(provider.converseStream(TURN))).rejects.toBe(failure);
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('send FALHOU'));
  });

  it('logs the chunk count and rethrows when the stream fails midway', async () => {
    const failure = new Error('idle timeout');

    // eslint-disable-next-line @typescript-eslint/require-await -- the async generator stands in for the SDK stream; it yields once and then fails
    async function* brokenStream(): AsyncIterable<unknown> {
      yield { contentBlockDelta: { delta: { text: 'parcial' } } };

      throw failure;
    }

    send.mockResolvedValue({
      $metadata: { requestId: 'req-2' },
      stream: brokenStream(),
    });

    const provider = new BedrockProvider(configOf(CONFIGURED));
    const received: LlmStreamChunkType[] = [];

    await expect((async () => {
      for await (const chunk of provider.converseStream(TURN)) {
        received.push(chunk);
      }
    })()).rejects.toBe(failure);

    expect(received).toEqual([{
      type: 'text_delta',
      delta: 'parcial',
    }]);

    expect(logError).toHaveBeenCalledWith(expect.stringContaining('stream FALHOU após 1 chunks'));
  });
});
