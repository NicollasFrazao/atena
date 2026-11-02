import { HUNDRED_PERCENT, MS_PER_MINUTE } from '../common/units';
import type {
  DetectionInterface,
  DetectorOptionsInterface,
  DetectorRuleInterface,
  ShippingSampleInterface,
} from './detection.types';

/** Verdadeiro para status terminais (entram no cálculo da fração). */
function isTerminal(status: ShippingSampleInterface['finalStatus']): boolean {
  return status === 'delivered' || status === 'failed';
}

/** Formata uma fração como percentual legível (ex.: `0.66` → `66.0%`). */
function pct(value: number): string {
  return `${(value * HUNDRED_PERCENT).toFixed(1)}%`;
}

/** Rótulo da categoria de erro de uma falha (`errorHint`); `desconhecido` se vazio. */
function categoryOf(message: ShippingSampleInterface): string {
  const hint = (message.errorHint ?? '').trim();

  return hint || 'desconhecido';
}

/**
 * Categoria de falha DOMINANTE de um conjunto de terminais, com sua contagem.
 * Determinístico: em empate, mantém a primeira categoria vista.
 *
 * @param terminals - Terminais (delivered/failed) da janela.
 *
 * @returns Categoria dominante e quantas falhas tem (`count: 0` se não houve falha).
 */
function dominantFailureCategory(terminals: ShippingSampleInterface[]): {
  category: string;
  count: number
} {
  const counts = new Map<string, number>();

  for (const message of terminals) {
    if (message.finalStatus !== 'failed') {
      continue;
    }

    const category = categoryOf(message);

    counts.set(
      category,
      (counts.get(category) ?? 0) + 1,
    );
  }

  let category = '';
  let count = 0;

  for (const [
    name,
    total,
  ] of counts) {
    if (total > count) {
      category = name;
      count = total;
    }
  }

  return {
    category,
    count,
  };
}

/** One customer evaluated by the consistent-error rule over the current window. */
interface CustomerEvaluationInterface {
  /** Rule (threshold in %, window). */
  rule: DetectorRuleInterface;
  /** Customer evaluated (value of the dimension). */
  customerId: string;
  /** The customer's terminal samples in the lookback. */
  terminals: ShippingSampleInterface[];
  /** Start (ms) of the current window. */
  currentStart: number;
  /** End (ms) of the current window. */
  currentEnd: number;
  /** Calibration (minimum volume). */
  opts: DetectorOptionsInterface;
}

/**
 * Avalia um cliente: dispara se a categoria de falha DOMINANTE cruzar o limiar
 * (piso, em % do volume terminal), com volume suficiente. Diferente do `failure_spike`
 * (taxa de falha TOTAL), aqui importa uma única categoria concentrada (ex.: `invalid_number`).
 *
 * @param evaluation - The rule, the customer and its terminal samples, the current window and the calibration.
 *
 * @returns Anomalia detectada, ou `null`.
 */
function evaluateCustomer(evaluation: CustomerEvaluationInterface): DetectionInterface | null {
  const {
    rule,
    customerId,
    terminals,
    currentStart,
    currentEnd,
    opts,
  } = evaluation;

  const current = terminals.filter((message) => message.occurredAt.getTime() >= currentStart);

  if (current.length < opts.minTerminalVolume) {
    return null;
  }

  // Categoria-alvo: a FIXADA na regra (escopo, ex.: `invalid_number`/`policy_block`) ou, sem categoria,
  // a DOMINANTE (genérico). Assim "Spike de número inválido" mede invalid_number de verdade.
  const target = rule.category
    ? {
      category: rule.category,
      count: current.filter((message) => message.finalStatus === 'failed'
        && categoryOf(message) === rule.category).length,
    }
    : dominantFailureCategory(current);

  if (target.count === 0) {
    return null;
  }

  const share = target.count / current.length;

  if (share * HUNDRED_PERCENT < rule.threshold) {
    return null;
  }

  return {
    ruleId: rule.id,
    ruleName: rule.name,
    dimensionType: rule.dimension,
    dimensionValue: customerId,
    severity: rule.severity,
    windowStart: new Date(currentStart),
    windowEnd: new Date(currentEnd),
    summary: `Erro consistente do cliente ${customerId}: ${pct(share)} das ${current.length} tentativas terminais foram "${target.category}" na janela de ${rule.windowMinutes} min (limiar ≥ ${rule.threshold}%).`,
    metrics: {
      baseline: `< ${rule.threshold}%`,
      current: pct(share),
      threshold: `≥ ${rule.threshold}%`,
      sample: `${current.length} terminais`,
    },
    relatedShippings: target.count,
    relatedShippingIds: current
      .filter((message) => message.finalStatus === 'failed' && categoryOf(message) === target.category)
      .map((message) => message.id),
  };
}

/**
 * Detecta ERRO CONSISTENTE por cliente: na janela atual, se uma única categoria de
 * falha (`errorHint`) concentrar ≥ `threshold%` do volume terminal, com volume
 * suficiente, dispara. Função pura — recebe `now` e a calibração, sem I/O.
 *
 * @param rule - Regra `consistent_error` (limiar em %).
 * @param messages - Mensagens do lookback (qualquer status).
 * @param now - Instante de referência.
 * @param opts - Calibração.
 *
 * @returns Uma detecção por cliente acima do limiar.
 */
export function detectConsistentError(
  rule: DetectorRuleInterface,
  messages: ShippingSampleInterface[],
  now: Date,
  opts: DetectorOptionsInterface,
): DetectionInterface[] {
  const currentEnd = now.getTime();
  const currentStart = currentEnd - rule.windowMinutes * MS_PER_MINUTE;

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
      currentStart,
      currentEnd,
      opts,
    });

    if (detection) {
      detections.push(detection);
    }
  }

  return detections;
}
