import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { AuditQueryServiceInterface } from '../audit-query/audit-query.interface';
import type { ContentCacheInterface } from '../cache/content-cache.interface';
import { AnalysisService } from './analysis.service';

const cacheStub = {
  get: jest.fn(),
  getText: jest.fn(),
} as unknown as ContentCacheInterface;

/** Fake do motor cujo `getShipping` devolve `null` (não há mensagem). */
const auditStub = {
  getShipping: jest.fn().mockResolvedValue(null),
} as unknown as AuditQueryServiceInterface;

describe('AnalysisService', () => {
  it('analisa texto direto e devolve o shape de risco (§C.3)', async () => {
    const service = new AnalysisService(
      auditStub,
      cacheStub,
    );

    const result = await service.analyze({ text: 'Sua fatura vence amanhã, acesse cb.app/f/8H2 e regularize agora' });

    expect([
      'medium',
      'high',
    ]).toContain(result.verdict);

    expect(result.categories.length).toBeGreaterThan(0);
    expect(typeof result.score).toBe('number');
  });

  it('400 quando não há text nem shipping_id', async () => {
    const service = new AnalysisService(
      auditStub,
      cacheStub,
    );

    await expect(service.analyze({})).rejects.toBeInstanceOf(BadRequestException);
  });

  it('404 quando o shipping_id não existe', async () => {
    const service = new AnalysisService(
      auditStub,
      cacheStub,
    );

    await expect(service.analyze({ shipping_id: 'nope' })).rejects.toBeInstanceOf(NotFoundException);
  });
});
