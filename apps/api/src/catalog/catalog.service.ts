import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { clampWindowToMinDate } from '../audit-query/audit-guards';
import { AUDIT_QUERY, type AuditQueryServiceInterface } from '../audit-query/audit-query.interface';
import type { AuditWindowInterface } from '../audit-query/audit-query.types';
import { resolveWindow, type WindowInputInterface } from '../audit-query/window';
import { AUDIT_QUERY_DEFAULTS } from '../config/configuration';

/** Rótulo legível dos presets de `date_range`. */
const RANGE_LABELS: Record<string, string> = {
  '24h': 'últimas 24h',
  '7d': 'últimos 7 dias',
  '30d': 'últimos 30 dias',
  all: 'todo o período',
};

/**
 * Tools de catálogo (Fase 1): `list_providers` e `list_customers`.
 *
 * Os valores são derivados (DISTINCT) do dado de entrega no S3 (via {@link AuditQueryServiceInterface}),
 * listando quem teve ATIVIDADE numa janela — não há tabelas dedicadas de provider/customer. Sem janela
 * explícita, recorta para o período confiável (`>= ATENA_AUDIT_MIN_QUERY_DATE`) em vez de varrer o
 * default largo do motor (~30 dias), mantendo o scan barato. Saída em snake_case na borda.
 *
 * @see AuditQueryServiceInterface - motor de consulta sobre o S3.
 */
@Injectable()
export class CatalogService {
  /**
   * @param audit - Motor de consulta de auditoria (S3 via DuckDB).
   * @param [config] - Fonte de `auditQuery.minQueryDate` (recorte da janela default).
   */
  constructor(
    @Inject(AUDIT_QUERY) private readonly audit: AuditQueryServiceInterface,
    @Optional() private readonly config?: ConfigService,
  ) {}

  /**
   * Resolve a janela do catálogo: usa a janela informada (`date_from`/`date_to`/`date_range`) e
   * recorta o início para a data mínima confiável; sem janela, vira `[minQueryDate, agora]` (ou o
   * default do motor quando a guarda está desligada).
   *
   * @param [input] - Datas/atalho da requisição.
   *
   * @returns Janela recortada para o motor.
   */
  private catalogWindow(input?: WindowInputInterface): AuditWindowInterface | undefined {
    const minQueryDate = this.config?.get<string | null>('auditQuery.minQueryDate') ?? null;

    return clampWindowToMinDate(
      resolveWindow(input ?? {}),
      minQueryDate,
    ).window;
  }

  /**
   * Rótulo legível da janela efetivamente usada na listagem, para a tool deixar EXPLÍCITO ao usuário
   * de que período é a lista (uma lista de "ativos" sem janela é ambígua). Reflete a precedência real:
   * `date_from`/`date_to` → preset `date_range` → sem janela: o piso de dado confiável
   * (`minQueryDate`) quando ligado, senão o default do motor (~`defaultWindowDays`).
   *
   * @param [input] - Datas/atalho da requisição.
   *
   * @returns Janela legível (ex.: "últimas 24h", "desde 2026-06-18T20:40:00Z (padrão)").
   */
  windowLabel(input?: WindowInputInterface): string {
    if (
      input?.date_from
      || input?.date_to
    ) {
      return `${input.date_from ?? 'início'} → ${input.date_to ?? 'agora'}`;
    }

    if (input?.date_range) {
      return RANGE_LABELS[input.date_range] ?? input.date_range;
    }

    const minQueryDate = this.config?.get<string | null>('auditQuery.minQueryDate') ?? null;

    if (minQueryDate) {
      return `desde ${minQueryDate} (padrão)`;
    }

    const days = this.config?.get<number>('auditQuery.defaultWindowDays') ?? AUDIT_QUERY_DEFAULTS.defaultWindowDays;

    return `últimos ${days} dias (padrão)`;
  }

  /**
   * Lista os provedores com atividade na janela (`list_providers`), ordenados alfabeticamente.
   *
   * @param [input] - Janela opcional (`date_from`/`date_to`/`date_range`).
   *
   * @returns Nomes de providers distintos, em ordem ascendente.
   */
  async listProviders(input?: WindowInputInterface): Promise<string[]> {
    return this.audit.distinctProviders(this.catalogWindow(input));
  }

  /**
   * Lista os clientes com atividade na janela (`list_customers`), opcionalmente filtrados por busca.
   *
   * Como ainda não há tabela de customers, `id` e `name` são o mesmo valor (@todo join a uma referência real).
   *
   * @param [input] - Janela opcional + `search` (match parcial).
   *
   * @returns Top-N clientes
   *   por volume (`id === name` por ora) + total distinto na janela.
   */
  async listCustomers(input?: WindowInputInterface & { search?: string }): Promise<{
    items: {
      id: string;
      name: string
    }[];
    total: number
  }> {
    const {
      items,
      total,
    } = await this.audit.distinctCustomers(
      this.catalogWindow(input),
      input?.search,
    );

    return {
      // Sem tabela de customers no schema: id == name por ora. @todo join a uma referência real.
      items: items.map((customer) => ({
        id: customer,
        name: customer,
      })),
      total,
    };
  }
}
