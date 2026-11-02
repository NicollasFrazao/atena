import type { ConfigService } from '@nestjs/config';
import type { AuditQueryServiceInterface } from '../audit-query/audit-query.interface';
import { CatalogService } from './catalog.service';

/** ConfigService stub que devolve `minQueryDate` e `undefined` para o resto. */
function configWithMinDate(minDate: string): ConfigService {
  return {
    get: (key: string) => (key === 'auditQuery.minQueryDate'
      ? minDate
      : undefined),
  } as unknown as ConfigService;
}

describe('CatalogService', () => {
  it('lista providers distintos (sem nulos)', async () => {
    const audit = {
      distinctProviders: jest.fn().mockResolvedValue([
        'Provider C',
        'Provider D',
      ]),
    } as unknown as AuditQueryServiceInterface;

    const service = new CatalogService(audit);

    await expect(service.listProviders()).resolves.toEqual([
      'Provider C',
      'Provider D',
    ]);
  });

  it('lista customers como {id,name} + total (top-N por volume)', async () => {
    const audit = {
      distinctCustomers: jest.fn().mockResolvedValue({
        items: ['AcmeBank'],
        total: 42,
      }),
    } as unknown as AuditQueryServiceInterface;

    const service = new CatalogService(audit);

    await expect(service.listCustomers()).resolves.toEqual({
      items: [{
        id: 'AcmeBank',
        name: 'AcmeBank',
      }],
      total: 42,
    });
  });

  it('recorta a janela do catálogo à data mínima confiável (clamp)', async () => {
    const distinctCustomers = jest.fn().mockResolvedValue({
      items: [],
      total: 0,
    });

    const audit = { distinctCustomers } as unknown as AuditQueryServiceInterface;

    const service = new CatalogService(
      audit,
      configWithMinDate('2026-06-18T20:40:00Z'),
    );

    // `all` não tem piso → o início é recortado para a data mínima (determinístico, independe de "hoje";
    // com `7d` o teste virava bomba-relógio quando "hoje" passava de minQueryDate + 7 dias).
    await service.listCustomers({ date_range: 'all' });

    const window = distinctCustomers.mock.calls[0][0] as { from: Date };
    expect(window.from.toISOString()).toBe('2026-06-18T20:40:00.000Z');
  });

  it('repassa a janela explícita (date_from/date_to) ao motor', async () => {
    const distinctProviders = jest.fn().mockResolvedValue([]);
    const audit = { distinctProviders } as unknown as AuditQueryServiceInterface;

    const service = new CatalogService(audit);

    await service.listProviders({
      date_from: '2026-06-18T21:00:00Z',
      date_to: '2026-06-18T23:00:00Z',
    });

    const window = distinctProviders.mock.calls[0][0] as {
      from: Date;
      to: Date
    };

    expect(window.from.toISOString()).toBe('2026-06-18T21:00:00.000Z');
    expect(window.to.toISOString()).toBe('2026-06-18T23:00:00.000Z');
  });

  describe('windowLabel', () => {
    it('preset date_range → rótulo legível', () => {
      const service = new CatalogService({} as unknown as AuditQueryServiceInterface);

      expect(service.windowLabel({ date_range: '24h' })).toBe('últimas 24h');
    });

    it('datas explícitas → intervalo', () => {
      const service = new CatalogService({} as unknown as AuditQueryServiceInterface);

      expect(service.windowLabel({
        date_from: '2026-06-19',
        date_to: '2026-06-20',
      })).toBe('2026-06-19 → 2026-06-20');
    });

    it('sem janela com minQueryDate → "desde <min> (padrão)"', () => {
      const service = new CatalogService(
        {} as unknown as AuditQueryServiceInterface,
        configWithMinDate('2026-06-18T20:40:00Z'),
      );

      expect(service.windowLabel()).toBe('desde 2026-06-18T20:40:00Z (padrão)');
    });
  });
});
