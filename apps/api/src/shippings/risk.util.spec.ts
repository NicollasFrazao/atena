import { analyzeRisk } from './risk.util';

describe('analyzeRisk', () => {
  it('detecta phishing financeiro com link encurtado → medium/high', () => {
    const result = analyzeRisk('CreditBank: Sua fatura vence amanhã. Acesse cb.app/f/8H2 e regularize agora para evitar restrição.');
    expect(result.categories.length).toBeGreaterThanOrEqual(2);

    expect([
      'medium',
      'high',
    ]).toContain(result.verdict);

    expect(result.score).toBeGreaterThanOrEqual(0.4);
    // categorias ordenadas por strength desc
    expect(result.categories[0].strength).toBeGreaterThanOrEqual(result.categories[1].strength);
  });

  it('texto benigno → low e sem categorias', () => {
    const result = analyzeRisk('Olá! Seu pedido foi enviado e chega em 3 dias úteis. Obrigado pela preferência.');
    expect(result.categories).toHaveLength(0);
    expect(result.verdict).toBe('low');
    expect(result.score).toBe(0);
  });
});
