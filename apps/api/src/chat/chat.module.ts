import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CatalogModule } from '../catalog/catalog.module';
import { IncidentsModule } from '../incidents/incidents.module';
import { LlmModule } from '../llm/llm.module';
import { ShippingsModule } from '../shippings/shippings.module';
import { ReportsModule } from '../reports/reports.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { OrchestratorService } from './orchestrator.service';

/**
 * Módulo de chat: sessões/mensagens (Fase 1) + orquestrador SSE.
 *
 * Expõe o {@link ChatController} (endpoints sob `/chat/sessions`) e provê o
 * {@link OrchestratorService}, que reúne o provider LLM e os serviços de tools
 * (mensagens, catálogo, análise, relatórios) importados de seus módulos.
 *
 * Exporta o {@link ChatService} para reúso por outros módulos.
 */
@Module({
  imports: [
    LlmModule,
    ShippingsModule,
    CatalogModule,
    ReportsModule,
    IncidentsModule,
    AuditModule,
  ],
  controllers: [ChatController],
  providers: [
    ChatService,
    OrchestratorService,
  ],
  exports: [ChatService],
})
export class ChatModule {}
