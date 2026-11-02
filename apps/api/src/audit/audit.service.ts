import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  AuditActionType,
  AuditLogEntryInterface,
  AuditSeverityType,
  AuditSummaryInterface,
  AuditUserOptionInterface,
  PaginatedEnvelopeInterface,
} from '@atena/types';
import { PrismaService } from '../prisma/prisma.service';
import { ListAuditDto } from './dto/list-audit.dto';

/** Limite default de itens por página na listagem do audit log. */
const DEFAULT_AUDIT_LIMIT = 50;

/** Teto de registros por exportação JSONL (evita puxar o log inteiro). */
const AUDIT_EXPORT_CAP = 5000;

/**
 * Entrada de auditoria. É o contrato único de gravação no audit log.
 *
 * IMPORTANTE — privacidade:
 * NUNCA logar PII em claro (telefone, conteúdo de mensagem, e-mail, etc.).
 * Use `severity: 'pii'` para marcar acessos a dados sensíveis e mantenha
 * `detail`/`metadata` com referências (IDs, hashes) — jamais o valor cru.
 */
export interface AuditEntry {
  /** Subject (`sub`) do usuário autenticado, quando houver. */
  userId?: string;
  /** Ação auditada (ex.: `reveal_phone`). */
  action: AuditActionType;
  /** Recurso afetado (ex.: rota `MÉTODO /caminho`). */
  resource: string;
  /** Detalhe livre; apenas referências, NUNCA PII em claro. */
  detail?: string;
  /** Severidade do evento (ex.: `info`, `pii`). */
  severity: AuditSeverityType;
  /** IP de origem da requisição, quando disponível. */
  ipAddress?: string;
  /** Metadados estruturados; só referências (IDs/hashes), NUNCA PII em claro. */
  metadata?: Record<string, unknown>;
}

/**
 * Serviço de auditoria — append-only (somente `create`).
 * O modelo `audit_log` é imutável; o role de app só deve ter INSERT + SELECT.
 */
@Injectable()
export class AuditService {
  /**
   * @param prisma - Acesso ao banco; usado apenas para INSERT no audit log.
   */
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Grava uma entrada no audit log (append-only; somente `create`).
   *
   * NUNCA passe PII em claro em `detail` ou `metadata`.
   *
   * @param entry - Entrada a ser gravada no audit log.
   *
   * @returns Resolve quando o INSERT é concluído.
   */
  async record(entry: AuditEntry): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        userId: entry.userId,
        action: entry.action,
        resource: entry.resource,
        detail: entry.detail,
        severity: entry.severity,
        ipAddress: entry.ipAddress,
        metadata: entry.metadata as unknown as Prisma.InputJsonValue | undefined,
      },
    });
  }

  /**
   * Lista registros do audit log (mais recentes primeiro) com filtros e paginação — para a tela
   * de Audit log (somente leitura; RBAC na borda).
   *
   * @param dto - Filtros (ação/severidade/só-PII/busca) + paginação.
   *
   * @returns Página de registros.
   */
  async list(dto: ListAuditDto): Promise<PaginatedEnvelopeInterface<AuditLogEntryInterface>> {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? DEFAULT_AUDIT_LIMIT;
    const where = this.buildWhere(dto);

    const [
      rows,
      total,
    ] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    const names = await this.resolveUserNames(rows.map((row) => row.userId));

    return {
      rows: rows.map((row) => this.toEntry(
        row,
        names,
      )),
      page,
      total,
      total_pages: Math.max(
        1,
        Math.ceil(total / limit),
      ),
      latency_ms: 0,
    };
  }

  /**
   * Exporta os registros que casam os filtros (sem paginação), para download JSONL. Limitado a
   * {@link AUDIT_EXPORT_CAP} para não puxar o log inteiro de uma vez.
   *
   * @param dto - Mesmos filtros da listagem (paginação ignorada).
   *
   * @returns Registros (mais recentes primeiro), até o teto.
   */
  async exportAll(dto: ListAuditDto): Promise<AuditLogEntryInterface[]> {
    const rows = await this.prisma.auditLog.findMany({
      where: this.buildWhere(dto),
      orderBy: { occurredAt: 'desc' },
      take: AUDIT_EXPORT_CAP,
    });

    const names = await this.resolveUserNames(rows.map((row) => row.userId));

    return rows.map((row) => this.toEntry(
      row,
      names,
    ));
  }

  /**
   * Constrói o `where` do Prisma a partir dos filtros (ação/severidade/só-PII/usuário/janela/busca).
   *
   * @param dto - Filtros.
   *
   * @returns Cláusula de filtro.
   */
  private buildWhere(dto: ListAuditDto): Prisma.AuditLogWhereInput {
    const where: Prisma.AuditLogWhereInput = {};

    if (dto.action) {
      where.action = dto.action;
    }

    const severity = dto.pii_only === 'true'
      ? 'pii'
      : dto.severity;

    if (severity) {
      where.severity = severity;
    }

    if (dto.user_id) {
      where.userId = dto.user_id;
    }

    if (
      dto.from
      || dto.to
    ) {
      where.occurredAt = {
        ...(dto.from
          ? { gte: new Date(dto.from) }
          : {}),
        ...(dto.to
          ? { lt: new Date(dto.to) }
          : {}),
      };
    }

    if (dto.search) {
      where.OR = [
        { resource: { contains: dto.search } },
        { detail: { contains: dto.search } },
      ];
    }

    return where;
  }

  /**
   * Contadores do topo da tela de Audit log (eventos hoje, acessos a PII, mudanças de regra, total).
   *
   * @returns Contadores agregados.
   */
  async summary(): Promise<AuditSummaryInterface> {
    const now = new Date();

    const startOfTodayUtc = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
    ));

    const [
      today,
      pii,
      ruleChanges,
      total,
    ] = await Promise.all([
      this.prisma.auditLog.count({ where: { occurredAt: { gte: startOfTodayUtc } } }),
      this.prisma.auditLog.count({ where: { severity: 'pii' } }),
      this.prisma.auditLog.count({ where: { action: 'rule_update' } }),
      this.prisma.auditLog.count(),
    ]);

    return {
      today,
      pii,
      rule_changes: ruleChanges,
      total,
    };
  }

  /**
   * Lista os usuários distintos presentes no audit log (para o filtro de usuário da tela), cada um
   * com o `id` (sub) e o nome de exibição resolvido (ou `null` → a tela mostra o id).
   *
   * @returns Usuários distintos (sem nulos).
   */
  async users(): Promise<AuditUserOptionInterface[]> {
    const rows = await this.prisma.auditLog.findMany({
      where: { userId: { not: null } },
      distinct: ['userId'],
      select: { userId: true },
      orderBy: { userId: 'asc' },
    });

    const ids = rows
      .map((row) => row.userId)
      .filter((userId): userId is string => userId !== null);

    const names = await this.resolveUserNames(ids);

    return ids.map((id) => ({
      id,
      name: names.get(id) ?? null,
    }));
  }

  /**
   * Mapeia uma linha do Prisma para o registro de borda (snake_case).
   *
   * @param row - Linha do audit log.
   *
   * @returns Registro na borda.
   */
  private toEntry(
    row: {
      id: string;
      occurredAt: Date;
      userId: string | null;
      action: AuditActionType;
      resource: string;
      detail: string | null;
      severity: AuditSeverityType;
      ipAddress: string | null;
      metadata: Prisma.JsonValue | null;
    },
    names: Map<string, string>,
  ): AuditLogEntryInterface {
    return {
      id: row.id,
      occurred_at: row.occurredAt.toISOString(),
      user_id: row.userId,
      user_name: row.userId
        ? names.get(row.userId) ?? null
        : null,
      action: row.action,
      resource: row.resource,
      detail: row.detail,
      severity: row.severity,
      ip_address: row.ipAddress,
      metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    };
  }

  /**
   * Resolve `sub → nome de exibição` (nome, ou e-mail como fallback) para uma lista de subs, lendo a
   * tabela de usuários (RBAC). Subs não cadastrados (ex.: usuários de smoke/dev) ficam de fora do mapa
   * — a borda cai no próprio id.
   *
   * @param subs - Subs (`user_id`) a resolver (pode ter nulos/repetidos).
   *
   * @returns Mapa `sub → nome de exibição` (só os encontrados).
   */
  private async resolveUserNames(subs: (string | null)[]): Promise<Map<string, string>> {
    const ids = [...new Set(subs.filter((sub): sub is string => Boolean(sub)))];

    if (ids.length === 0) {
      return new Map();
    }

    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        name: true,
        email: true,
      },
    });

    return new Map(users.map((user) => [
      user.id,
      user.name || user.email,
    ]));
  }
}
