import type { ConfigService } from '@nestjs/config';
import type { AuditQueryServiceInterface } from '../audit-query/audit-query.interface';
import type { PrismaService } from '../prisma/prisma.service';
import type { SupportGateway } from '../realtime/support.gateway';
import { DetectorService } from './detector.service';
import type { ShippingSampleInterface } from './detection.types';

const NOW = new Date('2026-06-17T12:00:00Z');

const RULE_ROW = {
  id: 'r-delivery-drop-customer',
  name: 'Queda de entrega por cliente',
  ruleType: 'delivery_rate_drop',
  dimension: 'customer',
  enabled: true,
  severity: 'critical',
  threshold: 3,
  thresholdUnit: 'σ',
  windowMinutes: 15,
  updatedBy: null,
  updatedAt: NOW,
};

/** Cria `count` amostras terminais de um cliente, `minutesAgo` atrás, com dada fração entregue. */
function batch(
  customerId: string,
  minutesAgo: number,
  count: number,
  deliveredRatio: number,
): ShippingSampleInterface[] {
  const at = new Date(NOW.getTime() - minutesAgo * 60_000);
  const delivered = Math.round(count * deliveredRatio);
  const out: ShippingSampleInterface[] = [];

  for (let index = 0; index < count; index++) {
    out.push({
      id: `${customerId}-${minutesAgo}-${index}`,
      customerId,
      finalStatus: index < delivered
        ? 'delivered'
        : 'failed',
      occurredAt: at,
    });
  }

  return out;
}

/** Cliente `c1` com baseline alto e queda na janela atual (gera detecção). */
const SAMPLES: ShippingSampleInterface[] = [
  ...batch(
    'c1',
    67,
    20,
    0.9,
  ),
  ...batch(
    'c1',
    52,
    20,
    1,
  ),
  ...batch(
    'c1',
    37,
    20,
    0.95,
  ),
  ...batch(
    'c1',
    22,
    20,
    0.95,
  ),
  ...batch(
    'c1',
    7,
    20,
    0.5,
  ),
];

/** Incidente aberto de um cliente que NÃO está mais anômalo (deve auto-resolver). */
const OPEN_INCIDENT = {
  id: 'INC-old',
  ruleId: 'r-delivery-drop-customer',
  dimensionValue: 'c-old',
  status: 'detected',
};

/** Monta o serviço com AuditQuery/Prisma/Gateway/Config mockados. */
function buildService(): {
  service: DetectorService;
  prisma: PrismaService;
  realtime: SupportGateway;
} {
  const audit = {
    terminalSamples: jest.fn().mockResolvedValue(SAMPLES),
    sendSamples: jest.fn().mockResolvedValue([]),
  } as unknown as AuditQueryServiceInterface;

  const prisma = {
    anomalyRule: { findMany: jest.fn().mockResolvedValue([RULE_ROW]) },
    incident: {
      findMany: jest.fn().mockResolvedValue([OPEN_INCIDENT]),
      create: jest.fn().mockResolvedValue({ id: 'INC-new' }),
      update: jest.fn().mockResolvedValue({}),
    },
    incidentActivity: { create: jest.fn().mockResolvedValue({}) },
  } as unknown as PrismaService;

  const realtime = { broadcast: jest.fn() } as unknown as SupportGateway;

  const config = {
    get: jest.fn((key: string) => {
      const values: Record<string, number> = {
        'detect.minTerminalVolume': 10,
        'detect.baselineWindows': 4,
      };

      return values[key];
    }),
  } as unknown as ConfigService;

  const service = new DetectorService(
    audit,
    prisma,
    realtime,
    config,
  );

  return {
    service,
    prisma,
    realtime,
  };
}

describe('DetectorService.run', () => {
  it('cria incidente para cliente anômalo e auto-resolve o que voltou à baseline', async () => {
    const {
      service,
      prisma,
      realtime,
    } = buildService();

    const summary = await service.run(NOW);

    expect(summary).toEqual({
      detected: 1,
      created: 1,
      auto_resolved: 1,
    });

    expect(prisma.incident.create).toHaveBeenCalledTimes(1);

    expect(prisma.incident.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'INC-old' },
      data: expect.objectContaining({ status: 'auto_resolved' }),
    }));

    expect(realtime.broadcast).toHaveBeenCalledWith(expect.objectContaining({ type: 'incident.created' }));
    expect(realtime.broadcast).toHaveBeenCalledWith(expect.objectContaining({ type: 'incident.auto_resolved' }));
  });

  it('regra em shadow mode: registra o incidente (shadow=true) mas NÃO notifica', async () => {
    const {
      service,
      prisma,
      realtime,
    } = buildService();

    (prisma.anomalyRule.findMany as jest.Mock).mockResolvedValue([
      {
        ...RULE_ROW,
        shadowMode: true,
      },
    ]);

    // Sem incidentes abertos: a detecção do c1 vira um incidente novo (silencioso).
    (prisma.incident.findMany as jest.Mock).mockResolvedValue([]);

    const summary = await service.run(NOW);

    expect(summary.created).toBe(1);

    // Persistiu marcado como shadow...
    expect(prisma.incident.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ shadow: true }),
    }));

    // ...mas não empurrou nada pelo WebSocket.
    expect(realtime.broadcast).not.toHaveBeenCalled();
  });

  it('não duplica incidente quando já há um aberto para a mesma dimensão', async () => {
    const {
      service,
      prisma,
    } = buildService();

    (prisma.incident.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'INC-c1',
        ruleId: 'r-delivery-drop-customer',
        dimensionValue: 'c1',
        status: 'detected',
      },
    ]);

    const summary = await service.run(NOW);

    expect(summary.created).toBe(0);
    expect(prisma.incident.create).not.toHaveBeenCalled();
  });
});
