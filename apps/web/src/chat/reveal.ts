import type { RevealedContentInterface, RevealedPhoneInterface } from '@atena/types';
import { apiFetch } from '../api/client';

/** Janela temporal do contexto (a mesma do search/trilha) passada ao reveal. */
export interface RevealWindowInterface {
  date_from?: string;
  date_to?: string;
}

/**
 * Monta a query-string da janela (`?date_from=…&date_to=…`); vazia se nada vier. A janela escopa o
 * lookup por id no backend — sem ela, a varredura cai na janela default (~30 dias) e pode estourar.
 *
 * @param [window] - Datas do contexto.
 *
 * @returns A query-string (com `?`) ou string vazia.
 */
function windowQuery(window?: RevealWindowInterface): string {
  const params = new URLSearchParams();

  if (window?.date_from) {
    params.set(
      'date_from',
      window.date_from,
    );
  }

  if (window?.date_to) {
    params.set(
      'date_to',
      window.date_to,
    );
  }

  const query = params.toString();

  return query
    ? `?${query}`
    : '';
}

/**
 * Revela o telefone completo (PII) de um envio. O backend audita como `reveal_phone`
 * (severidade `pii`) — cada chamada é uma ação registrada; só dispare após confirmação do usuário.
 *
 * @param shippingId - Id do envio (o `id` da linha de busca / `shipping_id` da trilha).
 * @param [window] - Janela do contexto (mesma do search/trilha), escopa a busca.
 *
 * @returns `{ shipping_id, phone_full }` (telefone NÃO mascarado).
 */
export function revealPhone(
  shippingId: string,
  window?: RevealWindowInterface,
): Promise<RevealedPhoneInterface> {
  return apiFetch(
    `/shippings/${shippingId}/reveal-phone${windowQuery(window)}`,
    { method: 'POST' },
  );
}

/**
 * Revela o conteúdo bruto (PII) de um envio. O backend audita como `reveal_content`
 * (severidade `pii`) — cada chamada é uma ação registrada; só dispare após confirmação do usuário.
 *
 * @param shippingId - Id do envio (o `shipping_id` da trilha).
 * @param [window] - Janela do contexto (mesma do search/trilha), escopa a busca.
 *
 * @returns `{ shipping_id, content_preview }` (conteúdo em claro).
 */
export function revealContent(
  shippingId: string,
  window?: RevealWindowInterface,
): Promise<RevealedContentInterface> {
  return apiFetch(
    `/shippings/${shippingId}/reveal-content${windowQuery(window)}`,
    { method: 'POST' },
  );
}
