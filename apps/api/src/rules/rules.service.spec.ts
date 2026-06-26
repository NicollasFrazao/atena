import { NotFoundException } from '@nestjs/common';
import type { AuditService } from '../audit/audit.service';
import type { PrismaService } from '../prisma/prisma.service';
import { RulesService } from './rules.service';

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
  updatedAt: new Date('2026-06-10T00:00:00Z'),
};

/** Monta o serviço com Prisma/Audit mockados (regra encontrada ou não). */
function buildService(ruleRow: Record<string, unknown> | null): {
  service: RulesService;
  prisma: PrismaService;
  audit: AuditService;
} {
  const prisma = {
    anomalyRule: {
      findMany: jest.fn().mockResolvedValue([RULE_ROW]),
      findUnique: jest.fn().mockResolvedValue(ruleRow),
      update: jest.fn().mockResolvedValue({
        ...RULE_ROW,
        enabled: false,
        threshold: 4,
        updatedBy: 'rafael',
      }),
    },
  } as unknown as PrismaService;

  const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;

  const service = new RulesService(
    prisma,
    audit,
  );

  return {
    service,
    prisma,
    audit,
  };
}

describe('RulesService', () => {
  it('list: mapeia anomaly_rules para snake_case (threshold numérico)', async () => {
    const { service } = buildService(RULE_ROW);
    const rows = await service.list();

    expect(rows).toHaveLength(1);

    expect(rows[0]).toMatchObject({
      id: 'r-delivery-drop-customer',
      rule_type: 'delivery_rate_drop',
      threshold: 3,
      threshold_unit: 'σ',
      window_minutes: 15,
      updated_by: null,
    });
  });

  it('update: 404 quando a regra não existe', async () => {
    const { service } = buildService(null);

    await expect(service.update(
      'nope',
      { enabled: false },
      'rafael',
    )).rejects.toBeInstanceOf(NotFoundException);
  });

  it('update: aplica campos, marca updatedBy e audita rule_update', async () => {
    const {
      service,
      prisma,
      audit,
    } = buildService(RULE_ROW);

    const res = await service.update(
      'r-delivery-drop-customer',
      {
        enabled: false,
        threshold: 4,
      },
      'rafael',
    );

    expect(prisma.anomalyRule.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'r-delivery-drop-customer' },
      data: expect.objectContaining({
        enabled: false,
        threshold: 4,
        updatedBy: 'rafael',
      }),
    }));

    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'rule_update',
      severity: 'config',
    }));

    expect(res.enabled).toBe(false);
  });
});
