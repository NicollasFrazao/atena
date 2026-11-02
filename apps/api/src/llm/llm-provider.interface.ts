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

/** Pedaço incremental de texto gerado pelo modelo. */
interface LlmTextDeltaInterface {
  /** Discriminante da união {@link LlmStreamChunkType}. */
  type: 'text_delta';
  /** Fragmento de texto a anexar à resposta em construção. */
  delta: string;
}

/**
 * Pedido de tool call emitido pelo modelo. O orquestrador é quem executa a tool
 * (e toca o banco) e devolve o resultado numa próxima chamada `converseStream`.
 */
export interface LlmToolUseInterface {
  /** Discriminante da união {@link LlmStreamChunkType}. */
  type: 'tool_use';
  /** Nome da tool que o modelo pede para executar. */
  name: ToolNameType;
  /** Argumentos da tool pedidos pelo modelo. */
  args: Record<string, unknown>;
  /** Id da tool call (`toolUseId` do Bedrock) — correlaciona com o `tool_result` do próximo turno. */
  id?: string;
}

/** Sinal de fim de turno do modelo, com a razão da parada. */
export interface LlmStopInterface {
  /** Discriminante da união {@link LlmStreamChunkType}. */
  type: 'stop';
  /** Razão da parada: turno concluído, pedido de tool, ou recusa/segurança. */
  reason: 'end_turn' | 'tool_use' | 'refusal';
}

/** Uso de tokens reportado pelo modelo no turno (Bedrock Converse: evento `metadata.usage`). */
interface LlmUsageInterface {
  /** Discriminante da união {@link LlmStreamChunkType}. */
  type: 'usage';
  /** Tokens de entrada (prompt) consumidos no turno. */
  inputTokens: number;
  /** Tokens de saída (geração) produzidos no turno. */
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

/** Especificação de uma tool exposta ao modelo (apenas o contrato; sem execução). */
export interface LlmToolSpecInterface {
  /** Identificador da tool. */
  name: ToolNameType;
  /** Descrição usada pelo modelo para decidir quando chamá-la. */
  description: string;
  /** JSON Schema dos argumentos aceitos pela tool. */
  inputSchema: Record<string, unknown>;
}

/**
 * Mensagem de uma conversa. `tool` carrega o resultado de uma tool executada pela
 * aplicação, devolvido ao modelo no próximo turno. `content` é livre (texto, blocos
 * de tool_use/tool_result, etc.) — o provider concreto faz o mapeamento para o payload nativo.
 */
export interface LlmMessageInterface {
  /** Autor da mensagem; `tool` traz o resultado de uma tool executada pela aplicação. */
  role: 'user' | 'assistant' | 'tool';
  /** Conteúdo livre (texto ou blocos de tool_use/tool_result); o provider concreto mapeia para o payload nativo. */
  content: unknown;
}

/** Parâmetros de uma rodada de conversa com streaming. */
export interface LlmConverseParamsInterface {
  /** Prompt de sistema, quando houver. */
  system?: string;
  /** Histórico da conversa enviado ao modelo. */
  messages: LlmMessageInterface[];
  /** Catálogo de tools disponíveis ao modelo (apenas contrato; sem execução). */
  tools?: LlmToolSpecInterface[];
}

// ---------------------------------------------------------------------------
// Contrato do provider
// ---------------------------------------------------------------------------

/** Identidade do provider LLM ativo — para exibir na observabilidade (qual modelo está atendendo). */
export interface LlmDescriptorInterface {
  /** Provider concreto em uso. */
  provider: 'bedrock' | 'fake';
  /** Rótulo amigável do modelo (ex.: `Amazon Nova Pro v1`) ou `Simulado` (fake). */
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
   * @param params - Sistema, histórico e catálogo de tools.
   *
   * @returns Stream de eventos: deltas de texto, pedidos de tool e parada.
   */
  converseStream(params: LlmConverseParamsInterface): AsyncIterable<LlmStreamChunkType>;

  /**
   * Identifica o provider/modelo ativo (para a observabilidade).
   *
   * @returns Provider concreto + rótulo amigável do modelo.
   */
  describe(): LlmDescriptorInterface;
}

/** Token de injeção do NestJS para o `LlmProviderInterface`. */
export const LLM_PROVIDER = Symbol('LLM_PROVIDER');
