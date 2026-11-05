import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import request from 'supertest';
import { AppModule } from './app.module';

/** Full phone of `m-1001`, returned by reveal-phone. */
const FIXTURE_PHONE = '+5511987651234';

/** How far back the fixture sends are, inside the default 30-day search window. */
const FIXTURE_AGE_MS = 3 * 60 * 60 * 1000;

/** Number of sends in the fixture. */
const FIXTURE_SENDS = 8;

/** Zero-padded two-digit part of a partition path. */
function twoDigits(value: number): string {
  return String(value).padStart(
    2,
    '0',
  );
}

/**
 * Writes the delivery data the audit query reads: eight sends (`m-1001`…`m-1008`) a few hours old,
 * as one hourly partition of the detailed report under `root`. Every send starts with `queued` (a
 * terminal status alone is an orphan the search leaves out); `m-1001` carries the full trail
 * (queued → sent → delivered) and {@link FIXTURE_PHONE}. The providers are Provider C and Provider D.
 *
 * @param root - Directory the audit query uses as its source (`ATENA_AUDIT_SOURCE_ROOT`).
 */
function writeDeliveryFixture(root: string): void {
  const at = new Date(Date.now() - FIXTURE_AGE_MS);

  const partition = join(
    root,
    `year=${at.getUTCFullYear()}`,
    `month=${twoDigits(at.getUTCMonth() + 1)}`,
    `day=${twoDigits(at.getUTCDate())}`,
    `hour=${twoDigits(at.getUTCHours())}`,
  );

  const lines: string[] = [];

  for (let index = 1; index <= FIXTURE_SENDS; index += 1) {
    const campaignId = `m-${1000 + index}`;

    const statuses = index === 1
      ? [
        'queued',
        'sent',
        'delivered',
      ]
      : [
        'queued',
        'delivered',
      ];

    statuses.forEach((
      status,
      step,
    ) => {
      lines.push(JSON.stringify({
        campaign_id: campaignId,
        campaign_type: 'sms',
        client_id: 'AcmeBank',
        app_id: null,
        source: 'api',
        status,
        phone: index === 1
          ? FIXTURE_PHONE
          : `+55119876500${twoDigits(index)}`,
        message: 'hello',
        credits_required: 1,
        sent_at: at.toISOString().slice(
          0,
          10,
        ),
        processed_at: new Date(at.getTime() + (step * 60_000)).toISOString(),
        provider_name: index % 2 === 1
          ? 'Provider D'
          : 'Provider C',
        provider_code: null,
        error: null,
      }));
    });
  }

  mkdirSync(
    partition,
    { recursive: true },
  );

  writeFileSync(
    join(
      partition,
      'sends.json.gz',
    ),
    gzipSync(Buffer.from(`${lines.join('\n')}\n`)),
  );
}

/**
 * E2e INTEGRATION suite against a real MySQL (no Prisma mocks). It runs through `make test-e2e`,
 * which starts the database, applies the migrations, seeds and runs this suite; the
 * `*.e2e-spec.ts` naming keeps it out of the unit `testRegex`. Needs `DATABASE_URL`.
 *
 * Covers the real path end to end (HTTP → service → Prisma → MySQL) over the seed. Delivery data
 * is not in the database: it comes from the audit query's source, so the suite writes a local one
 * ({@link writeDeliveryFixture}) and points `ATENA_AUDIT_SOURCE_ROOT` at it.
 */
describe('DB e2e (MySQL real + seed, sem mocks)', () => {
  let app: INestApplication;
  let fixtureRoot: string;

  /**
   * Id of the `m-1001` send, as the search returns it: trail and reveal take the send id
   * (`md5(campaign_id|phone)`), not the campaign id.
   */
  const fixtureSendId = async (): Promise<string> => {
    const res = await request(app.getHttpServer()).get('/api/shippings/search');

    const rows = res.body.rows as {
      id: string;
      campaign_id: string | null;
    }[];

    const send = rows.find((row) => row.campaign_id === 'm-1001');

    if (!send) {
      throw new Error('The fixture send m-1001 is missing from the search.');
    }

    return send.id;
  };

  beforeAll(async () => {
    fixtureRoot = mkdtempSync(join(
      tmpdir(),
      'atena-e2e-',
    ));

    writeDeliveryFixture(join(
      fixtureRoot,
      'source',
    ));

    process.env.ATENA_AUDIT_SOURCE_ROOT = join(
      fixtureRoot,
      'source',
    );

    process.env.ATENA_TMP_CACHE_DIR = join(
      fixtureRoot,
      'cache',
    );

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();

    app.setGlobalPrefix(
      'api',
      { exclude: ['health'] },
    );

    app.useGlobalPipes(new ValidationPipe({
      whitelist: true,
      transform: true,
    }));

    await app.init();
  });

  afterAll(async () => {
    await app.close();

    rmSync(
      fixtureRoot,
      {
        recursive: true,
        force: true,
      },
    );
  });

  it('GET /health → 200', async () => {
    const res = await request(app.getHttpServer()).get('/health');

    expect(res.status).toBe(200);
  });

  it('GET /api/shippings/search → 8 envios do seed, PII mascarada', async () => {
    const res = await request(app.getHttpServer()).get('/api/shippings/search');

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(8);
    expect(res.body.rows[0].phone_masked).toContain('****');
  });

  it('GET /api/shippings/:id/trail → trilha com eventos (m-1001)', async () => {
    const id = await fixtureSendId();
    const res = await request(app.getHttpServer()).get(`/api/shippings/${id}/trail`);

    expect(res.status).toBe(200);
    expect(res.body.shipping_id).toBe(id);
    expect(res.body.campaign_id).toBe('m-1001');
    expect(res.body.events.length).toBeGreaterThan(0);
    expect(res.body.phone_masked).toContain('****');
  });

  it('GET /api/providers → provedores do seed', async () => {
    const res = await request(app.getHttpServer()).get('/api/providers');

    expect(res.status).toBe(200);

    expect(res.body).toEqual(expect.arrayContaining([
      'Provider D',
      'Provider C',
    ]));
  });

  it('POST /api/shippings/:id/reveal-phone → telefone completo + audita (real, m-1001)', async () => {
    const id = await fixtureSendId();
    const res = await request(app.getHttpServer()).post(`/api/shippings/${id}/reveal-phone`);

    expect(res.status).toBe(201);

    // The audit query canonicalises phones to digits (PHONE_CANONICAL), so the reveal has no `+`.
    expect(res.body).toEqual({
      shipping_id: id,
      phone_full: FIXTURE_PHONE.replace(
        '+',
        '',
      ),
    });
  });

  it('POST /api/reports/delivery → agrega os 8 envios do seed', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/reports/delivery')
      .send({ date_range: 'all' });

    expect(res.status).toBe(201);
    expect(res.body.totals.sent).toBe(8);
  });

  it('chat: cria sessão e responde em stream SSE (tool → done)', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/chat/sessions')
      .send({ title: 'E2e' });

    expect(created.status).toBe(201);

    const sessionId = created.body.session_id;

    const stream = await request(app.getHttpServer())
      .post(`/api/chat/sessions/${sessionId}/messages`)
      .send({ text: 'status do telefone +5511987651234' });

    expect(stream.status).toBe(200);
    expect(stream.text).toContain('event: tool_call');
    expect(stream.text).toContain('event: done');
  });

  it('GET /api/incidents → incidentes do seed (Fase 2)', async () => {
    const res = await request(app.getHttpServer()).get('/api/incidents');

    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(3);
    expect(res.body.rows[0]).toHaveProperty('dimension_type');
  });

  it('GET /api/incidents/INC-2401 → incidente + atividades', async () => {
    const res = await request(app.getHttpServer()).get('/api/incidents/INC-2401');

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('INC-2401');
    expect(res.body.severity).toBe('critical');
    expect(Array.isArray(res.body.activities)).toBe(true);
  });

  it('GET /api/rules → regras de anomalia do seed (2.2)', async () => {
    const res = await request(app.getHttpServer()).get('/api/rules');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(5);
    expect(res.body[0]).toHaveProperty('rule_type');
  });

  it('POST /api/reports/incidents → relatório dos resolvidos do seed (§C.6, 2.7)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/reports/incidents')
      .send({ date_range: 'all' });

    expect(res.status).toBe(201);
    expect(res.body.total).toBeGreaterThanOrEqual(3);
    expect(res.body).toHaveProperty('by_severity');
  });

  it('GET /api/observability → métricas básicas (2.8)', async () => {
    const res = await request(app.getHttpServer()).get('/api/observability');

    expect(res.status).toBe(200);
    expect(res.body.overview).toHaveProperty('sessions');
    expect(Array.isArray(res.body.tools)).toBe(true);
    expect(res.body.websocket).toHaveProperty('connected');
  });

  it('lifecycle: acknowledge → resolve (§D) num incidente do seed (2.4)', async () => {
    const ack = await request(app.getHttpServer()).post('/api/incidents/INC-2401/acknowledge');

    expect(ack.status).toBe(200);
    expect(ack.body.status).toBe('acknowledged');

    const resolve = await request(app.getHttpServer())
      .post('/api/incidents/INC-2401/resolve')
      .send({
        action_category: 'provider_recovered',
        action_description: 'Provedor normalizou a entrega após o reroteamento.',
      });

    expect(resolve.status).toBe(200);
    expect(resolve.body.status).toBe('resolved');
  });

  it('resolve com descrição curta → 422 (validação §D)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/incidents/INC-2398/resolve')
      .send({
        action_category: 'other',
        action_description: 'curto',
      });

    expect(res.status).toBe(422);
  });

  it('POST /api/dev/detect → roda o detector e devolve o resumo (2.6)', async () => {
    const res = await request(app.getHttpServer()).post('/api/dev/detect');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('detected');
    expect(res.body).toHaveProperty('created');
    expect(res.body).toHaveProperty('auto_resolved');
  });
});
