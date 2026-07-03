import type {
  ShippingEventType,
  ShippingStatusType,
} from '@atena/types';

/**
 * Janela temporal `[from, to)` de uma consulta de auditoria. Cada lado é opcional:
 * `null` significa "sem limite naquele lado" (ex.: `from: null` = desde o início do período).
 *
 * Os instantes já vêm resolvidos (presets como `24h`/`7d` são expandidos na borda).
 *
 * @property {Date | null} from - Limite inferior inclusivo; `null` = sem limite inferior.
 * @property {Date | null} to - Limite superior exclusivo; `null` = até agora.
 */
export interface AuditWindowInterface {
  from: Date | null;
  to: Date | null;
}

/**
 * Registro de entrega normalizado (por destinatário), derivado dos logs do S3. Espelha o
 * que `recordsToShippings` produzia para o hot store, mas é a unidade de saída do motor de
 * consulta (camelCase interno; o telefone é PII e só sai mascarado na borda da API).
 *
 * @property {string} id - Id estável do destinatário (determinístico: `internal_identifier|phone`).
 * @property {string} customerId - Cliente dono do envio (`context.user_id`).
 * @property {string} phoneE164 - Telefone em E.164 (PII; mascarar na borda, revelar só sob auditoria).
 * @property {string | null} provider - Provedor de envio (`payload.provider`); `null` se ausente no log.
 * @property {string | null} correlationId - Id da requisição/campanha (`correlation_id`, top-level); 1-para-muitos destinatários.
 * @property {ShippingStatusType} finalStatus - Status consolidado (último evento terminal; senão último visto).
 * @property {Date} requestedAt - Instante do envio (`payload.date`/timestamp do envio).
 * @property {Date | null} finalizedAt - Instante preciso do desfecho (`status_at`/timestamp do status); `null` se sem status.
 * @property {string | null} errorHint - Motivo da falha (`failure_reason`/`error_code`/status) quando `failed`; senão `null`.
 * @property {string | null} contentRef - Ponteiro S3 do conteúdo bruto (para reveal via cache); `null` se indisponível.
 * @property {string | null} content - Texto bruto do SMS (PII), do campo `message` do detailed report; só sai
 *   sob reveal auditado na borda (mascarado por padrão); `null` se ausente no log.
 */
export interface DeliveryRecordInterface {
  id: string;
  customerId: string;
  phoneE164: string;
  provider: string | null;
  correlationId: string | null;
  /** Canal do envio (`campaign_type`): `sms` (SMS Short) ou `sms_flash` (SMS Flash). */
  channel: string | null;
  /** Aplicação que originou o envio (atribuição); UUID no detailed report. */
  appId: string | null;
  finalStatus: ShippingStatusType;
  requestedAt: Date;
  finalizedAt: Date | null;
  errorHint: string | null;
  contentRef: string | null;
  content: string | null;
}

/**
 * Evento na trilha (lifecycle) de um envio, reconstruído dos logs de status.
 *
 * @property {ShippingEventType} type - Etapa do evento no ciclo de vida.
 * @property {string} label - Rótulo curto para exibição.
 * @property {Date} at - Instante do evento.
 * @property {string} detail - Detalhe legível do que ocorreu.
 */
export interface DeliveryTrailEventInterface {
  type: ShippingEventType;
  label: string;
  at: Date;
  detail: string;
}

/**
 * Trilha completa de um envio: o registro consolidado + a linha do tempo de eventos.
 *
 * @property {DeliveryRecordInterface} record - Registro consolidado do destinatário.
 * @property {DeliveryTrailEventInterface[]} events - Eventos do lifecycle, em ordem cronológica.
 */
export interface DeliveryTrailInterface {
  record: DeliveryRecordInterface;
  events: DeliveryTrailEventInterface[];
}

/**
 * Filtros de busca/relatório sobre os registros de entrega. Todos opcionais, exceto a janela.
 *
 * @property {AuditWindowInterface} [window] - Janela temporal; ausente → o motor usa a janela default.
 * @property {string} [phone] - Telefone E.164 (match exato).
 * @property {ShippingStatusType} [status] - Status final para filtrar.
 * @property {string} [provider] - Provedor de envio.
 * @property {string} [customerId] - Cliente (match exato).
 * @property {string} [correlationId] - Id da requisição/campanha (`correlation_id`) — devolve os destinatários daquela requisição.
 */
export interface AuditSearchFilterInterface {
  window?: AuditWindowInterface;
  phone?: string;
  status?: ShippingStatusType;
  provider?: string;
  customerId?: string;
  correlationId?: string;
}

/**
 * Totais por status de um relatório de entregabilidade.
 *
 * @property {number} sent - Total de envios na janela.
 * @property {number} delivered - Entregues.
 * @property {number} failed - Falhas (desfecho negativo do fornecedor).
 * @property {number} blocked - Bloqueados pelo controle de entrega (bounce: blacklist/throttling); NÃO é falha.
 * @property {number} pending - Em trânsito/sem desfecho.
 */
export interface DeliveryTotalsInterface {
  sent: number;
  delivered: number;
  failed: number;
  blocked: number;
  pending: number;
}

/**
 * Quebra de entregabilidade por provedor.
 *
 * @property {string} name - Nome do provedor.
 * @property {number} sent - Envios do provedor na janela.
 * @property {number} delivered - Entregues do provedor.
 * @property {number} rate - Taxa de entrega (%) com uma casa decimal.
 */
export interface ProviderBreakdownInterface {
  name: string;
  sent: number;
  delivered: number;
  rate: number;
}

/**
 * Erro recorrente no relatório, com o provedor dominante do código.
 *
 * @property {string} code - Código/motivo do erro (`errorHint`).
 * @property {number} count - Ocorrências na janela.
 * @property {string} provider - Provedor dominante do código (`mix` se indefinido).
 */
export interface TopErrorInterface {
  code: string;
  count: number;
  provider: string;
}

/**
 * Agregado do relatório de entregabilidade computado pelo motor (em SQL). A borda
 * (`ReportsService`) acrescenta `window` (rótulo) e `csv_url`.
 *
 * @property {DeliveryTotalsInterface} totals - Totais por status.
 * @property {ProviderBreakdownInterface[]} byProvider - Quebra por provedor (taxa de entrega).
 * @property {Array<{ at: string; rate: number }>} hourly - Taxa de entrega por hora em buckets
 *   CRONOLÓGICOS; `at` = início do bucket (ISO 8601 UTC). Cobre os dias da janela.
 * @property {TopErrorInterface[]} topErrors - Top-5 erros por contagem.
 */
export interface DeliveryReportAggregateInterface {
  totals: DeliveryTotalsInterface;
  byProvider: ProviderBreakdownInterface[];
  hourly: Array<{
    at: string;
    rate: number
  }>;
  topErrors: TopErrorInterface[];
}

/**
 * Página de resultados da busca: linhas + total de itens (para paginação na borda).
 *
 * @property {DeliveryRecordInterface[]} rows - Registros da página atual.
 * @property {number} total - Total de itens que casam o filtro (todas as páginas).
 * @property {AuditWindowInterface} [window] - Janela EFETIVA que o motor consultou (resolvida/default).
 *   A borda a usa para congelar o export: o download pelo `window` exato bate com o `total` exibido,
 *   em vez de reabrir o preset relativo (`24h`) num instante posterior (que desliza).
 */
export interface DeliveryPageInterface {
  rows: DeliveryRecordInterface[];
  total: number;
  window?: AuditWindowInterface;
  /** Quebra por status final de TODO o conjunto que casa o filtro (não só a página). */
  breakdown?: {
    delivered: number;
    failed: number;
    pending: number
  };
  /** Token do snapshot (Parquet) do conjunto exato — o export por token o lê (byte-exato). */
  snapshotToken?: string;
}

/**
 * Etapa do motor reportada via {@link AuditProgressCallback} durante a materialização da janela:
 * - `mapping` — mapeando as partições candidatas da janela (antes de tocar o S3);
 * - `reading` — lendo do S3 uma partição ainda fria (write-through pro cache `/tmp`); a etapa cara;
 * - `querying` — partições prontas (cache quente ou recém-lidas), rodando as queries locais.
 */
export type AuditProgressPhaseType =
  | 'mapping'
  | 'reading'
  | 'querying';

/**
 * Evento de andamento da materialização de uma consulta, emitido pelo motor para a borda (SSE).
 *
 * @property {AuditProgressPhaseType} phase - Etapa atual do motor.
 * @property {string} label - Rótulo legível (PT-BR) para exibição na UI.
 * @property {number} [current] - Partição atual (base 1) na etapa `reading`; para barra de progresso.
 * @property {number} [total] - Total de partições da janela; para barra de progresso.
 */
export interface AuditProgressEventInterface {
  phase: AuditProgressPhaseType;
  label: string;
  current?: number;
  total?: number;
}

/**
 * Callback opcional de progresso: o motor o invoca a cada mudança de etapa da materialização.
 * Síncrono e best-effort — a borda (orquestrador) faz a ponte para eventos SSE `tool_progress`.
 *
 * @param {AuditProgressEventInterface} event - Etapa atual + rótulo (e contagem de partições).
 */
export type AuditProgressCallback = (event: AuditProgressEventInterface) => void;
