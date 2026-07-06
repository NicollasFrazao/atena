import { BadRequestException } from '@nestjs/common';
import { assertQueryWithinMinDate, clampWindowToMinDate } from './audit-guards';

const MIN = '2026-06-18T20:40:00Z';

describe('assertQueryWithinMinDate', () => {
  it('não barra nada quando minQueryDate é null (guarda desligada)', () => {
    expect(() => assertQueryWithinMinDate(
      undefined,
      null,
    )).not.toThrow();

    expect(() => assertQueryWithinMinDate(
      {
        from: new Date('2020-01-01T00:00:00Z'),
        to: null,
      },
      null,
    )).not.toThrow();
  });

  it('barra janela ausente ou aberta (from null) quando a guarda está ligada', () => {
    expect(() => assertQueryWithinMinDate(
      undefined,
      MIN,
    )).toThrow(BadRequestException);

    expect(() => assertQueryWithinMinDate(
      {
        from: null,
        to: new Date(),
      },
      MIN,
    )).toThrow(BadRequestException);
  });

  it('barra janela que começa antes da data mínima', () => {
    expect(() => assertQueryWithinMinDate(
      {
        from: new Date('2026-06-18T20:39:59Z'),
        to: null,
      },
      MIN,
    )).toThrow(BadRequestException);
  });

  it('permite janela que começa em/depois da data mínima', () => {
    expect(() => assertQueryWithinMinDate(
      {
        from: new Date(MIN),
        to: null,
      },
      MIN,
    )).not.toThrow();

    expect(() => assertQueryWithinMinDate(
      {
        from: new Date('2026-06-18T21:00:00Z'),
        to: new Date('2026-06-18T22:00:00Z'),
      },
      MIN,
    )).not.toThrow();
  });

  it('o erro carrega o código acionável min_query_date', () => {
    try {
      assertQueryWithinMinDate(
        undefined,
        MIN,
      );

      throw new Error('deveria ter lançado');
    } catch (err) {
      const response = (err as BadRequestException).getResponse() as { error?: { code?: string } };
      expect(response.error?.code).toBe('min_query_date');
    }
  });
});

describe('clampWindowToMinDate', () => {
  it('não recorta quando minQueryDate é null', () => {
    const window = {
      from: new Date('2020-01-01T00:00:00Z'),
      to: null,
    };

    const result = clampWindowToMinDate(
      window,
      null,
    );

    expect(result.clamped).toBe(false);
    expect(result.window).toBe(window);
  });

  it('recorta o início para a data mínima quando a janela começa antes', () => {
    const result = clampWindowToMinDate(
      {
        from: new Date('2026-06-18T00:00:00Z'),
        to: new Date('2026-06-18T23:00:00Z'),
      },
      MIN,
    );

    expect(result.clamped).toBe(true);
    expect(result.window?.from?.toISOString()).toBe('2026-06-18T20:40:00.000Z');
    expect(result.window?.to?.toISOString()).toBe('2026-06-18T23:00:00.000Z');
  });

  it('recorta janela aberta/ausente para [min, …]', () => {
    const result = clampWindowToMinDate(
      undefined,
      MIN,
    );

    expect(result.clamped).toBe(true);
    expect(result.window?.from?.toISOString()).toBe('2026-06-18T20:40:00.000Z');
    expect(result.window?.to).toBeNull();
  });

  it('não recorta quando a janela já começa em/depois da data mínima', () => {
    const window = {
      from: new Date('2026-06-18T21:00:00Z'),
      to: null,
    };

    const result = clampWindowToMinDate(
      window,
      MIN,
    );

    expect(result.clamped).toBe(false);
    expect(result.window).toBe(window);
  });

  it('REJEITA (não inverte) quando a janela inteira é anterior ao piso (to <= min)', () => {
    // Regressão: "dia 03/05" com piso em 18/06 recortava só o início → [18/06, 04/05) invertida,
    // devolvendo 0 mudo. Agora rejeita com o erro acionável.
    expect(() => clampWindowToMinDate(
      {
        from: new Date('2026-05-03T03:00:00Z'),
        to: new Date('2026-05-04T03:00:00Z'),
      },
      MIN,
    )).toThrow(BadRequestException);

    // Fim EXATAMENTE no piso também não tem porção confiável (fim exclusivo).
    expect(() => clampWindowToMinDate(
      {
        from: new Date('2026-06-01T00:00:00Z'),
        to: new Date(MIN),
      },
      MIN,
    )).toThrow(BadRequestException);
  });

  it('o erro do fully-below-floor carrega o código acionável min_query_date', () => {
    try {
      clampWindowToMinDate(
        {
          from: new Date('2026-05-03T03:00:00Z'),
          to: new Date('2026-05-04T03:00:00Z'),
        },
        MIN,
      );

      throw new Error('deveria ter lançado');
    } catch (err) {
      const response = (err as BadRequestException).getResponse() as { error?: { code?: string } };
      expect(response.error?.code).toBe('min_query_date');
    }
  });
});
