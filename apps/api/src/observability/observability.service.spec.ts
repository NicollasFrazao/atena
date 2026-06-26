import type { AuditQueryServiceInterface } from '../audit-query/audit-query.interface';
import type { LlmProviderInterface } from '../llm/llm-provider.interface';
import type { PrismaService } from '../prisma/prisma.service';
import type { SupportGateway } from '../realtime/support.gateway';
import { ObservabilityService } from './observability.service';

/** Provider LLM mockado: só o rótulo `describe` (provider/modelo) importa aqui. */
const FAKE_LLM = {
  describe: () => ({
    provider: 'fake' as const,
    model: 'Simulado',
  }),
} as unknown as LlmProviderInterface;

/** Motor de auditoria mockado: só o `scanStats` (custo de S3) importa aqui. */
const FAKE_AUDIT = {
  scanStats: async () => ({
    queries: 0,
    partitions_total: 0,
    partitions_cached: 0,
    partitions_scanned: 0,
    s3_objects: 0,
    cache_hit_rate: 0,
    avg_materialize_ms: 0,
    estimated_get_requests: 0,
    estimated_cost_usd: 0,
  }),
} as unknown as AuditQueryServiceInterface;

describe('ObservabilityService', () => {
  it('agrega sessões, reveals, uso por tool, MTTA, recusas, conexões e pico do WS', async () => {
    const prisma = {
      chatSession: {
        findMany: jest.fn().mockResolvedValue(Array.from(
          { length: 7 },
          () => ({
            startedAt: new Date('2026-06-17T12:00:00Z'),
            lastActivity: new Date('2026-06-17T12:05:00Z'),
          }),
        )),
      },
      auditLog: {
        count: jest.fn().mockResolvedValue(3),
        findMany: jest.fn().mockResolvedValue([
          {
            resource: 'orchestrator:search_shippings',
            detail: null,
            metadata: { latency_ms: 100 },
          },
          {
            resource: 'orchestrator:search_shippings',
            detail: 'tool_error',
            metadata: { latency_ms: 300 },
          },
          {
            resource: 'orchestrator:list_incidents',
            detail: null,
            metadata: {},
          },
        ]),
      },
      incident: {
        findMany: jest.fn().mockResolvedValue([
          {
            detectedAt: new Date('2026-06-17T12:00:00Z'),
            acknowledgedAt: new Date('2026-06-17T12:01:00Z'), // 60s
          },
          {
            detectedAt: new Date('2026-06-17T12:00:00Z'),
            acknowledgedAt: new Date('2026-06-17T12:02:00Z'), // 120s
          },
        ]),
      },
      chatMessage: {
        findMany: jest.fn().mockResolvedValue([
          {
            content: {
              text: 'ok',
              usage: {
                input_tokens: 100,
                output_tokens: 50,
              },
            },
          },
          {
            content: {
              text: '',
              refusal: { reason: 'fora_escopo' },
              usage: {
                input_tokens: 10,
                output_tokens: 1,
              },
            },
          },
          {
            content: {
              text: '',
              refusal: { reason: 'fora_escopo' },
              usage: {
                input_tokens: 10,
                output_tokens: 1,
              },
            },
          },
        ]),
      },
    } as unknown as PrismaService;

    const realtime = {
      connectionCount: jest.fn().mockReturnValue(5),
      peakConnections: jest.fn().mockReturnValue(9),
    } as unknown as SupportGateway;

    const service = new ObservabilityService(
      prisma,
      realtime,
      FAKE_AUDIT,
      FAKE_LLM,
    );

    const result = await service.snapshot();

    expect(result.overview.sessions).toBe(7);
    expect(result.overview.reveals).toBe(3);
    expect(result.overview.tokens).toBe(172); // (100+50)+(10+1)+(10+1)
    expect(result.overview.mtta).toBe('1m 30s'); // média de 60s e 120s
    expect(result.websocket.connected).toBe(5);
    expect(result.websocket.peak).toBe(9);

    expect(result.llm).toEqual({
      provider: 'fake',
      model: 'Simulado',
    });

    expect(result.refusals.total).toBe(2);

    expect(result.refusals.by_reason).toEqual([
      {
        reason: 'fora_escopo',
        count: 2,
      },
    ]);

    const search = result.tools.find((tool) => tool.name === 'search_shippings');

    expect(search).toMatchObject({
      calls: 2,
      errors: 1,
      avg_latency_ms: 200,
    });

    const incidents = result.tools.find((tool) => tool.name === 'list_incidents');

    expect(incidents).toMatchObject({
      calls: 1,
      avg_latency_ms: null,
    });
  });

  it('MTTA é null e recusas zeram quando não há incidente reconhecido nem recusa', async () => {
    const prisma = {
      chatSession: { findMany: jest.fn().mockResolvedValue([]) },
      auditLog: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
      incident: { findMany: jest.fn().mockResolvedValue([]) },
      chatMessage: { findMany: jest.fn().mockResolvedValue([{ content: { text: 'oi' } }]) },
    } as unknown as PrismaService;

    const realtime = {
      connectionCount: jest.fn().mockReturnValue(0),
      peakConnections: jest.fn().mockReturnValue(0),
    } as unknown as SupportGateway;

    const result = await new ObservabilityService(
      prisma,
      realtime,
      FAKE_AUDIT,
      FAKE_LLM,
    ).snapshot();

    expect(result.overview.mtta).toBeNull();
    expect(result.overview.tokens).toBeNull();
    expect(result.refusals.total).toBe(0);
    expect(result.refusals.by_reason).toEqual([]);
    expect(result.websocket.peak).toBe(0);
  });
});
