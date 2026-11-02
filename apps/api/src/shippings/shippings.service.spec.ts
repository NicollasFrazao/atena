import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { AuditQueryServiceInterface } from '../audit-query/audit-query.interface';
import { ShippingsService } from './shippings.service';

/** ConfigService stub que devolve `minQueryDate` e `undefined` para o resto. */
function configWithMinDate(minDate: string): ConfigService {
  return {
    get: (key: string) => (key === 'auditQuery.minQueryDate'
      ? minDate
      : undefined),
  } as unknown as ConfigService;
}

describe('ShippingsService', () => {
  it('mascara o telefone e monta o envelope paginado (PII não vaza)', async () => {
    const audit = {
      search: jest.fn().mockResolvedValue({
        rows: [
          {
            id: 'm1',
            customerId: 'AcmeBank',
            phoneE164: '+5511987651234',
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
    } as unknown as AuditQueryServiceInterface;

    const service = new ShippingsService(audit);
    const res = await service.search({});

    expect(res.total).toBe(1);
    expect(res.page).toBe(1);
    const row = res.rows[0];
    expect(row.phone_masked).toContain('****');
    expect(row.phone_masked).not.toContain('98765'); // miolo do telefone oculto
    expect(row.phone_masked.endsWith('1234')).toBe(true);
    expect(row.status).toBe('failed');
    expect(row.error_hint).toBe('INSUFFICIENT_BALANCE');
  });

  it('retorna null na trilha quando a mensagem não existe', async () => {
    const audit = {
      getTrail: jest.fn().mockResolvedValue(null),
    } as unknown as AuditQueryServiceInterface;

    const service = new ShippingsService(audit);
    await expect(service.getTrail('nope')).resolves.toBeNull();
  });

  it('repassa a janela temporal (date_from/date_to com hora) ao motor', async () => {
    const search = jest.fn().mockResolvedValue({
      rows: [],
      total: 0,
    });

    const audit = { search } as unknown as AuditQueryServiceInterface;

    const service = new ShippingsService(audit);

    await service.search({
      date_from: '2026-06-15T08:00:00Z',
      date_to: '2026-06-16T23:59:00Z',
    });

    const filter = search.mock.calls[0][0] as {
      window: {
        from: Date;
        to: Date
      }
    };

    expect(filter.window.from.toISOString()).toBe('2026-06-15T08:00:00.000Z');
    expect(filter.window.to.toISOString()).toBe('2026-06-16T23:59:00.000Z');
  });

  it('date_to só-dia cobre o dia inteiro NO fuso (fim do dia, não o instante inicial)', async () => {
    // Fuso de exibição/janela fixado em BRT (default) → o dia nomeado vira 00:00 BRT (= 03:00Z).
    process.env.APP_TIMEZONE = 'America/Sao_Paulo';

    const search = jest.fn().mockResolvedValue({
      rows: [],
      total: 0,
    });

    const audit = { search } as unknown as AuditQueryServiceInterface;

    const service = new ShippingsService(audit);

    await service.search({
      date_from: '2026-06-18',
      date_to: '2026-06-18',
    });

    const filter = search.mock.calls[0][0] as {
      window: {
        from: Date;
        to: Date
      }
    };

    // 18/06 00:00 BRT = 18/06 03:00Z; fim exclusivo = 19/06 00:00 BRT = 19/06 03:00Z.
    expect(filter.window.from.toISOString()).toBe('2026-06-18T03:00:00.000Z');
    expect(filter.window.to.toISOString()).toBe('2026-06-19T03:00:00.000Z');
  });

  it('exige janela ao buscar por campaign_id sem data (window_required)', async () => {
    const search = jest.fn();
    const audit = { search } as unknown as AuditQueryServiceInterface;
    const service = new ShippingsService(audit);

    await expect(service.search({ campaign_id: 'b92b6533-62b9-4526-8963-fcbd9347614f' }))
      .rejects.toBeInstanceOf(BadRequestException);

    expect(search).not.toHaveBeenCalled();
  });

  it('trilha sem janela com data mínima ativa: recorta para o min (não rejeita)', async () => {
    const getTrail = jest.fn().mockResolvedValue(null);
    const audit = { getTrail } as unknown as AuditQueryServiceInterface;

    const service = new ShippingsService(
      audit,
      configWithMinDate('2026-06-18T20:40:00Z'),
    );

    await service.getTrail('m1');

    const window = getTrail.mock.calls[0][1] as { from: Date };
    expect(window.from.toISOString()).toBe('2026-06-18T20:40:00.000Z');
  });

  it('trilha com date_from explícito antes da data mínima: recorta para o min (não rejeita)', async () => {
    const getTrail = jest.fn().mockResolvedValue(null);
    const audit = { getTrail } as unknown as AuditQueryServiceInterface;

    const service = new ShippingsService(
      audit,
      configWithMinDate('2026-06-18T20:40:00Z'),
    );

    await service.getTrail(
      'm1',
      {
        from: new Date('2026-06-10T00:00:00Z'),
        to: null,
      },
    );

    const window = getTrail.mock.calls[0][1] as { from: Date };
    expect(window.from.toISOString()).toBe('2026-06-18T20:40:00.000Z');
  });
});
