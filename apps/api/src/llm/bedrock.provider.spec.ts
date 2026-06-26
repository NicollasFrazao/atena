import {
  buildConverseInput,
  friendlyModelName,
  translateConverseStream,
} from './bedrock.provider';
import type { LlmConverseParamsInterface, LlmStreamChunkType } from './llm-provider.interface';

/** Transforma um array em async iterable (simula o stream do Bedrock). */
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
