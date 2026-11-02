import { HUNDRED_PERCENT, MS_PER_MINUTE } from '../common/units';
import type {
  DetectionInterface,
  DetectorOptionsInterface,
  DetectorRuleInterface,
  ShippingSampleInterface,
} from './detection.types';

/** Mínimo de buckets de baseline para um σ confiável. */
const MIN_BASELINE_BUCKETS = 3;

/** σ abaixo do qual o baseline é tratado como "plano" (usa alta relativa absoluta). */
const FLAT_SIGMA = 0.001;

/** Alta relativa (fração) usada quando o baseline é plano (σ ≈ 0). */
const FLAT_BASELINE_RISE = 0.2;

/** Verdadeiro para status terminais (entram no cálculo da taxa). */
function isTerminal(status: ShippingSampleInterface['finalStatus']): boolean {
  return status === 'delivered' || status === 'failed';
}

/** Taxa de FALHA (failed / terminais) de um conjunto já filtrado de terminais. */
function failureRate(messages: ShippingSampleInterface[]): number {
  if (messages.length === 0) {
    return 0;
  }

  const failed = messages.filter((message) => message.finalStatus === 'failed').length;

  return failed / messages.length;
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

/** Formata uma fração como percentual legível (ex.: `0.082` → `8.2%`). */
function pct(value: number): string {
  return `${(value * HUNDRED_PERCENT).toFixed(1)}%`;
}

/** Taxas de FALHA dos buckets de baseline (janelas anteriores com volume > 0). */
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
      rates.push(failureRate(bucket));
    }
  }

  return rates;
}

/** One customer evaluated by the failure-spike rule against its own rolling baseline. */
interface CustomerEvaluationInterface {
  /** Rule (threshold in σ, window). */
  rule: DetectorRuleInterface;
  /** Customer evaluated (value of the dimension). */
  customerId: string;
  /** The customer's terminal samples in the lookback. */
  terminals: ShippingSampleInterface[];
  /** Reference instant of the evaluation. */
  now: Date;
  /** Calibration (minimum volume, number of windows). */
  opts: DetectorOptionsInterface;
}

/**
 * Avalia um cliente: dispara se a taxa de FALHA na janela atual SUBIR além do limiar
 * (em σ acima do baseline rolante do próprio cliente, ou alta relativa quando o baseline
 * é plano) com volume suficiente. Baseline-relativo (não um piso absoluto) — robusto a
 * bases com falha estruturalmente alta, em que um piso fixo dispararia para todos.
 *
 * @param evaluation - The rule, the customer and its terminal samples, the reference instant and the calibration.
 *
 * @returns Anomalia detectada, ou `null`.
 */
function evaluateCustomer(evaluation: CustomerEvaluationInterface): DetectionInterface | null {
  const {
    rule,
    customerId,
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

  const currentRate = failureRate(current);
  const mu = mean(rates);

  const sigma = stddev(
    rates,
    mu,
  );

  const rise = currentRate - mu;

  const triggered = sigma > FLAT_SIGMA
    ? rise >= rule.threshold * sigma
    : rise >= FLAT_BASELINE_RISE;

  if (!triggered) {
    return null;
  }

  return {
    ruleId: rule.id,
    ruleName: rule.name,
    dimensionType: rule.dimension,
    dimensionValue: customerId,
    severity: rule.severity,
    windowStart: new Date(currentStart),
    windowEnd: new Date(end),
    summary: `Taxa de falha do cliente ${customerId} subiu de ${pct(mu)} (baseline) para ${pct(currentRate)} na janela de ${rule.windowMinutes} min.`,
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
 * Detecta PICO DE FALHA por cliente: agrupa terminais por cliente e dispara onde a taxa
 * de falha da janela atual sobe além do baseline rolante (μ/σ), com guarda de volume.
 * Função pura — recebe `now` e a calibração, sem I/O nem relógio implícito.
 *
 * Baseline-relativo (não piso absoluto): numa base com falha alta e variável por cliente,
 * um piso fixo (ex.: "> 5%") dispararia para todos sempre; o σ vs. o próprio histórico
 * pega o cliente que DESVIOU do normal dele.
 *
 * @param rule - Regra `failure_spike` (limiar em σ).
 * @param messages - Mensagens do lookback (qualquer status).
 * @param now - Instante de referência.
 * @param opts - Calibração.
 *
 * @returns Uma detecção por cliente anômalo.
 */
export function detectFailureSpike(
  rule: DetectorRuleInterface,
  messages: ShippingSampleInterface[],
  now: Date,
  opts: DetectorOptionsInterface,
): DetectionInterface[] {
  const byCustomer = new Map<string, ShippingSampleInterface[]>();

  for (const message of messages) {
    if (!isTerminal(message.finalStatus)) {
      continue;
    }

    const list = byCustomer.get(message.customerId) ?? [];

    list.push(message);

    byCustomer.set(
      message.customerId,
      list,
    );
  }

  const detections: DetectionInterface[] = [];

  for (const [
    customerId,
    terminals,
  ] of byCustomer) {
    const detection = evaluateCustomer({
      rule,
      customerId,
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
