import { estimateCostUsd } from './llm-pricing';

describe('estimateCostUsd', () => {
  it('calcula o custo de um modelo conhecido (entrada + saída por 1k)', () => {
    // 1000/1k * 0.0008 + 2000/1k * 0.0032 = 0.0008 + 0.0064 = 0.0072
    expect(estimateCostUsd(
      'amazon.nova-pro-v1:0',
      1000,
      2000,
    )).toBeCloseTo(
      0.0072,
      6,
    );
  });

  it('normaliza o prefixo de inference profile (us./global.) p/ casar a tabela', () => {
    expect(estimateCostUsd(
      'us.amazon.nova-pro-v1:0',
      1000,
      2000,
    )).toBeCloseTo(
      0.0072,
      6,
    );

    expect(estimateCostUsd(
      'global.amazon.nova-pro-v1:0',
      1000,
      2000,
    )).toBeCloseTo(
      0.0072,
      6,
    );
  });

  it('precifica o Amazon Nova Lite (bem mais barato — opção econômica)', () => {
    // 1000/1k * 0.00006 + 2000/1k * 0.00024 = 0.00006 + 0.00048 = 0.00054 → 0.0005 (4 casas)
    expect(estimateCostUsd(
      'us.amazon.nova-lite-v1:0',
      1000,
      2000,
    )).toBeCloseTo(
      0.0005,
      6,
    );
  });

  it('retorna null para modelo sem preço ou indefinido', () => {
    expect(estimateCostUsd(
      'modelo-desconhecido',
      1000,
      2000,
    )).toBeNull();

    expect(estimateCostUsd(
      undefined,
      1000,
      2000,
    )).toBeNull();
  });
});
