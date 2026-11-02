import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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

/** Alphabetical comparator for `sort` (the default sort compares UTF-16 code units). */
function byText(
  left: string,
  right: string,
): number {
  return left.localeCompare(right);
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
      // C5 (req-5, sms_flash/zapsms): canal sms_flash => INCLUÍDO (decisão revista 2026-06-25: cobre Flash).
      // queued -> delivered (envio real sempre tem o queued; requested_at vem dele).
      detailedRecord({
        campaign_id: 'req-5',
        campaign_type: 'sms_flash',
        status: 'queued',
        phone: '+5511900000009',
        client_id: '9001',
        provider_name: 'zapsms',
        app_id: 'app-flash-1',
        processed_at: '2026-06-17T14:59:00Z',
      }),
      detailedRecord({
        campaign_id: 'req-5',
        campaign_type: 'sms_flash',
        status: 'delivered',
        phone: '+5511900000009',
        client_id: '9001',
        provider_name: 'zapsms',
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
    expect(byPhone['5511900000002'].finalStatus).toBe('blocked'); // bounce = bloqueio do controle de entrega
    expect(byPhone['5511900000002'].errorHint).toBeNull(); // bloqueado não é erro
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
      failed: 1, // C4 (request_error)
      blocked: 1, // C2 (bounce = bloqueio do controle de entrega, não falha)
      pending: 1, // C3
    });

    const sinch = report.byProvider.find((row) => row.name === 'sinch');
    expect(sinch?.sent).toBe(3); // C1, C2, C4
    expect(sinch?.delivered).toBe(1); // C1

    const zapsms = report.byProvider.find((row) => row.name === 'zapsms');
    expect(zapsms?.sent).toBe(1); // C5 (sms_flash)
    expect(zapsms?.delivered).toBe(1);

    expect(report.topErrors.map((row) => row.code).sort(byText)).toEqual([
      'request_error', // bounce virou 'blocked' → sai do top de erros
    ]);
  });

  it('distinctProviders: distintos e ordenados', async () => {
    const providers = await service.distinctProviders(WINDOW);

    expect(providers).toEqual([
      'sinch',
      'twilio',
      'zapsms', // C5 (sms_flash) agora entra
    ]);
  });

  it('distinctCustomers: top-N por volume + total distinto', async () => {
    const {
      items,
      total,
    } = await service.distinctCustomers(WINDOW);

    // Fixture tem 2 clientes na janela (1001, 9001); o cliente 9001 abrange sms e sms_flash (C5).
    expect(total).toBe(2);

    expect([...items].sort(byText)).toEqual([
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

    expect(samples).toHaveLength(3); // C1 + C5 delivered; C4 failed (C2 bounce→blocked e C3 pending excluídos)

    expect(samples.map((sample) => sample.finalStatus).sort(byText)).toEqual([
      'delivered',
      'delivered',
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
 * Send-based através da meia-noite: um envio cujo `queued` é de um dia mas cujo DESFECHO cruza para o
 * dia seguinte aparece SÓ na busca do dia do `queued` (o `requested_at` vem do evento `queued` real,
 * nunca do desfecho). O buffer (só pra frente) garante que o desfecho do dia seguinte seja alcançado
 * a partir do dia do envio.
 */
describe('DuckDbAuditQueryService — send-based através da meia-noite (buffer só pra frente)', () => {
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
      // 48h pra FRENTE: a busca do dia 16 alcança o desfecho do dia 17 (o `queued` já está no dia 16).
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
      // registro reflete só o `queued` (não-terminal). Prova que o scan ficou em ~1 dia (sem buffer).
      expect(record?.finalStatus).toBe('pending');
    }
    finally {
      svc.onModuleDestroy();
    }
  });

  it('getShipping(expand:true): janela AMPLA — o buffer +48h (pra frente) alcança o bounce do 17/06 (desfecho terminal)', async () => {
    const svc = freshService();

    try {
      const record = await svc.getShipping(
        LATE_ID,
        DAY_16,
        true,
      );

      expect(record?.phoneE164).toBeTruthy();
      // Mesmo id, mesma janela do 16/06: com a expansão, o desfecho do dia seguinte é capturado.
      // O desfecho é um `bounce` → classificado como 'blocked' (bloqueio do controle de entrega).
      expect(record?.finalStatus).toBe('blocked');
    }
    finally {
      svc.onModuleDestroy();
    }
  });
});

/**
 * Redesenho send-based ESTRITO: `requested_at` vem do evento `queued` (senão NULL → fora da janela),
 * `finalized_at` vem do PRÓPRIO desfecho (delivered ou última falha) — não de um max sobre tudo. E a
 * reconciliação por lag: objeto que chega DEPOIS do settle não pode ficar faltando.
 */
describe('DuckDbAuditQueryService — send-based estrito + reconciliação de cache (lag)', () => {
  let root: string;
  let dir: string;
  let service: DuckDbAuditQueryService;

  const SEND_WINDOW: AuditWindowInterface = {
    from: new Date('2026-06-10T00:00:00Z'),
    to: new Date('2026-06-11T00:00:00Z'),
  };

  beforeAll(() => {
    root = mkdtempSync(join(
      tmpdir(),
      'atena-sendbased-',
    ));

    dir = join(
      root,
      'year=2026/month=06/day=10/hour=12',
    );

    mkdirSync(
      dir,
      { recursive: true },
    );

    const lines = [
      // R1: queued -> delivered (normal).
      detailedRecord({
        campaign_id: 'req-a',
        status: 'queued',
        phone: '+5511900000010',
        client_id: '7000',
        provider_name: 'sinch',
        processed_at: '2026-06-10T12:00:00Z',
      }),
      detailedRecord({
        campaign_id: 'req-a',
        status: 'delivered',
        phone: '+5511900000010',
        client_id: '7000',
        provider_name: 'sinch',
        processed_at: '2026-06-10T12:05:00Z',
      }),
      // R2: SÓ delivered (sem queued) → requested_at NULL → fora da busca send-based.
      detailedRecord({
        campaign_id: 'req-b',
        status: 'delivered',
        phone: '+5511900000011',
        client_id: '7000',
        provider_name: 'sinch',
        processed_at: '2026-06-10T12:10:00Z',
      }),
      // Rprec: queued -> delivered -> bounce TARDIO → finalized_at deve ser o do DELIVERED, não o do bounce.
      detailedRecord({
        campaign_id: 'req-c',
        status: 'queued',
        phone: '+5511900000012',
        client_id: '7000',
        provider_name: 'sinch',
        processed_at: '2026-06-10T12:00:00Z',
      }),
      detailedRecord({
        campaign_id: 'req-c',
        status: 'delivered',
        phone: '+5511900000012',
        client_id: '7000',
        provider_name: 'sinch',
        processed_at: '2026-06-10T12:05:00Z',
      }),
      detailedRecord({
        campaign_id: 'req-c',
        status: 'bounce',
        phone: '+5511900000012',
        client_id: '7000',
        provider_name: 'sinch',
        provider_code: '21211',
        error: {
          name: 'SmsStatusError',
          message: 'late bounce',
        },
        processed_at: '2026-06-10T12:09:00Z',
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
      'auditQuery.cacheSettleMinutes': 0, // partição já fechada → settled (cacheável).
      'auditQuery.lateStatusBufferHours': 0, // dado numa só partição.
      'auditQuery.lagHours': 24 * 365 * 100, // lag "infinito" → settled é SEMPRE reconciliada por LIST.
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

  it('#3 envio SEM queued fica fora (requested_at vem do queued, senão NULL)', async () => {
    const page = await service.search(
      { window: SEND_WINDOW },
      1,
      20,
    );

    const phones = page.rows.map((row) => row.phoneE164);

    expect(phones).toContain('5511900000010'); // R1 tem queued
    expect(phones).toContain('5511900000012'); // Rprec tem queued
    expect(phones).not.toContain('5511900000011'); // R2 sem queued → fora
    expect(page.total).toBe(2);
  });

  it('#3 finalized_at vem do DELIVERED, não do último terminal (bounce tardio)', async () => {
    const page = await service.search(
      { window: SEND_WINDOW },
      1,
      20,
    );

    const rprec = page.rows.find((row) => row.phoneE164 === '5511900000012');

    expect(rprec?.finalStatus).toBe('delivered');
    // delivered raw 12:05 (+3h BRT→UTC) = 15:05 — NÃO o bounce de 12:09 (=15:09).
    expect(rprec?.finalizedAt?.toISOString()).toBe('2026-06-10T15:05:00.000Z');
    // requested_at = queued 12:00 (+3h) = 15:00.
    expect(rprec?.requestedAt.toISOString()).toBe('2026-06-10T15:00:00.000Z');
  });

  it('#5 objeto que chega DEPOIS do settle é relido (reconciliação por LIST — não fica faltando)', async () => {
    const before = await service.search(
      { window: SEND_WINDOW },
      1,
      20,
    );

    expect(before.total).toBe(2); // partição cacheada + sidecar de impressão gravado.

    // Lag do detailed report: chega um novo objeto na MESMA partição (novo destinatário com queued).
    const late = [
      detailedRecord({
        campaign_id: 'req-d',
        status: 'queued',
        phone: '+5511900000013',
        client_id: '7000',
        provider_name: 'sinch',
        processed_at: '2026-06-10T12:30:00Z',
      }),
      detailedRecord({
        campaign_id: 'req-d',
        status: 'delivered',
        phone: '+5511900000013',
        client_id: '7000',
        provider_name: 'sinch',
        processed_at: '2026-06-10T12:35:00Z',
      }),
    ];

    writeFileSync(
      join(
        dir,
        'part-late.json.gz',
      ),
      gzipSync(Buffer.from(`${late.join('\n')}\n`)),
    );

    const after = await service.search(
      { window: SEND_WINDOW },
      1,
      20,
    );

    expect(after.total).toBe(3);
    expect(after.rows.map((row) => row.phoneE164)).toContain('5511900000013');
  });

  it('trilha de id DESCONHECIDO + janela AMPLA → recusa (exige a data, não varre ~30d)', async () => {
    const unknownId = 'f'.repeat(32); // md5 válido, nunca visto (sem cache/índice)

    const wide = {
      from: new Date('2026-06-01T00:00:00Z'),
      to: new Date('2026-06-30T00:00:00Z'), // 29 dias > teto (3d)
    };

    await expect(service.getTrail(
      unknownId,
      wide,
    )).rejects.toThrow();
  });

  it('trilha de id desconhecido + janela ESTREITA (uma data) → prossegue (não recusa); id ausente → null', async () => {
    const unknownId = 'e'.repeat(32);

    const narrow = {
      from: new Date('2026-06-10T00:00:00Z'),
      to: new Date('2026-06-11T00:00:00Z'), // 1 dia ≤ teto
    };

    await expect(service.getTrail(
      unknownId,
      narrow,
    )).resolves.toBeNull();
  });
});

describe('DuckDbAuditQueryService — cache incremental (manifesto + shards + compactação)', () => {
  let root: string;
  let cacheRoot: string;
  let service: DuckDbAuditQueryService;

  const INC_WINDOW: AuditWindowInterface = {
    from: new Date('2026-06-10T00:00:00Z'),
    to: new Date('2026-06-11T00:00:00Z'),
  };

  const partDir = (): string => join(
    root,
    'year=2026/month=06/day=10/hour=12',
  );

  /** Arquivos do cache (sob o tmpDir) terminando em `suffix` — sem depender do EV_CACHE_VERSION. */
  const cacheFiles = (suffix: string): string[] => readdirSync(
    cacheRoot,
    { recursive: true },
  )
    .map(String)
    .filter((name) => name.endsWith(suffix));

  /** Parquets do cache de EVENTOS (`audit-ev-*`) — exclui os Parquets de snapshot de busca. */
  const evParquets = (): string[] => cacheFiles('.parquet')
    .filter((name) => name.includes('audit-ev-'));

  /** Lê o (único) manifesto de partição do cache. */
  const readManifest = (): {
    baseObjects: string[];
    baseParquet: string;
    shardObjects: string[];
    shardParquet: string | null;
  } => {
    const [found] = cacheFiles('.manifest');

    return JSON.parse(readFileSync(
      join(
        cacheRoot,
        found,
      ),
      'utf8',
    )) as ReturnType<typeof readManifest>;
  };

  const makeService = (
    overrides: Record<string, unknown> = {},
  ): DuckDbAuditQueryService => new DuckDbAuditQueryService(configStub({
    'auditQuery.sourceRoot': root,
    'auditQuery.defaultWindowDays': 30,
    'auditQuery.cacheSettleMinutes': 0, // partição já fechada → settled (cacheável).
    'auditQuery.lateStatusBufferHours': 0, // dado numa só partição.
    'auditQuery.lagHours': 24 * 365 * 100, // lag "infinito" → settled é SEMPRE reconciliada por LIST.
    'cache.tmpDir': cacheRoot,
    's3.logsBucket': '',
    'aws.region': 'us-east-1',
    ...overrides,
  }));

  const send = (
    campaignId: string,
    phone: string,
  ): string[] => [
    detailedRecord({
      campaign_id: campaignId,
      status: 'queued',
      phone,
      client_id: '9000',
      provider_name: 'sinch',
      processed_at: '2026-06-10T12:00:00Z',
    }),
    detailedRecord({
      campaign_id: campaignId,
      status: 'delivered',
      phone,
      client_id: '9000',
      provider_name: 'sinch',
      processed_at: '2026-06-10T12:05:00Z',
    }),
  ];

  beforeAll(() => {
    root = mkdtempSync(join(
      tmpdir(),
      'atena-cacheinc-',
    ));

    cacheRoot = join(
      root,
      '.cache',
    );

    mkdirSync(
      partDir(),
      { recursive: true },
    );

    writeFileSync(
      join(
        partDir(),
        'a.json.gz',
      ),
      gzipSync(Buffer.from(`${send(
        'req-a',
        '+5511900000010',
      ).join('\n')}\n`)),
    );

    service = makeService();
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

  it('cold: grava base + manifesto que LISTA os objetos cacheados (visibilidade), sem shard', async () => {
    const page = await service.search(
      { window: INC_WINDOW },
      1,
      20,
    );

    expect(page.total).toBe(1);

    const manifest = readManifest();

    expect(manifest.baseObjects).toHaveLength(1);
    expect(manifest.baseObjects[0]).toContain('a.json.gz');
    expect(manifest.shardParquet).toBeNull();
    expect(evParquets()).toHaveLength(1); // só o base
  });

  it('objeto novo dentro do lag: vira SHARD (base INTACTO = incremental) e o resultado reflete o delta', async () => {
    const before = readManifest();

    // Chega um objeto atrasado na MESMA partição (novo destinatário com queued).
    writeFileSync(
      join(
        partDir(),
        'b.json.gz',
      ),
      gzipSync(Buffer.from(`${send(
        'req-b',
        '+5511900000011',
      ).join('\n')}\n`)),
    );

    const page = await service.search(
      { window: INC_WINDOW },
      1,
      20,
    );

    expect(page.total).toBe(2);
    expect(page.rows.map((row) => row.phoneE164)).toContain('5511900000011');

    const after = readManifest();

    // O base NÃO foi reescrito (mesmo arquivo) — só o objeto novo foi lido p/ um shard.
    expect(after.baseParquet).toBe(before.baseParquet);
    expect(after.shardParquet).not.toBeNull();
    expect(after.shardObjects.some((object) => object.includes('b.json.gz'))).toBe(true);
    expect(evParquets()).toHaveLength(2); // base + shard
  });

  it('settle ALÉM do lag: compacta base+shard num único Parquet (0 S3) preservando o dado', async () => {
    // Mesmo cache, mas lag finito → a partição de 2026-06-10 fica ALÉM do lag → dispara compactação.
    const compacting = makeService({ 'auditQuery.lagHours': 48 });

    try {
      const page = await compacting.search(
        { window: INC_WINDOW },
        1,
        20,
      );

      expect(page.total).toBe(2); // dado preservado

      const manifest = readManifest();

      expect(manifest.shardParquet).toBeNull(); // shard dobrado no base
      expect(manifest.baseObjects).toHaveLength(2); // base agora contém os dois objetos
      expect(evParquets()).toHaveLength(1); // só o base compactado
    }
    finally {
      compacting.onModuleDestroy();
    }
  });
});

describe('DuckDbAuditQueryService — DDI inconsistente entre queued e desfecho (grão canônico)', () => {
  let root: string;
  let service: DuckDbAuditQueryService;

  const WIN: AuditWindowInterface = {
    from: new Date('2026-06-20T00:00:00Z'),
    to: new Date('2026-06-21T00:00:00Z'),
  };

  beforeAll(() => {
    root = mkdtempSync(join(
      tmpdir(),
      'atena-ddi-',
    ));

    const dir = join(
      root,
      'year=2026/month=06/day=20/hour=15',
    );

    mkdirSync(
      dir,
      { recursive: true },
    );

    // MESMO envio: a fonte manda o `queued` COM DDI (13 díg.) e o `delivered` SEM (11 díg.) — o bug
    // real do localsms. Sem canonizar, viram 2 destinatários (1 pending + 1 delivered órfão) e a
    // taxa de entrega dá 0%. Com o phone canônico, colapsam no mesmo destinatário → ENTREGUE.
    const lines = [
      detailedRecord({
        campaign_id: 'req-ddi',
        status: 'queued',
        phone: '+5511900000055',
        client_id: '1001',
        provider_name: 'localsms',
        processed_at: '2026-06-20T15:00:00Z',
      }),
      detailedRecord({
        campaign_id: 'req-ddi',
        status: 'delivered',
        phone: '11900000055',
        client_id: '1001',
        provider_name: 'localsms',
        processed_at: '2026-06-20T15:05:00Z',
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

  it('queued(+55) e delivered(sem 55) do mesmo envio → 1 destinatário ENTREGUE (não pending órfão)', async () => {
    const page = await service.search(
      { window: WIN },
      1,
      20,
    );

    // Canonizado (prepend DDI no nacional de 11 díg.): os dois status colapsam no MESMO destinatário.
    expect(page.total).toBe(1);
    expect(page.rows[0].finalStatus).toBe('delivered');
    expect(page.rows[0].phoneE164).toBe('5511900000055');
  });
});
