import { detectConsistentError } from './consistent-error.detector';
import type {
  DetectorOptionsInterface,
  DetectorRuleInterface,
  ShippingSampleInterface,
} from './detection.types';

const NOW = new Date('2026-06-17T12:00:00Z');

const RULE: DetectorRuleInterface = {
  id: 'r-invalid-number-spike',
  name: 'Spike de número inválido (consistent_error)',
  ruleType: 'consistent_error',
  dimension: 'customer',
  severity: 'warning',
  threshold: 25,
  windowMinutes: 30,
};

const OPTS: DetectorOptionsInterface = {
  minTerminalVolume: 10,
  baselineWindows: 8,
};

/**
 * Cria terminais de um cliente, `minutesAgo` atrás: `delivered` entregues +
 * `failuresByCategory` falhas (uma chave por categoria de `errorHint`).
 */
function batch(
  customerId: string,
  minutesAgo: number,
  delivered: number,
  failuresByCategory: Record<string, number>,
): ShippingSampleInterface[] {
  const at = new Date(NOW.getTime() - minutesAgo * 60_000);
  const out: ShippingSampleInterface[] = [];

  for (let index = 0; index < delivered; index++) {
    out.push({
      id: `${customerId}-${minutesAgo}-d${index}`,
      customerId,
      finalStatus: 'delivered',
      occurredAt: at,
    });
  }

  for (const [
    category,
    count,
  ] of Object.entries(failuresByCategory)) {
    for (let index = 0; index < count; index++) {
      out.push({
        id: `${customerId}-${minutesAgo}-${category}-${index}`,
        customerId,
        finalStatus: 'failed',
        occurredAt: at,
        errorHint: category,
      });
    }
  }

  return out;
}

describe('detectConsistentError', () => {
  it('dispara quando a categoria dominante cruza o limiar (com volume)', () => {
    const out = detectConsistentError(
      RULE,
      batch(
        'c1',
        5,
        8,
        { invalid_number: 12 },
      ),
      NOW,
      OPTS,
    );

    expect(out).toHaveLength(1);
    expect(out[0].dimensionValue).toBe('c1');
    expect(out[0].severity).toBe('warning');
    expect(out[0].metrics.current).toBe('60.0%');
    expect(out[0].summary).toContain('invalid_number');
  });

  it('escolhe a MAIOR categoria quando há mistura de falhas', () => {
    const out = detectConsistentError(
      RULE,
      batch(
        'c1',
        5,
        4,
        {
          invalid_number: 10,
          policy_block: 6,
        },
      ),
      NOW,
      OPTS,
    );

    expect(out).toHaveLength(1);
    expect(out[0].summary).toContain('invalid_number');
    expect(out[0].relatedShippings).toBe(10);
  });

  it('NÃO dispara quando nenhuma categoria isolada cruza o limiar', () => {
    const out = detectConsistentError(
      RULE,
      batch(
        'c1',
        5,
        17,
        { invalid_number: 3 },
      ),
      NOW,
      OPTS,
    );

    expect(out).toHaveLength(0);
  });

  it('NÃO dispara abaixo da guarda de volume mínimo', () => {
    const out = detectConsistentError(
      RULE,
      batch(
        'c1',
        5,
        0,
        { invalid_number: 5 },
      ),
      NOW,
      OPTS,
    );

    expect(out).toHaveLength(0);
  });

  it('NÃO dispara para terminais fora da janela atual', () => {
    const out = detectConsistentError(
      RULE,
      batch(
        'c1',
        40,
        8,
        { invalid_number: 12 },
      ), // 40 min atrás, fora da janela de 30 min
      NOW,
      OPTS,
    );

    expect(out).toHaveLength(0);
  });

  describe('com categoria FIXADA na regra', () => {
    const SCOPED: DetectorRuleInterface = {
      ...RULE,
      category: 'invalid_number',
    };

    it('mede a categoria da regra (não a dominante) quando ela cruza o limiar', () => {
      const out = detectConsistentError(
        SCOPED,
        // generic_error é a dominante (40%), mas a regra é escopada em invalid_number (30% ≥ 25%).
        batch(
          'c1',
          5,
          30,
          {
            generic_error: 40,
            invalid_number: 30,
          },
        ),
        NOW,
        OPTS,
      );

      expect(out).toHaveLength(1);
      expect(out[0].metrics.current).toBe('30.0%');
      expect(out[0].relatedShippings).toBe(30);
      expect(out[0].summary).toContain('invalid_number');
      expect(out[0].summary).not.toContain('generic_error');
    });

    it('NÃO dispara se a categoria da regra está abaixo do limiar, mesmo com outra dominante alta', () => {
      const out = detectConsistentError(
        SCOPED,
        // generic_error domina (40%) mas invalid_number (10%) < 25% → escopo NÃO dispara.
        batch(
          'c1',
          5,
          50,
          {
            generic_error: 40,
            invalid_number: 10,
          },
        ),
        NOW,
        OPTS,
      );

      expect(out).toHaveLength(0);
    });
  });
});
