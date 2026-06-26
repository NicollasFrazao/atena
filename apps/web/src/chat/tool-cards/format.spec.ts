import { describe, expect, it } from 'vitest';
import { describeStatus, formatDateTime, formatDateTimeSeconds, formatNumber, formatPhone } from './format';

describe('format', () => {
  it('formatNumber agrupa milhares (separador pt-BR/locale)', () => {
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(1000)).toMatch(/1[.,]000/);
  });

  it('formatDateTime devolve o ISO cru se a data for inválida', () => {
    expect(formatDateTime('não-é-data')).toBe('não-é-data');
  });

  it('formatDateTime formata data válida no shape dd/MM HH:mm', () => {
    expect(formatDateTime('2026-06-18T20:47:11Z')).toMatch(/\d{2}\/\d{2}.*\d{2}:\d{2}/);
  });

  it('formatDateTimeSeconds inclui os segundos (HH:mm:ss) p/ a trilha', () => {
    expect(formatDateTimeSeconds('não-é-data')).toBe('não-é-data');
    expect(formatDateTimeSeconds('2026-06-18T20:47:11Z')).toMatch(/\d{2}:\d{2}:\d{2}/);
  });

  it('formatDateTimeSeconds: naive (sem Z) é o relógio de parede do fuso — NÃO desloca', () => {
    // A borda do chat entrega os eventos da trilha em BRT naive; o card exibe o próprio relógio
    // (16:54:06, dia 22/06), sem reinterpretar — independente do fuso do navegador.
    const out = formatDateTimeSeconds('2026-06-22T16:54:06');
    expect(out).toContain('16:54:06');
    expect(out).toContain('22/06');
  });

  it('formatDateTimeSeconds: absoluto (com Z) converte UTC → BRT (mesmo relógio do naive)', () => {
    // 19:54:06Z = 16:54:06 BRT: o que a borda converte para o naive acima.
    expect(formatDateTimeSeconds('2026-06-22T19:54:06Z')).toContain('16:54:06');
  });

  it('formatDateTime: naive sem segundos formata o próprio relógio (dd/MM HH:mm)', () => {
    const out = formatDateTime('2026-06-22T16:54');
    expect(out).toContain('16:54');
    expect(out).toContain('22/06');
  });

  it('formatPhone formata BR móvel (só-dígitos → +55 (DD) NNNNN-NNNN)', () => {
    expect(formatPhone('5513991884678')).toBe('+55 (13) 99188-4678');
    expect(formatPhone('+5513991884678')).toBe('+55 (13) 99188-4678');
  });

  it('formatPhone trata BR SEM o DDI 55 (ex.: SMS Flash) como BR — não vira "+47..."', () => {
    // 11 dígitos sem 55 = DDD + móvel; 10 = DDD + fixo. Antes virava "+47991508939" (parecia +47).
    expect(formatPhone('47991508939')).toBe('+55 (47) 99150-8939');
    expect(formatPhone('1938989938')).toBe('+55 (19) 3898-9938');
  });

  it('describeStatus cai em neutral + label cru para status desconhecido', () => {
    expect(describeStatus('zztop')).toEqual({
      label: 'zztop',
      tone: 'neutral',
    });
  });
});
