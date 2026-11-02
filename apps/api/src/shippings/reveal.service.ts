import { Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { RevealedContentInterface, RevealedPhoneInterface } from '@atena/types';
import { AUDIT_QUERY, type AuditQueryServiceInterface } from '../audit-query/audit-query.interface';
import type { AuditWindowInterface } from '../audit-query/audit-query.types';
import { CONTENT_CACHE, type ContentCacheInterface } from '../cache/content-cache.interface';

/**
 * Reveal de PII (Fase 1): telefone completo e conteúdo bruto do envio.
 *
 * O mascaramento é o padrão (search/trail); este serviço expõe o dado completo SOMENTE sob
 * demanda explícita. Cada chamada é auditada na borda como `reveal_phone`/`reveal_content`
 * (severidade `pii`) — o valor sensível vai só na RESPOSTA, nunca no audit log nem em logs de app.
 *
 * O registro (telefone / `content_ref`) vem do {@link AuditQueryServiceInterface} (S3 fonte de
 * verdade); o conteúdo bruto é hidratado pelo {@link ContentCacheInterface} (`/tmp`↔S3).
 *
 * @see AuditQueryServiceInterface - registro de entrega (telefone / `content_ref`).
 * @see ContentCacheInterface - hidratação do conteúdo bruto.
 */
@Injectable()
export class RevealService {
  /**
   * @param audit - Motor de consulta (telefone / `content_ref`).
   * @param cache - Cache read-through `/tmp`↔S3 do conteúdo bruto.
   */
  constructor(
    @Inject(AUDIT_QUERY) private readonly audit: AuditQueryServiceInterface,
    @Inject(CONTENT_CACHE) private readonly cache: ContentCacheInterface,
  ) {}

  /**
   * Revela o telefone completo (E.164) de um envio.
   *
   * @param shippingId - Id do envio.
   * @param [window] - Janela do contexto (mesma do search/trilha); evita o
   *   scan frio de ~30 dias que estoura timeout num lookup pontual por id.
   *
   * @returns `{ shipping_id, phone_full }` (não mascarado).
   *
   * @throws {NotFoundException} Se o envio não existir.
   */
  async revealPhone(
    shippingId: string,
    window?: AuditWindowInterface,
  ): Promise<RevealedPhoneInterface> {
    // `expand: false` → varre só a janela do contexto (~1 dia), não ±lateStatusBuffer (~6 dias): o
    // telefone está no evento `queued` do próprio dia; o desfecho terminal é irrelevante p/ o reveal.
    const record = await this.audit.getShipping(
      shippingId,
      window,
      false,
    );

    if (!record) {
      throw new NotFoundException({
        error: {
          code: 'not_found',
          message: 'Mensagem não encontrada',
        },
      });
    }

    return {
      shipping_id: shippingId,
      phone_full: record.phoneE164,
    };
  }

  /**
   * Revela o conteúdo bruto de um envio (hidratado do S3 via `content_ref`).
   *
   * @param shippingId - Id do envio.
   * @param [window] - Janela do contexto (mesma do search/trilha); evita o
   *   scan frio de ~30 dias que estoura timeout num lookup pontual por id.
   *
   * @returns `{ shipping_id, content_preview }`.
   *
   * @throws {NotFoundException} Se o envio não existir.
   * @throws {UnprocessableEntityException} Se não houver `content_ref` ou o conteúdo não puder ser hidratado.
   */
  async revealContent(
    shippingId: string,
    window?: AuditWindowInterface,
  ): Promise<RevealedContentInterface> {
    // `expand: false` → só a janela do contexto (~1 dia): o texto do SMS está no evento do próprio
    // envio; dispensa expandir ±lateStatusBuffer p/ um lookup pontual por id.
    const record = await this.audit.getShipping(
      shippingId,
      window,
      false,
    );

    if (!record) {
      throw new NotFoundException({
        error: {
          code: 'not_found',
          message: 'Mensagem não encontrada',
        },
      });
    }

    // O detailed report carrega o texto do SMS inline (record.content); o `content_ref` (cache S3)
    // fica como fallback caso a fonte mude para ponteiro externo no futuro.
    const inline = record.content !== null && record.content !== ''
      ? record.content
      : null;

    const content = inline
      ?? (record.contentRef
        ? await this.cache.getText(record.contentRef)
        : null);

    if (content === null) {
      throw new UnprocessableEntityException({
        error: {
          code: 'content_unavailable',
          message: 'Conteúdo indisponível para esta mensagem',
        },
      });
    }

    return {
      shipping_id: shippingId,
      content_preview: content,
    };
  }
}
