import { Test } from '@nestjs/testing';
import type { Response } from 'express';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { ChatController } from './chat.controller';
import { FakeLlmProvider } from '../llm/fake-llm.provider';
import { LLM_PROVIDER } from '../llm/llm-provider.interface';
import { AUDIT_QUERY } from '../audit-query/audit-query.interface';

/** Fake do motor de auditoria (S3 via DuckDB) — sem rede, dados canned para o e2e do chat. */
function buildAuditMock() {
  return {
    search: jest.fn().mockResolvedValue({
      rows: [
        {
          id: 'm1',
          customerId: 'CreditBank',
          phoneE164: '+5521988887777', // diferente da query: prova o masking no resultado
          provider: 'Twilio',
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
    distinctProviders: jest.fn().mockResolvedValue(['Twilio']),
    distinctCustomers: jest.fn().mockResolvedValue(['CreditBank']),
    terminalSamples: jest.fn().mockResolvedValue([]),
    sendSamples: jest.fn().mockResolvedValue([]),
  };
}

/**
 * E2e (grafo de DI real, sem HTTP socket nem banco): sobe o AppModule com o
 * PrismaService mockado e o FakeLlmProvider (default), chama o ChatController e
 * verifica os frames SSE do orquestrador (tool path e refusal).
 */
function buildPrismaMock() {
  return {
    $connect: jest.fn(),
    $disconnect: jest.fn(),
    onModuleInit: jest.fn(),
    onModuleDestroy: jest.fn(),
    chatSession: {
      findUnique: jest.fn().mockResolvedValue({ id: 's-1' }),
      findFirst: jest.fn().mockResolvedValue({ id: 's-1' }),
      update: jest.fn().mockResolvedValue({}),
    },
    chatMessage: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 'asst-1' }),
    },
    message: {
      count: jest.fn().mockResolvedValue(1),
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'm1',
          phoneE164: '+5521988887777', // diferente da query: prova o masking no resultado
          finalStatus: 'failed',
          provider: 'Twilio',
          customerId: 'CreditBank',
          requestedAt: new Date('2026-05-28T14:02:00Z'),
          metadata: { errorHint: 'INSUFFICIENT_BALANCE' },
        },
      ]),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
}

/** Response Express stub que captura os frames SSE escritos. */
function buildResStub() {
  const frames: string[] = [];

  const res = {
    status: jest.fn(),
    setHeader: jest.fn(),
    flushHeaders: jest.fn(),
    write: jest.fn((chunk: string) => {
      frames.push(chunk);

      return true;
    }),
    end: jest.fn(),
  } as unknown as Response;

  return {
    res,
    frames,
  };
}

describe('Chat SSE (e2e, DI real + Prisma mockado + FakeLlmProvider)', () => {
  let controller: ChatController;
  let close: () => Promise<void>;

  beforeAll(async () => {
    // E2E não testa auth: garante o dev-bypass independentemente do `.env` (AUTH_DEV_BYPASS).
    process.env.AUTH_DEV_BYPASS = 'true';

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(buildPrismaMock())
      .overrideProvider(AUDIT_QUERY)
      .useValue(buildAuditMock())
      .overrideProvider(LLM_PROVIDER)
      .useValue(new FakeLlmProvider())
      .compile();

    controller = moduleRef.get(ChatController);
    close = () => moduleRef.close();
  });

  afterAll(async () => {
    await close();
  });

  it('caminho com tool: emite tool_call → tool_result → text_delta → done', async () => {
    const {
      res,
      frames,
    } = buildResStub();

    await controller.sendMessage(
      's-1',
      { text: 'status do telefone +5511987651234' },
      res,
    );

    const sse = frames.join('');

    expect(sse).toContain('event: tool_call');
    expect(sse).toContain('event: tool_result');
    expect(sse).toContain('event: text_delta');
    expect(sse).toContain('event: done');
    expect(sse).toContain('search_shippings');
    // PII do banco sai mascarada no tool_result; o número bruto NUNCA aparece no stream.
    expect(sse).toContain('phone_masked');
    expect(sse).not.toContain('988887777');
    expect(res.end).toHaveBeenCalled();
  });

  it('caminho de recusa: pedido fora de escopo emite refusal', async () => {
    const {
      res,
      frames,
    } = buildResStub();

    await controller.sendMessage(
      's-1',
      { text: 'qual é a capital da França?' },
      res,
    );

    const sse = frames.join('');

    expect(sse).toContain('event: refusal');
    expect(sse).not.toContain('event: done');
    expect(res.end).toHaveBeenCalled();
  });
});
