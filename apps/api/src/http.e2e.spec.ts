import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from './app.module';
import { PrismaService } from './prisma/prisma.service';
import { FakeLlmProvider } from './llm/fake-llm.provider';
import { LLM_PROVIDER } from './llm/llm-provider.interface';
import { AUDIT_QUERY } from './audit-query/audit-query.interface';

/** Fake do motor de auditoria (S3 via DuckDB) — sem rede, dados canned para o e2e. */
function buildAuditMock() {
  return {
    search: jest.fn().mockResolvedValue({
      rows: [
        {
          id: 'm1',
          customerId: 'AcmeBank',
          phoneE164: '+5521988887777',
          provider: 'Provider D',
          finalStatus: 'failed',
          requestedAt: new Date('2026-05-28T14:02:00Z'),
          finalizedAt: null,
          errorHint: 'INSUFFICIENT_BALANCE',
          contentRef: null,
          content: null,
        },
      ],
      total: 1,
    }),
    getShipping: jest.fn().mockResolvedValue(null),
    getTrail: jest.fn().mockResolvedValue(null),
    deliveryReport: jest.fn().mockResolvedValue({
      totals: {
        sent: 0,
        delivered: 0,
        failed: 0,
        pending: 0,
      },
      byProvider: [],
      hourly: Array.from(
        { length: 24 },
        () => 0,
      ),
      topErrors: [],
    }),
    distinctProviders: jest.fn().mockResolvedValue(['Provider D']),
    distinctCustomers: jest.fn().mockResolvedValue(['AcmeBank']),
    terminalSamples: jest.fn().mockResolvedValue([]),
    sendSamples: jest.fn().mockResolvedValue([]),
  };
}

/**
 * E2e HTTP real (supertest contra o app Nest em memória) com PrismaService mockado
 * e FakeLlmProvider — exercita o pipeline HTTP completo: prefixo `/api`,
 * ValidationPipe, guards (RBAC; em test `devBypass` resolve usuário com papéis),
 * interceptors (audit/métricas), filtro de exceção e o stream SSE do chat.
 *
 * Sem banco: um MySQL real seria necessário apenas para um e2e de integração de
 * dados (ver `make up`/seed).
 */
function buildPrismaMock() {
  return {
    $connect: jest.fn(),
    $disconnect: jest.fn(),
    onModuleInit: jest.fn(),
    onModuleDestroy: jest.fn(),
    message: {
      count: jest.fn().mockResolvedValue(1),
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'm1',
          phoneE164: '+5521988887777',
          finalStatus: 'failed',
          provider: 'Provider D',
          customerId: 'AcmeBank',
          requestedAt: new Date('2026-05-28T14:02:00Z'),
          metadata: { errorHint: 'INSUFFICIENT_BALANCE' },
        },
      ]),
    },
    chatSession: {
      create: jest.fn().mockResolvedValue({ id: 's-1' }),
      findUnique: jest.fn().mockResolvedValue({ id: 's-1' }),
      findFirst: jest.fn().mockResolvedValue({ id: 's-1' }),
      update: jest.fn().mockResolvedValue({}),
    },
    chatMessage: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 'asst-1' }),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
}

describe('HTTP e2e (app real + Prisma mockado + FakeLlmProvider)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    // E2E testa o comportamento dos endpoints, não a auth: garante o dev-bypass (usuário com
    // papéis) independentemente do `.env` do dev (que pode ter AUTH_DEV_BYPASS=false p/ login real).
    process.env.AUTH_DEV_BYPASS = 'true';

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(buildPrismaMock())
      .overrideProvider(AUDIT_QUERY)
      .useValue(buildAuditMock())
      .overrideProvider(LLM_PROVIDER)
      .useValue(new FakeLlmProvider())
      .compile();

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

  it('GET /health → 200 (público)', async () => {
    const res = await request(app.getHttpServer()).get('/health');

    expect(res.status).toBe(200);

    expect(res.body).toEqual({
      status: 'ok',
      service: 'atena-api',
    });
  });

  it('GET /api/shippings/search → 200 com PII mascarada (snake_case)', async () => {
    const res = await request(app.getHttpServer()).get('/api/shippings/search');

    expect(res.status).toBe(200);
    expect(res.body.rows[0].phone_masked).toContain('****');
    expect(JSON.stringify(res.body)).not.toContain('988887777');
  });

  it('GET /api/shippings/nope/trail → 404 estruturado', async () => {
    const res = await request(app.getHttpServer()).get('/api/shippings/nope/trail');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });

  it('POST /api/shippings/analyze → 201 com shape de risco', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/shippings/analyze')
      .send({ text: 'Sua fatura vence amanhã, acesse cb.app/f/8H2 e regularize agora' });

    expect(res.status).toBe(201);

    expect([
      'medium',
      'high',
    ]).toContain(res.body.verdict);
  });

  it('POST /api/chat/sessions/:id/messages → stream SSE (tool → done)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/chat/sessions/s-1/messages')
      .send({ text: 'status do telefone +5511987651234' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.text).toContain('event: tool_call');
    expect(res.text).toContain('event: done');
    expect(res.text).not.toContain('988887777');
  });
});
