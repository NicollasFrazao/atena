import { BadRequestException, Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  ShippingStatusType,
  ShippingTrailInterface,
  PaginatedEnvelopeInterface,
  SearchResultRowInterface,
} from '@atena/types';
import { clampWindowToMinDate } from '../audit-query/audit-guards';
import { AUDIT_QUERY, type AuditQueryServiceInterface } from '../audit-query/audit-query.interface';
import type {
  AuditProgressCallback,
  AuditWindowInterface,
  DeliveryRecordInterface,
} from '../audit-query/audit-query.types';
import { resolveWindow } from '../audit-query/window';
import { maskPhone } from '../common/pii.util';
import { SearchShippingsDto } from './dto/search-shippings.dto';

/**
 * Tamanho PADRÃO de página da busca (`search_shippings`). Fixo, para a quantidade não variar entre
 * buscas — o chat NÃO controla mais a paginação (o card mostra a 1ª página e o export traz TODAS as
 * linhas); o `limit` da DTO segue para consumidores REST diretos.
 */
const DEFAULT_SEARCH_LIMIT = 50;

/**
 * Tools de envios (Fase 1): `search_shippings` e `get_shipping_trail`.
 *
 * Lê o dado de entrega do {@link AuditQueryServiceInterface} (S3 fonte de verdade, via DuckDB +
 * cache `/tmp`) — não mais do MySQL. Invariantes de borda:
 * - Saída sempre em **snake_case** (code-style do contrato da API).
 * - **PII mascarada** por padrão: o telefone sai como `phone_masked` (via {@link maskPhone}).
 * - Conteúdo do envio é OMITIDO; só é exposto via endpoint de reveal auditado.
 *
 * @see AuditQueryServiceInterface - motor de consulta sobre o S3.
 * @see maskPhone - mascaramento de PII (telefone).
 */
@Injectable()
export class ShippingsService {
  /**
   * @param {AuditQueryServiceInterface} audit - Motor de consulta de auditoria (S3 via DuckDB).
   */
  constructor(
    @Inject(AUDIT_QUERY) private readonly audit: AuditQueryServiceInterface,
    @Optional() private readonly config?: ConfigService,
  ) {}

  /** Data mínima de consulta confiável (config); `null` = guarda desligada. */
  private minQueryDate(): string | null {
    return this.config?.get<string | null>('auditQuery.minQueryDate') ?? null;
  }

  /**
   * Guarda: busca/export por `campaign_id` (lookup pontual) sem janela varreria ~30 dias no S3 — cara
   * demais. Lança erro acionável (o orquestrador repassa ao LLM, que pede a janela ao usuário).
   *
   * @param {string | undefined} campaignId - Filtro por campaign_id, se houver.
   * @param {AuditWindowInterface | null | undefined} window - Janela resolvida (ausente = sem janela).
   * @returns {void}
   * @throws {BadRequestException} Se `campaignId` presente sem janela.
   */
  private requireWindowForCampaign(
    campaignId: string | undefined,
    window: AuditWindowInterface | null | undefined,
  ): void {
    if (
      campaignId
      && !window
    ) {
      throw new BadRequestException({
        error: {
          code: 'window_required',
          message: 'A busca NÃO foi executada (isto NÃO é "nenhum envio encontrado"): falta a janela '
            + 'temporal. Para buscar por campaign_id (id da campanha) é obrigatório informar QUANDO '
            + 'foi o envio (a busca sem janela varreria ~30 dias). NÃO diga ao usuário que não há envios. '
            + 'Se este campaign_id veio de uma BUSCA ANTERIOR desta conversa, REUSE a janela '
            + '(date_from/date_to) daquela busca e refaça; senão, PERGUNTE ao usuário a data aproximada '
            + 'do envio (pode ser só o dia) e refaça passando date_from/date_to (ISO 8601) ou date_range.',
        },
      });
    }
  }

  /**
   * Busca paginada de envios (`search_shippings`), com filtros opcionais.
   *
   * Sem `date_range` explícito, o motor aplica a janela default (S3 não permite varrer todo o
   * histórico por consulta). Devolve um envelope paginado já normalizado (snake_case, PII mascarada).
   *
   * @param {SearchShippingsDto} query - Filtros e paginação validados (page default 1, limit default 50).
   * @param {AuditProgressCallback} [onProgress] - Callback de andamento da varredura (etapas do motor).
   * @returns {Promise<PaginatedEnvelopeInterface<SearchResultRowInterface> & { date_from: string | null; date_to: string; breakdown: { delivered: number; failed: number; pending: number } }>}
   *   Envelope paginado + a janela EFETIVA CONGELADA (`date_from`/`date_to`, ISO) + o `breakdown` por
   *   status (entregue/falha/pendente) de TODO o conjunto. O export usa a janela exata (download bate
   *   com o `total`), e o breakdown casa com o CSV baixado.
   */
  async search(
    query: SearchShippingsDto,
    onProgress?: AuditProgressCallback,
  ): Promise<PaginatedEnvelopeInterface<SearchResultRowInterface> & {
    date_from: string | null;
    date_to: string;
    export_token?: string;
    breakdown: {
      delivered: number;
      failed: number;
      blocked: number;
      pending: number
    }
  }> {
    const startedAt = Date.now();
    const page = query.page ?? 1;
    const limit = query.limit ?? DEFAULT_SEARCH_LIMIT;
    const window = resolveWindow(query);

    this.requireWindowForCampaign(
      query.campaign_id,
      window,
    );

    // Recorta a janela (inclusive datas explícitas) à data mínima confiável quando há SOBREPOSIÇÃO: o
    // usuário recebe a porção confiável (>= minQueryDate) e a busca segue. Se a janela inteira for
    // anterior ao piso (ex.: "dia 03/05" com piso em 18/06), REJEITA com min_query_date — antes
    // recortava só o início e devolvia uma janela invertida (0 resultados mudos, "18/06 → 04/05").
    const effectiveWindow = clampWindowToMinDate(
      window,
      this.minQueryDate(),
    ).window;

    const result = await this.audit.search(
      {
        window: effectiveWindow,
        phone: query.phone,
        status: query.status as ShippingStatusType | undefined,
        provider: query.provider,
        channel: query.channel,
        errorHint: query.error_hint,
        customerId: query.customer_id,
        correlationId: query.campaign_id,
      },
      page,
      limit,
      onProgress,
    );

    // Congela a janela EFETIVA usada pelo motor para o export: `to` aberto (preset "até agora") é
    // fixado no instante da busca, senão o download reabriria o preset num momento posterior e a
    // contagem deslizaria. `from` ausente (ex.: "todo o período") fica null.
    const used = result.window ?? effectiveWindow;

    const exportFrom = used?.from
      ? used.from.toISOString()
      : null;

    const exportTo = used?.to
      ? used.to.toISOString()
      : new Date(startedAt).toISOString();

    return {
      rows: result.rows.map((record) => this.toRow(record)),
      page,
      total: result.total,
      total_pages: Math.max(
        1,
        Math.ceil(result.total / limit),
      ),
      latency_ms: Date.now() - startedAt,
      date_from: exportFrom,
      date_to: exportTo,
      // Token do snapshot do conjunto exato — o export por token baixa byte-exato (sem re-scan).
      export_token: result.snapshotToken,
      breakdown: result.breakdown ?? {
        delivered: 0,
        failed: 0,
        blocked: 0,
        pending: 0,
      },
    };
  }

  /**
   * Trilha completa de um envio (`get_shipping_trail`): cabeçalho + linha do tempo de eventos.
   *
   * O `phone` sai mascarado (`phone_masked`) e o `content_preview` é OMITIDO por padrão (PII) —
   * só é revelado via endpoint de reveal auditado.
   *
   * @param {string} shippingId - Identificador do envio.
   * @param {AuditWindowInterface} [window] - Janela da varredura (idealmente a mesma do `search_shippings`
   *   que produziu o `id`, para cair no cache `/tmp` quente). É recortada à data mínima confiável
   *   (mesma política do `search`): nunca rejeita por data antiga, só clampa o início.
   * @param {AuditProgressCallback} [onProgress] - Callback de andamento da varredura (etapas do motor).
   * @returns {Promise<ShippingTrailInterface | null>} A trilha do envio, ou `null` se não existir.
   */
  async getTrail(
    shippingId: string,
    window?: AuditWindowInterface,
    onProgress?: AuditProgressCallback,
  ): Promise<ShippingTrailInterface | null> {
    // Mesma política do search: recorta a janela à data mínima confiável quando há sobreposição
    // (abrir a trilha após um search não quebra); só rejeita se a janela inteira for anterior ao piso.
    const effectiveWindow = clampWindowToMinDate(
      window,
      this.minQueryDate(),
    ).window;

    const trail = await this.audit.getTrail(
      shippingId,
      effectiveWindow,
      onProgress,
    );

    if (!trail) {
      return null;
    }

    return {
      shipping_id: trail.record.id,
      campaign_id: trail.record.correlationId,
      customer: trail.record.customerId,
      provider: trail.record.provider ?? '',
      phone_masked: maskPhone(trail.record.phoneE164),
      channel: trail.record.channel,
      app_id: trail.record.appId,
      final_status: trail.record.finalStatus,
      content_ref: trail.record.contentRef ?? '',
      content_available: Boolean(trail.record.content) || Boolean(trail.record.contentRef),
      // content_preview OMITIDO por padrão (PII) — revelado só via endpoint de reveal auditado.
      events: trail.events.map((event) => ({
        type: event.type,
        label: event.label,
        at: event.at.toISOString(),
        detail: event.detail,
      })),
    };
  }

  /**
   * Busca registros por uma lista de ids (na janela dada) — usado pelo detalhe do incidente para
   * trazer EXATAMENTE os envios que o detector marcou como impactados. Saída normalizada
   * (snake_case, telefone mascarado).
   *
   * @param {string[]} ids - Ids dos destinatários (impactados).
   * @param {AuditWindowInterface} window - Janela da detecção (escopa as partições).
   * @returns {Promise<SearchResultRowInterface[]>} Linhas dos envios impactados.
   */
  async byIds(
    ids: string[],
    window: AuditWindowInterface,
  ): Promise<SearchResultRowInterface[]> {
    const records = await this.audit.searchByIds(
      ids,
      window,
    );

    return records.map((record) => this.toRow(record));
  }

  /**
   * Gera o CSV COMPLETO (todas as linhas do filtro, sem paginação) dos envios, com o telefone
   * **EM CLARO**, e devolve o caminho do arquivo — base do export auditado (`GET /shippings/export`).
   * Mesma resolução de janela/guarda do {@link search} (clamp à data mínima; janela obrigatória p/
   * campaign_id). O telefone sai em claro porque o endpoint é auditado (severidade `pii`).
   *
   * Com `token` (snapshot da busca), baixa o conjunto EXATO daquela busca (byte-exato com o total
   * exibido, sem re-escanear o S3). Se o snapshot expirou/é inválido, cai no export por filtro
   * (janela congelada) — ainda preciso a menos do lag de ingestão.
   *
   * @param {SearchShippingsDto} query - Filtros (os mesmos do search; paginação ignorada).
   * @param {string} [token] - Token do snapshot da busca (`export_token`); precede o filtro.
   * @returns {Promise<string>} Caminho do CSV gerado (o controller envia com BOM e remove ao fim).
   */
  async exportCsvFile(
    query: SearchShippingsDto,
    token?: string,
  ): Promise<string> {
    // Snapshot da busca: caminho exato e instantâneo (lê o Parquet local). Se sumiu (TTL), cai no filtro.
    if (token) {
      const snapshot = await this.audit.exportSnapshotCsv(token);

      if (snapshot) {
        return snapshot;
      }
    }

    const window = resolveWindow(query);

    this.requireWindowForCampaign(
      query.campaign_id,
      window,
    );

    const effectiveWindow = clampWindowToMinDate(
      window,
      this.minQueryDate(),
    ).window;

    return this.audit.exportSearchCsv({
      window: effectiveWindow,
      phone: query.phone,
      status: query.status as ShippingStatusType | undefined,
      provider: query.provider,
      channel: query.channel,
      errorHint: query.error_hint,
      customerId: query.customer_id,
      correlationId: query.campaign_id,
    });
  }

  /**
   * Gera o CSV (telefone **EM CLARO**) de EXATAMENTE os ids impactados de um incidente, na janela de
   * detecção, e devolve o caminho — base do download auditado do detalhe (`GET /incidents/:id/
   * shippings/export`). Espelha {@link byIds}, mas em CSV via stream em vez de linhas mascaradas.
   *
   * @param {string[]} ids - Ids dos destinatários impactados (persistidos pelo detector).
   * @param {AuditWindowInterface} window - Janela da detecção (escopa as partições).
   * @returns {Promise<string>} Caminho do CSV gerado (o controller envia com BOM e remove ao fim).
   */
  async exportByIdsCsvFile(
    ids: string[],
    window: AuditWindowInterface,
  ): Promise<string> {
    return this.audit.exportByIdsCsv(
      ids,
      window,
    );
  }

  /**
   * Normaliza um registro de entrega (do motor) em uma linha de busca (snake_case + PII mascarada).
   *
   * @param {DeliveryRecordInterface} record - Registro de entrega do {@link AuditQueryServiceInterface}.
   * @returns {SearchResultRowInterface} Linha com `phone_masked`, `status`, `provider`, `customer`,
   *   `requested_at` (envio, ISO 8601), `finalized_at` (finalização ou `null`) e `error_hint`.
   */
  private toRow(record: DeliveryRecordInterface): SearchResultRowInterface {
    return {
      id: record.id,
      campaign_id: record.correlationId,
      phone_masked: maskPhone(record.phoneE164),
      status: record.finalStatus,
      provider: record.provider ?? '',
      customer: record.customerId,
      channel: record.channel,
      app_id: record.appId,
      requested_at: record.requestedAt.toISOString(),
      finalized_at: record.finalizedAt?.toISOString() ?? null,
      error_hint: record.errorHint,
    };
  }
}
