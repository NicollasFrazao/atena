import { Global, Module } from '@nestjs/common';
import { AUDIT_QUERY } from './audit-query.interface';
import { DuckDbAuditQueryService } from './duckdb-audit-query.service';

/**
 * Módulo do motor de consulta de auditoria (S3 fonte de verdade, via DuckDB + cache /tmp).
 *
 * `@Global` para que os 6 consumidores (messages/reports/catalog/detector/reveal/analysis)
 * injetem o token {@link AUDIT_QUERY} sem reimportar o módulo. A implementação padrão é a
 * {@link DuckDbAuditQueryService}; trocar o motor (ex.: Athena) é só rebindar o token aqui.
 */
@Global()
@Module({
  providers: [
    {
      provide: AUDIT_QUERY,
      useClass: DuckDbAuditQueryService,
    },
  ],
  exports: [AUDIT_QUERY],
})
export class AuditQueryModule {}
