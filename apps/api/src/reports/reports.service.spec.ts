import type { AuditQueryServiceInterface } from '../audit-query/audit-query.interface';
import type { DeliveryReportAggregateInterface } from '../audit-query/audit-query.types';
import type { PrismaService } from '../prisma/prisma.service';
import { ReportsService } from './reports.service';

describe('ReportsService', () => {
  it('mapeia o agregado do motor para o shape de borda (§C.4)', async () => {
    const aggregate: DeliveryReportAggregateInterface = {
      totals: {
        sent: 3,
        delivered: 2,
        failed: 1,
        blocked: 0,
        pending: 0,
      },
      byProvider: [
        {
          name: 'Twilio',
          sent: 2,
          delivered: 1,
          rate: 50,
        },
        {
          name: 'Sinch',
          sent: 1,
          delivered: 1,
          rate: 100,
        },
      ],
      hourly: Array.from(
        { length: 24 },
        (
          _unused,
          hour,
        ) => ({
          at: `2026-06-18T${String(hour).padStart(
            2,
            '0',
          )}:00:00Z`,
          rate: 0,
        }),
      ),
      topErrors: [{
        code: 'INSUFFICIENT_BALANCE',
        count: 1,
        provider: 'Twilio',
      }],
    };

    const audit = {
      deliveryReport: jest.fn().mockResolvedValue(aggregate),
    } as unknown as AuditQueryServiceInterface;

    const service = new ReportsService(
      audit,
      {} as unknown as PrismaService,
    );

    const report = await service.generateDelivery({ date_range: 'all' });

    expect(report.window).toBe('Todo o período');

    expect(report.totals).toEqual({
      sent: 3,
      delivered: 2,
      failed: 1,
      blocked: 0,
      pending: 0,
    });

    expect(report.hourly).toHaveLength(24);

    const twilio = report.by_provider.find((provider) => provider.name === 'Twilio');

    expect(twilio).toMatchObject({
      sent: 2,
      delivered: 1,
      rate: 50,
    });

    expect(report.top_errors[0]).toMatchObject({
      code: 'INSUFFICIENT_BALANCE',
      count: 1,
      provider: 'Twilio',
    });

    // csv_url aponta para o export real (GET /reports/delivery/export), carregando a janela usada.
    expect(report.csv_url).toBe('/reports/delivery/export?date_range=all');

    // Sem filtros → não ecoa `filters` (o card mostra "Todos os clientes e provedores").
    expect(report.filters).toBeUndefined();
  });

  it('ecoa os filtros aplicados (cliente/provedor/status) no relatório, só as chaves definidas', async () => {
    const audit = {
      deliveryReport: jest.fn().mockResolvedValue({
        totals: {
          sent: 0,
          delivered: 0,
          failed: 0,
          blocked: 0,
          pending: 0,
        },
        byProvider: [],
        hourly: [],
        topErrors: [],
      }),
    } as unknown as AuditQueryServiceInterface;

    const service = new ReportsService(
      audit,
      {} as unknown as PrismaService,
    );

    const report = await service.generateDelivery({
      date_range: '24h',
      filters: {
        customer_id: '1001',
        provider: 'Twilio',
      },
    });

    // Só cliente+provedor foram informados → status fica de fora do eco.
    expect(report.filters).toEqual({
      customer_id: '1001',
      provider: 'Twilio',
    });
  });

  it('aceita janela explícita (date_from/date_to) com precedência sobre o preset', async () => {
    const deliveryReport = jest.fn().mockResolvedValue({
      totals: {
        sent: 0,
        delivered: 0,
        failed: 0,
        blocked: 0,
        pending: 0,
      },
      byProvider: [],
      hourly: Array.from(
        { length: 24 },
        (
          _unused,
          hour,
        ) => ({
          at: `2026-06-18T${String(hour).padStart(
            2,
            '0',
          )}:00:00Z`,
          rate: 0,
        }),
      ),
      topErrors: [],
    });

    const audit = { deliveryReport } as unknown as AuditQueryServiceInterface;

    const service = new ReportsService(
      audit,
      {} as unknown as PrismaService,
    );

    // date_from com hora = instante absoluto; date_to só-dia ("16/06") = dia inteiro NO fuso (BRT):
    // fim exclusivo = início de 17/06 no fuso = 17/06 03:00Z.
    const report = await service.generateDelivery({
      date_range: '24h',
      date_from: '2026-06-15T08:30:00Z',
      date_to: '2026-06-16',
    });

    const filter = deliveryReport.mock.calls[0][0] as {
      window: {
        from: Date;
        to: Date
      }
    };

    expect(filter.window.from.toISOString()).toBe('2026-06-15T08:30:00.000Z');
    expect(filter.window.to.toISOString()).toBe('2026-06-17T03:00:00.000Z');
    expect(report.window).toContain('15/06/2026');
  });

  it('date_to só-dia (sem hora) cobre o dia inteiro — não janela vazia (regressão: relatório 0)', async () => {
    const deliveryReport = jest.fn().mockResolvedValue({
      totals: {
        sent: 0,
        delivered: 0,
        failed: 0,
        blocked: 0,
        pending: 0,
      },
      byProvider: [],
      hourly: Array.from(
        { length: 24 },
        (
          _unused,
          hour,
        ) => ({
          at: `2026-06-18T${String(hour).padStart(
            2,
            '0',
          )}:00:00Z`,
          rate: 0,
        }),
      ),
      topErrors: [],
    });

    const audit = { deliveryReport } as unknown as AuditQueryServiceInterface;

    const service = new ReportsService(
      audit,
      {} as unknown as PrismaService,
    );

    // O LLM costuma passar date_from = date_to = só o dia. Deve cobrir o dia 19 inteiro NO fuso (BRT):
    // 19/06 00:00 BRT = 19/06 03:00Z; fim exclusivo = 20/06 00:00 BRT = 20/06 03:00Z. Sem isso a janela
    // seria vazia → relatório zerado.
    await service.generateDelivery({
      date_from: '2026-06-19',
      date_to: '2026-06-19',
    });

    const filter = deliveryReport.mock.calls[0][0] as {
      window: {
        from: Date;
        to: Date
      }
    };

    expect(filter.window.from.toISOString()).toBe('2026-06-19T03:00:00.000Z');
    expect(filter.window.to.toISOString()).toBe('2026-06-20T03:00:00.000Z');
  });

  it('relatório de incidentes: total, by_severity e mapeamento resolved (§C.6)', async () => {
    const incidents = [
      {
        id: 'INC-1',
        severity: 'critical',
        status: 'resolved',
        dimensionType: 'provider',
        dimensionValue: 'Twilio',
        detectionPayload: { rule: 'Queda de entrega — Twilio' },
        detectedAt: new Date('2026-05-28T14:00:00Z'),
        acknowledgedAt: new Date('2026-05-28T14:02:00Z'),
        resolvedAt: new Date('2026-05-28T14:38:00Z'),
        actionCategory: 'provider_escalated',
        resolvedBy: 'rafael',
        escalatedTo: 'Twilio #91',
        rule: { name: 'r-delivery' },
      },
      {
        id: 'INC-2',
        severity: 'warning',
        status: 'auto_resolved',
        dimensionType: 'provider',
        dimensionValue: 'Twilio',
        detectionPayload: {},
        detectedAt: new Date('2026-05-28T13:00:00Z'),
        acknowledgedAt: null,
        resolvedAt: new Date('2026-05-28T13:10:00Z'),
        actionCategory: null,
        resolvedBy: null,
        escalatedTo: null,
        rule: { name: 'r-spike' },
      },
    ];

    const prisma = {
      incident: { findMany: jest.fn().mockResolvedValue(incidents) },
    } as unknown as PrismaService;

    const service = new ReportsService(
      {} as unknown as AuditQueryServiceInterface,
      prisma,
    );

    const report = await service.generateIncident({ date_range: 'all' });

    expect(report.window).toBe('Todo o período');
    expect(report.total).toBe(2);

    expect(report.by_severity).toEqual({
      critical: 1,
      warning: 1,
      info: 0,
    });

    const manual = report.resolved.find((incident) => incident.id === 'INC-1');

    expect(manual).toMatchObject({
      rule: 'Queda de entrega — Twilio',
      action: 'provider_escalated',
      analyst: 'rafael',
      duration: '38m',
      escalated_to: 'Twilio #91',
    });

    const auto = report.resolved.find((incident) => incident.id === 'INC-2');

    expect(auto).toMatchObject({
      action: 'monitoring_only',
      analyst: null,
      duration: '10m',
    });

    // MTTA: só INC-1 tem acknowledge (2 min = 120s). MTTR: média de 38m e 10m = 24m = 1440s.
    expect(report.mtta_seconds).toBe(120);
    expect(report.mttr_seconds).toBe(1440);

    // Janela sem limite inferior (período inteiro) não tem período anterior → sem variação.
    expect(report.delta_vs_previous).toBeNull();

    // Ambos no mesmo fornecedor (Twilio) → 1 dimensão, contagem 2, pior severidade = critical.
    expect(report.affected_dimensions).toEqual([
      {
        dimension: 'provider',
        value: 'Twilio',
        count: 2,
        severity: 'critical',
      },
    ]);
  });
});
