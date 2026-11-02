import { gzipSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { DuckDBInstance } from '@duckdb/node-api';
import type { MetricsService } from '../observability/metrics.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuditWindowInterface, DeliveryRecordInterface } from './audit-query.types';
import { DuckDbAuditQueryService } from './duckdb-audit-query.service';

// DuckDB + materialization do real I/O; under the parallel run the default 5s timeout is tight.
jest.setTimeout(30000);

/** One raw record of the detailed report; unlike the main spec, client/provider/processed_at may be null. */
interface SourceRecordInputInterface {
  campaign_id: string;
  status: string;
  phone: string;
  client_id: string | null;
  provider_name: string | null;
  processed_at: string | null;
  campaign_type?: string;
  provider_code?: string;
  sent_at?: string;
  error?: Record<string, unknown>;
}

/** Serializes one detailed-report record (one line of a `.json.gz` object). */
function sourceRecord(input: SourceRecordInputInterface): string {
  return JSON.stringify({
    campaign_id: input.campaign_id,
    campaign_type: input.campaign_type ?? 'sms',
    client_id: input.client_id,
    app_id: null,
    source: 'api',
    status: input.status,
    phone: input.phone,
    message: 'hello',
    credits_required: 1,
    sent_at: input.sent_at ?? '2026-06-17',
    processed_at: input.processed_at,
    provider_name: input.provider_name,
    provider_code: input.provider_code ?? null,
    error: input.error ?? null,
  });
}

/** Writes `lines` as a gzipped object `name` under `dir` (created if missing). */
function writeObject(
  dir: string,
  name: string,
  lines: string[],
): void {
  mkdirSync(
    dir,
    { recursive: true },
  );

  writeFileSync(
    join(
      dir,
      name,
    ),
    gzipSync(Buffer.from(`${lines.join('\n')}\n`)),
  );
}

/** ConfigService stub that returns the injected value for each key. */
function configStub(values: Record<string, unknown>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

/** Removes a temporary directory tree. */
function removeTree(path: string): void {
  rmSync(
    path,
    {
      recursive: true,
      force: true,
    },
  );
}

/** Non-empty lines of a CSV file written by the service (the file is removed afterwards). */
function csvLines(path: string): string[] {
  const lines = readFileSync(
    path,
    'utf8',
  )
    .split('\n')
    .filter((line) => line !== '');

  rmSync(
    path,
    { force: true },
  );

  return lines;
}

/**
 * Record of `rows` whose phone is `phone`.
 *
 * @throws {Error} When no row has that phone (fails the test with a clear message).
 */
function byPhone(
  rows: DeliveryRecordInterface[],
  phone: string,
): DeliveryRecordInterface {
  const found = rows.find((row) => row.phoneE164 === phone);

  if (!found) {
    throw new Error(`no row for ${phone}`);
  }

  return found;
}

const DAY_WINDOW: AuditWindowInterface = {
  from: new Date('2026-06-17T00:00:00Z'),
  to: new Date('2026-06-18T00:00:00Z'),
};

const OPEN_WINDOW: AuditWindowInterface = {
  from: null,
  to: null,
};

/** A window with no source object at all (the fixture only has 2026-06-17). */
const EMPTY_WINDOW: AuditWindowInterface = {
  from: new Date('2026-06-01T00:00:00Z'),
  to: new Date('2026-06-02T00:00:00Z'),
};

const CSV_HEADER = 'shipping_id;campaign_id;phone;channel;app_id;status;provider;customer;requested_at;error_hint';

describe('DuckDbAuditQueryService — query paths over a settled local fixture', () => {
  let root: string;
  let service: DuckDbAuditQueryService;

  beforeAll(() => {
    root = mkdtempSync(join(
      tmpdir(),
      'atena-paths-',
    ));

    writeObject(
      join(
        root,
        'year=2026/month=06/day=17/hour=15',
      ),
      'part.json.gz',
      [
        // req-1: queued -> sent -> delivered.
        sourceRecord({
          campaign_id: 'req-1',
          status: 'queued',
          phone: '+5511900000001',
          client_id: '1001',
          provider_name: 'provider-c',
          processed_at: '2026-06-17T15:00:00Z',
        }),
        sourceRecord({
          campaign_id: 'req-1',
          status: 'delivered',
          phone: '+5511900000001',
          client_id: '1001',
          provider_name: 'provider-c',
          processed_at: '2026-06-17T15:02:00Z',
        }),
        // req-2: queued -> bounce with a provider status code => blocked.
        sourceRecord({
          campaign_id: 'req-2',
          status: 'queued',
          phone: '+5511900000002',
          client_id: '1001',
          provider_name: 'provider-c',
          processed_at: '2026-06-17T15:00:00Z',
        }),
        sourceRecord({
          campaign_id: 'req-2',
          status: 'bounce',
          phone: '+5511900000002',
          client_id: '1001',
          provider_name: 'provider-c',
          provider_code: '21211',
          processed_at: '2026-06-17T15:05:00Z',
        }),
        // req-3: only queued => pending.
        sourceRecord({
          campaign_id: 'req-3',
          status: 'queued',
          phone: '+5511900000003',
          client_id: '9001',
          provider_name: 'provider-d',
          processed_at: '2026-06-17T15:03:00Z',
        }),
        // req-4: queued -> request_error => failed.
        sourceRecord({
          campaign_id: 'req-4',
          status: 'queued',
          phone: '+5511900000004',
          client_id: '9001',
          provider_name: 'provider-c',
          processed_at: '2026-06-17T15:00:00Z',
        }),
        sourceRecord({
          campaign_id: 'req-4',
          status: 'request_error',
          phone: '+5511900000004',
          client_id: '9001',
          provider_name: 'provider-c',
          provider_code: '403',
          error: { message: 'Failed to send SMS message' },
          processed_at: '2026-06-17T15:01:00Z',
        }),
        // req-np: queued WITHOUT provider, a `sent` without processed_at (only sent_at), then delivered.
        sourceRecord({
          campaign_id: 'req-np',
          status: 'queued',
          phone: '+5511900000005',
          client_id: '1001',
          provider_name: null,
          processed_at: '2026-06-17T15:00:00Z',
        }),
        sourceRecord({
          campaign_id: 'req-np',
          status: 'sent',
          phone: '+5511900000005',
          client_id: '1001',
          provider_name: 'provider-c',
          processed_at: null,
          sent_at: '2026-06-17T14:59:00',
        }),
        sourceRecord({
          campaign_id: 'req-np',
          status: 'delivered',
          phone: '+5511900000005',
          client_id: '1001',
          provider_name: 'provider-c',
          processed_at: '2026-06-17T15:03:00Z',
        }),
        // req-noq: no queued and no customer => pending, requested_at NULL (outside any bounded window).
        sourceRecord({
          campaign_id: 'req-noq',
          status: 'sent',
          phone: '+5511900000006',
          client_id: null,
          provider_name: 'provider-c',
          processed_at: '2026-06-17T15:04:00Z',
        }),
      ],
    );

    service = new DuckDbAuditQueryService(configStub({
      'auditQuery.sourceRoot': root,
      'auditQuery.defaultWindowDays': 30,
      'auditQuery.cacheSettleMinutes': 0,
      'auditQuery.lateStatusBufferHours': 0,
      'cache.tmpDir': join(
        root,
        '.cache',
      ),
    }));
  });

  afterAll(() => {
    service.onModuleDestroy();
    removeTree(root);
  });

  it('search combines the status, provider, channel, error and customer filters', async () => {
    const page = await service.search(
      {
        window: DAY_WINDOW,
        status: 'failed',
        provider: 'provider-c',
        channel: 'sms',
        errorHint: 'request_error',
        customerId: '9001',
      },
      1,
      20,
    );

    expect(page.total).toBe(1);
    expect(page.rows[0].correlationId).toBe('req-4');
    expect(page.breakdown?.failed).toBe(1);
  });

  it('search with no match returns an empty page without a snapshot token', async () => {
    const page = await service.search(
      {
        window: DAY_WINDOW,
        status: 'failed',
        customerId: '1001',
      },
      1,
      20,
    );

    expect(page.total).toBe(0);
    expect(page.rows).toEqual([]);
    expect(page.snapshotToken).toBeUndefined();
  });

  it('search over an open window also returns sends without a queued event (epoch requested_at, no customer)', async () => {
    const page = await service.search(
      { window: OPEN_WINDOW },
      1,
      20,
    );

    expect(page.total).toBe(6);

    const orphan = byPhone(
      page.rows,
      '5511900000006',
    );

    expect(orphan.finalStatus).toBe('pending');
    expect(orphan.requestedAt.getTime()).toBe(0);
    expect(orphan.customerId).toBe('');
  });

  it('reports a single partition in the mapping label when the window fits in one hour', async () => {
    const labels: string[] = [];

    await service.search(
      {
        window: {
          from: new Date('2026-06-17T15:00:00Z'),
          to: new Date('2026-06-17T15:30:00Z'),
        },
      },
      1,
      20,
      (event) => labels.push(event.label),
    );

    expect(labels[0]).toBe('Mapeando 1 partição da janela');
  });

  it('aborting while the partitions are scanned interrupts the report with an AbortError', async () => {
    const controller = new AbortController();

    const report = service.deliveryReport(
      {
        window: {
          from: new Date('2026-06-17T15:00:00Z'),
          to: new Date('2026-06-17T17:00:00Z'),
        },
      },
      (event) => {
        if (event.phase === 'reading') {
          controller.abort();
        }
      },
      controller.signal,
    );

    await expect(report).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('sendSamples falls back to requested_at and then to the epoch when a send has no outcome', async () => {
    const samples = await service.sendSamples(OPEN_WINDOW);

    const orphan = samples.find((sample) => sample.customerId === '');
    const pending = samples.find((sample) => sample.provider === 'provider-d');

    expect(samples).toHaveLength(6);
    expect(orphan?.occurredAt.getTime()).toBe(0);
    expect(orphan?.requestedAt).toBeUndefined();
    expect(orphan?.finalizedAt).toBeNull();
    expect(pending?.finalizedAt).toBeNull();
    expect(pending?.occurredAt).toEqual(pending?.requestedAt);
  });

  it('terminalSamples over an open window keeps only delivered and failed outcomes', async () => {
    const samples = await service.terminalSamples(OPEN_WINDOW);

    expect(samples.map((sample) => sample.finalStatus).sort((
      left,
      right,
    ) => left.localeCompare(right))).toEqual([
      'delivered',
      'delivered',
      'failed',
    ]);
  });

  it('searchByIds returns [] for no ids and the matching records otherwise', async () => {
    const page = await service.search(
      { window: DAY_WINDOW },
      1,
      20,
    );

    const wanted = [
      byPhone(
        page.rows,
        '5511900000001',
      ).id,
      byPhone(
        page.rows,
        '5511900000004',
      ).id,
    ];

    const empty = await service.searchByIds(
      [],
      DAY_WINDOW,
    );

    const found = await service.searchByIds(
      wanted,
      DAY_WINDOW,
    );

    expect(empty).toEqual([]);

    expect(found.map((record) => record.correlationId).sort((
      left,
      right,
    ) => (left ?? '').localeCompare(right ?? ''))).toEqual([
      'req-1',
      'req-4',
    ]);
  });

  it('exportSearchCsv writes the filtered set with the phone in clear and a `;` header', async () => {
    const path = await service.exportSearchCsv({
      window: DAY_WINDOW,
      provider: 'provider-d',
    });

    const lines = csvLines(path);

    expect(lines[0]).toBe(CSV_HEADER);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain(';req-3;5511900000003;sms;');
  });

  it('exportSearchCsv without a window uses the default window (no data there → header only)', async () => {
    const path = await service.exportSearchCsv({});

    expect(csvLines(path)).toEqual([CSV_HEADER]);
  });

  it('exportByIdsCsv writes only the header for no ids and one line per requested id', async () => {
    const page = await service.search(
      { window: DAY_WINDOW },
      1,
      20,
    );

    const first = byPhone(
      page.rows,
      '5511900000001',
    );

    const emptyPath = await service.exportByIdsCsv(
      [],
      DAY_WINDOW,
    );

    const onePath = await service.exportByIdsCsv(
      [first.id],
      DAY_WINDOW,
    );

    expect(csvLines(emptyPath)).toEqual([CSV_HEADER]);

    const lines = csvLines(onePath);

    expect(lines).toHaveLength(2);
    expect(lines[1].startsWith(`${first.id};req-1;`)).toBe(true);
  });

  it('exportSnapshotCsv exports exactly the searched set by token and refuses unknown or malformed tokens', async () => {
    const page = await service.search(
      { window: DAY_WINDOW },
      1,
      2,
    );

    const path = await service.exportSnapshotCsv(page.snapshotToken ?? '');

    expect(path).not.toBeNull();
    // Header + every row of the set (5), not only the 2 of the page.
    expect(csvLines(path ?? '')).toHaveLength(6);
    expect(await service.exportSnapshotCsv('../../etc/passwd')).toBeNull();
    expect(await service.exportSnapshotCsv(randomUUID())).toBeNull();
  });

  it('getShipping serves a record seen by a search from memory and returns null for an unknown id', async () => {
    const page = await service.search(
      { window: DAY_WINDOW },
      1,
      20,
    );

    const seen = byPhone(
      page.rows,
      '5511900000001',
    );

    const queriesBefore = (await service.scanStats()).queries;
    const cached = await service.getShipping(seen.id);
    const queriesAfterCached = (await service.scanStats()).queries;
    const unknown = await service.getShipping('f'.repeat(32));

    expect(cached).toEqual(seen);
    expect(queriesAfterCached).toBe(queriesBefore);
    expect(unknown).toBeNull();
  });

  it('getTrail refuses an unknown id when no date is given', async () => {
    await expect(service.getTrail('0'.repeat(32))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('getTrail describes the provider and its status code only when present', async () => {
    const page = await service.search(
      { window: DAY_WINDOW },
      1,
      20,
    );

    const noProvider = await service.getTrail(byPhone(
      page.rows,
      '5511900000005',
    ).id);

    const bounced = await service.getTrail(byPhone(
      page.rows,
      '5511900000002',
    ).id);

    const queued = noProvider?.events.find((event) => event.label === 'Status: enfileirado');
    const sent = noProvider?.events.find((event) => event.type === 'provider_attempt');
    const blocked = bounced?.events.find((event) => event.type === 'final');

    expect(noProvider?.record.finalStatus).toBe('delivered');
    expect(queued?.detail).toBe('');
    // No processed_at → the event is placed at its sent_at (BRT → UTC).
    expect(sent?.at.toISOString()).toBe('2026-06-17T17:59:00.000Z');
    expect(blocked?.detail).toBe('fornecedor provider-c · código de status do provedor 21211');
  });

  it('getTrail of a pending send anchors the window on its request (no finalized_at)', async () => {
    const page = await service.search(
      { window: DAY_WINDOW },
      1,
      20,
    );

    const pending = byPhone(
      page.rows,
      '5511900000003',
    );

    const trail = await service.getTrail(pending.id);

    expect(trail?.record.finalStatus).toBe('pending');
    expect(trail?.events).toHaveLength(1);
  });

  it('getTrail of an id that is not an md5 in a narrow window finds nothing', async () => {
    const trail = await service.getTrail(
      'not-a-shipping-id',
      DAY_WINDOW,
    );

    expect(trail).toBeNull();
  });

  it('catalog and report over windows without objects come back empty', async () => {
    const providers = await service.distinctProviders(EMPTY_WINDOW);
    const defaultProviders = await service.distinctProviders();
    const customers = await service.distinctCustomers(EMPTY_WINDOW);
    const defaultCustomers = await service.distinctCustomers();
    const report = await service.deliveryReport({});

    expect(providers).toEqual([]);
    expect(defaultProviders).toEqual([]);

    expect(customers).toEqual({
      items: [],
      total: 0,
    });

    expect(defaultCustomers.total).toBe(0);

    expect(report.totals).toEqual({
      sent: 0,
      delivered: 0,
      failed: 0,
      blocked: 0,
      pending: 0,
    });

    expect(report.byProvider).toEqual([]);
  });

  it('scanStats without persistence aggregates the in-memory scans since start-up', async () => {
    await service.search(
      { window: DAY_WINDOW },
      1,
      20,
    );

    const stats = await service.scanStats();

    expect(stats.queries).toBeGreaterThan(0);
    expect(stats.partitions_total).toBeGreaterThan(0);
    expect(stats.partitions_cached).toBeGreaterThan(0);
    expect(stats.cache_hit_rate).toBeGreaterThan(0);
    expect(stats.cache_hit_rate).toBeLessThanOrEqual(1);
    expect(stats.avg_materialize_ms).toBeGreaterThanOrEqual(0);
  });
});

describe('DuckDbAuditQueryService — scan persistence and metrics', () => {
  let root: string;

  /** Prisma stub of `auditScanEvent` (the only delegate the engine touches). */
  const prismaStub = (delegate: Record<string, jest.Mock>): PrismaService => {
    return { auditScanEvent: delegate } as unknown as PrismaService;
  };

  const metricsStub = (): MetricsService & {
    increment: jest.Mock;
    histogram: jest.Mock
  } => ({
    increment: jest.fn(),
    histogram: jest.fn(),
  }) as unknown as MetricsService & {
    increment: jest.Mock;
    histogram: jest.Mock
  };

  const makeService = (
    metrics: MetricsService | undefined,
    prisma: PrismaService,
    overrides: Record<string, unknown> = {},
  ): DuckDbAuditQueryService => new DuckDbAuditQueryService(
    configStub({
      'auditQuery.sourceRoot': root,
      'auditQuery.cacheSettleMinutes': 0,
      'auditQuery.lateStatusBufferHours': 0,
      'cache.tmpDir': join(
        root,
        `.cache-${randomUUID()}`,
      ),
      ...overrides,
    }),
    metrics,
    prisma,
  );

  beforeAll(() => {
    root = mkdtempSync(join(
      tmpdir(),
      'atena-scanstats-',
    ));

    writeObject(
      join(
        root,
        'year=2026/month=06/day=17/hour=15',
      ),
      'part.json.gz',
      [
        sourceRecord({
          campaign_id: 'req-1',
          status: 'queued',
          phone: '+5511900000001',
          client_id: '1001',
          provider_name: 'provider-c',
          processed_at: '2026-06-17T15:00:00Z',
        }),
      ],
    );
  });

  afterAll(() => {
    removeTree(root);
  });

  it('each scan emits metrics and persists one scan event; a failed write never fails the query', async () => {
    const metrics = metricsStub();
    const create = jest.fn().mockRejectedValue(new Error('database down'));

    const service = makeService(
      metrics,
      prismaStub({ create }),
    );

    try {
      const page = await service.search(
        {
          window: {
            from: new Date('2026-06-17T15:00:00Z'),
            to: new Date('2026-06-17T19:00:00Z'),
          },
        },
        1,
        20,
      );

      expect(page.total).toBe(1);
      expect(metrics.increment).toHaveBeenCalledWith('audit.s3.query');

      expect(metrics.histogram).toHaveBeenCalledWith(
        'audit.s3.objects',
        1,
      );

      expect(create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          partitionsTotal: 5,
          partitionsCached: 0,
          partitionsScanned: 5,
          s3Objects: 1,
        }) as unknown,
      });
    }
    finally {
      service.onModuleDestroy();
    }
  });

  it('scanStats aggregates the persisted events of the window (missing sums count as zero)', async () => {
    const aggregate = jest.fn()
      .mockResolvedValueOnce({
        _count: { _all: 0 },
        _sum: {
          partitionsTotal: null,
          partitionsCached: null,
          partitionsScanned: null,
          s3Objects: null,
          readMs: null,
        },
      })
      .mockResolvedValueOnce({
        _count: { _all: 4 },
        _sum: {
          partitionsTotal: 8,
          partitionsCached: 6,
          partitionsScanned: 2,
          s3Objects: 1000,
          readMs: 402,
        },
      });

    const service = makeService(
      undefined,
      prismaStub({ aggregate }),
    );

    const startedAt = Date.now();
    const empty = await service.scanStats();

    const windowed = await service.scanStats(2);

    expect(empty).toEqual({
      queries: 0,
      partitions_total: 0,
      partitions_cached: 0,
      partitions_scanned: 0,
      s3_objects: 0,
      cache_hit_rate: 0,
      avg_materialize_ms: 0,
      estimated_get_requests: 0,
      estimated_cost_usd: 0,
    });

    expect(windowed).toMatchObject({
      queries: 4,
      cache_hit_rate: 0.75,
      avg_materialize_ms: 101,
      estimated_get_requests: 1000,
      estimated_cost_usd: 0.0004,
    });

    const firstSince = (aggregate.mock.calls[0][0] as { where: { at: { gte: Date } } }).where.at.gte;
    const secondSince = (aggregate.mock.calls[1][0] as { where: { at: { gte: Date } } }).where.at.gte;

    expect(startedAt - firstSince.getTime()).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000 - 1000);
    expect(startedAt - firstSince.getTime()).toBeLessThanOrEqual(24 * 60 * 60 * 1000 + 1000);
    expect(startedAt - secondSince.getTime()).toBeLessThanOrEqual(2 * 60 * 60 * 1000 + 1000);
  });

  it('evictCache prunes the scan events older than the retention, and tolerates a failed prune', async () => {
    const deleteMany = jest.fn()
      .mockResolvedValueOnce({ count: 3 })
      .mockRejectedValueOnce(new Error('database down'));

    const service = makeService(
      undefined,
      prismaStub({ deleteMany }),
      { 'auditQuery.scanEventRetentionDays': 7 },
    );

    const startedAt = Date.now();

    service.evictCache();

    expect(() => {
      service.evictCache();
    }).not.toThrow();

    // Let the fire-and-forget promises settle (a rejection must not surface as unhandled).
    await new Promise((resolve) => {
      setImmediate(resolve);
    });

    const cutoff = (deleteMany.mock.calls[0][0] as { where: { at: { lt: Date } } }).where.at.lt;

    expect(deleteMany).toHaveBeenCalledTimes(2);
    expect(startedAt - cutoff.getTime()).toBeGreaterThanOrEqual(7 * 24 * 60 * 60 * 1000 - 1000);
    expect(startedAt - cutoff.getTime()).toBeLessThanOrEqual(7 * 24 * 60 * 60 * 1000 + 1000);
  });
});

describe('DuckDbAuditQueryService — cache lifecycle (filesystem only)', () => {
  let tmpRoot: string;

  /** Writes an empty file and backdates its mtime by `ageHours`. */
  const touch = (
    path: string,
    ageHours: number,
  ): void => {
    writeFileSync(
      path,
      'x',
    );

    const when = new Date(Date.now() - ageHours * 60 * 60 * 1000);

    utimesSync(
      path,
      when,
      when,
    );
  };

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(
      tmpdir(),
      'atena-lifecycle-',
    ));

    for (const name of [
      'audit-ev-v11',
      'snapshots',
    ]) {
      mkdirSync(
        join(
          tmpRoot,
          name,
        ),
        { recursive: true },
      );
    }

    touch(
      join(
        tmpRoot,
        'audit-ev-v11',
        'old.parquet',
      ),
      10,
    );

    touch(
      join(
        tmpRoot,
        'audit-ev-v11',
        'fresh.parquet',
      ),
      0,
    );

    touch(
      join(
        tmpRoot,
        'snapshots',
        'expired.parquet',
      ),
      2,
    );
  });

  afterEach(() => {
    removeTree(tmpRoot);
  });

  it('onModuleInit removes cache dirs of older versions and keeps everything else', () => {
    mkdirSync(join(
      tmpRoot,
      'audit-ev-v1',
    ));

    const service = new DuckDbAuditQueryService(configStub({
      'auditQuery.sourceRoot': tmpRoot,
      'cache.tmpDir': tmpRoot,
    }));

    service.onModuleInit();

    expect(existsSync(join(
      tmpRoot,
      'audit-ev-v1',
    ))).toBe(false);

    expect(existsSync(join(
      tmpRoot,
      'audit-ev-v11',
      'fresh.parquet',
    ))).toBe(true);

    expect(existsSync(join(
      tmpRoot,
      'snapshots',
    ))).toBe(true);
  });

  it('evictCache removes expired snapshots and event Parquets older than the age limit', () => {
    const service = new DuckDbAuditQueryService(configStub({
      'auditQuery.sourceRoot': tmpRoot,
      'auditQuery.cacheMaxAgeHours': 1,
      'cache.tmpDir': tmpRoot,
    }));

    service.evictCache();

    expect(readdirSync(join(
      tmpRoot,
      'snapshots',
    ))).toEqual([]);

    expect(readdirSync(join(
      tmpRoot,
      'audit-ev-v11',
    ))).toEqual(['fresh.parquet']);
  });

  it('evictCache with the size and age limits disabled keeps the event cache but still expires snapshots', () => {
    const service = new DuckDbAuditQueryService(configStub({
      'auditQuery.sourceRoot': tmpRoot,
      'auditQuery.cacheMaxMb': 0,
      'auditQuery.cacheMaxAgeHours': 0,
      'cache.tmpDir': tmpRoot,
    }));

    service.evictCache();

    expect(readdirSync(join(
      tmpRoot,
      'snapshots',
    ))).toEqual([]);

    expect(readdirSync(join(
      tmpRoot,
      'audit-ev-v11',
    )).sort((
      left,
      right,
    ) => left.localeCompare(right))).toEqual([
      'fresh.parquet',
      'old.parquet',
    ]);
  });

  it('builds with no configuration at all and reports an empty scan history', async () => {
    const service = new DuckDbAuditQueryService(configStub({}));

    const stats = await service.scanStats();

    expect(stats.queries).toBe(0);
    expect(stats.cache_hit_rate).toBe(0);
    expect(stats.avg_materialize_ms).toBe(0);
    expect(await service.exportSnapshotCsv('not-a-token')).toBeNull();
  });
});

describe('DuckDbAuditQueryService — recent partitions with the default configuration', () => {
  let root: string;
  let service: DuckDbAuditQueryService;

  /** BRT wall clock (as the source writes it) of an instant `minutesAgo` before now. */
  const brtMinutesAgo = (minutesAgo: number): string => {
    return new Date(Date.now() - (180 + minutesAgo) * 60 * 1000).toISOString();
  };

  /** Hive partition path (UTC hour) of the current instant. */
  const currentHourPath = (): string => {
    const now = new Date();

    const month = String(now.getUTCMonth() + 1).padStart(
      2,
      '0',
    );

    const day = String(now.getUTCDate()).padStart(
      2,
      '0',
    );

    const hour = String(now.getUTCHours()).padStart(
      2,
      '0',
    );

    return `year=${now.getUTCFullYear()}/month=${month}/day=${day}/hour=${hour}`;
  };

  const recentWindow = (): AuditWindowInterface => ({
    from: new Date(Date.now() - 60 * 60 * 1000),
    to: null,
  });

  beforeAll(() => {
    root = mkdtempSync(join(
      tmpdir(),
      'atena-recent-',
    ));

    writeObject(
      join(
        root,
        currentHourPath(),
      ),
      'part.json.gz',
      [
        sourceRecord({
          campaign_id: 'req-now',
          status: 'queued',
          phone: '+5511900000020',
          client_id: '1001',
          provider_name: 'provider-c',
          processed_at: brtMinutesAgo(2),
        }),
        sourceRecord({
          campaign_id: 'req-now',
          status: 'delivered',
          phone: '+5511900000020',
          client_id: '1001',
          provider_name: 'provider-c',
          processed_at: brtMinutesAgo(1),
        }),
      ],
    );

    // Only the source and the cache dir are configured: everything else uses AUDIT_QUERY_DEFAULTS.
    service = new DuckDbAuditQueryService(configStub({
      'auditQuery.sourceRoot': `${root}/`,
      'cache.tmpDir': join(
        root,
        '.cache',
      ),
    }));
  });

  afterAll(() => {
    service.onModuleDestroy();
    removeTree(root);
  });

  it('a recent partition is read live once and then served from the short-lived cache', async () => {
    const first = await service.search(
      { window: recentWindow() },
      1,
      20,
    );

    const cachedBefore = (await service.scanStats()).partitions_cached;

    const second = await service.search(
      { window: recentWindow() },
      1,
      20,
    );

    const cachedAfter = (await service.scanStats()).partitions_cached;

    expect(first.total).toBe(1);
    expect(first.rows[0].finalStatus).toBe('delivered');
    expect(second.rows).toEqual(first.rows);
    expect(cachedAfter).toBeGreaterThan(cachedBefore);
  });

  it('search without a window scans the default window day by day and finds today’s send', async () => {
    const page = await service.search(
      {},
      1,
      20,
    );

    expect(page.total).toBe(1);
    expect(page.rows[0].correlationId).toBe('req-now');
  });

  it('with the live cache disabled every query re-reads the recent objects', async () => {
    const uncached = new DuckDbAuditQueryService(configStub({
      'auditQuery.sourceRoot': root,
      'auditQuery.liveCacheTtlSeconds': 0,
      'cache.tmpDir': join(
        root,
        '.cache-uncached',
      ),
    }));

    try {
      const first = await uncached.search(
        { window: recentWindow() },
        1,
        20,
      );

      const second = await uncached.search(
        { window: recentWindow() },
        1,
        20,
      );

      const stats = await uncached.scanStats();

      expect(first.total).toBe(1);
      expect(second.total).toBe(1);
      expect(stats.partitions_cached).toBe(0);
      expect(stats.s3_objects).toBe(2);
    }
    finally {
      uncached.onModuleDestroy();
    }
  });
});

describe('DuckDbAuditQueryService — settled partition reconciliation within the lag', () => {
  let root: string;
  let cacheRoot: string;
  let service: DuckDbAuditQueryService;

  const WINDOW: AuditWindowInterface = {
    from: new Date('2026-06-10T00:00:00Z'),
    to: new Date('2026-06-11T00:00:00Z'),
  };

  const partDir = (): string => join(
    root,
    'year=2026/month=06/day=10/hour=12',
  );

  const writeSend = (
    name: string,
    campaignId: string,
    phone: string,
  ): void => {
    writeObject(
      partDir(),
      name,
      [
        sourceRecord({
          campaign_id: campaignId,
          status: 'queued',
          phone,
          client_id: '9000',
          provider_name: 'provider-c',
          processed_at: '2026-06-10T12:00:00Z',
        }),
      ],
    );
  };

  /** Event-cache Parquets (`audit-ev-*`) currently on disk. */
  const evParquets = (): string[] => readdirSync(
    cacheRoot,
    { recursive: true },
  )
    .map(String)
    .filter((name) => name.includes('audit-ev-') && name.endsWith('.parquet'));

  const readManifest = (): {
    baseObjects: string[];
    shardObjects: string[];
    shardParquet: string | null
  } => {
    const found = readdirSync(
      cacheRoot,
      { recursive: true },
    )
      .map(String)
      .find((name) => name.endsWith('.manifest')) ?? '';

    return JSON.parse(readFileSync(
      join(
        cacheRoot,
        found,
      ),
      'utf8',
    )) as ReturnType<typeof readManifest>;
  };

  const phones = async (): Promise<string[]> => {
    const page = await service.search(
      { window: WINDOW },
      1,
      20,
    );

    return page.rows.map((row) => row.phoneE164).sort((
      left,
      right,
    ) => left.localeCompare(right));
  };

  beforeAll(() => {
    root = mkdtempSync(join(
      tmpdir(),
      'atena-reconcile-',
    ));

    cacheRoot = join(
      root,
      '.cache',
    );

    writeSend(
      'a.json.gz',
      'req-a',
      '+5511900000030',
    );

    service = new DuckDbAuditQueryService(configStub({
      'auditQuery.sourceRoot': root,
      'auditQuery.cacheSettleMinutes': 0,
      'auditQuery.lateStatusBufferHours': 0,
      // "Infinite" lag → a settled partition is always reconciled by LIST.
      'auditQuery.lagHours': 24 * 365 * 100,
      'cache.tmpDir': cacheRoot,
    }));
  });

  afterAll(() => {
    service.onModuleDestroy();
    removeTree(root);
  });

  it('keeps serving the cache when the LIST comes back empty (transient source outage)', async () => {
    expect(await phones()).toEqual(['5511900000030']);

    removeTree(partDir());

    expect(await phones()).toEqual(['5511900000030']);

    writeSend(
      'a.json.gz',
      'req-a',
      '+5511900000030',
    );
  });

  it('a second late object replaces the previous shard instead of stacking shards', async () => {
    writeSend(
      'b.json.gz',
      'req-b',
      '+5511900000031',
    );

    await phones();

    writeSend(
      'c.json.gz',
      'req-c',
      '+5511900000032',
    );

    expect(await phones()).toEqual([
      '5511900000030',
      '5511900000031',
      '5511900000032',
    ]);

    const manifest = readManifest();

    expect(manifest.shardObjects).toHaveLength(2);
    expect(evParquets()).toHaveLength(2); // base + the single current shard
  });

  it('an object removed from the source triggers a full rewrite of the partition cache', async () => {
    rmSync(join(
      partDir(),
      'a.json.gz',
    ));

    expect(await phones()).toEqual([
      '5511900000031',
      '5511900000032',
    ]);

    const manifest = readManifest();

    expect(manifest.baseObjects).toHaveLength(2);
    expect(manifest.shardParquet).toBeNull();
    expect(evParquets()).toHaveLength(1); // the previous base and shard are gone
  });

  it('a corrupted manifest is treated as a cold partition and rebuilt from the source', async () => {
    const manifestName = readdirSync(
      cacheRoot,
      { recursive: true },
    )
      .map(String)
      .find((name) => name.endsWith('.manifest')) ?? '';

    writeFileSync(
      join(
        cacheRoot,
        manifestName,
      ),
      '{ not json',
    );

    expect(await phones()).toEqual([
      '5511900000031',
      '5511900000032',
    ]);

    expect(readManifest().baseObjects).toHaveLength(2);
  });
});

describe('DuckDbAuditQueryService — parallel prefetch of S3 objects (mocked S3 client)', () => {
  let root: string;

  const BUCKET = 'atena-logs';
  const PARTITION = 'year=2026/month=06/day=17/hour=15';

  const WINDOW: AuditWindowInterface = {
    from: new Date('2026-06-17T15:00:00Z'),
    to: new Date('2026-06-17T15:30:00Z'),
  };

  /** Gzipped object with one queued send (BRT 12:00 = 15:00Z, inside WINDOW). */
  const objectBytes = (campaignId: string): Buffer => gzipSync(Buffer.from(`${sourceRecord({
    campaign_id: campaignId,
    status: 'queued',
    phone: '+5511900000040',
    client_id: '1001',
    provider_name: 'provider-c',
    processed_at: '2026-06-17T12:00:00Z',
  })}\n`));

  interface PrefetchHarnessInterface {
    service: DuckDbAuditQueryService;
    send: jest.Mock;
    prefetchDir: string;
  }

  /**
   * Service over a local root whose LIST is replaced by two `s3://` URLs and whose S3 client is a
   * stub — the S3 boundary is the only thing faked; DuckDB reads the prefetched local copies.
   */
  const harness = (send: jest.Mock): PrefetchHarnessInterface => {
    const tmpDir = join(
      root,
      `.cache-${randomUUID()}`,
    );

    const service = new DuckDbAuditQueryService(configStub({
      'auditQuery.sourceRoot': root,
      'auditQuery.cacheSettleMinutes': 0,
      'auditQuery.lateStatusBufferHours': 0,
      'auditQuery.prefetchConcurrency': 4,
      'cache.tmpDir': tmpDir,
    }));

    const internals = service as unknown as {
      s3: { send: jest.Mock };
      expandPartition: () => Promise<string[]>;
    };

    internals.s3 = { send };

    jest.spyOn(
      internals,
      'expandPartition',
    ).mockResolvedValue([
      `s3://${BUCKET}/${PARTITION}/a.json.gz`,
      `s3://${BUCKET}/${PARTITION}/b.json.gz`,
    ]);

    return {
      service,
      send,
      prefetchDir: join(
        tmpDir,
        'prefetch',
      ),
    };
  };

  beforeAll(() => {
    root = mkdtempSync(join(
      tmpdir(),
      'atena-prefetch-',
    ));
  });

  afterAll(() => {
    removeTree(root);
  });

  it('downloads every object of a cold partition in parallel and reads the local copies', async () => {
    const send = jest.fn((command: { input: { Key: string } }) => Promise.resolve({
      Body: {
        transformToByteArray: () => Promise.resolve(new Uint8Array(objectBytes(command.input.Key.endsWith('a.json.gz')
          ? 'req-a'
          : 'req-b'))),
      },
    }));

    const {
      service,
      prefetchDir,
    } = harness(send);

    try {
      const page = await service.search(
        { window: WINDOW },
        1,
        20,
      );

      const keys = send.mock.calls.map(([command]) => command.input);

      expect(page.rows.map((row) => row.correlationId).sort((
        left,
        right,
      ) => (left ?? '').localeCompare(right ?? ''))).toEqual([
        'req-a',
        'req-b',
      ]);

      expect(keys).toEqual(expect.arrayContaining([
        {
          Bucket: BUCKET,
          Key: `${PARTITION}/a.json.gz`,
        },
        {
          Bucket: BUCKET,
          Key: `${PARTITION}/b.json.gz`,
        },
      ]));

      // The per-batch download dir is removed once the cache Parquet is written.
      expect(readdirSync(prefetchDir)).toEqual([]);
    }
    finally {
      service.onModuleDestroy();
    }
  });

  it('an S3 object without a body fails the query with its name and leaves no batch behind', async () => {
    const send = jest.fn().mockResolvedValue({});

    const {
      service,
      prefetchDir,
    } = harness(send);

    try {
      await expect(service.search(
        { window: WINDOW },
        1,
        20,
      )).rejects.toThrow('S3 object without a body: s3://');

      expect(readdirSync(prefetchDir)).toEqual([]);
    }
    finally {
      service.onModuleDestroy();
    }
  });

  it('a failed download fails the query and leaves no partial batch behind', async () => {
    const send = jest.fn().mockRejectedValue(new Error('S3 unavailable'));

    const {
      service,
      prefetchDir,
    } = harness(send);

    try {
      await expect(service.search(
        { window: WINDOW },
        1,
        20,
      )).rejects.toThrow('S3 unavailable');

      expect(readdirSync(prefetchDir)).toEqual([]);
    }
    finally {
      service.onModuleDestroy();
    }
  });
});

describe('DuckDbAuditQueryService — S3 source bootstrap (fake DuckDB instance)', () => {
  let tmpRoot: string;

  afterEach(() => {
    jest.restoreAllMocks();
    removeTree(tmpRoot);
  });

  it('an s3:// source (from the logs bucket) loads httpfs/aws once and creates the credential-chain secret', async () => {
    tmpRoot = mkdtempSync(join(
      tmpdir(),
      'atena-s3boot-',
    ));

    const run = jest.fn().mockResolvedValue(undefined);
    const runAndReadAll = jest.fn().mockResolvedValue({ getRowObjectsJS: () => [] });

    const connection = {
      run,
      runAndReadAll,
      closeSync: jest.fn(),
    };

    const instance = {
      connect: jest.fn().mockResolvedValue(connection),
      closeSync: jest.fn(),
    };

    const create = jest.spyOn(
      DuckDBInstance,
      'create',
    ).mockResolvedValue(instance as unknown as DuckDBInstance);

    const service = new DuckDbAuditQueryService(configStub({
      's3.logsBucket': 'atena-logs',
      'aws.region': 'sa-east-1',
      'cache.tmpDir': tmpRoot,
    }));

    const token = randomUUID();

    const snapshot = join(
      tmpRoot,
      'snapshots',
      `${token}.parquet`,
    );

    mkdirSync(
      join(
        tmpRoot,
        'snapshots',
      ),
      { recursive: true },
    );

    writeFileSync(
      snapshot,
      '',
    );

    const first = await service.exportSnapshotCsv(token);
    const second = await service.exportSnapshotCsv(token);

    service.onModuleDestroy();

    expect(create).toHaveBeenCalledTimes(1);

    expect(run.mock.calls.map(([sql]) => sql as string)).toEqual([
      'INSTALL httpfs; LOAD httpfs;',
      'INSTALL aws; LOAD aws;',
      expect.stringContaining("PROVIDER credential_chain, REGION 'sa-east-1'") as unknown as string,
    ]);

    expect(runAndReadAll).toHaveBeenCalledWith(
      expect.stringContaining(`read_parquet('${snapshot}')`),
      [],
    );

    expect(first).toMatch(/exports\/messages-[0-9a-f-]{36}\.csv$/);
    expect(second).not.toBe(first);
    expect(connection.closeSync).toHaveBeenCalledTimes(3);
    expect(instance.closeSync).toHaveBeenCalledTimes(1);
  });
});
