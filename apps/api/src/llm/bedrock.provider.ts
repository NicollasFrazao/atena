/**
 * Provider LLM concreto: Amazon Bedrock (Nova via Bedrock, Converse API com streaming).
 *
 * Usa `@aws-sdk/client-bedrock-runtime` diretamente (Bedrock é partner-operated; sem SDK da
 * Anthropic). Autentica por **API key (Bearer)** — `AWS_BEARER_TOKEN_BEDROCK`, passado explícito no
 * client (`httpBearerAuth`; o SDK não lê a env sozinho). O `LlmModule` torna o token OBRIGATÓRIO
 * quando `LLM_PROVIDER=bedrock`. O Bedrock NÃO usa a IAM Role da EC2 — essa cobre só o acesso S3
 * ao detailed report (via `credential_chain` do DuckDB no AuditQueryService).
 * `modelId` (inference profile, ex.: `us.amazon.nova-pro-v1:0`), `region` e `maxTokens` vêm
 * do ConfigService. A IA apenas PEDE tool calls; a aplicação executa as tools.
 */
import {
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BedrockRuntimeClient,
  ConverseStreamCommand,
  type ContentBlock,
  type ConverseStreamCommandInput,
  type ConverseStreamCommandOutput,
  type Message,
  type Tool,
} from '@aws-sdk/client-bedrock-runtime';
import type { ToolNameType } from '@atena/types';
import type {
  LlmConverseParamsInterface,
  LlmDescriptorInterface,
  LlmMessageInterface,
  LlmProviderInterface,
  LlmStreamChunkType,
  LlmStopInterface,
  LlmToolSpecInterface,
} from './llm-provider.interface';

/** Subset dos eventos do ConverseStream que traduzimos (shape oficial do Bedrock). */
interface BedrockStreamEventInterface {
  contentBlockStart?: {
    start?: {
      toolUse?: {
        toolUseId?: string;
        name?: string
      }
    }
  };
  contentBlockDelta?: {
    delta?: {
      text?: string;
      toolUse?: { input?: string }
    }
  };
  contentBlockStop?: unknown;
  messageStop?: { stopReason?: string };
  metadata?: {
    usage?: {
      inputTokens?: number;
      outputTokens?: number
    }
  };
}

/** Conteúdo (livre) de uma mensagem do orquestrador, recortado para o mapeamento Converse. */
interface OrchestratorContentInterface {
  tool_use?: {
    id?: string;
    name: string;
    args: Record<string, unknown>
  };
  id?: string;
  name?: string;
  result?: unknown;
}

/**
 * Mapeia o `stopReason` do Converse para a razão de parada do nosso contrato.
 *
 * @param {string} reason - `stopReason` nativo do Bedrock.
 *
 * @returns {LlmStopInterface['reason']} `tool_use` | `refusal` (guardrail/filtro) | `end_turn` (resto).
 */
function mapStopReason(reason: string): LlmStopInterface['reason'] {
  if (reason === 'tool_use') {
    return 'tool_use';
  }

  if (
    reason === 'guardrail_intervened'
    || reason === 'content_filtered'
  ) {
    return 'refusal';
  }

  return 'end_turn';
}

/** Parseia o JSON acumulado do input de uma tool; `{}` se vazio ou inválido. */
function parseJsonObject(json: string): Record<string, unknown> {
  if (!json) {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(json);

    if (
      typeof parsed === 'object'
      && parsed !== null
    ) {
      return parsed as Record<string, unknown>;
    }

    return {};
  } catch {
    return {};
  }
}

/**
 * Conteúdo de um `toolResult` para o Converse. O Bedrock exige um documento JSON que seja um
 * **OBJETO não-nulo** em `json`: `null` é descartado (→ `toolResult: required key [content] not
 * found`) e um **array** no topo é rejeitado (→ `The format of the value at ...json is invalid.
 * Provide a json object`). Por isso resultados que não são objeto — `null`/`undefined`/escalar **ou
 * array** (ex.: `list_providers`/`list_customers`, que devolvem `string[]`) — são embrulhados em
 * `{ result }`, sempre produzindo um objeto JSON válido.
 *
 * @param {unknown} result - Resultado cru da tool (envelope, trilha, lista, `null` se não encontrado, etc.).
 * @returns {{ json: unknown }} Bloco de conteúdo com um documento JSON garantidamente objeto não-nulo.
 */
function toToolResultJson(result: unknown): { json: unknown } {
  if (
    result !== null
    && typeof result === 'object'
    && !Array.isArray(result)
  ) {
    return { json: result };
  }

  return { json: { result: result ?? null } };
}

/** Converte uma mensagem do orquestrador em blocos de conteúdo do Converse. */
function toContentBlocks(message: LlmMessageInterface): ContentBlock[] {
  if (typeof message.content === 'string') {
    return [{ text: message.content }];
  }

  const content = (message.content ?? {}) as OrchestratorContentInterface;

  if (content.tool_use) {
    // toolUse.input é um DocumentType; cast localizado (args é Record<string, unknown>).
    return [{
      toolUse: {
        toolUseId: content.tool_use.id ?? '',
        name: content.tool_use.name,
        input: content.tool_use.args,
      },
    }] as ContentBlock[];
  }

  // Detecta o resultado de tool pelo PAPEL (não por `result !== undefined`): um tool que devolve
  // `undefined` ainda precisa virar um bloco `toolResult` — o Converse exige um para cada `toolUse`.
  if (message.role === 'tool') {
    // toolResult.content aceita um DocumentType em `json`; cast localizado (result é `unknown`).
    return [{
      toolResult: {
        toolUseId: content.id ?? '',
        content: [toToolResultJson(content.result)],
      },
    }] as ContentBlock[];
  }

  return [{ text: JSON.stringify(message.content) }];
}

/**
 * Converte o histórico do orquestrador em mensagens do Converse (tool → role `user`), **fundindo
 * mensagens consecutivas de mesmo papel** numa só (concatenando blocos, na ordem original).
 *
 * O Converse exige alternância estrita user/assistant e, num turno com várias tools, **UMA** mensagem
 * assistant com vários blocos `toolUse` seguida de **UMA** mensagem user com os `toolResult` na MESMA
 * ordem. O orquestrador empilha uma mensagem por tool; a fusão aqui remonta o formato que o Bedrock
 * aceita (sem ela: `ValidationException` de pareamento/ordem de `toolResult`).
 *
 * @param {LlmMessageInterface[]} messages - Histórico do orquestrador (texto + blocos de tool).
 * @returns {Message[]} Mensagens do Converse com alternância estrita e blocos agrupados por turno.
 */
function toConverseMessages(messages: LlmMessageInterface[]): Message[] {
  const merged: Message[] = [];

  for (const message of messages) {
    const role = message.role === 'assistant'
      ? 'assistant'
      : 'user';

    const blocks = toContentBlocks(message);
    const last = merged.at(-1);

    if (
      last
      && last.role === role
    ) {
      last.content?.push(...blocks);
    } else {
      merged.push({
        role,
        content: blocks,
      });
    }
  }

  return merged;
}

/** Identifica o tipo do primeiro bloco de conteúdo (para diagnóstico do payload). */
function blockKind(block: ContentBlock): string {
  if ('text' in block) {
    return 'text';
  }

  if ('toolUse' in block) {
    return 'toolUse';
  }

  if ('toolResult' in block) {
    return 'toolResult';
  }

  return 'other';
}

/** Resume o payload do Converse em `role(bloco)→role(bloco)` para log de diagnóstico do #8. */
function describeConverseMessages(messages: Message[]): string {
  return messages
    .map((message) => `${message.role}(${(message.content ?? []).map(blockKind).join(',')})`)
    .join(' → ');
}

/**
 * Resume o `$metadata` do SDK para o log de diagnóstico do #8: `requestId` (correlaciona com
 * CloudTrail/suporte AWS), `httpStatusCode` e nº de `attempts` (>1 sugere throttling/retry).
 *
 * @param {ConverseStreamCommandOutput['$metadata']} metadata - Metadata da resposta do Converse.
 * @returns {string} Resumo `req=… http=… tries=…`.
 */
function describeMetadata(metadata: ConverseStreamCommandOutput['$metadata']): string {
  return `req=${metadata.requestId ?? '?'} http=${metadata.httpStatusCode ?? '?'} tries=${metadata.attempts ?? 1}`;
}

/** Converte o catálogo de tools no `toolConfig` do Converse (omitido se vazio). */
function toToolConfig(tools?: LlmToolSpecInterface[]): { tools: Tool[] } | undefined {
  if (
    !tools
    || tools.length === 0
  ) {
    return undefined;
  }

  // `Tool` é uma union smithy (com membro $unknown) e `inputSchema.json` é DocumentType → cast.
  return {
    tools: tools.map((tool) => ({
      toolSpec: {
        name: tool.name,
        description: tool.description,
        inputSchema: { json: tool.inputSchema },
      },
    })) as Tool[],
  };
}

/**
 * Monta o input do `ConverseStreamCommand` a partir dos parâmetros da rodada. Função pura.
 *
 * @param {string} modelId - Id do modelo (inference profile).
 * @param {number} maxTokens - Limite de tokens de saída.
 * @param {LlmConverseParamsInterface} params - Sistema, histórico e tools da rodada.
 *
 * @returns {ConverseStreamCommandInput} Input pronto para o comando.
 */
export function buildConverseInput(
  modelId: string,
  maxTokens: number,
  params: LlmConverseParamsInterface,
): ConverseStreamCommandInput {
  return {
    modelId,
    system: params.system
      ? [{ text: params.system }]
      : undefined,
    messages: toConverseMessages(params.messages),
    toolConfig: toToolConfig(params.tools),
    inferenceConfig: { maxTokens },
  };
}

/** Estado mutável da acumulação de tool use ao traduzir o stream do Bedrock. */
interface ConverseToolStateInterface {
  toolUseId: string;
  toolName: string;
  toolInputJson: string;
  inTool: boolean;
}

/**
 * Traduz UM evento do Bedrock ConverseStream para um chunk do contrato (ou `null` quando o evento
 * só acumula estado, ex.: início de tool use ou fragmento de input). Muta `state`. Extraído de
 * {@link translateConverseStream} para manter cada função sob o limite de complexidade cognitiva.
 *
 * @param {BedrockStreamEventInterface} event - Evento do Converse.
 * @param {ConverseToolStateInterface} state - Estado da tool em acumulação (mutado por referência).
 * @returns {LlmStreamChunkType | null} Chunk a emitir, ou `null` se o evento só atualiza estado.
 */
function translateConverseEvent(
  event: BedrockStreamEventInterface,
  state: ConverseToolStateInterface,
): LlmStreamChunkType | null {
  const startToolUse = event.contentBlockStart?.start?.toolUse;

  if (startToolUse) {
    state.inTool = true;
    state.toolUseId = startToolUse.toolUseId ?? '';
    state.toolName = startToolUse.name ?? '';
    state.toolInputJson = '';

    return null;
  }

  if (event.contentBlockDelta?.delta) {
    const { delta } = event.contentBlockDelta;

    if (typeof delta.text === 'string') {
      return {
        type: 'text_delta',
        delta: delta.text,
      };
    }

    if (
      state.inTool
      && typeof delta.toolUse?.input === 'string'
    ) {
      state.toolInputJson += delta.toolUse.input;
    }

    return null;
  }

  if (
    event.contentBlockStop != null
    && state.inTool
  ) {
    state.inTool = false;

    return {
      type: 'tool_use',
      id: state.toolUseId,
      name: state.toolName as ToolNameType,
      args: parseJsonObject(state.toolInputJson),
    };
  }

  if (event.metadata?.usage) {
    const { usage } = event.metadata;

    return {
      type: 'usage',
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
    };
  }

  if (event.messageStop?.stopReason) {
    return {
      type: 'stop',
      reason: mapStopReason(event.messageStop.stopReason),
    };
  }

  return null;
}

/**
 * Traduz o stream de eventos do Bedrock ConverseStream para {@link LlmStreamChunkType}.
 * Função pura (sem I/O): acumula o input fragmentado da tool e fecha no `contentBlockStop`.
 *
 * @param {AsyncIterable<BedrockStreamEventInterface>} stream - Eventos do Converse.
 *
 * @returns {AsyncIterable<LlmStreamChunkType>} Chunks no contrato do provider.
 */
export async function* translateConverseStream(
  stream: AsyncIterable<BedrockStreamEventInterface>,
): AsyncIterable<LlmStreamChunkType> {
  const state: ConverseToolStateInterface = {
    toolUseId: '',
    toolName: '',
    toolInputJson: '',
    inTool: false,
  };

  for await (const event of stream) {
    // Flush de segurança: o Bedrock pode encerrar (`messageStop`, ex.: `stopReason=max_tokens` no
    // MEIO de um `toolUse`) sem mandar `contentBlockStop` → o `tool_use` ficaria preso em `state` e
    // a chamada se perderia (loop encerra com `done` em branco). Emite o pendente antes do stop.
    if (
      event.messageStop?.stopReason != null
      && state.inTool
    ) {
      state.inTool = false;

      yield {
        type: 'tool_use',
        id: state.toolUseId,
        name: state.toolName as ToolNameType,
        args: parseJsonObject(state.toolInputJson),
      };
    }

    const chunk = translateConverseEvent(
      event,
      state,
    );

    if (chunk) {
      yield chunk;
    }
  }
}

/**
 * Deriva um rótulo amigável do `modelId` (inference profile) para exibir na observabilidade.
 * Ex.: `us.amazon.nova-pro-v1:0` → `Amazon Nova Pro v1`. Sem casar o padrão, devolve o id cru
 * (sem prefixo de região), ou `Bedrock` se vazio.
 *
 * @param {string} modelId - Id do modelo no Bedrock (inference profile).
 * @returns {string} Rótulo amigável do modelo.
 */
export function friendlyModelName(modelId: string): string {
  if (!modelId) {
    return 'Bedrock';
  }

  // Tira o prefixo de inference profile por região (`us.`/`eu.`/`ap.`), preservando o vendor.
  const id = modelId.replace(
    /^[a-z]{2}\./,
    '',
  );

  // `amazon.nova-pro-v1:0` → `Amazon Nova Pro v1`: tira o sufixo `:N`, separa vendor +
  // palavras e capitaliza (tokens de versão `vN` ficam minúsculos).
  const words = id
    .replace(
      /:\d+$/,
      '',
    )
    .split(/[.\-_]/)
    .filter(Boolean)
    .map((word) => (/^v\d+$/.test(word)
      ? word
      : word.charAt(0).toUpperCase() + word.slice(1)));

  return words.length > 0
    ? words.join(' ')
    : modelId;
}

/**
 * Provider LLM concreto sobre o Amazon Bedrock (Nova via Bedrock, ConverseStream + tool use).
 *
 * INVARIANTE: a IA nunca toca o banco — só PEDE tool calls; a aplicação executa as tools.
 * Implementação trocável atrás de {@link LlmProviderInterface} (ver `LLM_PROVIDER` no módulo).
 */
@Injectable()
export class BedrockProvider implements LlmProviderInterface {
  /** Logger de diagnóstico do Converse (shape do payload, latências, erros por turno). */
  private readonly logger = new Logger(BedrockProvider.name);

  /** Cliente do Bedrock Runtime (auth Bearer via `token`). */
  private readonly client: BedrockRuntimeClient;

  /** Id do modelo (inference profile, ex.: `us.amazon.nova-pro-v1:0`). */
  private readonly modelId: string;

  /** Limite de tokens de saída por turno. */
  private readonly maxTokens: number;

  /**
   * @param {ConfigService} config - Fonte de `aws.region`, `bedrock.{modelId,apiKey,maxTokens}`.
   */
  constructor(config: ConfigService) {
    const apiKey = config.get<string>('bedrock.apiKey');

    this.client = new BedrockRuntimeClient({
      region: config.get<string>('aws.region'),
      ...(apiKey
        ? { token: { token: apiKey } }
        : {}),
    });

    this.modelId = config.get<string>('bedrock.modelId') ?? '';
    this.maxTokens = config.get<number>('bedrock.maxTokens') ?? 1024;
  }

  /**
   * Identifica o provider/modelo ativo (Bedrock + rótulo amigável do `modelId`).
   *
   * @returns {LlmDescriptorInterface} `{ provider: 'bedrock', model }`.
   */
  describe(): LlmDescriptorInterface {
    return {
      provider: 'bedrock',
      model: friendlyModelName(this.modelId),
    };
  }

  /**
   * Conduz um turno de conversa com o Nova via Bedrock (ConverseStream), traduzindo
   * cada evento do stream nativo para {@link LlmStreamChunkType}.
   *
   * @param {LlmConverseParamsInterface} params - Sistema, histórico e catálogo de tools da rodada.
   *
   * @returns {AsyncIterable<LlmStreamChunkType>} Stream de eventos: deltas de texto, pedidos de tool, uso e parada.
   */
  async *converseStream(
    params: LlmConverseParamsInterface,
  ): AsyncIterable<LlmStreamChunkType> {
    const input = buildConverseInput(
      this.modelId,
      this.maxTokens,
      params,
    );

    // Diagnóstico do #8 (turno pós-tool malformado): resume o shape do payload (papéis + tipos de
    // bloco) e cronometra `send`/1º token/stream. Erros do Converse (ValidationException etc.) saem
    // em `error` — sem isto, o orquestrador mascara tudo como "Falha ao processar a mensagem".
    const turn = `[converse] ${input.messages?.length ?? 0}msg ${describeConverseMessages(input.messages ?? [])}`;
    const sendStart = Date.now();

    let response: ConverseStreamCommandOutput;

    try {
      response = await this.client.send(new ConverseStreamCommand(input));
    } catch (error) {
      this.logger.error(`${turn} | send FALHOU após ${Date.now() - sendStart}ms: ${String(error)}`);

      throw error;
    }

    // `$metadata` do SDK: requestId (correlaciona com o suporte/CloudTrail da AWS), httpStatus e nº de
    // tentativas (retry > 0 sugere throttling — hipótese (b) do #8). Disponível antes de drenar o stream.
    const meta = describeMetadata(response.$metadata);

    if (!response.stream) {
      this.logger.warn(`${turn} | resposta SEM stream · ${meta}`);

      return;
    }

    const sendMs = Date.now() - sendStart;
    const stream = response.stream as AsyncIterable<BedrockStreamEventInterface>;
    let chunks = 0;
    let ttfbMs = 0;
    const streamStart = Date.now();

    try {
      for await (const chunk of translateConverseStream(stream)) {
        if (chunks === 0) {
          ttfbMs = Date.now() - streamStart;
        }

        chunks += 1;
        yield chunk;
      }
    } catch (error) {
      // O hang do #8 cai aqui via withIdleTimeout (`chunks === 0` = stream abriu mas não emitiu nada).
      // Loga o requestId + o shape do turno (papéis/blocos) p/ replay e correlação com a AWS.
      this.logger.error(`${turn} | stream FALHOU após ${chunks} chunks (send ${sendMs}ms) · ${meta}: ${String(error)}`);

      throw error;
    }

    this.logger.debug(`${turn} | send ${sendMs}ms · 1º token ${ttfbMs}ms · ${chunks} chunks em ${Date.now() - streamStart}ms · ${meta}`);
  }
}
