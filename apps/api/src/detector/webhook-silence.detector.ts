import { MS_PER_MINUTE } from '../common/units';
import type {
  DetectionInterface,
  DetectorOptionsInterface,
  DetectorRuleInterface,
  ShippingSampleInterface,
} from './detection.types';

/** Instante de envio de uma amostra (`requestedAt`; cai no desfecho se ausente). */
function sendTime(message: ShippingSampleInterface): number {
  return (message.requestedAt ?? message.occurredAt).getTime();
}

/** One provider evaluated by the webhook-silence rule over the current window of sends. */
interface ProviderEvaluationInterface {
  /** Rule (threshold in MINUTES, window of sends). */
  rule: DetectorRuleInterface;
  /** Provider evaluated (value of the dimension). */
  provider: string;
  /** The provider's samples in the lookback (any status). */
  samples: ShippingSampleInterface[];
  /** Start (ms) of the window of sends. */
  currentStart: number;
  /** End (ms) of the window / reference instant. */
  currentEnd: number;
  /** Calibration (minimum volume of sends). */
  opts: DetectorOptionsInterface;
}

/**
 * Avalia um provider: dispara se houve ENVIOS na janela (acima da guarda) mas
 * nenhum STATUS (`finalizedAt`) chegou nos últimos `threshold` minutos — o canal
 * de callbacks ficou em silêncio. `threshold` é lido em MINUTOS (não σ/%).
 *
 * @param evaluation - The rule, the provider and its samples, the window of sends and the calibration.
 *
 * @returns Anomalia detectada, ou `null`.
 */
function evaluateProvider(evaluation: ProviderEvaluationInterface): DetectionInterface | null {
  const {
    rule,
    provider,
    samples,
    currentStart,
    currentEnd,
    opts,
  } = evaluation;

  const sends = samples.filter((message) => sendTime(message) >= currentStart);

  if (sends.length < opts.minTerminalVolume) {
    return null;
  }

  const statusTimes = samples
    .map((message) => message.finalizedAt?.getTime())
    .filter((time) => time != null);

  // reduce em vez de `Math.max(...statusTimes)`: o spread de um array grande (provedor de alto
  // volume → centenas de milhares de status) estoura o limite de argumentos ("Maximum call stack
  // size exceeded"). reduce calcula o máximo sem espalhar argumentos.
  const lastStatus = statusTimes.length
    ? statusTimes.reduce(
      (
        max,
        time,
      ) => Math.max(
        max,
        time,
      ),
      -Infinity,
    )
    : null;

  const silenceMs = rule.threshold * MS_PER_MINUTE;

  const gapMs = lastStatus == null
    ? currentEnd - currentStart
    : currentEnd - lastStatus;

  const silent = lastStatus == null
    || gapMs > silenceMs;

  if (!silent) {
    return null;
  }

  const gapLabel = lastStatus == null
    ? 'nenhum status recebido'
    : `${Math.round(gapMs / MS_PER_MINUTE)} min sem status`;

  return {
    ruleId: rule.id,
    ruleName: rule.name,
    dimensionType: rule.dimension,
    dimensionValue: provider,
    severity: rule.severity,
    windowStart: new Date(currentStart),
    windowEnd: new Date(currentEnd),
    summary: `Silêncio de webhook do provedor ${provider}: ${sends.length} envios na janela de ${rule.windowMinutes} min, mas ${gapLabel} (limiar > ${rule.threshold} min).`,
    metrics: {
      baseline: 'status ativos',
      current: gapLabel,
      threshold: `> ${rule.threshold} min`,
      sample: `${sends.length} envios`,
    },
    relatedShippings: sends.length,
    relatedShippingIds: sends.map((message) => message.id),
  };
}

/**
 * Detecta SILÊNCIO DE WEBHOOK por provedor: agrupa as amostras por `provider` e
 * dispara onde há envios recentes (guarda de volume) mas nenhum status terminal
 * (`finalizedAt`) nos últimos `threshold` minutos. Função pura — recebe `now` e a
 * calibração, sem I/O nem relógio implícito.
 *
 * @param rule - Regra `webhook_silence` (limiar em minutos).
 * @param messages - Mensagens do lookback (qualquer status, com `provider`).
 * @param now - Instante de referência.
 * @param opts - Calibração.
 *
 * @returns Uma detecção por provedor em silêncio.
 */
export function detectWebhookSilence(
  rule: DetectorRuleInterface,
  messages: ShippingSampleInterface[],
  now: Date,
  opts: DetectorOptionsInterface,
): DetectionInterface[] {
  const currentEnd = now.getTime();
  const currentStart = currentEnd - rule.windowMinutes * MS_PER_MINUTE;

  const byProvider = new Map<string, ShippingSampleInterface[]>();

  for (const message of messages) {
    const provider = (message.provider ?? '').trim();

    if (!provider) {
      continue;
    }

    const list = byProvider.get(provider) ?? [];

    list.push(message);

    byProvider.set(
      provider,
      list,
    );
  }

  const detections: DetectionInterface[] = [];

  for (const [
    provider,
    samples,
  ] of byProvider) {
    const detection = evaluateProvider({
      rule,
      provider,
      samples,
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
