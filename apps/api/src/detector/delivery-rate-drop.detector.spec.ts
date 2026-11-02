import { detectDeliveryRateDrop } from './delivery-rate-drop.detector';
import type {
  DetectorOptionsInterface,
  DetectorRuleInterface,
  ShippingSampleInterface,
} from './detection.types';

const NOW = new Date('2026-06-17T12:00:00Z');

const RULE: DetectorRuleInterface = {
  id: 'r-delivery-drop-customer',
  name: 'Queda de entrega por cliente',
  ruleType: 'delivery_rate_drop',
  dimension: 'customer',
  severity: 'critical',
  threshold: 3,
  windowMinutes: 15,
};

const OPTS: DetectorOptionsInterface = {
  minTerminalVolume: 10,
  baselineWindows: 4,
};

/** Cria `count` terminais de um cliente, `minutesAgo` atrás, com dada fração entregue. */
function batch(
  customerId: string,
  minutesAgo: number,
  count: number,
  deliveredRatio: number,
): ShippingSampleInterface[] {
  const at = new Date(NOW.getTime() - minutesAgo * 60_000);
  const delivered = Math.round(count * deliveredRatio);
  const out: ShippingSampleInterface[] = [];

  for (let index = 0; index < count; index++) {
    out.push({
      id: `${customerId}-${minutesAgo}-${index}`,
      customerId,
      finalStatus: index < delivered
        ? 'delivered'
        : 'failed',
      occurredAt: at,
    });
  }

  return out;
}

/** Baseline alto e estável (4 buckets, ~0.9–1.0 de entrega), 20 terminais cada. */
function stableBaseline(customerId: string): ShippingSampleInterface[] {
  return [
    ...batch(
      customerId,
      67,
      20,
      0.9,
    ),
    ...batch(
      customerId,
      52,
      20,
      1,
    ),
    ...batch(
      customerId,
      37,
      20,
      0.95,
    ),
    ...batch(
      customerId,
      22,
      20,
      0.95,
    ),
  ];
}

describe('detectDeliveryRateDrop', () => {
  it('dispara quando a taxa atual cai muito abaixo do baseline (com volume)', () => {
    const messages = [
      ...stableBaseline('c1'),
      ...batch(
        'c1',
        7,
        20,
        0.5,
      ), // janela atual: 50% vs baseline ~95%
    ];

    const out = detectDeliveryRateDrop(
      RULE,
      messages,
      NOW,
      OPTS,
    );

    expect(out).toHaveLength(1);
    expect(out[0].dimensionValue).toBe('c1');
    expect(out[0].severity).toBe('critical');
    expect(out[0].metrics.current).toBe('50.0%');
  });

  it('NÃO dispara quando a taxa atual está perto do baseline', () => {
    const messages = [
      ...stableBaseline('c1'),
      ...batch(
        'c1',
        7,
        20,
        0.93,
      ),
    ];

    const out = detectDeliveryRateDrop(
      RULE,
      messages,
      NOW,
      OPTS,
    );

    expect(out).toHaveLength(0);
  });

  it('NÃO dispara abaixo da guarda de volume mínimo', () => {
    const messages = [
      ...stableBaseline('c1'),
      ...batch(
        'c1',
        7,
        5,
        0.2,
      ), // queda forte, mas só 5 terminais (< 10)
    ];

    const out = detectDeliveryRateDrop(
      RULE,
      messages,
      NOW,
      OPTS,
    );

    expect(out).toHaveLength(0);
  });

  it('agrupa por PROVEDOR quando a regra é dimension=provider', () => {
    const provider = (
      minutesAgo: number,
      ratio: number,
    ): ShippingSampleInterface[] => batch(
      'any-customer',
      minutesAgo,
      20,
      ratio,
    ).map((message) => ({
      ...message,
      provider: 'provider-c',
    }));

    const out = detectDeliveryRateDrop(
      {
        ...RULE,
        id: 'r-delivery-drop-provider',
        name: 'Queda de entrega por provedor',
        dimension: 'provider',
      },
      [
        ...provider(
          67,
          0.95,
        ),
        ...provider(
          52,
          1,
        ),
        ...provider(
          37,
          0.95,
        ),
        ...provider(
          22,
          0.9,
        ),
        ...provider(
          7,
          0.4,
        ), // queda na janela atual
      ],
      NOW,
      OPTS,
    );

    expect(out).toHaveLength(1);
    expect(out[0].dimensionType).toBe('provider');
    expect(out[0].dimensionValue).toBe('provider-c');
    expect(out[0].summary).toContain('provedor');
  });
});
