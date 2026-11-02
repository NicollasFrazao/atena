import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { RiskAnalysisInterface } from '@atena/types';
import { AUDIT_QUERY, type AuditQueryServiceInterface } from '../audit-query/audit-query.interface';
import { CONTENT_CACHE, type ContentCacheInterface } from '../cache/content-cache.interface';
import { nonEmpty } from '../common/text.util';
import { AnalyzeContentDto } from './dto/analyze-content.dto';
import { analyzeRisk } from './risk.util';

/**
 * Tool `analyze_shipping_content` (§C.3): análise determinística de risco de conteúdo.
 *
 * Resolve o texto a analisar — direto (`text`) ou pelo conteúdo do envio
 * (`shipping_id` → `content_ref` → {@link ContentCacheInterface}, cache `/tmp`↔S3) —
 * e delega ao {@link analyzeRisk}. Retorna só o risco (não o conteúdo), portanto
 * não é um reveal de PII.
 *
 * @see analyzeRisk - heurística de risco.
 */
@Injectable()
export class AnalysisService {
  /**
   * @param audit - Motor de consulta (resolve `content_ref` do envio).
   * @param cache - Cache read-through `/tmp`↔S3 do conteúdo bruto.
   */
  constructor(
    @Inject(AUDIT_QUERY) private readonly audit: AuditQueryServiceInterface,
    @Inject(CONTENT_CACHE) private readonly cache: ContentCacheInterface,
  ) {}

  /**
   * Analisa o risco do conteúdo informado (texto direto ou por `shipping_id`).
   *
   * @param input - `text` OU `shipping_id` (ao menos um).
   *
   * @returns Score, veredito, categorias e explicação.
   *
   * @throws {NotFoundException} Se `shipping_id` não existir (`{ error: { code: 'not_found' } }`).
   * @throws {BadRequestException} Se nenhum texto puder ser resolvido (`{ error: { code: 'invalid_request' } }`).
   */
  async analyze(input: AnalyzeContentDto): Promise<RiskAnalysisInterface> {
    let text = input.text?.trim();

    if (
      !text
      && input.shipping_id
    ) {
      const record = await this.audit.getShipping(input.shipping_id);

      if (!record) {
        throw new NotFoundException({
          error: {
            code: 'not_found',
            message: 'Mensagem não encontrada',
          },
        });
      }

      // Conteúdo inline (campo `message` do detailed report) tem precedência; `contentRef` (cache S3)
      // é fallback para o caso de a fonte voltar a usar ponteiro externo.
      const raw = record.content
        ?? (record.contentRef
          ? await this.cache.getText(record.contentRef)
          : null);

      text = nonEmpty(raw?.trim());
    }

    if (!text) {
      throw new BadRequestException({
        error: {
          code: 'invalid_request',
          message: 'Forneça "text" ou um "shipping_id" com conteúdo disponível para análise',
        },
      });
    }

    return analyzeRisk(text);
  }
}
