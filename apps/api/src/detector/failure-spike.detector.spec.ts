import { detectFailureSpike } from './failure-spike.detector';
import type {
  DetectorOptionsInterface,
  DetectorRuleInterface,
  ShippingSampleInterface,
} from './detection.types';

const NOW = new Date('2026-06-17T12:00:00Z');

const RULE: DetectorRuleInterface = {
  id: 'r-failure-spike',
  name: 'Pico de falha (vs baseline)',
  ruleType: 'failure_spike',
  dimension: 'customer',
  severity: 'critical',
  threshold: 3,
  windowMinutes: 15,
};

const OPTS: DetectorOptionsInterface = {
  minTerminalVolume: 10,
  baselineWindows: 8,
};

/** Cria `count` terminais de um cliente, `minutesAgo` atrás, com dada fração de falha. */
function batch(
  customerId: string,
  minutesAgo: number,
  count: number,
  failedRatio: number,
): ShippingSampleInterface[] {
  const at = new Date(NOW.getTime() - minutesAgo * 60_000);
  const failed = Math.round(count * failedRatio);
  const out: ShippingSampleInterface[] = [];

  for (let index = 0; index < count; index++) {
    out.push({
      id: `${customerId}-${minutesAgo}-${index}`,
      customerId,
      finalStatus: index < failed
        ? 'failed'
        : 'delivered',
      occurredAt: at,
    });
  }

  return out;
}

/** Baseline: um batch em cada uma das 8 janelas anteriores (15 min), com taxa de falha estável. */
function baseline(
  customerId: string,
  failedRatio: number,
): ShippingSampleInterface[] {
  const out: ShippingSampleInterface[] = [];

  for (let window = 0; window < 8; window++) {
    out.push(...batch(
      customerId,
      22 + window * 15,
      20,
      failedRatio,
    ));
  }

  return out;
}

describe('detectFailureSpike (baseline-relativo)', () => {
  it('dispara quando a taxa de falha SOBE muito acima do baseline do cliente', () => {
    const out = detectFailureSpike(
      RULE,
      [
        ...baseline(
          'c1',
          0.05,
        ),
        ...batch(
          'c1',
          7,
          20,
          0.6,
        ),
      ],
      NOW,
      OPTS,
    );

    expect(out).toHaveLength(1);
    expect(out[0].dimensionValue).toBe('c1');
    expect(out[0].metrics.baseline).toBe('5.0%');
    expect(out[0].metrics.current).toBe('60.0%');
  });

  it('NÃO dispara para cliente com falha estruturalmente ALTA mas estável (sem desvio)', () => {
    const out = detectFailureSpike(
      RULE,
      [
        ...baseline(
          'c1',
          0.4,
        ),
        ...batch(
          'c1',
          7,
          20,
          0.4,
        ),
      ],
      NOW,
      OPTS,
    );

    expect(out).toHaveLength(0);
  });

  it('NÃO dispara abaixo da guarda de volume mínimo na janela atual', () => {
    const out = detectFailureSpike(
      RULE,
      [
        ...baseline(
          'c1',
          0.05,
        ),
        ...batch(
          'c1',
          7,
          5,
          1,
        ),
      ],
      NOW,
      OPTS,
    );

    expect(out).toHaveLength(0);
  });

  it('NÃO dispara sem baseline suficiente (só a janela atual)', () => {
    const out = detectFailureSpike(
      RULE,
      batch(
        'c1',
        7,
        20,
        1,
      ),
      NOW,
      OPTS,
    );

    expect(out).toHaveLength(0);
  });
});
