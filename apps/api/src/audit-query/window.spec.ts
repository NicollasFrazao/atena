import { resolveWindow } from './window';

const BRT = 'America/Sao_Paulo';
const NOW = new Date('2026-06-22T14:20:00Z'); // 11:20 BRT

describe('resolveWindow (edge de entrada, no fuso)', () => {
  it('dia nomeado (date_from=date_to) vira o dia inteiro NO fuso', () => {
    const window = resolveWindow(
      {
        date_from: '2026-06-19',
        date_to: '2026-06-19',
      },
      BRT,
      NOW,
    );

    expect(window?.from?.toISOString()).toBe('2026-06-19T03:00:00.000Z');
    expect(window?.to?.toISOString()).toBe('2026-06-20T03:00:00.000Z');
  });

  it('24h é rolante (agora − 24h), independe do fuso', () => {
    const window = resolveWindow(
      { date_range: '24h' },
      BRT,
      NOW,
    );

    expect(window?.from?.toISOString()).toBe('2026-06-21T14:20:00.000Z');
    expect(window?.to).toBeNull();
  });

  it('7d vira 7 dias-calendário no fuso (início do dia 6 atrás às 03:00Z)', () => {
    const window = resolveWindow(
      { date_range: '7d' },
      BRT,
      NOW,
    );

    expect(window?.from?.toISOString()).toBe('2026-06-16T03:00:00.000Z');
    expect(window?.to).toBeNull();
  });

  it('all = sem limite inferior; preset desconhecido = undefined', () => {
    expect(resolveWindow(
      { date_range: 'all' },
      BRT,
      NOW,
    )).toEqual({
      from: null,
      to: null,
    });

    expect(resolveWindow(
      { date_range: 'xpto' },
      BRT,
      NOW,
    )).toBeUndefined();
  });

  it('data com hora (ISO) é instante absoluto', () => {
    const window = resolveWindow(
      { date_from: '2026-06-19T10:00:00Z' },
      BRT,
      NOW,
    );

    expect(window?.from?.toISOString()).toBe('2026-06-19T10:00:00.000Z');
  });
});
