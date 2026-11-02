import {
  Controller,
  Get,
  Query,
} from '@nestjs/common';
import type {
  AuditLogEntryInterface,
  AuditSummaryInterface,
  AuditUserOptionInterface,
  PaginatedEnvelopeInterface,
} from '@atena/types';
import { Requires } from '../auth/rbac/requires.decorator';
import { AuditService } from './audit.service';
import { ListAuditDto } from './dto/list-audit.dto';

/**
 * Endpoints de LEITURA do audit log (`/audit`, página admin). Append-only e imutável: aqui só há
 * `GET` (lista + contadores). RBAC via `@Roles`. Sem PII em claro (o log já guarda só referências).
 *
 * @see AuditService - leitura paginada e contadores.
 */
@Requires('audit:view')
@Controller('audit')
export class AuditController {
  /**
   * @param audit - Serviço de auditoria (leitura).
   */
  constructor(private readonly audit: AuditService) {}

  /**
   * `GET /audit` — lista registros (mais recentes primeiro) com filtros e paginação.
   *
   * @param query - Filtros + paginação.
   *
   * @returns Página de registros.
   */
  @Get()
  list(@Query() query: ListAuditDto): Promise<PaginatedEnvelopeInterface<AuditLogEntryInterface>> {
    return this.audit.list(query);
  }

  /**
   * `GET /audit/summary` — contadores do topo (hoje, PII, mudanças de regra, total).
   *
   * @returns Contadores agregados.
   */
  @Get('summary')
  summary(): Promise<AuditSummaryInterface> {
    return this.audit.summary();
  }

  /**
   * `GET /audit/users` — usuários distintos no log (para o filtro de usuário da tela).
   *
   * @returns Usuários distintos (id + nome de exibição).
   */
  @Get('users')
  users(): Promise<AuditUserOptionInterface[]> {
    return this.audit.users();
  }

  /**
   * `GET /audit/export` — registros que casam os filtros (sem paginação), para download JSONL.
   *
   * @param query - Mesmos filtros da listagem.
   *
   * @returns Registros (até o teto de exportação).
   */
  @Get('export')
  export(@Query() query: ListAuditDto): Promise<AuditLogEntryInterface[]> {
    return this.audit.exportAll(query);
  }
}
