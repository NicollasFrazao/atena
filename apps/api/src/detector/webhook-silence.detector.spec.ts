import { detectWebhookSilence } from './webhook-silence.detector';
import type {
  DetectorOptionsInterface,
  DetectorRuleInterface,
  ShippingSampleInterface,
} from './detection.types';

const NOW = new Date('2026-06-17T12:00:00Z');

const RULE: DetectorRuleInterface = {
  id: 'r-webhook-silence-provider',
  name: 'Silêncio de callbacks (por provedor)',
  ruleType: 'webhook_silence',
  dimension: 'provider',
  severity: 'critical',
  threshold: 15,
  windowMinutes: 15,
};

const OPTS: DetectorOptionsInterface = {
  minTerminalVolume: 10,
  baselineWindows: 8,
};

/** `count` envios pendentes (sem status) de um provider, `minutesAgo` atrás. */
function pendingSends(
  provider: string,
  count: number,
  minutesAgo: number,
): ShippingSampleInterface[] {
  const at = new Date(NOW.getTime() - minutesAgo * 60_000);
  const out: ShippingSampleInterface[] = [];

  for (let index = 0; index < count; index++) {
    out.push({
      id: `${provider}-${minutesAgo}-${index}`,
      customerId: 'c1',
      finalStatus: 'pending',
      occurredAt: at,
      provider,
      requestedAt: at,
      finalizedAt: null,
    });
  }

  return out;
}

/** Um status que CHEGOU `minutesAgo` atrás (envio bem mais antigo, fora da janela). */
function statusArrived(
  provider: string,
  minutesAgo: number,
): ShippingSampleInterface {
  const at = new Date(NOW.getTime() - minutesAgo * 60_000);

  return {
    id: `${provider}-status-${minutesAgo}`,
    customerId: 'c1',
    finalStatus: 'delivered',
    occurredAt: at,
    provider,
    requestedAt: new Date(NOW.getTime() - (minutesAgo + 30) * 60_000),
    finalizedAt: at,
  };
}

describe('detectWebhookSilence', () => {
  it('dispara quando há envios mas NENHUM status (com volume)', () => {
    const out = detectWebhookSilence(
      RULE,
      pendingSends(
        'provider-c',
        20,
        5,
      ),
      NOW,
      OPTS,
    );

    expect(out).toHaveLength(1);
    expect(out[0].dimensionValue).toBe('provider-c');
    expect(out[0].severity).toBe('critical');
    expect(out[0].metrics.current).toBe('nenhum status recebido');
  });

  it('dispara quando o último status é mais velho que o limiar', () => {
    const out = detectWebhookSilence(
      RULE,
      [
        ...pendingSends(
          'provider-c',
          20,
          5,
        ),
        statusArrived(
          'provider-c',
          30,
        ), // último status há 30 min > limiar de 15 min
      ],
      NOW,
      OPTS,
    );

    expect(out).toHaveLength(1);
    expect(out[0].metrics.current).toBe('30 min sem status');
  });

  it('NÃO dispara quando há status recente dentro do limiar', () => {
    const out = detectWebhookSilence(
      RULE,
      [
        ...pendingSends(
          'provider-c',
          20,
          5,
        ),
        statusArrived(
          'provider-c',
          5,
        ), // status há 5 min < limiar de 15 min
      ],
      NOW,
      OPTS,
    );

    expect(out).toHaveLength(0);
  });

  it('NÃO dispara abaixo da guarda de volume de envios', () => {
    const out = detectWebhookSilence(
      RULE,
      pendingSends(
        'provider-c',
        5,
        5,
      ),
      NOW,
      OPTS,
    );

    expect(out).toHaveLength(0);
  });

  it('NÃO dispara sem envios na janela (provedor ocioso)', () => {
    const out = detectWebhookSilence(
      RULE,
      pendingSends(
        'provider-c',
        20,
        60,
      ), // envios há 60 min, fora da janela de 15 min
      NOW,
      OPTS,
    );

    expect(out).toHaveLength(0);
  });

  it('não estoura a pilha com muitos status (regressão: Math.max(...) → reduce)', () => {
    // Provedor de alto volume: centenas de milhares de status no lookback. O antigo
    // `Math.max(...statusTimes)` espalhava todos como argumentos → "Maximum call stack size exceeded".
    const statuses: ShippingSampleInterface[] = [];

    for (let index = 0; index < 200_000; index++) {
      statuses.push(statusArrived(
        'provider-c',
        30,
      )); // último status há 30 min > limiar de 15 min
    }

    const out = detectWebhookSilence(
      RULE,
      [
        ...pendingSends(
          'provider-c',
          20,
          5,
        ),
        ...statuses,
      ],
      NOW,
      OPTS,
    );

    expect(out).toHaveLength(1);
    expect(out[0].metrics.current).toBe('30 min sem status');
  });
});
