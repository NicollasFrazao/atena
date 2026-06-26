import { resolveLlmProvider } from './llm.module';
import type { LlmProviderInterface } from './llm-provider.interface';

/** Sentinelas: `resolveLlmProvider` só compara/retorna a referência — não chama métodos. */
const bedrock = { kind: 'bedrock' } as unknown as LlmProviderInterface;
const fake = { kind: 'fake' } as unknown as LlmProviderInterface;

describe('resolveLlmProvider', () => {
  it('LLM_PROVIDER ausente ou != bedrock → FakeLlmProvider', () => {
    expect(resolveLlmProvider(
      undefined,
      undefined,
      bedrock,
      fake,
    )).toBe(fake);

    expect(resolveLlmProvider(
      'fake',
      undefined,
      bedrock,
      fake,
    )).toBe(fake);
  });

  it('LLM_PROVIDER=bedrock COM AWS_BEARER_TOKEN_BEDROCK → BedrockProvider', () => {
    expect(resolveLlmProvider(
      'bedrock',
      'bearer-xyz',
      bedrock,
      fake,
    )).toBe(bedrock);
  });

  it('LLM_PROVIDER=bedrock SEM o token → lança (Bearer obrigatório; não cai pro fake)', () => {
    expect(() => resolveLlmProvider(
      'bedrock',
      '',
      bedrock,
      fake,
    )).toThrow(/AWS_BEARER_TOKEN_BEDROCK/);

    expect(() => resolveLlmProvider(
      'bedrock',
      undefined,
      bedrock,
      fake,
    )).toThrow(/AWS_BEARER_TOKEN_BEDROCK/);
  });
});
