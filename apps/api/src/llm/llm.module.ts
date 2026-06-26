/**
 * Módulo LLM: provê o `LlmProviderInterface` selecionado por config (`llm.provider`),
 * exposto sob o token de injeção `LLM_PROVIDER`.
 *
 * - `bedrock` → `BedrockProvider` (produção; Nova via Bedrock). Exige `AWS_BEARER_TOKEN_BEDROCK`
 *   (Bearer) — OBRIGATÓRIO; sem ele, falha-rápido no boot (não cai pro fake). O Bedrock NÃO usa a
 *   IAM Role da EC2 (essa cobre só o S3 do detailed report, via credential_chain do DuckDB).
 * - `fake`    → `FakeLlmProvider` (dev/local e testes, sem credencial) — default
 *
 * Consumidores injetam o token `LLM_PROVIDER`, nunca a implementação concreta —
 * mantendo o provider trocável sem mudar o orquestrador/tools.
 *
 * @module LlmModule
 */
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BedrockProvider } from './bedrock.provider';
import { FakeLlmProvider } from './fake-llm.provider';
import { LLM_PROVIDER, type LlmProviderInterface } from './llm-provider.interface';

/**
 * Decide o provider LLM a partir da config. `bedrock` exige `AWS_BEARER_TOKEN_BEDROCK`
 * (OBRIGATÓRIO): o Bedrock autentica por Bearer, NÃO pela IAM Role da EC2 (essa cobre só o S3).
 * Sem o token, **falha-rápido** em vez de cair silenciosamente no fake (que esconderia a
 * má-configuração em produção). Função pura → testável sem subir o módulo Nest.
 *
 * @param {string | undefined} providerName - Valor de `llm.provider` (`bedrock` | `fake`).
 * @param {string | undefined} bearerToken - `bedrock.apiKey` (= `AWS_BEARER_TOKEN_BEDROCK`).
 * @param {LlmProviderInterface} bedrock - Instância do provider Bedrock.
 * @param {LlmProviderInterface} fake - Instância do provider fake.
 * @returns {LlmProviderInterface} O provider selecionado.
 * @throws {Error} Se `bedrock` for pedido sem o token Bearer.
 */
export function resolveLlmProvider(
  providerName: string | undefined,
  bearerToken: string | undefined,
  bedrock: LlmProviderInterface,
  fake: LlmProviderInterface,
): LlmProviderInterface {
  if (providerName !== 'bedrock') {
    return fake;
  }

  if (!bearerToken) {
    throw new Error(
      'LLM_PROVIDER=bedrock exige AWS_BEARER_TOKEN_BEDROCK. Defina o token (Bearer do Bedrock) ou use LLM_PROVIDER=fake.',
    );
  }

  return bedrock;
}

@Module({
  providers: [
    BedrockProvider,
    FakeLlmProvider,
    {
      provide: LLM_PROVIDER,
      useFactory: (
        config: ConfigService,
        bedrock: BedrockProvider,
        fake: FakeLlmProvider,
      ): LlmProviderInterface => resolveLlmProvider(
        config.get<string>('llm.provider'),
        config.get<string>('bedrock.apiKey'),
        bedrock,
        fake,
      ),
      inject: [
        ConfigService,
        BedrockProvider,
        FakeLlmProvider,
      ],
    },
  ],
  exports: [LLM_PROVIDER],
})
export class LlmModule {}
