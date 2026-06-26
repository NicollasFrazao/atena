import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConfigService } from '@nestjs/config';
import type { AuditWindowInterface } from './audit-query.types';
import { DuckDbAuditQueryService } from './duckdb-audit-query.service';

// DuckDB + carregamento de extensão + materialização fazem I/O real; sob o run paralelo o timeout
// padrão (5s) fica apertado. Margem generosa evita flake (não muda a semântica dos testes).
jest.setTimeout(30000);

/**
 * Um registro do **detailed report** (`example-sms-delivery-reports`): flat, uma linha por transição de status.
 * `error` é o objeto serializado (`BaseError.toJSON()`) nas falhas, ou `null`.
 */
function detailedRecord(input: {
  campaign_id: string;
  status: string;
  phone: string;
  client_id: string;
  provider_name: string;
  processed_at: string;
  campaign_type?: string;
  provider_code?: string;
  app_id?: string;
  error?: Record<string, unknown> | null;
}): string {
  return JSON.stringify({
    campaign_id: input.campaign_id,
    campaign_type: input.campaign_type ?? 'sms',
    client_id: input.client_id,
    app_id: input.app_id ?? null,
    source: 'api',
    status: input.status,
    phone: input.phone,
    message: 'x',
    credits_required: 1,
    sent_at: '2026-06-17',
    processed_at: input.processed_at,
    provider_name: input.provider_name,
    provider_code: input.provider_code ?? null,
    error: input.error ?? null,
  });
}

/** ConfigService stub que devolve a config injetada por chave. */
function configStub(values: Record<string, unknown>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

const WINDOW: AuditWindowInterface = {
  from: new Date('2026-06-17T00:00:00Z'),
  to: new Date('2026-06-18T00:00:00Z'),
};

describe('DuckDbAuditQueryService (fixture local — detailed report)', () => {
  let root: string;
  let service: DuckDbAuditQueryService;

  beforeAll(() => {
    root = mkdtempSync(join(
      tmpdir(),
      'atena-audit-',
    ));

    const dir = join(
      root,
      'year=2026/month=06/day=17/hour=15',
    );

    mkdirSync(
      dir,
      { recursive: true },
    );

    const lines = [
      // C1 (req-1, sinch): queued -> sent -> delivered => delivered
      detailedRecord({
        campaign_id: 'req-1',
        status: 'queued',
        phone: '+5511900000001',
        client_id: '1001',
        provider_name: 'sinch',
        processed_at: '2026-06-17T15:00:00Z',
      }),
      detailedRecord({
        campaign_id: 'req-1',
        status: 'sent',
        phone: '+5511900000001',
        client_id: '1001',
        provider_name: 'sinch',
        processed_at: '2026-06-17T15:00:30Z',
      }),
      detailedRecord({
        campaign_id: 'req-1',
        status: 'delivered',
        phone: '+5511900000001',
        client_id: '1001',
        provider_name: 'sinch',
        processed_at: '2026-06-17T15:02:00Z',
      }),
      // C2 (req-2, sinch): queued -> bounce => failed (error_hint 'bounce')
      detailedRecord({
        campaign_id: 'req-2',
        status: 'queued',
        phone: '+5511900000002',
        client_id: '1001',
        provider_name: 'sinch',
        processed_at: '2026-06-17T15:00:00Z',
      }),
      detailedRecord({
        campaign_id: 'req-2',
        status: 'bounce',
        phone: '+5511900000002',
        client_id: '1001',
        provider_name: 'sinch',
        provider_code: '21211',
        error: {
          name: 'SmsStatusError',
          message: "[sinch] SMS reported as 'bounce'",
        },
        processed_at: '2026-06-17T15:05:00Z',
      }),
      // C3 (req-3, twilio): só queued => pending
      detailedRecord({
        campaign_id: 'req-3',
        status: 'queued',
        phone: '+5511900000003',
        client_id: '9001',
        provider_name: 'twilio',
        processed_at: '2026-06-17T15:03:00Z',
      }),
      // C4 (req-4, sinch): queued -> request_error => failed (error_hint 'request_error')
      detailedRecord({
        campaign_id: 'req-4',
        status: 'queued',
        phone: '+5511900000004',
        client_id: '9001',
        provider_name: 'sinch',
        processed_at: '2026-06-17T15:00:00Z',
      }),
      detailedRecord({
        campaign_id: 'req-4',
        status: 'request_error',
        phone: '+5511900000004',
        client_id: '9001',
        provider_name: 'sinch',
        provider_code: '403',
        error: {
          name: 'SmsProcessingError',
          message: 'Failed to send SMS message',
        },
        processed_at: '2026-06-17T15:01:00Z',
      }),
      // C5 (req-5, sms_flash/flashsms): canal sms_flash => INCLUÍDO (decisão revista 2026-06-25: cobre Flash)
      detailedRecord({
        campaign_id: 'req-5',
        campaign_type: 'sms_flash',
        status: 'delivered',
        phone: '+5511900000009',
        client_id: '9001',
        provider_name: 'flashsms',
        app_id: 'app-flash-1',
        processed_at: '2026-06-17T15:00:00Z',
      }),
    ];

    writeFileSync(
      join(
        dir,
        'part.json.gz',
      ),
      gzipSync(Buffer.from(`${lines.join('\n')}\n`)),
    );

    service = new DuckDbAuditQueryService(configStub({
      'auditQuery.sourceRoot': root,
      'auditQuery.defaultWindowDays': 30,
      'auditQuery.cacheSettleMinutes': 0,
      // buffer 0 no fixture: o dado está numa única partição (settled) — evita varrer 48h de
      // partições-hora vazias (mais rápido e sem flake de timeout no run paralelo).
      'auditQuery.lateStatusBufferHours': 0,
      'cache.tmpDir': join(
        root,
        '.cache',
      ),
      's3.logsBucket': '',
      'aws.region': 'us-east-1',
    }));
  });

  afterAll(() => {
    service.onModuleDestroy();

    rmSync(
      root,
      {
        recursive: true,
        force: true,
      },
    );
  });

  it('search: desfecho terminal por campaign_id (delivered/failed/pending); sms_flash INCLUÍDO + canal/app_id', async () => {
    const page = await service.search(
      { window: WINDOW },
      1,
      20,
    );

    expect(page.total).toBe(5); // C1..C4 (sms) + C5 (sms_flash) — Flash agora entra

    const byPhone = Object.fromEntries(page.rows.map((row) => [
      row.phoneE164,
      row,
    ]));

    // phone é normalizado p/ só dígitos na ingestão (EV_PROJECTION) — chaves sem o '+'.
    expect(byPhone['5511900000001'].finalStatus).toBe('delivered');
    expect(byPhone['5511900000001'].channel).toBe('sms');
    expect(byPhone['5511900000002'].finalStatus).toBe('failed');
    expect(byPhone['5511900000002'].errorHint).toBe('bounce');
    expect(byPhone['5511900000003'].finalStatus).toBe('pending');
    expect(byPhone['5511900000004'].finalStatus).toBe('failed');
    expect(byPhone['5511900000004'].errorHint).toBe('request_error');
    // C5 (SMS Flash): canal + app_id discriminados.
    expect(byPhone['5511900000009'].finalStatus).toBe('delivered');
    expect(byPhone['5511900000009'].channel).toBe('sms_flash');
    expect(byPhone['5511900000009'].appId).toBe('app-flash-1');
  });

  it('search: reporta o progresso da materialização (mapping → … → querying)', async () => {
    const phases: string[] = [];

    await service.search(
      { window: WINDOW },
      1,
      20,
      (event) => phases.push(event.phase),
    );

    expect(phases[0]).toBe('mapping');
    expect(phases).toContain('querying');

    expect(phases.every((phase) => [
      'mapping',
      'reading',
      'querying',
    ].includes(phase))).toBe(true);
  });

  it('search por correlation_id (campaign_id) devolve o destinatário daquela campanha', async () => {
    const page = await service.search(
      {
        window: WINDOW,
        correlationId: 'req-2',
      },
      1,
      20,
    );

    expect(page.total).toBe(1);
    expect(page.rows[0].phoneE164).toBe('5511900000002');
  });

  it('search por telefone SEM DDI casa por sufixo (tolerante a DDI)', async () => {
    // O fixture grava 5511900000001; buscar sem o `55` (11 dígitos) deve achar via sufixo.
    const page = await service.search(
      {
        window: WINDOW,
        phone: '11900000001',
      },
      1,
      20,
    );

    expect(page.total).toBe(1);
    expect(page.rows[0].phoneE164).toBe('5511900000001');
  });

  it('search por telefone COM DDI completo (formatado) continua casando', async () => {
    const page = await service.search(
      {
        window: WINDOW,
        phone: '+55 11 90000-0002',
      },
      1,
      20,
    );

    expect(page.total).toBe(1);
    expect(page.rows[0].phoneE164).toBe('5511900000002');
  });

  it('search por fragmento curto NÃO casa por sufixo (guarda de tamanho mínimo)', async () => {
    const page = await service.search(
      {
        window: WINDOW,
        phone: '0001',
      },
      1,
      20,
    );

    expect(page.total).toBe(0);
  });

  it('deliveryReport: totais por desfecho terminal', async () => {
    const report = await service.deliveryReport({ window: WINDOW });

    expect(report.totals).toEqual({
      sent: 5, // C1..C4 (sms) + C5 (sms_flash, delivered)
      delivered: 2, // C1 (sms) + C5 (sms_flash)
      failed: 2,
      pending: 1,
    });

    const sinch = report.byProvider.find((row) => row.name === 'sinch');
    expect(sinch?.sent).toBe(3); // C1, C2, C4
    expect(sinch?.delivered).toBe(1); // C1

    const flashsms = report.byProvider.find((row) => row.name === 'flashsms');
    expect(flashsms?.sent).toBe(1); // C5 (sms_flash)
    expect(flashsms?.delivered).toBe(1);

    expect(report.topErrors.map((row) => row.code).sort()).toEqual([
      'bounce',
      'request_error',
    ]);
  });

  it('distinctProviders: distintos e ordenados', async () => {
    const providers = await service.distinctProviders(WINDOW);

    expect(providers).toEqual([
      'sinch',
      'twilio',
      'flashsms', // C5 (sms_flash) agora entra
    ]);
  });

  it('distinctCustomers: top-N por volume + total distinto', async () => {
    const {
      items,
      total,
    } = await service.distinctCustomers(WINDOW);

    // Fixture tem 2 clientes na janela (1001, 9001); o cliente 9001 abrange sms e sms_flash (C5).
    expect(total).toBe(2);

    expect([...items].sort()).toEqual([
      '1001',
      '9001',
    ]);
  });

  it('distinctCustomers: search filtra por match parcial (total reflete o filtro)', async () => {
    const {
      items,
      total,
    } = await service.distinctCustomers(
      WINDOW,
      '1001',
    );

    expect(total).toBe(1);
    expect(items).toEqual(['1001']);
  });

  it('terminalSamples: delivered/failed (exclui pending)', async () => {
    const samples = await service.terminalSamples(WINDOW);

    expect(samples).toHaveLength(4); // C1 + C5 delivered; C2 + C4 failed (C3 pending excluído)

    expect(samples.map((sample) => sample.finalStatus).sort()).toEqual([
      'delivered',
      'delivered',
      'failed',
      'failed',
    ]);
  });

  it('getTrail: timeline de status (queued → webhook_status; sent → provider_attempt; delivered → final)', async () => {
    const page = await service.search(
      { window: WINDOW },
      1,
      20,
    );

    const c1 = page.rows.find((row) => row.phoneE164 === '5511900000001');

    const trail = await service.getTrail(
      c1?.id ?? '',
      WINDOW,
    );

    expect(trail).not.toBeNull();
    expect(trail?.record.finalStatus).toBe('delivered');

    const types = (trail?.events ?? []).map((event) => event.type);
    expect(types).toContain('final'); // delivered
    expect(types).toContain('webhook_status'); // queued
    expect(types).toContain('provider_attempt'); // sent = tentativa
    expect(trail?.events.length).toBeGreaterThanOrEqual(3); // queued + sent + delivered
  });

  it('cache /tmp: serve a partição settled do Parquet mesmo sem a fonte', async () => {
    rmSync(
      join(
        root,
        'year=2026/month=06/day=17/hour=15',
      ),
      {
        recursive: true,
        force: true,
      },
    );

    const page = await service.search(
      { window: WINDOW },
      1,
      20,
    );

    expect(page.total).toBe(5);
  });
});

/**
 * Regressão do COLAPSO do `requested_at` (fix do scan simétrico): um envio cujo `queued` é de um dia
 * mas cujo DESFECHO cruza a meia-noite para o dia seguinte NÃO pode aparecer na busca (send-based) do
 * dia do desfecho — o `requested_at` deve refletir o `queued` real, não colapsar pro desfecho. Exige
 * `lateStatusBufferHours > 0` (o materialize alarga o scan pra trás e captura o `queued`).
 */
describe('DuckDbAuditQueryService — scan simétrico (colapso do requested_at)', () => {
  let root: string;
  let service: DuckDbAuditQueryService;

  const LATE = 'req-late'; // queued 16/06 23:30 → bounce 17/06 15:00 (cruza a meia-noite)
  const CLEAN = 'req-clean'; // queued + delivered ambos em 17/06 (controle)

  const writePartition = (
    partition: string,
    lines: string[],
  ): void => {
    const dir = join(
      root,
      partition,
    );

    mkdirSync(
      dir,
      { recursive: true },
    );

    writeFileSync(
      join(
        dir,
        'part.json.gz',
      ),
      gzipSync(Buffer.from(`${lines.join('\n')}\n`)),
    );
  };

  beforeAll(() => {
    root = mkdtempSync(join(
      tmpdir(),
      'atena-audit-sym-',
    ));

    // processed_at é gravado em BRT e o motor soma +3h → UTC. Os valores abaixo são escolhidos para
    // que, APÓS o +3h, o queued do LATE caia em 16/06 23:00 UTC (véspera) e o resto em 17/06 UTC.
    writePartition(
      'year=2026/month=06/day=16/hour=23',
      [detailedRecord({
        campaign_id: LATE,
        status: 'queued',
        phone: '+5511900000010',
        client_id: '1001',
        provider_name: 'sinch',
        processed_at: '2026-06-16T20:00:00Z', // +3h → 16/06 23:00 UTC (véspera do dia 17)
      })],
    );

    writePartition(
      'year=2026/month=06/day=17/hour=15',
      [
        detailedRecord({
          campaign_id: LATE,
          status: 'bounce',
          phone: '+5511900000010',
          client_id: '1001',
          provider_name: 'sinch',
          provider_code: '21211',
          processed_at: '2026-06-17T12:00:00Z', // +3h → 17/06 15:00 UTC (desfecho no dia 17)
        }),
        detailedRecord({
          campaign_id: CLEAN,
          status: 'queued',
          phone: '+5511900000011',
          client_id: '1001',
          provider_name: 'sinch',
          processed_at: '2026-06-17T12:00:00Z', // +3h → 17/06 15:00 UTC
        }),
        detailedRecord({
          campaign_id: CLEAN,
          status: 'delivered',
          phone: '+5511900000011',
          client_id: '1001',
          provider_name: 'sinch',
          processed_at: '2026-06-17T12:01:00Z', // +3h → 17/06 15:01 UTC
        }),
      ],
    );

    service = new DuckDbAuditQueryService(configStub({
      'auditQuery.sourceRoot': root,
      'auditQuery.defaultWindowDays': 30,
      'auditQuery.cacheSettleMinutes': 0,
      // 48h: o materialize alarga o scan pra TRÁS e captura o `queued` de 16/06.
      'auditQuery.lateStatusBufferHours': 48,
      'cache.tmpDir': join(
        root,
        '.cache',
      ),
      's3.logsBucket': '',
      'aws.region': 'us-east-1',
    }));
  });

  afterAll(() => {
    service.onModuleDestroy();

    rmSync(
      root,
      {
        recursive: true,
        force: true,
      },
    );
  });

  const DAY_17: AuditWindowInterface = {
    from: new Date('2026-06-17T00:00:00Z'),
    to: new Date('2026-06-18T00:00:00Z'),
  };

  const DAY_16: AuditWindowInterface = {
    from: new Date('2026-06-16T00:00:00Z'),
    to: new Date('2026-06-17T00:00:00Z'),
  };

  it('busca por ENVIO no 17/06: NÃO inclui o envio de 16/06 que só finalizou no 17 (sem colapso)', async () => {
    const page = await service.search(
      { window: DAY_17 },
      1,
      20,
    );

    const ids = page.rows.map((row) => row.correlationId);

    expect(ids).toContain(CLEAN);
    expect(ids).not.toContain(LATE);
    expect(page.total).toBe(1);
  });

  it('busca por ENVIO no 16/06: inclui o envio com requested_at do queued (não colapsa pro desfecho do 17)', async () => {
    const page = await service.search(
      { window: DAY_16 },
      1,
      20,
    );

    const late = page.rows.find((row) => row.correlationId === LATE);

    expect(late).toBeDefined();
    expect(late?.requestedAt.toISOString()).toBe('2026-06-16T23:00:00.000Z');
  });

  // O `recordCache` quente (aquecido pelas buscas acima) mascararia o efeito do `expand` no getShipping
  // → cada teste de expand usa um serviço RECÉM-criado (cache frio) sobre a MESMA fixture/partições.
  const freshService = (): DuckDbAuditQueryService => new DuckDbAuditQueryService(configStub({
    'auditQuery.sourceRoot': root,
    'auditQuery.defaultWindowDays': 30,
    'auditQuery.cacheSettleMinutes': 0,
    'auditQuery.lateStatusBufferHours': 48,
    'cache.tmpDir': join(
      root,
      '.cache',
    ),
    's3.logsBucket': '',
    'aws.region': 'us-east-1',
  }));

  // Grão do destinatário LATE: md5(campaign_id || '|' || phone só-dígitos) — espelha o `id` que a SQL
  // de produção computa (não é hash de segurança; é a chave estável do destinatário).
  // eslint-disable-next-line sonarjs/hashing -- md5 reproduz o grão (id) do registro, não PII/segredo
  const LATE_ID = createHash('md5')
    .update(`${LATE}|5511900000010`)
    .digest('hex');

  it('getShipping(expand:false): leitura fria ESTREITA — acha o telefone pelo queued do 16/06, SEM o desfecho do 17/06', async () => {
    const svc = freshService();

    try {
      const record = await svc.getShipping(
        LATE_ID,
        DAY_16,
        false,
      );

      expect(record).not.toBeNull();
      expect(record?.phoneE164).toBeTruthy();
      // O bounce do 17/06 está FORA da janela do 16/06 e o buffer NÃO foi aplicado (expand:false) → o
      // registro reflete só o `queued` (não-terminal). Prova que o scan ficou em ~1 dia (não ±48h).
      expect(record?.finalStatus).toBe('pending');
    }
    finally {
      svc.onModuleDestroy();
    }
  });

  it('getShipping(expand:true): janela AMPLA — o buffer ±48h alcança o bounce do 17/06 (desfecho terminal)', async () => {
    const svc = freshService();

    try {
      const record = await svc.getShipping(
        LATE_ID,
        DAY_16,
        true,
      );

      expect(record?.phoneE164).toBeTruthy();
      // Mesmo id, mesma janela do 16/06: com a expansão, o desfecho do dia seguinte é capturado.
      expect(record?.finalStatus).toBe('failed');
    }
    finally {
      svc.onModuleDestroy();
    }
  });
});
