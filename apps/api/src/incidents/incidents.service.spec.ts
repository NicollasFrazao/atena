import { NotFoundException } from '@nestjs/common';
import type { SearchResultRowInterface } from '@atena/types';
import type { ShippingsService } from '../shippings/shippings.service';
import type { PrismaService } from '../prisma/prisma.service';
import { IncidentsService } from './incidents.service';

/** Mock de ShippingsService sem busca (list/get não tocam nele). */
const NO_MESSAGES = {} as unknown as ShippingsService;

const INCIDENT_ROW = {
  id: 'INC-2401',
  ruleId: 'r-delivery-drop-customer',
  severity: 'critical',
  status: 'detected',
  dimensionType: 'provider',
  dimensionValue: 'Twilio',
  detectedAt: new Date('2026-05-28T14:02:00Z'),
  acknowledgedBy: null,
  resolvedBy: null,
  detectionPayload: {
    rule: 'Queda de taxa de entrega — Twilio',
    window: '14:02 → agora (4 min)',
    summary: 'Taxa caiu de 97% para 87%.',
    metrics: {
      baseline: '97.0%',
      current: '87.1%',
      threshold: '< 95%',
      sample: '2.4k tentativas',
    },
    relatedShippings: 184,
  },
};

describe('IncidentsService', () => {
  it('lista incidentes mapeando o detectionPayload (§C.5, snake_case)', async () => {
    const prisma = {
      incident: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([INCIDENT_ROW]),
      },
    } as unknown as PrismaService;

    const service = new IncidentsService(
      prisma,
      NO_MESSAGES,
    );

    const res = await service.list({ status: 'detected,acknowledged' });

    expect(res.total).toBe(1);

    const row = res.rows[0];

    expect(row).toMatchObject({
      id: 'INC-2401',
      rule: 'Queda de taxa de entrega — Twilio',
      severity: 'critical',
      dimension_type: 'provider',
      related_shippings: 184,
      assignee: null,
    });

    expect(row.metrics.current).toBe('87.1%');
  });

  it('expõe window_from/window_to em ISO UTC (com Z) a partir das colunas de janela', async () => {
    const prisma = {
      incident: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([{
          ...INCIDENT_ROW,
          detectionWindowStart: new Date('2026-06-23T19:40:00Z'),
          detectionWindowEnd: new Date('2026-06-23T19:55:00Z'),
        }]),
      },
    } as unknown as PrismaService;

    const service = new IncidentsService(
      prisma,
      NO_MESSAGES,
    );

    const row = (await service.list({ status: 'detected' })).rows[0];

    expect(row.window_from).toBe('2026-06-23T19:40:00.000Z');
    expect(row.window_to).toBe('2026-06-23T19:55:00.000Z');
  });

  it('window_from/window_to = null quando o incidente não tem colunas de janela', async () => {
    const prisma = {
      incident: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([INCIDENT_ROW]),
      },
    } as unknown as PrismaService;

    const service = new IncidentsService(
      prisma,
      NO_MESSAGES,
    );

    const row = (await service.list({ status: 'detected' })).rows[0];

    expect(row.window_from).toBeNull();
    expect(row.window_to).toBeNull();
  });

  it('get: 404 quando o incidente não existe', async () => {
    const prisma = {
      incident: { findUnique: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;

    const service = new IncidentsService(
      prisma,
      NO_MESSAGES,
    );

    await expect(service.get('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('get: devolve incidente + atividades', async () => {
    const prisma = {
      incident: {
        findUnique: jest.fn().mockResolvedValue({
          ...INCIDENT_ROW,
          activities: [
            {
              id: 'a1',
              userId: 'rafael',
              activityType: 'status_change',
              occurredAt: new Date('2026-05-28T14:06:00Z'),
              payload: { to: 'acknowledged' },
            },
          ],
        }),
      },
    } as unknown as PrismaService;

    const service = new IncidentsService(
      prisma,
      NO_MESSAGES,
    );

    const res = await service.get('INC-2401');

    expect(res.id).toBe('INC-2401');
    expect(res.activities).toHaveLength(1);

    expect(res.activities[0]).toMatchObject({
      type: 'status_change',
      user_id: 'rafael',
    });
  });

  it('shippings: usa os ids EXATOS persistidos + top_campaigns (download = impactadas)', async () => {
    const prisma = {
      incident: {
        findUnique: jest.fn().mockResolvedValue({
          ...INCIDENT_ROW,
          dimensionType: 'customer',
          dimensionValue: '1001',
          detectionWindowStart: new Date('2026-06-19T10:00:00Z'),
          detectionWindowEnd: new Date('2026-06-19T11:00:00Z'),
          detectionPayload: {
            ...INCIDENT_ROW.detectionPayload,
            relatedShippings: 3,
            relatedShippingIds: [
              'id-a',
              'id-b',
              'id-c',
            ],
          },
        }),
      },
    } as unknown as PrismaService;

    const byIds = jest.fn().mockResolvedValue([
      { campaign_id: 'camp-a' },
      { campaign_id: 'camp-a' },
      { campaign_id: 'camp-b' },
    ] as SearchResultRowInterface[]);

    const messages = { byIds } as unknown as ShippingsService;

    const service = new IncidentsService(
      prisma,
      messages,
    );

    const res = await service.shippings('INC-2401');

    expect(res.available).toBe(true);
    expect(res.total).toBe(3); // = relatedShippingIds.length (a contagem do detector)
    expect(res.rows).toHaveLength(3);

    // top por ocorrência: camp-a (2) antes de camp-b (1).
    expect(res.top_campaigns).toEqual([
      {
        campaign_id: 'camp-a',
        count: 2,
      },
      {
        campaign_id: 'camp-b',
        count: 1,
      },
    ]);

    // Buscou pelos ids exatos na janela de detecção.
    expect(byIds).toHaveBeenCalledWith(
      [
        'id-a',
        'id-b',
        'id-c',
      ],
      {
        from: new Date('2026-06-19T10:00:00Z'),
        to: new Date('2026-06-19T11:00:00Z'),
      },
    );
  });

  it('shippings: SEM relatedShippingIds (incidente antigo) → available false, sem fallback', async () => {
    const prisma = {
      incident: {
        findUnique: jest.fn().mockResolvedValue({
          ...INCIDENT_ROW,
          dimensionType: 'customer',
          dimensionValue: '1001',
        }),
      },
    } as unknown as PrismaService;

    const byIds = jest.fn();
    const search = jest.fn();

    const messages = {
      byIds,
      search,
    } as unknown as ShippingsService;

    const service = new IncidentsService(
      prisma,
      messages,
    );

    const res = await service.shippings('INC-2401');

    expect(res.available).toBe(false);
    expect(res.rows).toEqual([]);
    expect(res.total).toBe(0);
    expect(res.top_campaigns).toEqual([]);
    expect(byIds).not.toHaveBeenCalled();
    expect(search).not.toHaveBeenCalled();
  });
});
