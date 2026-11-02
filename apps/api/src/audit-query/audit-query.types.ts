import type {
  ShippingEventType,
  ShippingStatusType,
} from '@atena/types';

/**
 * Janela temporal `[from, to)` de uma consulta de auditoria. Cada lado é opcional:
 * `null` significa "sem limite naquele lado" (ex.: `from: null` = desde o início do período).
 *
 * Os instantes já vêm resolvidos (presets como `24h`/`7d` são expandidos na borda).
 */
export interface AuditWindowInterface {
  /** Limite inferior inclusivo; `null` = sem limite inferior. */
  from: Date | null;
  /** Limite superior exclusivo; `null` = até agora. */
  to: Date | null;
}

/**
 * Registro de entrega normalizado (por destinatário), derivado dos logs do S3. Espelha o
 * que `recordsToShippings` produzia para o hot store, mas é a unidade de saída do motor de
 * consulta (camelCase interno; o telefone é PII e só sai mascarado na borda da API).
 */
export interface DeliveryRecordInterface {
  /** Id estável do destinatário (determinístico: `internal_identifier|phone`). */
  id: string;
  /** Cliente dono do envio (`context.user_id`). */
  customerId: string;
  /** Telefone em E.164 (PII; mascarar na borda, revelar só sob auditoria). */
  phoneE164: string;
  /** Provedor de envio (`payload.provider`); `null` se ausente no log. */
  provider: string | null;
  /** Id da requisição/campanha (`correlation_id`, top-level); 1-para-muitos destinatários. */
  correlationId: string | null;
  /** Canal do envio (`campaign_type`): `sms` (SMS Short) ou `sms_flash` (SMS Flash). */
  channel: string | null;
  /** Aplicação que originou o envio (atribuição); UUID no detailed report. */
  appId: string | null;
  /** Status consolidado (último evento terminal; senão último visto). */
  finalStatus: ShippingStatusType;
  /** Instante do envio (`payload.date`/timestamp do envio). */
  requestedAt: Date;
  /** Instante preciso do desfecho (`status_at`/timestamp do status); `null` se sem status. */
  finalizedAt: Date | null;
  /** Motivo da falha (`failure_reason`/`error_code`/status) quando `failed`; senão `null`. */
  errorHint: string | null;
  /** Ponteiro S3 do conteúdo bruto (para reveal via cache); `null` se indisponível. */
  contentRef: string | null;
  /**
   * Texto bruto do SMS (PII), do campo `message` do detailed report; só sai
   * sob reveal auditado na borda (mascarado por padrão); `null` se ausente no log.
   */
  content: string | null;
}

/** Evento na trilha (lifecycle) de um envio, reconstruído dos logs de status. */
export interface DeliveryTrailEventInterface {
  /** Etapa do evento no ciclo de vida. */
  type: ShippingEventType;
  /** Rótulo curto para exibição. */
  label: string;
  /** Instante do evento. */
  at: Date;
  /** Detalhe legível do que ocorreu. */
  detail: string;
}

/** Trilha completa de um envio: o registro consolidado + a linha do tempo de eventos. */
export interface DeliveryTrailInterface {
  /** Registro consolidado do destinatário. */
  record: DeliveryRecordInterface;
  /** Eventos do lifecycle, em ordem cronológica. */
  events: DeliveryTrailEventInterface[];
}

/** Filtros de busca/relatório sobre os registros de entrega. Todos opcionais, exceto a janela. */
export interface AuditSearchFilterInterface {
  /** Janela temporal; ausente → o motor usa a janela default. */
  window?: AuditWindowInterface;
  /** Telefone E.164 (match exato). */
  phone?: string;
  /** Status final para filtrar. */
  status?: ShippingStatusType;
  /** Provedor de envio. */
  provider?: string;
  /** Canal do envio (`campaign_type`): `sms` (SMS Short) ou `sms_flash` (SMS Flash). */
  channel?: string;
  /**
   * Categoria da falha terminal (`error_hint`): `invalid_number`, `unreachable`,
   * `generic_error`, `request_error`, etc. Só casa envios `failed` (o `error_hint` é `null` para delivered/blocked/pending).
   */
  errorHint?: string;
  /** Cliente (match exato). */
  customerId?: string;
  /** Id da requisição/campanha (`correlation_id`) — devolve os destinatários daquela requisição. */
  correlationId?: string;
}

/** Totais por status de um relatório de entregabilidade. */
interface DeliveryTotalsInterface {
  /** Total de envios na janela. */
  sent: number;
  /** Entregues. */
  delivered: number;
  /** Falhas (desfecho negativo do fornecedor). */
  failed: number;
  /** Bloqueados pelo controle de entrega (bounce: blacklist/throttling); NÃO é falha. */
  blocked: number;
  /** Em trânsito/sem desfecho. */
  pending: number;
}

/** Quebra de entregabilidade por provedor. */
interface ProviderBreakdownInterface {
  /** Nome do provedor. */
  name: string;
  /** Envios do provedor na janela. */
  sent: number;
  /** Entregues do provedor. */
  delivered: number;
  failed: number;
  blocked: number;
  pending: number;
  /** Taxa de entrega (%) com uma casa decimal. */
  rate: number;
}

/** Erro recorrente no relatório, com o provedor dominante do código. */
interface TopErrorInterface {
  /** Código/motivo do erro (`errorHint`). */
  code: string;
  /** Ocorrências na janela. */
  count: number;
  /** Provedor dominante do código (`mix` se indefinido). */
  provider: string;
}

/**
 * Agregado do relatório de entregabilidade computado pelo motor (em SQL). A borda
 * (`ReportsService`) acrescenta `window` (rótulo) e `csv_url`.
 */
export interface DeliveryReportAggregateInterface {
  /** Totais por status. */
  totals: DeliveryTotalsInterface;
  /** Quebra por provedor (taxa de entrega). */
  byProvider: ProviderBreakdownInterface[];
  /**
   * Taxa de entrega por hora em buckets
   * CRONOLÓGICOS; `at` = início do bucket (ISO 8601 UTC). Cobre os dias da janela.
   */
  hourly: {
    at: string;
    rate: number
  }[];
  /** Top-5 erros por contagem. */
  topErrors: TopErrorInterface[];
}

/** Página de resultados da busca: linhas + total de itens (para paginação na borda). */
export interface DeliveryPageInterface {
  /** Registros da página atual. */
  rows: DeliveryRecordInterface[];
  /** Total de itens que casam o filtro (todas as páginas). */
  total: number;
  /**
   * Janela EFETIVA que o motor consultou (resolvida/default).
   * A borda a usa para congelar o export: o download pelo `window` exato bate com o `total` exibido,
   * em vez de reabrir o preset relativo (`24h`) num instante posterior (que desliza).
   */
  window?: AuditWindowInterface;
  /** Breakdown by final status of the whole set that matches the filter (not just the page). */
  breakdown?: {
    delivered: number;
    failed: number;
    blocked: number;
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
type AuditProgressPhaseType =
  | 'mapping'
  | 'reading'
  | 'querying';

/** Evento de andamento da materialização de uma consulta, emitido pelo motor para a borda (SSE). */
export interface AuditProgressEventInterface {
  /** Etapa atual do motor. */
  phase: AuditProgressPhaseType;
  /** Rótulo legível (PT-BR) para exibição na UI. */
  label: string;
  /** Partição atual (base 1) na etapa `reading`; para barra de progresso. */
  current?: number;
  /** Total de partições da janela; para barra de progresso. */
  total?: number;
}

/**
 * Callback opcional de progresso: o motor o invoca a cada mudança de etapa da materialização.
 * Síncrono e best-effort — a borda (orquestrador) faz a ponte para eventos SSE `tool_progress`.
 *
 * @param {AuditProgressEventInterface} event - Etapa atual + rótulo (e contagem de partições).
 */
export type AuditProgressCallback = (event: AuditProgressEventInterface) => void;
