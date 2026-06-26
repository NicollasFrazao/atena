import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import {
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import type { AuditScanStatsInterface, ShippingStatusType } from '@atena/types';
import { MetricsService } from '../observability/metrics.service';
import { PrismaService } from '../prisma/prisma.service';
import { normalizePhone } from '../common/pii.util';
import { statusDisplayLabel } from '../common/status-labels';
import type { ShippingSampleInterface } from '../detector/detection.types';
import type { AuditQueryServiceInterface } from './audit-query.interface';
import type {
  AuditProgressCallback,
  AuditSearchFilterInterface,
  AuditWindowInterface,
  DeliveryPageInterface,
  DeliveryRecordInterface,
  DeliveryReportAggregateInterface,
  DeliveryTrailEventInterface,
  DeliveryTrailInterface,
} from './audit-query.types';
import {
  EMPTY_EV_DDL,
  evCopyToParquetSql,
  evDdlFromSources,
  globSql,
  partitionDescriptors,
  recordsDdl,
  RECORDS_TABLE,
  trailEventsSql,
} from './audit-query.sql';
import { cleanOrphanCacheVersions, evictCacheDir } from './cache-eviction';
import { RecordCache } from './record-cache';

/** Valor aceito no bind posicional (`$1..`) do DuckDB nesta camada. */
type BindValue = string | number;

/** Milissegundos em um dia (janela default de `search`/`getShipping`/`getTrail`). */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Mínimo de dígitos do filtro de telefone para casar por SUFIXO (tolera busca sem o DDI). Um número
 * nacional brasileiro tem 10–11 dígitos (DD + 8/9); abaixo disso, casa exato p/ não pegar fragmento.
 */
const PHONE_SUFFIX_MIN_DIGITS = 10;

/**
 * TTL do cache de registros por id (30 min): o reveal de PII/análise lê deste cache (chaveado por id)
 * e devolve na hora — SEM re-materializar a janela no S3. A busca aquece os registros da página
 * (`recordCache.set`), então um reveal posterior reusa esse trabalho. 30 min (não 5) cobre uma sessão
 * de investigação inteira — o operador revela vários telefones ao longo do tempo sem cair no scan frio
 * de ~6 dias (`dayWindow ± lateStatusBuffer`). Seguro p/ o reveal: o telefone é imutável; o teto FIFO
 * ({@link RECORD_CACHE_MAX}) limita a memória independentemente do TTL.
 */
const RECORD_CACHE_TTL_MS = 30 * 60 * 1000;

/** Teto do cache de registros por id (FIFO ao exceder) — limita o uso de memória. */
const RECORD_CACHE_MAX = 10_000;

/** Versão do cache de eventos no `/tmp`; bump invalida os Parquets antigos se a normalização mudar. */
const EV_CACHE_VERSION = 'v9';

/** Período da eviction agendada do cache de eventos (1h) — varre idade + teto de tamanho. */
const EVICT_INTERVAL_MS = 60 * 60 * 1000;

/** Retenção dos eventos de scan persistidos (30 dias): além da janela exibida; poda no eviction. */
const SCAN_EVENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** Milissegundos em uma hora (converte os limites de idade da config). */
const HOUR_MS = 60 * 60 * 1000;

/** Bytes em um megabyte (converte o teto de tamanho da config). */
const MB_BYTES = 1024 * 1024;

/** Converte um valor de timestamp do DuckDB (Date | string | {micros}) em `Date`, ou `null`. */
function toDate(value: unknown): Date | null {
  if (
    value === null
    || value === undefined
  ) {
    return null;
  }

  if (value instanceof Date) {
    return value;
  }

  if (typeof value === 'string') {
    return new Date(value);
  }

  const micros = (value as { micros?: bigint }).micros;

  if (typeof micros === 'bigint') {
    return new Date(Number(micros / 1000n));
  }

  return null;
}

/** Converte um valor numérico do DuckDB (number | bigint) em `number`. */
function toNumber(value: unknown): number {
  return typeof value === 'bigint'
    ? Number(value)
    : Number(value ?? 0);
}

/** String ou `null` a partir de um valor do DuckDB. */
function toText(value: unknown): string | null {
  return value === null || value === undefined
    ? null
    : String(value);
}

/**
 * Janela de SCAN com buffer SIMÉTRICO (±`bufferMs`) em torno de `window`, capando o fim em `now`:
 * - PRA FRENTE capta status atrasados do fornecedor (o desfecho chega até ~`bufferMs` após o envio);
 * - PRA TRÁS capta o `queued` de envios cujo DESFECHO caiu na janela mas o envio foi ANTES de `from`
 *   — sem o recuo, `requested_at` (= min(processed_at) sobre o varrido) COLAPSA pro desfecho e o envio
 *   aparece na janela ERRADA. O filtro por `requested_at` (janela ORIGINAL) descarta o que não pertence.
 *
 * @param {AuditWindowInterface} window - Janela base (do usuário ou default).
 * @param {number} bufferMs - Buffer (ms) aplicado nas duas pontas.
 * @param {Date} now - Teto do fim (partições futuras não existem → evita globs vazios e lentos).
 * @returns {AuditWindowInterface} Janela alargada simetricamente.
 */
function symmetricScanWindow(
  window: AuditWindowInterface,
  bufferMs: number,
  now: Date,
): AuditWindowInterface {
  return {
    from: window.from
      ? new Date(window.from.getTime() - bufferMs)
      : null,
    to: window.to
      ? new Date(Math.min(
        window.to.getTime() + bufferMs,
        now.getTime(),
      ))
      : null,
  };
}

/**
 * Projeção comum dos exports/snapshots: telefone EM CLARO, aliases = header snake_case do contrato.
 * Reusada pelo CSV (export auditado) e pelo Parquet de snapshot da busca (export por token).
 */
const EXPORT_PROJECTION = `id AS shipping_id,
          correlation_id AS campaign_id,
          phone AS phone,
          channel AS channel,
          app_id AS app_id,
          final_status AS status,
          provider AS provider,
          customer AS customer,
          strftime(requested_at, '%Y-%m-%dT%H:%M:%SZ') AS requested_at,
          error_hint AS error_hint`;

/** TTL dos snapshots de busca (1h): cobre o export logo após a busca; depois são evictados. */
const SNAPSHOT_TTL_MS = 60 * 60 * 1000;

/** Aceita só um token UUID (evita path traversal ao montar o caminho do snapshot). */
const SNAPSHOT_TOKEN_RE = /^[0-9a-f-]{36}$/i;

/** Teto de itens do catálogo de clientes (`distinctCustomers`): top-N por volume; o total vem à parte. */
const CATALOG_LIMIT = 50;

/**
 * Implementação do {@link AuditQueryServiceInterface} sobre o S3 (fonte de verdade) via DuckDB.
 *
 * Cada consulta: abre uma conexão, materializa numa TEMP TABLE os registros normalizados da
 * janela (uma varredura), roda a(s) query(ies) locais e fecha a conexão. Lê JSON.gz direto do
 * S3 (httpfs + credential_chain); NUNCA escreve no bucket de origem. PII (telefone) sai como
 * está no registro — o mascaramento/reveal é responsabilidade da borda.
 *
 * @see {@link recordsDdlFromSources} - normalização por destinatário (= `recordsToShippings`) em SQL.
 */
@Injectable()
export class DuckDbAuditQueryService
implements AuditQueryServiceInterface, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DuckDbAuditQueryService.name);

  private readonly sourceRoot: string;

  private readonly region: string;

  private readonly defaultWindowMs: number;

  private readonly cacheDir: string;

  private readonly extensionDir: string;

  /** Diretório de spill do DuckDB: quando o `memory_limit` estoura, derrama em disco em vez de OOM. */
  private readonly spillDir: string;

  /** Teto de memória do DuckDB (ex.: `2GB`). Limita o uso de RAM por consulta na máquina enxuta. */
  private readonly duckdbMemoryLimit: string;

  /** Threads do DuckDB. Limita o uso de CPU por consulta (default conservador p/ recursos enxutos). */
  private readonly duckdbThreads: number;

  /** Diretório dos CSVs de export (transitórios; removidos após o stream pela borda). */
  private readonly exportDir: string;

  /** Diretório dos snapshots de busca (Parquet do conjunto exato; export por token lê daqui). */
  private readonly snapshotDir: string;

  private readonly settleMs: number;

  private readonly lateStatusBufferMs: number;

  private readonly cacheMaxBytes: number;

  private readonly cacheMaxAgeMs: number;

  /** Cache de registros por id (TTL curto): reveal/análise logo após a busca não re-varrem o S3. */
  private readonly recordCache = new RecordCache(
    RECORD_CACHE_TTL_MS,
    RECORD_CACHE_MAX,
  );

  /** Acumulado de custo de leitura do S3 (desde a subida): partições frias/cache/recentes + objetos. */
  private readonly scan = {
    queries: 0,
    partitionsTotal: 0,
    partitionsCached: 0,
    partitionsCold: 0,
    partitionsLive: 0,
    s3Objects: 0,
    s3ReadMs: 0,
  };

  private instance: DuckDBInstance | null = null;

  /**
   * @param {ConfigService} config - Fonte de `auditQuery.sourceRoot`, `aws.region` e janela default.
   * @param {MetricsService} [metrics] - Emissão best-effort de métricas de scan do S3 (DogStatsD).
   * @param {PrismaService} [prisma] - Persistência best-effort dos eventos de scan (janela temporal).
   */
  constructor(
    config: ConfigService,
    @Optional() private readonly metrics?: MetricsService,
    @Optional() private readonly prisma?: PrismaService,
  ) {
    const logsBucket = config.get<string>('s3.logsBucket') ?? '';

    this.sourceRoot = config.get<string>('auditQuery.sourceRoot')
      || (logsBucket
        ? `s3://${logsBucket}`
        : '');

    this.region = config.get<string>('aws.region') ?? 'us-east-1';

    const days = config.get<number>('auditQuery.defaultWindowDays') ?? 30;
    this.defaultWindowMs = days * DAY_MS;

    // eslint-disable-next-line sonarjs/publicly-writable-directories -- /tmp = cache transitório read-through por design (decisão #8); sobrescrevível via ATENA_TMP_CACHE_DIR.
    const tmpDir = config.get<string>('cache.tmpDir') ?? '/tmp/atena-cache';

    this.cacheDir = join(
      tmpDir,
      `audit-ev-${EV_CACHE_VERSION}`,
    );

    // Extensões DuckDB (httpfs/aws) baixadas 1× e persistidas no volume — sem re-download por restart.
    this.extensionDir = join(
      tmpDir,
      'duckdb-ext',
    );

    // Spill em disco quando o `memory_limit` estoura — evita o DuckDB devorar a RAM do host enxuto.
    this.spillDir = join(
      tmpDir,
      'duckdb-spill',
    );

    this.duckdbMemoryLimit = config.get<string>('auditQuery.duckdbMemoryLimit') ?? '2GB';
    this.duckdbThreads = config.get<number>('auditQuery.duckdbThreads') ?? 2;

    this.exportDir = join(
      tmpDir,
      'exports',
    );

    this.snapshotDir = join(
      tmpDir,
      'snapshots',
    );

    const settleMinutes = config.get<number>('auditQuery.cacheSettleMinutes') ?? 60;
    this.settleMs = settleMinutes * 60 * 1000;

    const bufferHours = config.get<number>('auditQuery.lateStatusBufferHours') ?? 48;
    this.lateStatusBufferMs = bufferHours * 60 * 60 * 1000;

    const cacheMaxMb = config.get<number>('auditQuery.cacheMaxMb') ?? 0;

    this.cacheMaxBytes = cacheMaxMb > 0
      ? cacheMaxMb * MB_BYTES
      : 0;

    const cacheMaxAgeHours = config.get<number>('auditQuery.cacheMaxAgeHours') ?? 0;

    this.cacheMaxAgeMs = cacheMaxAgeHours > 0
      ? cacheMaxAgeHours * HOUR_MS
      : 0;
  }

  /**
   * Na subida: limpa dirs de versão de cache órfãos (peso morto de bumps de `EV_CACHE_VERSION`) e
   * roda uma eviction inicial — o cache sobrevive a restarts no volume, então pode vir cheio/velho.
   */
  onModuleInit(): void {
    const orphans = cleanOrphanCacheVersions(this.cacheDir);

    if (orphans.length > 0) {
      this.logger.log(`Cache: removidos ${orphans.length} dir(s) de versão órfãos (${orphans.join(', ')}).`);
    }

    this.evictCache();
  }

  /** Fecha a instância DuckDB ao destruir o módulo. */
  onModuleDestroy(): void {
    this.instance?.closeSync();
    this.instance = null;
  }

  /**
   * Eviction agendada (1h) do cache de eventos: remove Parquets velhos (> `cacheMaxAgeMs`) e, se
   * ainda acima do teto, os mais antigos por mtime (LRU) até caber em `cacheMaxBytes`. No-op quando
   * ambos os limites estão desligados. O cache é rebuildável do S3, então a remoção é segura.
   */
  @Interval(EVICT_INTERVAL_MS)
  evictCache(): void {
    // Snapshots de busca são transitórios (export logo após a busca) — evicta por TTL SEMPRE,
    // independente da config do cache de eventos (que pode estar desligada).
    const snapshots = evictCacheDir(
      this.snapshotDir,
      0,
      SNAPSHOT_TTL_MS,
      Date.now(),
    );

    if (snapshots.removed > 0) {
      this.logger.log(`Snapshots: eviction removeu ${snapshots.removed} (> ${SNAPSHOT_TTL_MS / 60000} min).`);
    }

    // Poda os eventos de scan persistidos além da retenção (best-effort, fire-and-forget).
    this.pruneScanEvents();

    if (
      this.cacheMaxBytes <= 0
      && this.cacheMaxAgeMs <= 0
    ) {
      return;
    }

    const {
      removed,
      freedBytes,
    } = evictCacheDir(
      this.cacheDir,
      this.cacheMaxBytes,
      this.cacheMaxAgeMs,
      Date.now(),
    );

    if (removed > 0) {
      const freedMb = (freedBytes / MB_BYTES).toFixed(1);
      this.logger.log(`Cache: eviction removeu ${removed} Parquet(s), liberou ${freedMb} MB.`);
    }
  }

  /** @inheritdoc */
  async search(
    filter: AuditSearchFilterInterface,
    page: number,
    limit: number,
    onProgress?: AuditProgressCallback,
  ): Promise<DeliveryPageInterface> {
    const window = filter.window ?? this.defaultWindow();

    const resolved: AuditSearchFilterInterface = {
      ...filter,
      window,
    };

    return this.withRecords(
      window,
      async (connection) => {
        const baseParams: BindValue[] = [];

        const conditions = this.filterConditions(
          resolved,
          baseParams,
        );

        const offset = (page - 1) * limit;

        const queryStartedAt = Date.now();

        // Agregado (total + breakdown) sobre TODO o conjunto, SEM bufferizar linhas/PII. Antes, o
        // `count(*) OVER ()`/FILTER no MESMO SELECT das linhas obrigava o operador de window a
        // bufferizar TODAS as linhas com todas as colunas (incl. `message`) → ~150s com spill em disco.
        const aggRows = await this.query(
          connection,
          `SELECT count(*)::INTEGER AS total,
              count(*) FILTER (WHERE final_status = 'delivered')::INTEGER AS delivered_total,
              count(*) FILTER (WHERE final_status = 'failed')::INTEGER AS failed_total,
              count(*) FILTER (WHERE final_status = 'pending')::INTEGER AS pending_total
            FROM ${RECORDS_TABLE}
            WHERE ${conditions}`,
          baseParams,
        );

        // Página: só as N linhas (top-N por `requested_at`) — barato mesmo com o conjunto grande.
        const pageParams: BindValue[] = [...baseParams];
        const limitParam = pageParams.push(limit);
        const offsetParam = pageParams.push(offset);

        const rows = await this.query(
          connection,
          `SELECT id, phone, customer, provider, correlation_id, final_status, requested_at, finalized_at, error_hint, message, channel, app_id
            FROM ${RECORDS_TABLE}
            WHERE ${conditions}
            ORDER BY requested_at DESC
            LIMIT $${limitParam} OFFSET $${offsetParam}`,
          pageParams,
        );

        const queryMs = Date.now() - queryStartedAt;

        const records = rows.map((row) => this.toRecord(row));

        // Aquece o cache por id: um reveal/análise logo após a busca lê daqui (sem re-varrer o S3).
        records.forEach((record) => this.recordCache.set(record));

        const head = aggRows[0] ?? {};

        const total = toNumber(head.total);

        // Snapshot do conjunto EXATO (Parquet) p/ o export byte-exato por token. Conditions/params
        // recriados num array próprio (o `params` da busca já tem limit/offset extras). Só com linhas.
        let snapshotToken: string | undefined;

        const snapshotStartedAt = Date.now();

        if (total > 0) {
          snapshotToken = randomUUID();
          const snapParams: BindValue[] = [];

          const snapConditions = this.filterConditions(
            resolved,
            snapParams,
          );

          await this.writeSearchSnapshot(
            connection,
            snapConditions,
            snapParams,
            snapshotToken,
          );
        }

        this.logger.debug(`search: page query ${queryMs}ms · snapshot ${Date.now() - snapshotStartedAt}ms · total ${total}`);

        return {
          rows: records,
          breakdown: {
            delivered: toNumber(head.delivered_total),
            failed: toNumber(head.failed_total),
            pending: toNumber(head.pending_total),
          },
          total,
          // Janela EFETIVA consultada (a borda congela o export por ela).
          window,
          snapshotToken,
        };
      },
      onProgress,
    );
  }

  /** @inheritdoc */
  async getShipping(
    shippingId: string,
    window?: AuditWindowInterface,
    expand = true,
  ): Promise<DeliveryRecordInterface | null> {
    // Atalho: registro quente da busca/trilha recente → evita o scan do dia no S3 (~6s).
    const cached = this.recordCache.get(shippingId);

    if (cached) {
      return cached;
    }

    const record = await this.withRecords(
      window ?? this.defaultWindow(),
      async (connection) => {
        const rows = await this.query(
          connection,
          `SELECT id, phone, customer, provider, correlation_id, final_status, requested_at, finalized_at, error_hint, message, channel, app_id
            FROM ${RECORDS_TABLE} WHERE id = $1 LIMIT 1`,
          [shippingId],
        );

        return rows.length > 0
          ? this.toRecord(rows[0])
          : null;
      },
      undefined,
      undefined,
      // `expand: false` (reveal) → buffer 0 → varre SÓ a janela/filtros (~1 dia), não ±lateStatusBuffer
      // (~6 dias). Seguro p/ o lookup pontual: o telefone/conteúdo está no evento do próprio dia.
      expand
        ? undefined
        : 0,
    );

    if (record) {
      this.recordCache.set(record);
    }

    return record;
  }

  /** @inheritdoc */
  async getTrail(
    messageId: string,
    window?: AuditWindowInterface,
    onProgress?: AuditProgressCallback,
  ): Promise<DeliveryTrailInterface | null> {
    return this.withRecords(
      // O `materialize` já alarga o scan pra trás (buffer simétrico) → captura o `queued` mesmo que
      // o desfecho na janela seja de um dia posterior; não precisa de recuo extra aqui.
      window ?? this.defaultWindow(),
      async (connection) => {
        const rows = await this.query(
          connection,
          `SELECT id, phone, customer, provider, correlation_id, final_status, requested_at, finalized_at, error_hint, message, channel, app_id
            FROM ${RECORDS_TABLE} WHERE id = $1 LIMIT 1`,
          [messageId],
        );

        if (rows.length === 0) {
          return null;
        }

        const eventRows = await this.query(
          connection,
          trailEventsSql(),
          [messageId],
        );

        const record = this.toRecord(rows[0]);

        // Aquece o cache por id: reveal logo após abrir a trilha não re-varre o S3.
        this.recordCache.set(record);

        return {
          record,
          events: eventRows.map((row) => this.toTrailEvent(row)),
        };
      },
      onProgress,
    );
  }

  /** @inheritdoc */
  async deliveryReport(
    filter: AuditSearchFilterInterface,
    onProgress?: AuditProgressCallback,
    signal?: AbortSignal,
  ): Promise<DeliveryReportAggregateInterface> {
    const window = filter.window ?? this.defaultWindow();

    const resolved: AuditSearchFilterInterface = {
      ...filter,
      window,
    };

    return this.withRecords(
      window,
      async (connection) => {
        const totals = await this.reportTotals(
          connection,
          resolved,
        );

        const byProvider = await this.reportByProvider(
          connection,
          resolved,
        );

        const hourly = await this.reportHourly(
          connection,
          resolved,
        );

        const topErrors = await this.reportTopErrors(
          connection,
          resolved,
        );

        return {
          totals,
          byProvider,
          hourly,
          topErrors,
        };
      },
      onProgress,
      signal,
    );
  }

  /** @inheritdoc */
  async distinctProviders(window?: AuditWindowInterface): Promise<string[]> {
    return this.withRecords(
      window ?? this.defaultWindow(),
      async (connection) => {
        const rows = await this.query(
          connection,
          `SELECT DISTINCT provider FROM ${RECORDS_TABLE} WHERE provider IS NOT NULL ORDER BY provider`,
          [],
        );

        return rows
          .map((row) => toText(row.provider))
          .filter((provider): provider is string => provider !== null);
      },
    );
  }

  /** @inheritdoc */
  async distinctCustomers(
    window?: AuditWindowInterface,
    search?: string,
  ): Promise<{
    items: string[];
    total: number
  }> {
    return this.withRecords(
      window ?? this.defaultWindow(),
      async (connection) => {
        const params: BindValue[] = [];
        let filterClause = '';

        if (search) {
          const searchParam = params.push(`%${search}%`);
          filterClause = ` AND customer ILIKE $${searchParam}`;
        }

        // Total distinto (antes do limite) — o card declara o tamanho real do conjunto.
        const totalRows = await this.query(
          connection,
          `SELECT count(DISTINCT customer)::INTEGER AS total FROM ${RECORDS_TABLE}
            WHERE customer IS NOT NULL${filterClause}`,
          params,
        );

        // Top-N por VOLUME (mais ativos primeiro; desempate por nome) — em vez de despejar todos no LLM.
        const rows = await this.query(
          connection,
          `SELECT customer FROM ${RECORDS_TABLE}
            WHERE customer IS NOT NULL${filterClause}
            GROUP BY customer ORDER BY count(*) DESC, customer LIMIT ${CATALOG_LIMIT}`,
          params,
        );

        const items = rows
          .map((row) => toText(row.customer))
          .filter((customer): customer is string => customer !== null);

        return {
          items,
          total: toNumber(totalRows[0]?.total),
        };
      },
    );
  }

  /** @inheritdoc */
  async terminalSamples(window: AuditWindowInterface): Promise<ShippingSampleInterface[]> {
    return this.withRecords(
      window,
      async (connection) => {
        const params: BindValue[] = [];

        const conditions = this.windowConditions(
          window,
          'finalized_at',
          params,
        );

        const rows = await this.query(
          connection,
          `SELECT id, customer, provider, final_status, finalized_at, error_hint
            FROM ${RECORDS_TABLE}
            WHERE final_status IN ('delivered', 'failed')${conditions}`,
          params,
        );

        return rows.map((row) => ({
          id: String(row.id ?? ''),
          customerId: String(row.customer ?? ''),
          provider: toText(row.provider),
          finalStatus: row.final_status as ShippingStatusType,
          occurredAt: toDate(row.finalized_at) ?? new Date(0),
          errorHint: toText(row.error_hint),
        }));
      },
    );
  }

  /** @inheritdoc */
  async sendSamples(window: AuditWindowInterface): Promise<ShippingSampleInterface[]> {
    return this.withRecords(
      window,
      async (connection) => {
        const params: BindValue[] = [];

        const conditions = this.windowConditions(
          window,
          'requested_at',
          params,
        );

        // Os records já incluem o universo de envios (process-messages-sms): enviado-sem-status
        // vem como `pending`/`finalized_at NULL` (o silêncio que o webhook_silence detecta).
        const rows = await this.query(
          connection,
          `SELECT id, customer, final_status, provider, requested_at, finalized_at
            FROM ${RECORDS_TABLE} WHERE TRUE${conditions}`,
          params,
        );

        return rows.map((row) => ({
          id: String(row.id ?? ''),
          customerId: String(row.customer ?? ''),
          finalStatus: row.final_status as ShippingStatusType,
          occurredAt: toDate(row.finalized_at) ?? toDate(row.requested_at) ?? new Date(0),
          provider: toText(row.provider),
          requestedAt: toDate(row.requested_at) ?? undefined,
          finalizedAt: toDate(row.finalized_at),
        }));
      },
    );
  }

  /** @inheritdoc */
  async searchByIds(
    ids: string[],
    window: AuditWindowInterface,
  ): Promise<DeliveryRecordInterface[]> {
    if (ids.length === 0) {
      return [];
    }

    return this.withRecords(
      window,
      async (connection) => {
        const params: BindValue[] = [];
        const placeholders = ids.map((id) => `$${params.push(id)}`).join(', ');

        const rows = await this.query(
          connection,
          `SELECT id, phone, customer, provider, correlation_id, final_status, requested_at, finalized_at, error_hint, message, channel, app_id
            FROM ${RECORDS_TABLE} WHERE id IN (${placeholders}) ORDER BY requested_at DESC`,
          params,
        );

        return rows.map((row) => this.toRecord(row));
      },
    );
  }

  /** @inheritdoc */
  async exportSearchCsv(filter: AuditSearchFilterInterface): Promise<string> {
    const window = filter.window ?? this.defaultWindow();

    const resolved: AuditSearchFilterInterface = {
      ...filter,
      window,
    };

    return this.withRecords(
      window,
      async (connection) => {
        const params: BindValue[] = [];

        const conditions = this.filterConditions(
          resolved,
          params,
        );

        return this.copyToCsv(
          connection,
          conditions,
          params,
          'shippings',
        );
      },
    );
  }

  /** @inheritdoc */
  async exportByIdsCsv(
    ids: string[],
    window: AuditWindowInterface,
  ): Promise<string> {
    return this.withRecords(
      window,
      async (connection) => {
        const params: BindValue[] = [];
        const placeholders = ids.map((id) => `$${params.push(id)}`).join(', ');

        // Lista vazia → `id IN ()` é SQL inválido; usa `FALSE` (CSV só com o header).
        const conditions = ids.length > 0
          ? `id IN (${placeholders})`
          : 'FALSE';

        return this.copyToCsv(
          connection,
          conditions,
          params,
          'incident',
        );
      },
    );
  }

  /**
   * Materializa o recorte (`WHERE conditions`) numa TEMP TABLE e copia p/ um CSV — o `COPY` não aceita
   * params posicionais no binding, então o WHERE parametrizado fica no `CREATE TABLE AS`. Telefone EM
   * CLARO (exports auditados, severidade `pii`); aliases = header snake_case do contrato; delimitador
   * `;` p/ o Excel pt-BR (o BOM UTF-8 é prefixado no stream pela borda). Sem LIMIT: TODAS as linhas.
   *
   * @param {DuckDBConnection} connection - Conexão com a TEMP TABLE de records materializada.
   * @param {string} conditions - Cláusula `WHERE` (já com os `$n` ligados a `params`).
   * @param {BindValue[]} params - Valores de bind do `WHERE`.
   * @param {string} prefix - Prefixo do nome do arquivo (`shippings`/`incident`).
   * @returns {Promise<string>} Caminho do CSV gerado.
   */
  private async copyToCsv(
    connection: DuckDBConnection,
    conditions: string,
    params: BindValue[],
    prefix: string,
  ): Promise<string> {
    mkdirSync(
      this.exportDir,
      { recursive: true },
    );

    const file = join(
      this.exportDir,
      `${prefix}-${randomUUID()}.csv`,
    );

    await this.query(
      connection,
      `CREATE OR REPLACE TEMP TABLE atena_export AS
        SELECT ${EXPORT_PROJECTION}
        FROM ${RECORDS_TABLE}
        WHERE ${conditions}
        ORDER BY requested_at DESC`,
      params,
    );

    await this.query(
      connection,
      `COPY atena_export TO '${file}' (FORMAT CSV, DELIMITER ';', HEADER true)`,
      [],
    );

    return file;
  }

  /**
   * Grava um SNAPSHOT (Parquet) do conjunto EXATO da busca — o export por token o lê depois, então o
   * download é byte-exato com o `total` exibido (sem re-escanear o S3, que ainda recebe dado tardio).
   * Roda na MESMA conexão da busca (a TEMP TABLE de records já está materializada).
   *
   * @param {DuckDBConnection} connection - Conexão com a TEMP TABLE de records da busca.
   * @param {string} conditions - `WHERE` da busca (mesmos `$n`/params).
   * @param {BindValue[]} params - Binds do `WHERE`.
   * @param {string} token - Id do snapshot (compõe o nome do Parquet).
   * @returns {Promise<void>}
   */
  private async writeSearchSnapshot(
    connection: DuckDBConnection,
    conditions: string,
    params: BindValue[],
    token: string,
  ): Promise<void> {
    mkdirSync(
      this.snapshotDir,
      { recursive: true },
    );

    const file = join(
      this.snapshotDir,
      `${token}.parquet`,
    );

    await this.query(
      connection,
      `CREATE OR REPLACE TEMP TABLE atena_search_snapshot AS
        SELECT ${EXPORT_PROJECTION}
        FROM ${RECORDS_TABLE}
        WHERE ${conditions}
        ORDER BY requested_at DESC`,
      params,
    );

    await this.query(
      connection,
      `COPY atena_search_snapshot TO '${file}' (FORMAT PARQUET)`,
      [],
    );
  }

  /** @inheritdoc */
  async exportSnapshotCsv(token: string): Promise<string | null> {
    if (!SNAPSHOT_TOKEN_RE.test(token)) {
      return null;
    }

    const snapshot = join(
      this.snapshotDir,
      `${token}.parquet`,
    );

    if (!existsSync(snapshot)) {
      return null;
    }

    const instance = await this.ensureInstance();
    const connection = await instance.connect();

    try {
      mkdirSync(
        this.exportDir,
        { recursive: true },
      );

      const file = join(
        this.exportDir,
        `messages-${randomUUID()}.csv`,
      );

      // Lê o snapshot local (Parquet) → CSV. Sem materialize, sem S3 → instantâneo e EXATO.
      await this.query(
        connection,
        `COPY (SELECT * FROM read_parquet('${snapshot}')) TO '${file}' (FORMAT CSV, DELIMITER ';', HEADER true)`,
        [],
      );

      return file;
    }
    finally {
      connection.closeSync();
    }
  }

  /** Totais por status do relatório, na janela/filtros. */
  private async reportTotals(
    connection: DuckDBConnection,
    filter: AuditSearchFilterInterface,
  ): Promise<DeliveryReportAggregateInterface['totals']> {
    const params: BindValue[] = [];

    const conditions = this.filterConditions(
      filter,
      params,
    );

    const rows = await this.query(
      connection,
      `SELECT
          count(*)::INTEGER AS sent,
          count(*) FILTER (WHERE final_status = 'delivered')::INTEGER AS delivered,
          count(*) FILTER (WHERE final_status = 'failed')::INTEGER AS failed,
          count(*) FILTER (WHERE final_status = 'pending')::INTEGER AS pending
        FROM ${RECORDS_TABLE} WHERE ${conditions}`,
      params,
    );

    const row = rows[0] ?? {};

    return {
      sent: toNumber(row.sent),
      delivered: toNumber(row.delivered),
      failed: toNumber(row.failed),
      pending: toNumber(row.pending),
    };
  }

  /** Quebra por provedor (taxa de entrega) do relatório. */
  private async reportByProvider(
    connection: DuckDBConnection,
    filter: AuditSearchFilterInterface,
  ): Promise<DeliveryReportAggregateInterface['byProvider']> {
    const params: BindValue[] = [];

    const conditions = this.filterConditions(
      filter,
      params,
    );

    const rows = await this.query(
      connection,
      `SELECT
          coalesce(provider, 'desconhecido') AS name,
          count(*)::INTEGER AS sent,
          count(*) FILTER (WHERE final_status = 'delivered')::INTEGER AS delivered,
          round(100.0 * count(*) FILTER (WHERE final_status = 'delivered') / count(*), 1) AS rate
        FROM ${RECORDS_TABLE} WHERE ${conditions}
        GROUP BY 1 ORDER BY sent DESC`,
      params,
    );

    return rows.map((row) => ({
      name: String(row.name ?? 'desconhecido'),
      sent: toNumber(row.sent),
      delivered: toNumber(row.delivered),
      rate: toNumber(row.rate),
    }));
  }

  /** 24 buckets de taxa de entrega por hora-do-dia (UTC) do relatório. */
  private async reportHourly(
    connection: DuckDBConnection,
    filter: AuditSearchFilterInterface,
  ): Promise<Array<{
    at: string;
    rate: number
  }>> {
    const params: BindValue[] = [];

    const conditions = this.filterConditions(
      filter,
      params,
    );

    // Buckets CRONOLÓGICOS por hora (date_trunc), ordenados — não por hora-do-dia: assim a janela
    // que cruza a meia-noite mantém os dois dias separados e em ordem. `at` sai como ISO 8601 UTC.
    const rows = await this.query(
      connection,
      `SELECT
          strftime(date_trunc('hour', requested_at), '%Y-%m-%dT%H:00:00Z') AS at,
          round(100.0 * count(*) FILTER (WHERE final_status = 'delivered') / count(*), 1) AS rate
        FROM ${RECORDS_TABLE} WHERE ${conditions}
        GROUP BY 1
        ORDER BY 1`,
      params,
    );

    return rows.map((row) => ({
      at: String(row.at),
      rate: toNumber(row.rate),
    }));
  }

  /** Top-5 erros (por contagem), com o provedor dominante de cada código. */
  private async reportTopErrors(
    connection: DuckDBConnection,
    filter: AuditSearchFilterInterface,
  ): Promise<DeliveryReportAggregateInterface['topErrors']> {
    const params: BindValue[] = [];

    const conditions = this.filterConditions(
      filter,
      params,
    );

    const rows = await this.query(
      connection,
      `SELECT error_hint AS code, count(*)::INTEGER AS count, coalesce(mode(provider), 'mix') AS provider
        FROM ${RECORDS_TABLE} WHERE ${conditions} AND error_hint IS NOT NULL
        GROUP BY error_hint ORDER BY count DESC LIMIT 5`,
      params,
    );

    return rows.map((row) => ({
      code: String(row.code ?? ''),
      count: toNumber(row.count),
      provider: String(row.provider ?? 'mix'),
    }));
  }

  /** Janela default `[agora - defaultWindowDays, agora)`. */
  private defaultWindow(): AuditWindowInterface {
    const now = Date.now();

    return {
      from: new Date(now - this.defaultWindowMs),
      to: new Date(now),
    };
  }

  /**
   * Constrói as condições de filtro de `search`/`deliveryReport` (janela por `requested_at` +
   * phone/status/provider/customer), empurrando os valores em `params`.
   *
   * @param {AuditSearchFilterInterface} filter - Filtros da consulta.
   * @param {BindValue[]} params - Acumulador de valores de bind (mutável).
   * @returns {string} Cláusula booleana (sempre verdadeira se não houver filtro).
   */
  private filterConditions(
    filter: AuditSearchFilterInterface,
    params: BindValue[],
  ): string {
    const clauses: string[] = [this.windowConditions(
      filter.window,
      'requested_at',
      params,
      true,
    )];

    if (filter.phone) {
      // O telefone é gravado só-dígitos e COM DDI na ingestão (ex.: 55DD9XXXXXXXX). Casa por SUFIXO
      // quando o filtro tem um número nacional (>= PHONE_SUFFIX_MIN_DIGITS), tolerando a busca SEM o
      // DDI (ex.: "13991884678" acha "5513991884678"); número completo casa igual (termina nele
      // mesmo). Sufixo evita o bug do "prepend 55" no DDD 55. Filtro curto demais → match exato.
      const digits = normalizePhone(filter.phone);

      clauses.push(
        digits.length >= PHONE_SUFFIX_MIN_DIGITS
          ? `ends_with(phone, $${params.push(digits)})`
          : `phone = $${params.push(digits)}`,
      );
    }

    if (filter.status) {
      clauses.push(`final_status = $${params.push(filter.status)}`);
    }

    if (filter.provider) {
      clauses.push(`provider = $${params.push(filter.provider)}`);
    }

    if (filter.customerId) {
      clauses.push(`customer = $${params.push(filter.customerId)}`);
    }

    if (filter.correlationId) {
      clauses.push(`correlation_id = $${params.push(filter.correlationId)}`);
    }

    return clauses
      .filter((clause) => clause !== '')
      .join(' AND ') || 'TRUE';
  }

  /**
   * Condição de janela sobre uma coluna de timestamp, empurrando os bounds (ISO) em `params`.
   *
   * @param {AuditWindowInterface} window - Janela `[from, to)`.
   * @param {string} column - Coluna de timestamp (`requested_at`/`finalized_at`).
   * @param {BindValue[]} params - Acumulador de valores de bind (mutável).
   * @param {boolean} [bare] - Se `true`, devolve só a cláusula (sem ` AND ` à frente).
   * @returns {string} Cláusula da janela (ou vazia se a janela for aberta dos dois lados).
   */
  private windowConditions(
    window: AuditWindowInterface | undefined,
    column: string,
    params: BindValue[],
    bare = false,
  ): string {
    if (!window) {
      return bare
        ? 'TRUE'
        : '';
    }

    const clauses: string[] = [];

    if (window.from) {
      clauses.push(`${column} >= CAST($${params.push(window.from.toISOString())} AS TIMESTAMP)`);
    }

    if (window.to) {
      clauses.push(`${column} < CAST($${params.push(window.to.toISOString())} AS TIMESTAMP)`);
    }

    if (clauses.length === 0) {
      return bare
        ? 'TRUE'
        : '';
    }

    const joined = clauses.join(' AND ');

    return bare
      ? joined
      : ` AND ${joined}`;
  }

  /** Mapeia uma linha do DuckDB para o registro de entrega de domínio. */
  private toRecord(row: Record<string, unknown>): DeliveryRecordInterface {
    return {
      id: String(row.id ?? ''),
      customerId: String(row.customer ?? ''),
      phoneE164: String(row.phone ?? ''),
      provider: toText(row.provider),
      correlationId: toText(row.correlation_id),
      channel: toText(row.channel),
      appId: toText(row.app_id),
      finalStatus: row.final_status as ShippingStatusType,
      requestedAt: toDate(row.requested_at) ?? new Date(0),
      finalizedAt: toDate(row.finalized_at),
      errorHint: toText(row.error_hint),
      contentRef: null,
      content: toText(row.message),
    };
  }

  /**
   * Mapeia um registro do detailed report (`atena_ev`) para um evento de trilha (lifecycle). Status
   * intermediário (`queued`/`sent`/`in_progress`) vira `webhook_status`; o restante (delivered/falhas)
   * vira `final`. `detail` agrega fornecedor + código + mensagem de erro, quando presentes.
   *
   * @param {Record<string, unknown>} row - Linha de evento cru (`atena_ev`).
   * @returns {DeliveryTrailEventInterface} Evento normalizado para a timeline.
   */
  private toTrailEvent(row: Record<string, unknown>): DeliveryTrailEventInterface {
    const at = toDate(row.processed_at) ?? toDate(row.sent_at) ?? new Date(0);
    const status = toText(row.status) ?? '';

    const isFinal = status !== 'queued'
      && status !== 'sent'
      && status !== 'in_progress';

    // `sent` = entrega ao fornecedor/operadora = uma TENTATIVA (o front conta `provider_attempt`);
    // `queued`/`in_progress` ficam como evento de webhook. Terminais viram `final`.
    let type: DeliveryTrailEventInterface['type'] = 'webhook_status';

    if (isFinal) {
      type = 'final';
    }
    else if (status === 'sent') {
      type = 'provider_attempt';
    }

    const provider = toText(row.provider);
    const code = toText(row.provider_code);

    const detail = [
      provider
        ? `fornecedor ${provider}`
        : '',
      // Rótulo explícito: é o status code DO PROVEDOR (operadora/gateway), NÃO um HTTP status —
      // evita o LLM (e o leitor) lerem "401" como "Unauthorized". Mostra o código SEMPRE que houver,
      // INCLUSIVE "0" (é o código real da Sinch p/ o erro genérico — o operador quer vê-lo); só omite
      // quando ausente de fato (null/vazio, ex.: bounce). O `error_text` cru ("[sinch] SMS reported
      // as 'generic_error'") NÃO entra: é redundante com o status (já legível no label).
      code
        ? `código de status do provedor ${code}`
        : '',
    ].filter(Boolean).join(' · ');

    return {
      type,
      label: isFinal
        ? `Status final: ${statusDisplayLabel(status)}`
        : `Status: ${statusDisplayLabel(status)}`,
      at,
      detail,
    };
  }

  /**
   * Abre uma conexão, materializa os registros da janela numa TEMP TABLE e executa `run`.
   * Fecha a conexão ao final. Janela sem objetos → TEMP TABLE vazia (resultado vazio, sem erro).
   *
   * @template T - Tipo do resultado de `run`.
   * @param {AuditWindowInterface} window - Janela que define as partições varridas.
   * @param {(connection: DuckDBConnection) => Promise<T>} run - Trabalho sobre a TEMP TABLE.
   * @param {AuditProgressCallback} [onProgress] - Callback de andamento da materialização.
   * @returns {Promise<T>} O resultado de `run`.
   */
  private async withRecords<T>(
    window: AuditWindowInterface,
    run: (connection: DuckDBConnection) => Promise<T>,
    onProgress?: AuditProgressCallback,
    signal?: AbortSignal,
    bufferMs?: number,
  ): Promise<T> {
    const instance = await this.ensureInstance();
    const connection = await instance.connect();

    // Disconnect (cliente fechou/abortou): interrompe a query DuckDB EM ANDAMENTO na hora — a leitura
    // do S3 da partição corrente ou a agregação final — não só entre partições. `interrupt()` faz a
    // query em curso lançar; o erro sobe e o `finally` fecha a conexão.
    const onAbort = (): void => {
      try {
        connection.interrupt();
      } catch {
        // conexão já encerrada / sem query em curso — nada a interromper.
      }
    };

    signal?.addEventListener(
      'abort',
      onAbort,
      { once: true },
    );

    try {
      await this.materialize(
        connection,
        window,
        onProgress,
        signal,
        bufferMs,
      );

      return await run(connection);
    }
    finally {
      signal?.removeEventListener(
        'abort',
        onAbort,
      );

      connection.closeSync();
    }
  }

  /**
   * Materializa a TEMP TABLE de registros da janela, com cache `/tmp` por partição.
   *
   * Para cada partição: se está "settled" (fechada há mais de `settleMs`) e já tem Parquet de cache,
   * usa o cache SEM tocar o S3; se settled sem cache, lê o S3 uma vez e grava o cache (write-through);
   * partições recentes são lidas live (JSON). A dedup por destinatário roda sobre a UNIÃO
   * `read_parquet(cache) ∪ read_json(live)` — global à janela (recipients podem cruzar partições).
   *
   * @param {DuckDBConnection} connection - Conexão ativa.
   * @param {AuditWindowInterface} window - Janela que define as partições candidatas.
   * @param {AuditProgressCallback} [onProgress] - Callback de andamento (mapping → reading → querying).
   * @param {AbortSignal} [signal] - Aborta a query em curso.
   * @param {number} [bufferMs] - Override do buffer de expansão simétrica da janela. Default
   *   `this.lateStatusBufferMs` (cobre status que finalizam fora da janela). Passe `0` num lookup
   *   pontual por id (reveal) p/ varrer SÓ a janela/filtros — o evento `queued` (com telefone) está
   *   no próprio dia, então não precisa expandir, e o scan frio cai de ~6 dias para ~1.
   * @returns {Promise<void>}
   */
  private async materialize(
    connection: DuckDBConnection,
    window: AuditWindowInterface,
    onProgress?: AuditProgressCallback,
    signal?: AbortSignal,
    bufferMs?: number,
  ): Promise<void> {
    const startedAt = Date.now();
    const now = new Date();

    const scanWindow = symmetricScanWindow(
      window,
      bufferMs ?? this.lateStatusBufferMs,
      now,
    );

    const descriptors = partitionDescriptors(
      this.sourceRoot,
      scanWindow,
      now,
    );

    const total = descriptors.length;

    onProgress?.({
      phase: 'mapping',
      label: total === 1
        ? 'Mapeando 1 partição da janela'
        : `Mapeando ${total} partições da janela`,
      total,
    });

    const settledBefore = now.getTime() - this.settleMs;
    const parquetFiles: string[] = [];
    const jsonFiles: string[] = [];

    // Contadores de custo de S3 desta consulta: partições servidas do cache (0 S3) vs. lidas do S3
    // (frias = settled sem cache; recentes = live) + objetos lidos do S3.
    let cachedCount = 0;
    let coldCount = 0;
    let liveCount = 0;
    let s3Objects = 0;

    for (let index = 0; index < descriptors.length; index++) {
      // Cliente desconectou (ex.: trocou a janela na tela): aborta a varredura entre partições —
      // limita o trabalho desperdiçado a, no máximo, a partição corrente.
      if (signal?.aborted) {
        throw new DOMException(
          'Consulta cancelada (cliente desconectou)',
          'AbortError',
        );
      }

      const descriptor = descriptors[index];

      // Progresso por partição (toda iteração) — barra avança 1/N..N/N, mesmo nas partições
      // recentes (live) ou já cacheadas (que não fazem leitura fria do S3).
      onProgress?.({
        phase: 'reading',
        label: 'Varrendo partições no S3',
        current: index + 1,
        total,
      });

      const settled = descriptor.endsAt !== null
        && descriptor.endsAt.getTime() <= settledBefore;

      if (!settled) {
        const live = await this.expandPartition(
          connection,
          descriptor.glob,
        );

        jsonFiles.push(...live);
        liveCount += 1;
        s3Objects += live.length;

        continue;
      }

      const cachePath = this.cachePathFor(descriptor.cacheKey);

      if (existsSync(cachePath)) {
        parquetFiles.push(cachePath);
        cachedCount += 1;

        continue;
      }

      // Partição fria (settled, sem cache): lê o S3 uma vez e grava o Parquet — é aqui que o tempo mora.
      const files = await this.expandPartition(
        connection,
        descriptor.glob,
      );

      coldCount += 1;
      s3Objects += files.length;

      if (files.length > 0) {
        await this.cachePartition(
          connection,
          files,
          cachePath,
        );

        parquetFiles.push(cachePath);
      }
    }

    onProgress?.({
      phase: 'querying',
      label: 'Consultando',
    });

    this.recordScan(
      {
        total,
        cachedCount,
        coldCount,
        liveCount,
        s3Objects,
      },
      Date.now() - startedAt,
    );

    if (
      parquetFiles.length === 0
      && jsonFiles.length === 0
    ) {
      await connection.run(EMPTY_EV_DDL);
    }
    else {
      await connection.run(evDdlFromSources(
        parquetFiles,
        jsonFiles,
      ));
    }

    await connection.run(recordsDdl());
  }

  /**
   * Acumula o custo de leitura do S3 desta materialização (partições cache/fria/recente + objetos +
   * tempo), emite métricas best-effort (DogStatsD) e loga uma linha por consulta. Alimenta o
   * {@link scanStats} exposto no `/observability`.
   *
   * @param {{ total: number; cachedCount: number; coldCount: number; liveCount: number; s3Objects: number }} counts - Contagens da consulta.
   * @param {number} elapsedMs - Duração da materialização (ms).
   * @returns {void}
   */
  private recordScan(
    counts: {
      total: number;
      cachedCount: number;
      coldCount: number;
      liveCount: number;
      s3Objects: number
    },
    elapsedMs: number,
  ): void {
    const s3Partitions = counts.coldCount + counts.liveCount;

    this.scan.queries += 1;
    this.scan.partitionsTotal += counts.total;
    this.scan.partitionsCached += counts.cachedCount;
    this.scan.partitionsCold += counts.coldCount;
    this.scan.partitionsLive += counts.liveCount;
    this.scan.s3Objects += counts.s3Objects;
    this.scan.s3ReadMs += elapsedMs;

    this.metrics?.increment('audit.s3.query');

    this.metrics?.histogram(
      'audit.s3.partitions_scanned',
      s3Partitions,
    );

    this.metrics?.histogram(
      'audit.s3.objects',
      counts.s3Objects,
    );

    this.metrics?.histogram(
      'audit.s3.materialize_ms',
      elapsedMs,
    );

    this.logger.debug(`S3 scan: ${counts.total} part (${counts.cachedCount} cache, ${counts.coldCount} fria, ${counts.liveCount} recente) · ${counts.s3Objects} obj · ${elapsedMs}ms`);

    // Persiste o evento (best-effort, fire-and-forget) — base da janela temporal que sobrevive a
    // restart; falha de escrita NUNCA afeta a consulta.
    this.prisma?.auditScanEvent.create({
      data: {
        partitionsTotal: counts.total,
        partitionsCached: counts.cachedCount,
        partitionsScanned: s3Partitions,
        s3Objects: counts.s3Objects,
        readMs: elapsedMs,
      },
    }).catch(() => undefined);
  }

  /**
   * Poda os eventos de scan persistidos além de {@link SCAN_EVENT_RETENTION_MS} (best-effort,
   * fire-and-forget) — mantém a tabela limitada; falha nunca afeta o resto do eviction.
   *
   * @returns {void}
   */
  private pruneScanEvents(): void {
    this.prisma?.auditScanEvent.deleteMany({
      where: { at: { lt: new Date(Date.now() - SCAN_EVENT_RETENTION_MS) } },
    })
      .then((result) => {
        if (result.count > 0) {
          this.logger.log(`audit_scan_events: poda removeu ${result.count} (> 30d).`);
        }
      })
      .catch(() => undefined);
  }

  /**
   * Estatísticas de leitura do S3 numa JANELA temporal (default 24h), agregadas dos eventos
   * persistidos (`audit_scan_events`) — sobrevive a restart. Sem Prisma (ex.: testes), cai no
   * acumulador em memória "desde a subida".
   *
   * @param {number} [windowHours] - Tamanho da janela em horas (default 24).
   * @returns {Promise<AuditScanStatsInterface>} Métricas agregadas da janela.
   */
  async scanStats(windowHours = 24): Promise<AuditScanStatsInterface> {
    if (!this.prisma) {
      return this.buildScanStats({
        queries: this.scan.queries,
        partitionsTotal: this.scan.partitionsTotal,
        partitionsCached: this.scan.partitionsCached,
        partitionsScanned: this.scan.partitionsCold + this.scan.partitionsLive,
        s3Objects: this.scan.s3Objects,
        readMs: this.scan.s3ReadMs,
      });
    }

    const since = new Date(Date.now() - windowHours * HOUR_MS);

    const agg = await this.prisma.auditScanEvent.aggregate({
      where: { at: { gte: since } },
      _count: { _all: true },
      _sum: {
        partitionsTotal: true,
        partitionsCached: true,
        partitionsScanned: true,
        s3Objects: true,
        readMs: true,
      },
    });

    return this.buildScanStats({
      queries: agg._count._all,
      partitionsTotal: agg._sum.partitionsTotal ?? 0,
      partitionsCached: agg._sum.partitionsCached ?? 0,
      partitionsScanned: agg._sum.partitionsScanned ?? 0,
      s3Objects: agg._sum.s3Objects ?? 0,
      readMs: agg._sum.readMs ?? 0,
    });
  }

  /**
   * Monta o {@link AuditScanStatsInterface} (taxa de cache, custo estimado, médias) a partir dos
   * totais agregados — reusado pela janela persistida e pelo fallback em memória.
   *
   * @param {object} totals - Totais agregados (queries/partições/objetos/ms).
   * @returns {AuditScanStatsInterface} Estatísticas de borda.
   */
  private buildScanStats(totals: {
    queries: number;
    partitionsTotal: number;
    partitionsCached: number;
    partitionsScanned: number;
    s3Objects: number;
    readMs: number
  }): AuditScanStatsInterface {
    // Estimativa GROSSEIRA: GET ~US$0,0004/1k (≈ 1 por objeto, limite inferior — DuckDB faz range
    // reads) + LIST ~US$0,005/1k (≈ 1 glob por partição lida do S3). Cache não toca o S3 (custo 0).
    const cost = (totals.s3Objects * 0.0004) / 1000
      + (totals.partitionsScanned * 0.005) / 1000;

    return {
      queries: totals.queries,
      partitions_total: totals.partitionsTotal,
      partitions_cached: totals.partitionsCached,
      partitions_scanned: totals.partitionsScanned,
      s3_objects: totals.s3Objects,
      cache_hit_rate: totals.partitionsTotal > 0
        ? Math.round((totals.partitionsCached / totals.partitionsTotal) * 1000) / 1000
        : 0,
      avg_materialize_ms: totals.queries > 0
        ? Math.round(totals.readMs / totals.queries)
        : 0,
      estimated_get_requests: totals.s3Objects,
      estimated_cost_usd: Math.round(cost * 10000) / 10000,
    };
  }

  /** Caminho do Parquet de cache de uma partição (hash de `sourceRoot|chave`; isola por fonte). */
  private cachePathFor(cacheKey: string): string {
    const digest = createHash('sha256')
      .update(`${this.sourceRoot}|${cacheKey}`)
      .digest('hex');

    return join(
      this.cacheDir,
      `${digest}.parquet`,
    );
  }

  /** Expande um glob de partição nos objetos existentes (via `glob()`, que tolera padrão sem match). */
  private async expandPartition(
    connection: DuckDBConnection,
    glob: string,
  ): Promise<string[]> {
    const rows = await this.query(
      connection,
      globSql(glob),
      [],
    );

    return rows
      .map((row) => String(row.file ?? ''))
      .filter((file) => file !== '');
  }

  /** Grava o cache de eventos da partição (write atômico: arquivo tmp + rename). */
  private async cachePartition(
    connection: DuckDBConnection,
    files: string[],
    cachePath: string,
  ): Promise<void> {
    mkdirSync(
      this.cacheDir,
      { recursive: true },
    );

    const tmpPath = `${cachePath}.${randomUUID()}.tmp`;

    await connection.run(evCopyToParquetSql(
      files,
      tmpPath,
    ));

    renameSync(
      tmpPath,
      cachePath,
    );
  }

  /** Roda uma query com bind posicional e devolve as linhas como objetos JS. */
  private async query(
    connection: DuckDBConnection,
    sql: string,
    params: BindValue[],
  ): Promise<Array<Record<string, unknown>>> {
    const reader = await connection.runAndReadAll(
      sql,
      params,
    );

    return reader.getRowObjectsJS() as unknown as Array<Record<string, unknown>>;
  }

  /** Cria (lazy) a instância DuckDB e, para fontes `s3://`, instala httpfs + secret. */
  private async ensureInstance(): Promise<DuckDBInstance> {
    if (this.instance) {
      return this.instance;
    }

    mkdirSync(
      this.extensionDir,
      { recursive: true },
    );

    mkdirSync(
      this.spillDir,
      { recursive: true },
    );

    // Recursos LIMITADOS (máquina enxuta): `memory_limit` + `threads` capam RAM/CPU por consulta;
    // `temp_directory` faz o DuckDB derramar em disco ao exceder o limite (em vez de OOM/swap do
    // host); `preserve_insertion_order=false` reduz a memória em agregações/ordenações grandes.
    const created = await DuckDBInstance.create(
      ':memory:',
      {
        extension_directory: this.extensionDir,
        memory_limit: this.duckdbMemoryLimit,
        threads: String(this.duckdbThreads),
        temp_directory: this.spillDir,
        preserve_insertion_order: 'false',
      },
    );

    this.logger.log(`DuckDB: memory_limit=${this.duckdbMemoryLimit} · threads=${this.duckdbThreads} · spill=${this.spillDir}`);

    if (this.sourceRoot.startsWith('s3://')) {
      const connection = await created.connect();

      try {
        // `httpfs` lê s3://; `aws` provê o credential_chain do CREATE SECRET. O autoload exige
        // ca-certificates na imagem — instalar explícito deixa o erro claro se faltar rede/cert.
        await connection.run('INSTALL httpfs; LOAD httpfs;');
        await connection.run('INSTALL aws; LOAD aws;');

        await connection.run(
          `CREATE OR REPLACE SECRET atena_s3 (TYPE S3, PROVIDER credential_chain, REGION '${this.region}')`,
        );
      }
      finally {
        connection.closeSync();
      }

      this.logger.log(`AuditQuery via DuckDB sobre ${this.sourceRoot} (httpfs)`);
    }
    else {
      this.logger.log(`AuditQuery via DuckDB sobre ${this.sourceRoot} (local)`);
    }

    this.instance = created;

    return created;
  }
}
