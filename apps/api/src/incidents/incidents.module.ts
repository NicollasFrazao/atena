import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ShippingsModule } from '../shippings/shippings.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { IncidentLifecycleController } from './incident-lifecycle.controller';
import { IncidentLifecycleService } from './incident-lifecycle.service';
import { IncidentsController } from './incidents.controller';
import { IncidentsService } from './incidents.service';

/**
 * Módulo de incidentes (Fase 2).
 *
 * - Leitura (LLM/UI): {@link IncidentsController} (`list_incidents`/`get_incident`).
 * - Lifecycle (UI-only, não-LLM): {@link IncidentLifecycleController}
 *   (`acknowledge`/`resolve`/`comment`) com validação §D + audit.
 *
 * Importa o {@link AuditModule} para o lifecycle gravar no audit log e exporta o
 * {@link IncidentsService} para reúso (orquestrador/tools, detector).
 */
@Module({
  imports: [
    AuditModule,
    ShippingsModule,
    RealtimeModule,
  ],
  controllers: [
    IncidentsController,
    IncidentLifecycleController,
  ],
  providers: [
    IncidentsService,
    IncidentLifecycleService,
  ],
  exports: [IncidentsService],
})
export class IncidentsModule {}
