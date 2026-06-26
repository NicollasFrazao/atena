import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AnomalyRule, Incident, Prisma } from '@prisma/client';
import type {
  AffectedDimensionInterface,
  DeliveryReportInterface,
  DimensionType,
  IncidentReportInterface,
  IncidentSeverityType,
  ShippingStatusType,
  ResolvedIncidentInterface,
} from '@atena/types';
import { assertQueryWithinMinDate, clampWindowToMinDate } from '../audit-query/audit-guards';
import { AUDIT_QUERY, type AuditQueryServiceInterface } from '../audit-query/audit-query.interface';
import type {
  AuditProgressCallback,
  AuditWindowInterface,
} from '../audit-query/audit-query.types';
import { appTimeZone, formatInstantInTz, resolveBoundInTz, startOfRecentDays } from '../audit-query/tz';
import { PrismaService } from '../prisma/prisma.service';
import { DeliveryExportDto } from './dto/delivery-export.dto';
import { DeliveryReportDto } from './dto/delivery-report.dto';
import { IncidentReportDto } from './dto/incident-report.dto';

/**
 * Janela temporal de um preset de `date_range`.
 *
 * @property {number | null} ms - Tamanho da janela em ms a partir de agora; `null` = sem limite inferior (todo o período).
 * @property {string} label - Rótulo legível usado em `window` na resposta.
 */
interface WindowPresetInterface {
  ms: number | null;
  label: string;
}

/** Milissegundos em um dia (janela rolante de `24h` e conversão de presets em dias). */
const DAY_MS = 24 * 60 * 60 * 1000;

/** Captura `YYYY-MM-DD` + (opcional) `HH:MM` de uma entrada de data/datetime para o rótulo legível. */
const BOUND_PARTS = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/;

/**
 * Formata um limite da janela (`date_from`/`date_to`) de forma amigável: `DD/MM/AAAA` (só-dia) ou
 * `DD/MM/AAAA HH:MM` (com hora) — sem o `T` cru do ISO. Devolve o valor original se não casar.
 *
 * @param {string | undefined} value - Limite cru (`YYYY-MM-DD` ou ISO).
 * @param {string} fallback - Texto quando o limite é ausente (ex.: `início`/`agora`).
 * @returns {string} Limite legível.
 */
function humanBound(
  value: string | undefined,
  fallback: string,
): string {
  if (!value) {
    return fallback;
  }

  const match = BOUND_PARTS.exec(value);

  if (!match) {
    return value;
  }

  const date = `${match[3]}/${match[2]}/${match[1]}`;

  return match[4]
    ? `${date} às ${match[4]}:${match[5]}`
    : date;
}

/**
 * Rótulo legível de uma janela explícita: `DD/MM/AAAA` quando é um único dia inteiro; senão
 * `<de> → <até>` humanizado. Sem `T` cru.
 *
 * @param {string} [from] - `date_from` cru.
 * @param {string} [to] - `date_to` cru.
 * @returns {string} Rótulo da janela.
 */
function explicitWindowLabel(
  from?: string,
  to?: string,
): string {
  // Mesmo dia inteiro (só-data, from === to): mostra apenas "DD/MM/AAAA".
  if (
    from
    && from === to
    && DATE_ONLY_BOUND.test(from)
  ) {
    return humanBound(
      from,
      '',
    );
  }

  return `${humanBound(
    from,
    'início',
  )} → ${humanBound(
    to,
    'agora',
  )}`;
}

/** Reconhece um limite só-data (`YYYY-MM-DD`, sem hora). */
const DATE_ONLY_BOUND = /^\d{4}-\d{2}-\d{2}$/;

/** Presets aceitos em `date_range` (default `'24h'`). */
const WINDOW_PRESETS: Record<string, WindowPresetInterface> = {
  '24h': {
    ms: 24 * 60 * 60 * 1000,
    label: 'Últimas 24h',
  },
  '7d': {
    ms: 7 * 24 * 60 * 60 * 1000,
    label: 'Últimos 7 dias',
  },
  '30d': {
    ms: 30 * 24 * 60 * 60 * 1000,
    label: 'Últimos 30 dias',
  },
  all: {
    ms: null,
    label: 'Todo o período',
  },
};

/**
 * Janela resolvida do relatório: o intervalo a consultar + o rótulo legível exibido em `window`.
 *
 * @property {AuditWindowInterface} window - Intervalo `[from, to)` a consultar no motor.
 * @property {string} label - Rótulo legível (preset ou intervalo) devolvido na resposta.
 * @property {boolean} explicit - `true` se veio de `date_from`/`date_to` (data nomeada pelo usuário);
 *   `false` se é preset rolante/default (clampável pela guarda em vez de rejeitado).
 */
interface ResolvedReportWindowInterface {
  window: AuditWindowInterface;
  label: string;
  explicit: boolean;
}

/**
 * Resolve a janela do relatório: `date_from`/`date_to` (ISO, precedência) → preset `date_range`
 * → default `24h`. Devolve a janela e o rótulo legível.
 *
 * @param {DeliveryReportDto} dto - Janela pedida.
 * @returns {ResolvedReportWindowInterface} Janela resolvida + rótulo.
 */
function resolveReportWindow(
  dto: {
    date_from?: string;
    date_to?: string;
    date_range?: string
  },
  timeZone: string,
  now: Date,
): ResolvedReportWindowInterface {
  if (
    dto.date_from
    || dto.date_to
  ) {
    return {
      window: {
        // Dia nomeado (`YYYY-MM-DD`) é interpretado NO fuso de exibição → instante UTC; data com hora
        // (ISO completo) é instante absoluto. `date_to` só-dia cobre o dia inteiro (fim exclusivo =
        // início do dia seguinte no fuso): "até 19/06" é o dia 19 inteiro. Fonte única: resolveBoundInTz.
        from: dto.date_from
          ? resolveBoundInTz(
            dto.date_from,
            timeZone,
            false,
          )
          : null,
        to: dto.date_to
          ? resolveBoundInTz(
            dto.date_to,
            timeZone,
            true,
          )
          : null,
      },
      label: explicitWindowLabel(
        dto.date_from,
        dto.date_to,
      ),
      explicit: true,
    };
  }

  const key = dto.date_range ?? '24h';
  const preset = WINDOW_PRESETS[key] ?? WINDOW_PRESETS['24h'];

  return {
    window: {
      from: presetWindowStart(
        key,
        preset,
        timeZone,
        now,
      ),
      to: null,
    },
    label: preset.label,
    explicit: false,
  };
}

/**
 * Início (UTC) da janela de um preset: `all` = sem limite; `24h` = rolante (`agora − 24h`); `7d`/`30d`
 * = N dias-calendário **no fuso** (início do dia mais antigo). Espelha {@link resolveWindow} do motor.
 *
 * @param {string} key - Atalho (`24h`/`7d`/`30d`/`all`).
 * @param {WindowPresetInterface} preset - Preset resolvido (ms/label).
 * @param {string} timeZone - Fuso de exibição (IANA).
 * @param {Date} now - Instante de referência.
 * @returns {Date | null} Início da janela em UTC, ou `null` (sem limite inferior).
 */
function presetWindowStart(
  key: string,
  preset: WindowPresetInterface,
  timeZone: string,
  now: Date,
): Date | null {
  if (preset.ms === null) {
    return null;
  }

  if (key === '24h') {
    return new Date(now.getTime() - preset.ms);
  }

  return startOfRecentDays(
    Math.round(preset.ms / DAY_MS) - 1,
    timeZone,
    now,
  );
}

/**
 * Monta o `csv_url` (caminho sob `/api`) do export do relatório a partir da MESMA janela/filtros que
 * o geraram — o front baixa por essa URL (`GET /reports/delivery/export`).
 *
 * @param {DeliveryReportDto} dto - Janela e filtros do relatório gerado.
 * @returns {string} Caminho do export com a query string (ex.: `/reports/delivery/export?date_range=24h`).
 */
function deliveryExportUrl(dto: DeliveryReportDto): string {
  const params = new URLSearchParams();

  if (dto.date_from) {
    params.set(
      'date_from',
      dto.date_from,
    );
  }

  if (dto.date_to) {
    params.set(
      'date_to',
      dto.date_to,
    );
  }

  if (dto.date_range) {
    params.set(
      'date_range',
      dto.date_range,
    );
  }

  if (dto.filters?.customer_id) {
    params.set(
      'customer_id',
      dto.filters.customer_id,
    );
  }

  if (dto.filters?.provider) {
    params.set(
      'provider',
      dto.filters.provider,
    );
  }

  if (dto.filters?.status) {
    params.set(
      'status',
      dto.filters.status,
    );
  }

  const qs = params.toString();

  return qs
    ? `/reports/delivery/export?${qs}`
    : '/reports/delivery/export';
}

/**
 * Eco dos filtros aplicados ao relatório (só as chaves definidas) — o front mostra no card de qual
 * cliente/provedor/status é o recorte. Devolve `undefined` se nenhum filtro foi informado (= todos).
 *
 * @param {DeliveryReportDto['filters']} filters - Filtros do recorte (opcionais, snake_case).
 * @returns {DeliveryReportInterface['filters']} O eco enxuto, ou `undefined` se vazio.
 */
function echoedFilters(filters: DeliveryReportDto['filters']): DeliveryReportInterface['filters'] {
  if (!filters) {
    return undefined;
  }

  const echo: NonNullable<DeliveryReportInterface['filters']> = {};

  if (filters.customer_id) {
    echo.customer_id = filters.customer_id;
  }

  if (filters.provider) {
    echo.provider = filters.provider;
  }

  if (filters.status) {
    echo.status = filters.status as ShippingStatusType;
  }

  return Object.keys(echo).length > 0
    ? echo
    : undefined;
}

/** Formata a duração detecção→resolução de forma legível (ex.: `38m`, `2h 15m`, `—`). */
function formatDuration(
  from: Date,
  to: Date | null,
): string {
  if (!to) {
    return '—';
  }

  const totalMin = Math.max(
    0,
    Math.round((to.getTime() - from.getTime()) / 60_000),
  );

  const hours = Math.floor(totalMin / 60);
  const minutes = totalMin % 60;

  if (hours === 0) {
    return `${minutes}m`;
  }

  return `${hours}h ${minutes}m`;
}

/** Ordem de severidade para escolher a "pior" de um grupo de incidentes. */
const SEVERITY_RANK: Record<string, number> = {
  critical: 3,
  warning: 2,
  info: 1,
};

/** Média (arredondada, em segundos) de uma lista; `null` se vazia. */
function avgSecondsOrNull(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  let sum = 0;

  for (const value of values) {
    sum += value;
  }

  return Math.round(sum / values.length);
}

/**
 * Top dimensões afetadas: agrupa os incidentes por `dimension_type`+`dimension_value`, conta e
 * mantém a pior severidade do grupo. Ignora incidentes sem `dimension_value` (ex.: dimensão global).
 *
 * @param {Array<{ dimensionType: string; dimensionValue: string | null; severity: string }>} rows - Incidentes resolvidos.
 * @param {number} limit - Máximo de dimensões devolvidas (desc. por contagem).
 * @returns {AffectedDimensionInterface[]} Dimensões afetadas ordenadas por contagem.
 */
function topAffectedDimensions(
  rows: Array<{
    dimensionType: string;
    dimensionValue: string | null;
    severity: string
  }>,
  limit = 12,
): AffectedDimensionInterface[] {
  const byKey = new Map<string, AffectedDimensionInterface>();

  for (const row of rows) {
    const value = row.dimensionValue;

    if (!value) {
      continue;
    }

    const key = `${row.dimensionType} ${value}`;
    const existing = byKey.get(key);

    if (existing) {
      existing.count += 1;

      if ((SEVERITY_RANK[row.severity] ?? 0) > (SEVERITY_RANK[existing.severity] ?? 0)) {
        existing.severity = row.severity as IncidentSeverityType;
      }
    } else {
      byKey.set(
        key,
        {
          dimension: row.dimensionType as DimensionType,
          value,
          count: 1,
          severity: row.severity as IncidentSeverityType,
        },
      );
    }
  }

  return [...byKey.values()]
    .sort((
      left,
      right,
    ) => right.count - left.count)
    .slice(
      0,
      limit,
    );
}

/**
 * Tool `generate_delivery_report` (§C.4): relatório agregado de entregabilidade.
 *
 * Agrega via {@link AuditQueryServiceInterface} (S3 fonte de verdade, DuckDB + cache `/tmp`):
 * totais por status, quebra por provedor (com taxa), 24 buckets de taxa por hora-do-dia (UTC) e
 * top-5 erros. O relatório de incidentes (`generate_incident_report`) segue lendo o MySQL (dado
 * da aplicação).
 *
 * @remarks O `csv_url` aponta para `GET /reports/delivery/export` (mesma janela/filtros): baixa as
 *   mensagens do recorte (row-level, telefone em claro), auditado como `export_report` (`pii`).
 *
 * @see AuditQueryServiceInterface - agregação de entregabilidade sobre o S3.
 * @see PrismaService - incidentes (dado da aplicação).
 */
@Injectable()
export class ReportsService {
  /**
   * @param {AuditQueryServiceInterface} audit - Motor de consulta de auditoria (entregabilidade).
   * @param {PrismaService} prisma - Acesso aos incidentes (relatório de incidentes).
   */
  constructor(
    @Inject(AUDIT_QUERY) private readonly audit: AuditQueryServiceInterface,
    private readonly prisma: PrismaService,
    @Optional() private readonly config?: ConfigService,
  ) {}

  /**
   * Gera o relatório de entregabilidade para a janela/filtros informados.
   *
   * @param {DeliveryReportDto} dto - Janela (`date_range`), agrupamento e filtros opcionais.
   * @param {AuditProgressCallback} [onProgress] - Callback de andamento da varredura (etapas do motor).
   * @param {AbortSignal} [signal] - Cancela a varredura no S3 se abortado (ex.: cliente desconectou do stream).
   * @returns {Promise<DeliveryReportInterface>} Relatório agregado (totais, por provider, hourly, top_errors, csv_url).
   */
  async generateDelivery(
    dto: DeliveryReportDto,
    onProgress?: AuditProgressCallback,
    signal?: AbortSignal,
  ): Promise<DeliveryReportInterface> {
    const {
      window,
      label,
    } = this.effectiveWindow(dto);

    const aggregate = await this.audit.deliveryReport(
      {
        window,
        customerId: dto.filters?.customer_id,
        provider: dto.filters?.provider,
        status: dto.filters?.status as ShippingStatusType | undefined,
      },
      onProgress,
      signal,
    );

    const filters = echoedFilters(dto.filters);

    return {
      window: label,
      ...(filters
        ? { filters }
        : {}),
      totals: aggregate.totals,
      by_provider: aggregate.byProvider,
      hourly: aggregate.hourly,
      top_errors: aggregate.topErrors,
      csv_url: deliveryExportUrl(dto),
    };
  }

  /**
   * Gera o CSV das mensagens (row-level, telefone **EM CLARO**) do recorte do relatório de
   * entregabilidade — base do download do relatório (`GET /reports/delivery/export`, auditado como
   * `export_report` · `pii`). Mesma resolução de janela/guarda do {@link generateDelivery}.
   *
   * @param {DeliveryExportDto} dto - Janela + filtros (flat, da query string).
   * @returns {Promise<string>} Caminho do CSV gerado (o controller envia com BOM e remove ao fim).
   */
  async exportDelivery(dto: DeliveryExportDto): Promise<string> {
    const { window } = this.effectiveWindow(dto);

    return this.audit.exportSearchCsv({
      window,
      customerId: dto.customer_id,
      provider: dto.provider,
      status: dto.status as ShippingStatusType | undefined,
    });
  }

  /**
   * Resolve a janela efetiva do relatório (preset/explícita) e aplica a guarda de data mínima:
   * data nomeada pelo usuário é rejeitada se cair antes do contrato; preset rolante é recortado.
   *
   * @param {{ date_from?: string; date_to?: string; date_range?: string }} dto - Janela pedida.
   * @returns {{ window: AuditWindowInterface; label: string }} Janela efetiva + rótulo legível.
   */
  private effectiveWindow(dto: {
    date_from?: string;
    date_to?: string;
    date_range?: string
  }): {
    window: AuditWindowInterface;
    label: string
  } {
    const timeZone = this.config?.get<string>('app.timezone') ?? appTimeZone();

    const resolved = resolveReportWindow(
      dto,
      timeZone,
      new Date(),
    );

    const minQueryDate = this.config?.get<string | null>('auditQuery.minQueryDate') ?? null;

    let window = resolved.window;
    let label = resolved.label;

    if (resolved.explicit) {
      // Data nomeada pelo usuário: rejeita se cair antes do contrato confiável.
      assertQueryWithinMinDate(
        window,
        minQueryDate,
      );
    } else {
      // Preset rolante (24h/7d/…): recorta para a porção confiável em vez de rejeitar.
      const clamp = clampWindowToMinDate(
        window,
        minQueryDate,
      );

      window = clamp.window ?? window;

      if (
        clamp.clamped
        && minQueryDate
      ) {
        label = `${label} (a partir de ${formatInstantInTz(
          minQueryDate,
          timeZone,
        )})`;
      }
    }

    return {
      window,
      label,
    };
  }

  /**
   * Gera o relatório de incidentes resolvidos (§C.6) na janela/filtros informados.
   *
   * @param {IncidentReportDto} dto - Janela (`date_range`) e filtros opcionais (severidade/dimensão).
   *
   * @returns {Promise<IncidentReportInterface>} Total, contagem por severidade e a lista resolvida.
   */
  async generateIncident(dto: IncidentReportDto): Promise<IncidentReportInterface> {
    const preset = WINDOW_PRESETS[dto.date_range ?? '24h'] ?? WINDOW_PRESETS['24h'];

    const where: Prisma.IncidentWhereInput = {
      status: {
        in: [
          'resolved',
          'auto_resolved',
        ] as never,
      },
    };

    if (preset.ms !== null) {
      where.resolvedAt = { gte: new Date(Date.now() - preset.ms) };
    }

    if (dto.filters?.severity) {
      where.severity = dto.filters.severity;
    }

    if (dto.filters?.dimension) {
      where.dimensionType = dto.filters.dimension;
    }

    const rows = await this.prisma.incident.findMany({
      where,
      include: { rule: true },
      orderBy: { resolvedAt: 'desc' },
    });

    const resolved = rows.map((row) => this.toResolvedIncident(row));

    // MTTA (detecção→acknowledge) e MTTR (detecção→resolução), em segundos, sobre as amostras que têm o marco.
    const ackSeconds: number[] = [];
    const resolveSeconds: number[] = [];

    for (const row of rows) {
      if (row.acknowledgedAt) {
        ackSeconds.push((row.acknowledgedAt.getTime() - row.detectedAt.getTime()) / 1000);
      }

      if (row.resolvedAt) {
        resolveSeconds.push((row.resolvedAt.getTime() - row.detectedAt.getTime()) / 1000);
      }
    }

    // Variação vs o período anterior de mesmo tamanho (só faz sentido em janela rolante).
    let deltaVsPrevious: number | null = null;

    if (preset.ms !== null) {
      const previousTotal = await this.prisma.incident.count({
        where: {
          ...where,
          resolvedAt: {
            gte: new Date(Date.now() - 2 * preset.ms),
            lt: new Date(Date.now() - preset.ms),
          },
        },
      });

      deltaVsPrevious = resolved.length - previousTotal;
    }

    return {
      window: preset.label,
      total: resolved.length,
      by_severity: {
        critical: resolved.filter((incident) => incident.severity === 'critical').length,
        warning: resolved.filter((incident) => incident.severity === 'warning').length,
        info: resolved.filter((incident) => incident.severity === 'info').length,
      },
      mtta_seconds: avgSecondsOrNull(ackSeconds),
      mttr_seconds: avgSecondsOrNull(resolveSeconds),
      delta_vs_previous: deltaVsPrevious,
      affected_dimensions: topAffectedDimensions(rows),
      resolved,
    };
  }

  /**
   * Normaliza um incidente resolvido para o shape de borda (§C.6).
   *
   * @param {Incident & { rule: AnomalyRule }} incident - Incidente resolvido (com a regra).
   *
   * @returns {ResolvedIncidentInterface} Incidente resolvido em snake_case.
   */
  private toResolvedIncident(incident: Incident & { rule: AnomalyRule }): ResolvedIncidentInterface {
    const payload = (incident.detectionPayload ?? {}) as { rule?: string };

    return {
      id: incident.id,
      severity: incident.severity,
      rule: payload.rule ?? incident.rule.name,
      resolved_at: (incident.resolvedAt ?? incident.detectedAt).toISOString(),
      action: incident.actionCategory ?? 'monitoring_only',
      analyst: incident.resolvedBy ?? null,
      duration: formatDuration(
        incident.detectedAt,
        incident.resolvedAt,
      ),
      escalated_to: incident.escalatedTo ?? null,
      shadow: incident.shadow,
    };
  }
}
