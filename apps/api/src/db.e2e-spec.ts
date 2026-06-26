import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from './app.module';

/**
 * E2e de INTEGRAÇÃO contra um MySQL real (sem mocks de Prisma) — roda via
 * `make test-e2e`, que sobe o banco (compose), aplica migrations, semeia e executa
 * esta suíte. Fica FORA do `make test` (naming `*.e2e-spec.ts` não casa com o
 * `testRegex` unitário); precisa de `DATABASE_URL` apontando para o MySQL.
 *
 * Valida o caminho real ponta a ponta (HTTP → serviço → Prisma → MySQL) sobre os
 * dados de seed (8 mensagens; trilha de `m-1001`; telefone `+5511987651234`).
 */
describe('DB e2e (MySQL real + seed, sem mocks)', () => {
  let app: INestApplication;

  beforeAll(async () => {
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

  it('GET /api/shippings/m-1001/trail → trilha com eventos', async () => {
    const res = await request(app.getHttpServer()).get('/api/shippings/m-1001/trail');

    expect(res.status).toBe(200);
    expect(res.body.shipping_id).toBe('m-1001');
    expect(res.body.events.length).toBeGreaterThan(0);
    expect(res.body.phone_masked).toContain('****');
  });

  it('GET /api/providers → provedores do seed', async () => {
    const res = await request(app.getHttpServer()).get('/api/providers');

    expect(res.status).toBe(200);

    expect(res.body).toEqual(expect.arrayContaining([
      'Twilio',
      'Sinch',
    ]));
  });

  it('POST /api/shippings/m-1001/reveal-phone → telefone completo + audita (real)', async () => {
    const res = await request(app.getHttpServer()).post('/api/shippings/m-1001/reveal-phone');

    expect(res.status).toBe(201);

    expect(res.body).toEqual({
      shipping_id: 'm-1001',
      phone_full: '+5511987651234',
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
