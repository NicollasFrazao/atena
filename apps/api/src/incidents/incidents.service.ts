import { Injectable, NotFoundException } from '@nestjs/common';
import type { Incident, Prisma } from '@prisma/client';
import type {
  IncidentActivityInterface,
  IncidentInterface,
  IncidentShippingsInterface,
  PaginatedEnvelopeInterface,
  SearchResultRowInterface,
} from '@atena/types';
import { ShippingsService } from '../shippings/shippings.service';
import { PrismaService } from '../prisma/prisma.service';
import { ListIncidentsDto } from './dto/list-incidents.dto';
import { normalizeDimensions, normalizeSeverities, normalizeStatuses } from './incident-filters';

/** Amostra default das mensagens relacionadas (resumo do detalhe: total + top de campanhas). */
const RELATED_SAMPLE_LIMIT = 200;

/** Teto da amostra (download CSV sob demanda); alinhado ao cap de export da auditoria. */
const RELATED_MAX_LIMIT = 5000;

/** Quantos códigos de envio (campaign_id) exibir no resumo do detalhe (top por ocorrência). */
const TOP_CAMPAIGNS = 5;

/** Default page size of the incident list (`limit` absent). */
const DEFAULT_INCIDENTS_LIMIT = 20;

/** Message of the 404 when the incident does not exist. */
const INCIDENT_NOT_FOUND = 'Incidente não encontrado';

/**
 * Window of the impacted shippings of an incident: its detection window (NOT NULL in the schema,
 * always written by the detector).
 *
 * @param incident - The incident row.
 *
 * @returns The window to read the impacted shippings from.
 */
function impactWindow(incident: Incident): {
  from: Date;
  to: Date
} {
  return {
    from: incident.detectionWindowStart,
    to: incident.detectionWindowEnd,
  };
}

/**
 * Agrupa as linhas por `campaign_id` e devolve os códigos com mais ocorrências (top {@link TOP_CAMPAIGNS}),
 * em ordem decrescente. Linhas sem `campaign_id` são ignoradas. Hoje o grão é 1 registro por campanha
 * (ver follow-up de modelo de dado), então as contagens tendem a 1 — passam a refletir destinatários
 * quando o grão virar `campaign_id + phone`.
 *
 * @param rows - Amostra de mensagens impactadas.
 *
 * @returns Top códigos de envio por ocorrência.
 */
function topCampaigns(rows: SearchResultRowInterface[]): {
  campaign_id: string;
  count: number
}[] {
  const counts = new Map<string, number>();

  for (const row of rows) {
    if (row.campaign_id) {
      counts.set(
        row.campaign_id,
        (counts.get(row.campaign_id) ?? 0) + 1,
      );
    }
  }

  return [...counts.entries()]
    .map(([
      id,
      count,
    ]) => ({
      campaign_id: id,
      count,
    }))
    .sort((
      first,
      second,
    ) => second.count - first.count)
    .slice(
      0,
      TOP_CAMPAIGNS,
    );
}

/**
 * Display de um incidente, guardado em `Incident.detectionPayload` (Json) pelo
 * detector — o que não cabe nas colunas estruturadas.
 */
interface DetectionPayloadInterface {
  /** Nome legível da regra/anomalia. */
  rule?: string;
  /** Janela temporal (rótulo legível). */
  window?: string;
  /** Resumo legível do incidente. */
  summary?: string;
  /** Métricas de suporte. */
  metrics?: {
    baseline: string;
    current: string;
    threshold: string;
    sample: string
  };
  /** Quantidade de envios relacionados. */
  relatedShippings?: number;
  /** Ids EXATOS dos envios impactados (persistidos pelo detector). */
  relatedShippingIds?: string[];
}

/** Métricas vazias quando o payload não as traz. */
const EMPTY_METRICS = {
  baseline: '',
  current: '',
  threshold: '',
  sample: '',
};

/**
 * Tools de incidentes (Fase 2): `list_incidents` e `get_incident` (read-only).
 *
 * Lê o hot store e normaliza para a borda (snake_case). O incidente agrega por
 * dimensão (provider/customer/...) — **não** carrega PII (telefone/conteúdo).
 *
 * @see PrismaService - acesso aos incidentes e atividades.
 */
@Injectable()
export class IncidentsService {
  /**
   * @param prisma - Cliente Prisma para incidentes/atividades.
   * @param shippingsService - Busca de envios (S3) p/ a amostra de envios relacionados.
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly shippingsService: ShippingsService,
  ) {}

  /**
   * Lista incidentes paginados, com filtros opcionais (`list_incidents`, §C.5).
   *
   * @param query - Filtros (status/severity/dimension, CSV) e paginação.
   *
   * @returns Envelope paginado de incidentes.
   */
  async list(query: ListIncidentsDto): Promise<PaginatedEnvelopeInterface<IncidentInterface>> {
    const startedAt = Date.now();
    const page = query.page ?? 1;
    const limit = query.limit ?? DEFAULT_INCIDENTS_LIMIT;

    const where: Prisma.IncidentWhereInput = {};

    // Normaliza os filtros (CSV) para valores válidos do enum antes do Prisma: "open" vira
    // detected+acknowledged e valores inválidos são descartados — sem isso um status fora do enum
    // (ex.: "open") estourava com 500. Filtro presente que normaliza p/ vazio ⇒ não casa nada.
    if (query.status) {
      where.status = { in: normalizeStatuses(query.status) };
    }

    if (query.severity) {
      where.severity = { in: normalizeSeverities(query.severity) };
    }

    if (query.dimension) {
      where.dimensionType = { in: normalizeDimensions(query.dimension) };
    }

    // Shadow mode: incidentes silenciosos ficam FORA da lista ativa por padrão (não são acionáveis).
    // `?shadow=true` inverte para revisá-los na calibração.
    where.shadow = query.shadow === 'true';

    const [
      total,
      rows,
    ] = await Promise.all([
      this.prisma.incident.count({ where }),
      this.prisma.incident.findMany({
        where,
        orderBy: { detectedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      rows: rows.map((row) => this.toIncident(row)),
      page,
      total,
      total_pages: Math.max(
        1,
        Math.ceil(total / limit),
      ),
      latency_ms: Date.now() - startedAt,
    };
  }

  /**
   * Retorna um incidente e suas atividades (`get_incident`).
   *
   * @param id - Id do incidente.
   *
   * @returns Incidente + atividades (ordem cronológica).
   *
   * @throws {NotFoundException} Se o incidente não existir.
   */
  async get(id: string): Promise<IncidentInterface & { activities: IncidentActivityInterface[] }> {
    const incident = await this.prisma.incident.findUnique({
      where: { id },
      include: { activities: { orderBy: { occurredAt: 'asc' } } },
    });

    if (!incident) {
      throw new NotFoundException({
        error: {
          code: 'not_found',
          message: INCIDENT_NOT_FOUND,
        },
      });
    }

    return {
      ...this.toIncident(incident),
      activities: incident.activities.map((activity) => ({
        id: activity.id,
        user_id: activity.userId ?? undefined,
        type: activity.activityType as IncidentActivityInterface['type'],
        at: activity.occurredAt.toISOString(),
        payload: (activity.payload ?? {}) as Record<string, unknown>,
      })),
    };
  }

  /**
   * Amostra REAL de envios relacionados ao incidente (`GET /incidents/:id/shippings`).
   *
   * Roda um `search_shippings` escopado pela dimensão do incidente (provider/customer) na janela de
   * detecção (ou ~24h antes do `detected_at`, quando o incidente não tem janela precisa — ex.: seed).
   * Para dimensões sem filtro de busca direto (`global`/`route`), devolve `available: false` e a UI
   * cai no modo contagem (`related_shippings`). A janela é recortada à data mínima confiável pelo
   * próprio `ShippingsService` (mesma política do search), então incidentes antigos só não trazem dado.
   *
   * @param id - Id do incidente.
   * @param [limit] - Tamanho da amostra (default {@link RELATED_SAMPLE_LIMIT}; teto
   *   {@link RELATED_MAX_LIMIT}). O download CSV pede um limite maior sob demanda.
   *
   * @returns Amostra (rows + total) ou `available: false`.
   *
   * @throws {NotFoundException} Se o incidente não existir.
   */
  async shippings(
    id: string,
    limit = RELATED_SAMPLE_LIMIT,
  ): Promise<IncidentShippingsInterface> {
    const sampleSize = Math.min(
      Math.max(
        1,
        Number.isFinite(limit)
          ? limit
          : RELATED_SAMPLE_LIMIT,
      ),
      RELATED_MAX_LIMIT,
    );

    const incident = await this.prisma.incident.findUnique({ where: { id } });

    if (!incident) {
      throw new NotFoundException({
        error: {
          code: 'not_found',
          message: INCIDENT_NOT_FOUND,
        },
      });
    }

    const payload = (incident.detectionPayload ?? {}) as DetectionPayloadInterface;
    const impactedIds = payload.relatedShippingIds ?? [];

    // SEM fallback: usa só os IDs EXATOS que o detector marcou como impactados. Incidentes sem ids
    // (anteriores ao recurso) → modo contagem: a UI cai no `related_shippings`.
    if (impactedIds.length === 0) {
      return {
        available: false,
        rows: [],
        total: 0,
        top_campaigns: [],
      };
    }

    const rows = await this.shippingsService.byIds(
      impactedIds.slice(
        0,
        sampleSize,
      ),
      impactWindow(incident),
    );

    return {
      available: true,
      rows,
      total: impactedIds.length,
      top_campaigns: topCampaigns(rows),
    };
  }

  /**
   * Gera o CSV (telefone **EM CLARO**) dos envios impactados de um incidente — EXATAMENTE os ids
   * persistidos pelo detector, na janela de detecção — e devolve o caminho do arquivo. Base do
   * download auditado do detalhe (`GET /incidents/:id/shippings/export`). Sem ids → CSV só com header.
   *
   * @param id - Id do incidente.
   *
   * @returns Caminho do CSV gerado (o controller envia com BOM e remove ao fim).
   *
   * @throws {NotFoundException} Se o incidente não existir.
   */
  async exportShippingsCsv(id: string): Promise<string> {
    const incident = await this.prisma.incident.findUnique({ where: { id } });

    if (!incident) {
      throw new NotFoundException({
        error: {
          code: 'not_found',
          message: INCIDENT_NOT_FOUND,
        },
      });
    }

    const payload = (incident.detectionPayload ?? {}) as DetectionPayloadInterface;
    const impactedIds = payload.relatedShippingIds ?? [];

    return this.shippingsService.exportByIdsCsvFile(
      impactedIds.slice(
        0,
        RELATED_MAX_LIMIT,
      ),
      impactWindow(incident),
    );
  }

  /**
   * Normaliza um `Incident` do Prisma para o shape de borda (§C.5), combinando
   * colunas estruturadas com o `detectionPayload` (Json) e derivando `assignee`.
   *
   * @param record - Registro de incidente do Prisma.
   *
   * @returns Incidente em snake_case (sem PII).
   */
  private toIncident(record: Incident): IncidentInterface {
    const payload = (record.detectionPayload ?? {}) as DetectionPayloadInterface;

    return {
      id: record.id,
      rule: payload.rule ?? '',
      severity: record.severity,
      status: record.status,
      dimension_type: record.dimensionType,
      dimension_value: record.dimensionValue ?? '',
      detected_at: record.detectedAt.toISOString(),
      window: payload.window ?? '',
      // Janela em UTC absoluto (com `Z`) das colunas estruturadas — o consumidor (LLM) passa direto
      // como date_from/date_to do relatório, sem reconverter fuso (evita o shift do rótulo legível).
      window_from: record.detectionWindowStart.toISOString(),
      window_to: record.detectionWindowEnd.toISOString(),
      summary: payload.summary ?? '',
      metrics: payload.metrics ?? EMPTY_METRICS,
      related_shippings: payload.relatedShippings ?? 0,
      assignee: record.acknowledgedBy ?? record.resolvedBy ?? null,
      shadow: record.shadow,
    };
  }
}
