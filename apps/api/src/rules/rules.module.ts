import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { RulesController } from './rules.controller';
import { RulesService } from './rules.service';

/**
 * Módulo de regras de anomalia (Fase 2): tela de Regras (`GET`/`PUT /rules`).
 *
 * Importa o {@link AuditModule} para auditar as edições (`rule_update`) e exporta
 * o {@link RulesService} para reúso pelo detector (task 2.6).
 */
@Module({
  imports: [AuditModule],
  controllers: [RulesController],
  providers: [RulesService],
  exports: [RulesService],
})
export class RulesModule {}
