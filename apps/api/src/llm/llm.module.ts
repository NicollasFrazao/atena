/**
 * Módulo LLM: provê o `LlmProviderInterface` selecionado por config (`llm.provider`),
 * exposto sob o token de injeção `LLM_PROVIDER`.
 *
 * - `bedrock` → `BedrockProvider` (produção; Nova via Bedrock)
 * - `fake`    → `FakeLlmProvider` (dev/local e testes, sem credencial) — default
 *
 * Consumidores injetam o token `LLM_PROVIDER`, nunca a implementação concreta —
 * mantendo o provider trocável sem mudar o orquestrador/tools.
 *
 * @module LlmModule
 */
import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BedrockProvider } from './bedrock.provider';
import { FakeLlmProvider } from './fake-llm.provider';
import { LLM_PROVIDER, type LlmProviderInterface } from './llm-provider.interface';

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
      ): LlmProviderInterface => {
        const wantsBedrock = config.get<string>('llm.provider') === 'bedrock';
        const hasKey = Boolean(config.get<string>('bedrock.apiKey'));

        if (
          wantsBedrock
          && !hasKey
        ) {
          new Logger('LlmModule').warn('LLM_PROVIDER=bedrock sem AWS_BEARER_TOKEN_BEDROCK — usando FakeLlmProvider.');

          return fake;
        }

        return wantsBedrock
          ? bedrock
          : fake;
      },
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
