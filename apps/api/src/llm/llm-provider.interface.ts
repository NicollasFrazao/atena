/**
 * Abstração de provider LLM da Atena.
 *
 * DECISÃO: LLM via Amazon Bedrock (Nova via Bedrock, Converse API: streaming + tool use),
 * atrás desta interface para ser trocável. PRINCÍPIO: a IA só PEDE tool calls; a aplicação
 * executa as tools e toca o banco — a execução de tools NÃO acontece aqui.
 */
import type { ToolNameType } from '@atena/types';

// ---------------------------------------------------------------------------
// Chunks do stream (saída do provider)
// ---------------------------------------------------------------------------

/**
 * Pedaço incremental de texto gerado pelo modelo.
 *
 * @property {'text_delta'} type - Discriminante da união {@link LlmStreamChunkType}.
 * @property {string} delta - Fragmento de texto a anexar à resposta em construção.
 */
export interface LlmTextDeltaInterface {
  type: 'text_delta';
  delta: string;
}

/**
 * Pedido de tool call emitido pelo modelo. O orquestrador é quem executa a tool
 * (e toca o banco) e devolve o resultado numa próxima chamada `converseStream`.
 *
 * @property {'tool_use'} type - Discriminante da união {@link LlmStreamChunkType}.
 * @property {ToolNameType} name - Nome da tool que o modelo pede para executar.
 * @property {Record<string, unknown>} args - Argumentos da tool pedidos pelo modelo.
 * @property {string} [id] - Id da tool call (`toolUseId` do Bedrock) — correlaciona com o `tool_result` do próximo turno.
 */
export interface LlmToolUseInterface {
  type: 'tool_use';
  name: ToolNameType;
  args: Record<string, unknown>;
  id?: string;
}

/**
 * Sinal de fim de turno do modelo, com a razão da parada.
 *
 * @property {'stop'} type - Discriminante da união {@link LlmStreamChunkType}.
 * @property {'end_turn' | 'tool_use' | 'refusal'} reason - Razão da parada: turno concluído, pedido de tool, ou recusa/segurança.
 */
export interface LlmStopInterface {
  type: 'stop';
  reason: 'end_turn' | 'tool_use' | 'refusal';
}

/**
 * Uso de tokens reportado pelo modelo no turno (Bedrock Converse: evento `metadata.usage`).
 *
 * @property {'usage'} type - Discriminante da união {@link LlmStreamChunkType}.
 * @property {number} inputTokens - Tokens de entrada (prompt) consumidos no turno.
 * @property {number} outputTokens - Tokens de saída (geração) produzidos no turno.
 */
export interface LlmUsageInterface {
  type: 'usage';
  inputTokens: number;
  outputTokens: number;
}

/** União discriminada dos eventos que o stream do provider pode emitir. */
export type LlmStreamChunkType =
  | LlmTextDeltaInterface
  | LlmToolUseInterface
  | LlmUsageInterface
  | LlmStopInterface;

// ---------------------------------------------------------------------------
// Entrada do provider
// ---------------------------------------------------------------------------

/**
 * Especificação de uma tool exposta ao modelo (apenas o contrato; sem execução).
 *
 * @property {ToolNameType} name - Identificador da tool.
 * @property {string} description - Descrição usada pelo modelo para decidir quando chamá-la.
 * @property {Record<string, unknown>} inputSchema - JSON Schema dos argumentos aceitos pela tool.
 */
export interface LlmToolSpecInterface {
  name: ToolNameType;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * Mensagem de uma conversa. `tool` carrega o resultado de uma tool executada pela
 * aplicação, devolvido ao modelo no próximo turno. `content` é livre (texto, blocos
 * de tool_use/tool_result, etc.) — o provider concreto faz o mapeamento para o payload nativo.
 *
 * @property {'user' | 'assistant' | 'tool'} role - Autor da mensagem; `tool` traz o resultado de uma tool executada pela aplicação.
 * @property {unknown} content - Conteúdo livre (texto ou blocos de tool_use/tool_result); o provider concreto mapeia para o payload nativo.
 */
export interface LlmMessageInterface {
  role: 'user' | 'assistant' | 'tool';
  content: unknown;
}

/**
 * Parâmetros de uma rodada de conversa com streaming.
 *
 * @property {string} [system] - Prompt de sistema, quando houver.
 * @property {LlmMessageInterface[]} messages - Histórico da conversa enviado ao modelo.
 * @property {LlmToolSpecInterface[]} [tools] - Catálogo de tools disponíveis ao modelo (apenas contrato; sem execução).
 */
export interface LlmConverseParamsInterface {
  system?: string;
  messages: LlmMessageInterface[];
  tools?: LlmToolSpecInterface[];
}

// ---------------------------------------------------------------------------
// Contrato do provider
// ---------------------------------------------------------------------------

/**
 * Identidade do provider LLM ativo — para exibir na observabilidade (qual modelo está atendendo).
 *
 * @property {'bedrock' | 'fake'} provider - Provider concreto em uso.
 * @property {string} model - Rótulo amigável do modelo (ex.: `Amazon Nova Pro v1`) ou `Simulado` (fake).
 */
export interface LlmDescriptorInterface {
  provider: 'bedrock' | 'fake';
  model: string;
}

/**
 * Provider LLM trocável: expõe apenas conversa com streaming e tool use.
 * INVARIANTE: a IA nunca toca o banco — só PEDE tool calls; a aplicação executa as tools.
 */
export interface LlmProviderInterface {
  /**
   * Conduz um turno de conversa com o modelo, em streaming.
   *
   * @param {LlmConverseParamsInterface} params - Sistema, histórico e catálogo de tools.
   * @returns {AsyncIterable<LlmStreamChunkType>} Stream de eventos: deltas de texto, pedidos de tool e parada.
   */
  converseStream(params: LlmConverseParamsInterface): AsyncIterable<LlmStreamChunkType>;

  /**
   * Identifica o provider/modelo ativo (para a observabilidade).
   *
   * @returns {LlmDescriptorInterface} Provider concreto + rótulo amigável do modelo.
   */
  describe(): LlmDescriptorInterface;
}

/** Token de injeção do NestJS para o `LlmProviderInterface`. */
export const LLM_PROVIDER = Symbol('LLM_PROVIDER');
