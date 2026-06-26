import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, formatTime } from './time';

describe('util/time — naive-aware', () => {
  it('formatTime: naive (sem Z) é o relógio de parede do fuso — NÃO desloca', () => {
    // A borda do chat entrega os buckets do relatório em BRT naive; o eixo exibe a própria hora.
    expect(formatTime('2026-06-22T06:00:00')).toContain('06:00');
  });

  it('formatTime: naive com fração de segundo (.sss) ainda é relógio de parede — NÃO desloca', () => {
    // Regressão: o NAIVE_ISO precisa aceitar `.123`, senão cai no caminho absoluto e desloca pro fuso do browser.
    expect(formatTime('2026-06-22T06:00:00.123')).toContain('06:00');
  });

  it('formatDate: naive formata o próprio dia (dd/MM), sem reinterpretar fuso', () => {
    expect(formatDate('2026-06-22T06:00:00')).toContain('22/06');
  });

  it('formatDateTime: absoluto (com Z) converte UTC → BRT (default America/Sao_Paulo, −3h)', () => {
    const out = formatDateTime('2026-06-22T09:00:00Z');
    expect(out).toContain('22/06');
    expect(out).toContain('06:00');
  });

  it('valor não-parseável volta cru', () => {
    expect(formatTime('não-é-data')).toBe('não-é-data');
    expect(formatDate('xx')).toBe('xx');
  });
});
