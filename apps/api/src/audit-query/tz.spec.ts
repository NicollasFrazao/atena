import {
  resolveBoundInTz,
  startOfDayInTz,
  startOfNamedDayInTz,
  startOfRecentDays,
  toNaiveDatetimeInTz,
  tzOffsetMinutes,
} from './tz';

const BRT = 'America/Sao_Paulo';

describe('tz (edge de fuso)', () => {
  it('offset do BRT é -180 min (UTC-3, sem DST)', () => {
    expect(tzOffsetMinutes(
      new Date('2026-06-19T12:00:00Z'),
      BRT,
    )).toBe(-180);
  });

  it('dia nomeado no BRT começa às 03:00Z (00:00 BRT)', () => {
    expect(startOfNamedDayInTz(
      '2026-06-19',
      BRT,
    ).toISOString()).toBe('2026-06-19T03:00:00.000Z');
  });

  it('resolveBoundInTz: date-only vira início do dia no fuso; date_to é fim exclusivo (dia inteiro)', () => {
    expect(resolveBoundInTz(
      '2026-06-19',
      BRT,
      false,
    ).toISOString()).toBe('2026-06-19T03:00:00.000Z');

    // "até 19/06" cobre o dia 19 inteiro → início do dia 20 no fuso (exclusivo).
    expect(resolveBoundInTz(
      '2026-06-19',
      BRT,
      true,
    ).toISOString()).toBe('2026-06-20T03:00:00.000Z');
  });

  it('resolveBoundInTz: data com hora E `Z` (ISO completo) é instante absoluto — ignora o fuso', () => {
    expect(resolveBoundInTz(
      '2026-06-19T12:00:00Z',
      BRT,
      false,
    ).toISOString()).toBe('2026-06-19T12:00:00.000Z');
  });

  it('resolveBoundInTz: datetime SEM fuso (naive) é interpretado no fuso do operador (13h BRT = 16:00Z)', () => {
    expect(resolveBoundInTz(
      '2026-06-19T13:00:00',
      BRT,
      false,
    ).toISOString()).toBe('2026-06-19T16:00:00.000Z');

    // Sem segundos também (ex.: input HH:MM); endExclusive não altera datetime (o instante é o limite).
    expect(resolveBoundInTz(
      '2026-06-19T17:00',
      BRT,
      true,
    ).toISOString()).toBe('2026-06-19T20:00:00.000Z');
  });

  it('resolveBoundInTz: offset explícito (-03:00) também resolve ao instante absoluto correto', () => {
    expect(resolveBoundInTz(
      '2026-06-19T13:00:00-03:00',
      BRT,
      false,
    ).toISOString()).toBe('2026-06-19T16:00:00.000Z');
  });

  it('DST: startOfDayInTz respeita horário de verão (New York muda EST↔EDT)', () => {
    // Janeiro: EST (UTC-5) → 00:00 local = 05:00Z.
    expect(startOfDayInTz(
      2026,
      1,
      15,
      'America/New_York',
    ).toISOString()).toBe('2026-01-15T05:00:00.000Z');

    // Julho: EDT (UTC-4) → 00:00 local = 04:00Z.
    expect(startOfDayInTz(
      2026,
      7,
      15,
      'America/New_York',
    ).toISOString()).toBe('2026-07-15T04:00:00.000Z');
  });

  it('startOfRecentDays: início do dia N atrás, ancorado no fuso', () => {
    // "agora" = 22/06 14:20Z (11:20 BRT). 6 dias atrás = 16/06 00:00 BRT = 16/06 03:00Z.
    const now = new Date('2026-06-22T14:20:00Z');

    expect(startOfRecentDays(
      6,
      BRT,
      now,
    ).toISOString()).toBe('2026-06-16T03:00:00.000Z');

    // 0 dias atrás = início do dia corrente no fuso.
    expect(startOfRecentDays(
      0,
      BRT,
      now,
    ).toISOString()).toBe('2026-06-22T03:00:00.000Z');
  });

  it('toNaiveDatetimeInTz: instante UTC vira relógio-de-parede no fuso, sem `Z` (19:40Z → 16:40 BRT)', () => {
    expect(toNaiveDatetimeInTz(
      '2026-06-23T19:40:00Z',
      BRT,
    )).toBe('2026-06-23T16:40:00');
  });

  it('toNaiveDatetimeInTz ↔ resolveBoundInTz: round-trip preserva o instante UTC', () => {
    const utc = '2026-06-23T19:55:00.000Z';

    const naive = toNaiveDatetimeInTz(
      utc,
      BRT,
    );

    expect(resolveBoundInTz(
      naive,
      BRT,
      false,
    ).toISOString()).toBe(utc);
  });
});
