import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import configuration from './config/configuration';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { AuditModule } from './audit/audit.module';
import { LlmModule } from './llm/llm.module';
import { CacheModule } from './cache/cache.module';
import { AuditQueryModule } from './audit-query/audit-query.module';
import { ShippingsModule } from './shippings/shippings.module';
import { CatalogModule } from './catalog/catalog.module';
import { ReportsModule } from './reports/reports.module';
import { ChatModule } from './chat/chat.module';
import { IncidentsModule } from './incidents/incidents.module';
import { RulesModule } from './rules/rules.module';
import { RealtimeModule } from './realtime/realtime.module';
import { DetectorModule } from './detector/detector.module';
import { RetentionModule } from './retention/retention.module';
import { UsersModule } from './users/users.module';
import { AdminModule } from './admin/admin.module';
import { ObservabilityModule } from './observability/observability.module';
import { MetricsModule } from './observability/metrics.module';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { MetricsInterceptor } from './common/metrics.interceptor';

/**
 * Módulo raiz da API da Atena.
 *
 * Compõe a aplicação a partir dos módulos de domínio e da infraestrutura:
 * - `ConfigModule` global, carregando a config tipada (`configuration`) lida do
 *   `.env` único em runtime.
 * - `PrismaModule` (acesso ao MySQL — usado só pela aplicação, nunca pela IA).
 * - `AuthModule`, `AuditModule` (registra o AuditInterceptor global — tudo é
 *   auditado), `LlmModule`, `CacheModule` (cache transitório /tmp↔S3),
 *   `ShippingsModule`, `CatalogModule`, `ReportsModule` (tools da Fase 1) e
 *   `ChatModule` (sessões/mensagens de chat).
 *
 * Registra o `AllExceptionsFilter` como filtro global (`APP_FILTER`), produzindo
 * erros estruturados `{ error: { code, message } }` no boundary HTTP.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    ScheduleModule.forRoot(), // habilita @Interval (detector); o scan é gateado por detect.enabled
    MetricsModule, // global: DogStatsD (métricas custom no Datadog), best-effort
    PrismaModule,
    AuthModule,
    AuditModule, // registra o AuditInterceptor global (princípio: tudo é auditado)
    LlmModule,
    CacheModule, // cache transitório read-through /tmp↔S3 (decisão #8)
    AuditQueryModule, // motor de consulta de auditoria (S3 fonte de verdade via DuckDB) — @Global
    ShippingsModule, // tools de envios (Fase 1): search_shippings, get_shipping_trail, analyze_shipping_content
    CatalogModule, // tools de catálogo (Fase 1): list_providers, list_customers
    ReportsModule, // tool de relatório (Fase 1): generate_delivery_report
    ChatModule, // sessões/mensagens de chat (Fase 1): CRUD + histórico (orquestrador SSE na task 2.9)
    RealtimeModule, // tempo real (Fase 2): gateway socket.io /ws/support (push de incident.*)
    IncidentsModule, // incidentes (Fase 2): list_incidents, get_incident + lifecycle (ack/resolve/comment)
    RulesModule, // regras de anomalia (Fase 2): GET/PUT /rules (tela de Regras)
    DetectorModule, // detector (Fase 2): delivery_rate_drop + reconciliação + POST /dev/detect
    ObservabilityModule, // observabilidade (Fase 2): GET /observability básica
    RetentionModule, // retenção do chat: @Cron diário apaga sessões/mensagens > 90d + POST /dev/retention
    UsersModule, // RBAC: usuários persistidos + papéis no banco (cache) + resolução p/ o guard
    AdminModule, // administração: /admin/users (papéis/status) + /admin/roles (catálogo), users:manage
  ],
  controllers: [AppController],
  providers: [
    // Exception filter global: erros estruturados { error: { code, message } } + log boundary.
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
    // Observabilidade: latência/erro por requisição (sem PII).
    {
      provide: APP_INTERCEPTOR,
      useClass: MetricsInterceptor,
    },
  ],
})
export class AppModule {}
