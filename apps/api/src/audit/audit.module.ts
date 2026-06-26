import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';
import { AuditInterceptor } from './audit.interceptor';

/**
 * Módulo de auditoria.
 *
 * Provê o `AuditService`, expõe a leitura via `AuditController` (`/audit`) e registra o
 * `AuditInterceptor` como interceptor global (princípio: tudo é auditado). Como o PrismaService
 * é @Global, o AuditService recebe a injeção sem importar o PrismaModule aqui.
 *
 * @module AuditModule
 */
@Module({
  controllers: [AuditController],
  providers: [
    AuditService,
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
  ],
  exports: [AuditService],
})
export class AuditModule {}
