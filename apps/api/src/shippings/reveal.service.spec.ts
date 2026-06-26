import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { AuditQueryServiceInterface } from '../audit-query/audit-query.interface';
import type { DeliveryRecordInterface } from '../audit-query/audit-query.types';
import type { ContentCacheInterface } from '../cache/content-cache.interface';
import { RevealService } from './reveal.service';

const cacheStub = {
  get: jest.fn(),
  getText: jest.fn(),
} as unknown as ContentCacheInterface;

/** Fake do motor cujo `getShipping` devolve o registro dado (ou `null`). */
function auditWith(record: Partial<DeliveryRecordInterface> | null): AuditQueryServiceInterface {
  return {
    getShipping: jest.fn().mockResolvedValue(record),
  } as unknown as AuditQueryServiceInterface;
}

describe('RevealService', () => {
  it('revela o telefone completo (E.164)', async () => {
    const service = new RevealService(
      auditWith({ phoneE164: '+5511987651234' }),
      cacheStub,
    );

    await expect(service.revealPhone('m-1001')).resolves.toEqual({
      shipping_id: 'm-1001',
      phone_full: '+5511987651234',
    });
  });

  it('telefone: 404 quando a mensagem não existe', async () => {
    const service = new RevealService(
      auditWith(null),
      cacheStub,
    );

    await expect(service.revealPhone('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('revela o conteúdo hidratado do cache/S3', async () => {
    const cache = {
      get: jest.fn(),
      getText: jest.fn().mockResolvedValue('Olá, mundo'),
    } as unknown as ContentCacheInterface;

    const service = new RevealService(
      auditWith({ contentRef: 's3://b/k.txt' }),
      cache,
    );

    await expect(service.revealContent('m-1001')).resolves.toEqual({
      shipping_id: 'm-1001',
      content_preview: 'Olá, mundo',
    });
  });

  it('revela o conteúdo inline (campo message do detailed report) sem tocar o cache', async () => {
    const cache = {
      get: jest.fn(),
      getText: jest.fn(),
    } as unknown as ContentCacheInterface;

    const service = new RevealService(
      auditWith({ content: 'Promoção exclusiva: 50% OFF hoje!' }),
      cache,
    );

    await expect(service.revealContent('m-1001')).resolves.toEqual({
      shipping_id: 'm-1001',
      content_preview: 'Promoção exclusiva: 50% OFF hoje!',
    });

    expect(cache.getText).not.toHaveBeenCalled();
  });

  it('conteúdo: 422 quando indisponível no S3', async () => {
    const cache = {
      get: jest.fn(),
      getText: jest.fn().mockResolvedValue(null),
    } as unknown as ContentCacheInterface;

    const service = new RevealService(
      auditWith({ contentRef: 's3://b/k.txt' }),
      cache,
    );

    await expect(service.revealContent('m-1001')).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});
