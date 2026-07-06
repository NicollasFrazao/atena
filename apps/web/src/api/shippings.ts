import { downloadFile } from '../util/download';
import { API_URL } from './config';

/** Filtros repassáveis ao `GET /shippings/export` (subconjunto dos args da tool de busca). */
export type SearchShippingsQuery = Record<string, string | number | undefined>;

/** Chaves de filtro aceitas (paginação não se aplica ao export — ele traz TODAS as linhas). */
const FILTER_KEYS = [
  'phone',
  'status',
  'provider',
  'channel',
  'error_hint',
  'customer_id',
  'campaign_id',
  'date_from',
  'date_to',
  'date_range',
];

/** Nome do arquivo do export de envios. */
const EXPORT_FILENAME = 'atena-envios.csv';

/**
 * Baixa TODOS os envios do filtro via `GET /shippings/export` — o CSV é gerado no servidor pelo
 * DuckDB (stream, sem teto de linhas), então o card do chat (1ª página) não limita o export. O
 * telefone sai **EM CLARO**; o acesso é auditado no servidor (`export_report`, severidade `pii`). O
 * arquivo já vem com BOM UTF-8 + delimitador `;` (pronto para o Excel pt-BR).
 *
 * @param {SearchShippingsQuery} query - Filtros da busca (mesmos args da tool).
 * @returns {Promise<void>} Resolve quando o download é disparado.
 * @throws {Error} Se a resposta não for 2xx.
 */
export async function downloadSearchExport(query: SearchShippingsQuery): Promise<void> {
  const params = new URLSearchParams();

  for (const key of FILTER_KEYS) {
    const value = query[key];

    if (
      value !== undefined
      && value !== ''
    ) {
      params.set(
        key,
        String(value),
      );
    }
  }

  // `token` = snapshot da busca: o servidor baixa o conjunto EXATO daquela busca (byte-exato, sem
  // re-scan). Sem token (ou expirado), o servidor cai no export por filtro (janela congelada).
  if (
    query.token !== undefined
    && query.token !== ''
  ) {
    params.set(
      'token',
      String(query.token),
    );
  }

  await downloadFile(
    `${API_URL}/api/shippings/export?${params.toString()}`,
    EXPORT_FILENAME,
  );
}
