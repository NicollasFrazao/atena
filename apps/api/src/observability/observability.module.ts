import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { ObservabilityController } from './observability.controller';
import { ObservabilityService } from './observability.service';

/**
 * Módulo de observabilidade (Fase 2): `GET /observability` básica.
 *
 * Importa o {@link RealtimeModule} para ler as conexões ativas do `SupportGateway` e o
 * {@link LlmModule} para rotular o provider/modelo LLM ativo. `PrismaService`/`AUDIT_QUERY` são
 * globais (audit log / sessões / motor de auditoria).
 */
@Module({
  imports: [
    RealtimeModule,
    LlmModule,
  ],
  controllers: [ObservabilityController],
  providers: [ObservabilityService],
})
export class ObservabilityModule {}
