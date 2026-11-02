import { HUNDRED_PERCENT, MS_PER_MINUTE } from '../common/units';
import type {
  DetectionInterface,
  DetectorOptionsInterface,
  DetectorRuleInterface,
  ShippingSampleInterface,
} from './detection.types';

/** Mínimo de buckets de baseline para um σ confiável. */
const MIN_BASELINE_BUCKETS = 3;

/** σ abaixo do qual o baseline é tratado como "plano" (usa queda relativa). */
const FLAT_SIGMA = 0.001;

/** Queda relativa (fração) usada quando o baseline é plano (σ ≈ 0). */
const FLAT_BASELINE_DROP = 0.2;

/** Verdadeiro para status terminais (entram no cálculo da taxa). */
function isTerminal(status: ShippingSampleInterface['finalStatus']): boolean {
  return status === 'delivered' || status === 'failed';
}

/** Valor da dimensão da regra numa amostra: provedor (dim. `provider`) ou cliente (demais). */
function dimensionValueOf(
  rule: DetectorRuleInterface,
  message: ShippingSampleInterface,
): string {
  return rule.dimension === 'provider'
    ? (message.provider ?? '').trim()
    : message.customerId;
}

/** Substantivo legível da dimensão da regra (para o resumo do incidente). */
function dimensionNoun(rule: DetectorRuleInterface): string {
  return rule.dimension === 'provider'
    ? 'provedor'
    : 'cliente';
}

/** Taxa de entrega (delivered / terminais) de um conjunto já filtrado de terminais. */
function deliveryRate(messages: ShippingSampleInterface[]): number {
  if (messages.length === 0) {
    return 0;
  }

  const delivered = messages.filter((message) => message.finalStatus === 'delivered').length;

  return delivered / messages.length;
}

/** Média aritmética de uma lista não-vazia. */
function mean(values: number[]): number {
  const sum = values.reduce(
    (
      acc,
      value,
    ) => acc + value,
    0,
  );

  return sum / values.length;
}

/** Desvio-padrão populacional em torno de `mu`. */
function stddev(
  values: number[],
  mu: number,
): number {
  const variance = mean(values.map((value) => (value - mu) ** 2));

  return Math.sqrt(variance);
}

/** Formata uma fração como percentual legível (ex.: `0.871` → `87.1%`). */
function pct(value: number): string {
  return `${(value * HUNDRED_PERCENT).toFixed(1)}%`;
}

/** Taxas de entrega dos buckets de baseline (janelas anteriores com volume > 0). */
function baselineBucketRates(
  messages: ShippingSampleInterface[],
  baselineStart: number,
  windowMs: number,
  buckets: number,
): number[] {
  const rates: number[] = [];

  for (let index = 0; index < buckets; index++) {
    const start = baselineStart + index * windowMs;
    const end = start + windowMs;

    const bucket = messages.filter((message) => {
      const ts = message.occurredAt.getTime();

      return ts >= start && ts < end;
    });

    if (bucket.length > 0) {
      rates.push(deliveryRate(bucket));
    }
  }

  return rates;
}

/** One group of the dimension (customer or provider) evaluated by the delivery-rate-drop rule. */
interface GroupEvaluationInterface {
  /** Rule (threshold in σ, window, dimension). */
  rule: DetectorRuleInterface;
  /** Value of the dimension evaluated (customer or provider). */
  dimensionValue: string;
  /** The group's terminal samples in the lookback. */
  terminals: ShippingSampleInterface[];
  /** Reference instant of the evaluation. */
  now: Date;
  /** Calibration (minimum volume, number of windows). */
  opts: DetectorOptionsInterface;
}

/**
 * Avalia um grupo da dimensão (cliente ou provedor): dispara se a taxa atual cair além do
 * limiar (em σ vs. baseline, ou queda relativa quando o baseline é plano) com volume suficiente.
 *
 * @param evaluation - The rule, the group and its terminal samples, the reference instant and the calibration.
 *
 * @returns Anomalia detectada, ou `null`.
 */
function evaluateGroup(evaluation: GroupEvaluationInterface): DetectionInterface | null {
  const {
    rule,
    dimensionValue,
    terminals,
    now,
    opts,
  } = evaluation;

  const windowMs = rule.windowMinutes * MS_PER_MINUTE;
  const end = now.getTime();
  const currentStart = end - windowMs;
  const baselineStart = currentStart - opts.baselineWindows * windowMs;

  const current = terminals.filter((message) => message.occurredAt.getTime() >= currentStart);

  if (current.length < opts.minTerminalVolume) {
    return null;
  }

  const rates = baselineBucketRates(
    terminals,
    baselineStart,
    windowMs,
    opts.baselineWindows,
  );

  if (rates.length < MIN_BASELINE_BUCKETS) {
    return null;
  }

  const currentRate = deliveryRate(current);
  const mu = mean(rates);

  const sigma = stddev(
    rates,
    mu,
  );

  const drop = mu - currentRate;

  const triggered = sigma > FLAT_SIGMA
    ? drop >= rule.threshold * sigma
    : drop >= FLAT_BASELINE_DROP;

  if (!triggered) {
    return null;
  }

  return {
    ruleId: rule.id,
    ruleName: rule.name,
    dimensionType: rule.dimension,
    dimensionValue,
    severity: rule.severity,
    windowStart: new Date(currentStart),
    windowEnd: new Date(end),
    summary: `Taxa de entrega do ${dimensionNoun(rule)} ${dimensionValue} caiu de ${pct(mu)} (baseline) para ${pct(currentRate)} na janela de ${rule.windowMinutes} min.`,
    metrics: {
      baseline: pct(mu),
      current: pct(currentRate),
      threshold: `${rule.threshold}σ`,
      sample: `${current.length} terminais`,
    },
    relatedShippings: current.length,
    relatedShippingIds: current.map((message) => message.id),
  };
}

/**
 * Detecta queda de taxa de entrega POR CLIENTE: agrupa terminais por cliente e
 * compara a janela atual com o baseline rolante (μ/σ), com guarda de volume.
 * Função pura — recebe `now` e a calibração, sem I/O nem relógio implícito.
 *
 * @param rule - Regra `delivery_rate_drop` (dim. `customer`).
 * @param messages - Mensagens do lookback (qualquer status).
 * @param now - Instante de referência.
 * @param opts - Calibração.
 *
 * @returns Uma detecção por cliente anômalo.
 */
export function detectDeliveryRateDrop(
  rule: DetectorRuleInterface,
  messages: ShippingSampleInterface[],
  now: Date,
  opts: DetectorOptionsInterface,
): DetectionInterface[] {
  // Agrupa pela DIMENSÃO da regra: por cliente (default) ou por provedor (degradação provider-wide).
  const byDimension = new Map<string, ShippingSampleInterface[]>();

  for (const message of messages) {
    if (!isTerminal(message.finalStatus)) {
      continue;
    }

    const key = dimensionValueOf(
      rule,
      message,
    );

    if (!key) {
      continue;
    }

    const list = byDimension.get(key) ?? [];

    list.push(message);

    byDimension.set(
      key,
      list,
    );
  }

  const detections: DetectionInterface[] = [];

  for (const [
    dimensionValue,
    terminals,
  ] of byDimension) {
    const detection = evaluateGroup({
      rule,
      dimensionValue,
      terminals,
      now,
      opts,
    });

    if (detection) {
      detections.push(detection);
    }
  }

  return detections;
}
