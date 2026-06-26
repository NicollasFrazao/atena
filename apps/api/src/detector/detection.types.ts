import type {
  DimensionType,
  IncidentSeverityType,
  ShippingStatusType,
  RuleType,
} from '@atena/types';

/** Amostra mínima de envio usada pelo detector (sem PII). */
export interface ShippingSampleInterface {
  /** Id do envio (destinatário): `md5(campaign_id||phone)` — usado p/ persistir os impactados. */
  id: string;
  customerId: string;
  finalStatus: ShippingStatusType;
  /** Instante do DESFECHO (status terminal: `finalized_at`/`status_at`) — base do janelamento. */
  occurredAt: Date;
  /** Dica de erro (`metadata.errorHint` = `failure_reason`/`error_code`) quando falhou — usada por `consistent_error`. */
  errorHint?: string | null;
  /** Provedor de envio — usado por `webhook_silence` (dimensão `provider`). */
  provider?: string | null;
  /** Instante do ENVIO (`requested_at`) — usado por `webhook_silence` p/ contar envios na janela. */
  requestedAt?: Date;
  /** Instante PRECISO do status (`finalized_at`); `null` se nunca chegou status — usado por `webhook_silence`. */
  finalizedAt?: Date | null;
}

/** Regra de anomalia no shape consumido pelos detectores. */
export interface DetectorRuleInterface {
  id: string;
  name: string;
  ruleType: RuleType;
  dimension: DimensionType;
  severity: IncidentSeverityType;
  threshold: number;
  windowMinutes: number;
  /** Categoria de erro alvo do `consistent_error` (ex.: `invalid_number`); ausente/`null` = dominante. */
  category?: string | null;
}

/** Métricas de suporte exibidas no incidente (strings legíveis). */
export interface DetectionMetricsInterface {
  baseline: string;
  current: string;
  threshold: string;
  sample: string;
}

/** Uma anomalia detectada por uma regra, em um valor de dimensão. */
export interface DetectionInterface {
  ruleId: string;
  ruleName: string;
  dimensionType: DimensionType;
  dimensionValue: string;
  severity: IncidentSeverityType;
  windowStart: Date;
  windowEnd: Date;
  summary: string;
  metrics: DetectionMetricsInterface;
  relatedShippings: number;
  /** Ids dos envios (destinatários) que o detector contou como impactados — base do download exato. */
  relatedShippingIds: string[];
}

/** Calibração do detector (parametrizável por `.env`). */
export interface DetectorOptionsInterface {
  minTerminalVolume: number;
  baselineWindows: number;
}
