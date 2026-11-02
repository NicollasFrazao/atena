import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type {
  AuditLogEntryInterface,
  AuditSummaryInterface,
  AuditUserOptionInterface,
  PaginatedEnvelopeInterface,
} from '@atena/types';
import { triggerBlobDownload } from '../util/download';
import { apiFetch } from './client';

/** Filtros da listagem do audit log. */
export interface AuditQueryInterface {
  action?: string;
  pii_only?: boolean;
  search?: string;
  user_id?: string;
  from?: string;
  to?: string;
  page?: number;
}

/** Monta a query-string (omite vazios). */
function toQuery(query: AuditQueryInterface): string {
  const params = new URLSearchParams();

  if (query.action) {
    params.set(
      'action',
      query.action,
    );
  }

  if (query.pii_only) {
    params.set(
      'pii_only',
      'true',
    );
  }

  if (query.search) {
    params.set(
      'search',
      query.search,
    );
  }

  if (query.user_id) {
    params.set(
      'user_id',
      query.user_id,
    );
  }

  if (query.from) {
    params.set(
      'from',
      query.from,
    );
  }

  if (query.to) {
    params.set(
      'to',
      query.to,
    );
  }

  if (query.page) {
    params.set(
      'page',
      String(query.page),
    );
  }

  const qs = params.toString();

  return qs
    ? `?${qs}`
    : '';
}

/**
 * Lista registros do audit log (`GET /audit`).
 *
 * @param query - Filtros + paginação.
 *
 * @returns Página de registros.
 */
function listAudit(
  query: AuditQueryInterface,
): Promise<PaginatedEnvelopeInterface<AuditLogEntryInterface>> {
  return apiFetch(`/audit${toQuery(query)}`);
}

/**
 * Query da listagem do audit log (react-query), reativa aos filtros.
 *
 * @param query - Filtros + paginação.
 *
 * @returns Estado da query.
 */
export function useAudit(
  query: AuditQueryInterface,
): UseQueryResult<PaginatedEnvelopeInterface<AuditLogEntryInterface>> {
  return useQuery({
    queryKey: [
      'audit',
      query,
    ],
    queryFn: () => listAudit(query),
  });
}

/**
 * Query dos contadores do topo (`GET /audit/summary`).
 *
 * @returns Estado da query.
 */
export function useAuditSummary(): UseQueryResult<AuditSummaryInterface> {
  return useQuery({
    queryKey: [
      'audit',
      'summary',
    ],
    queryFn: () => apiFetch<AuditSummaryInterface>('/audit/summary'),
  });
}

/**
 * Query dos usuários distintos do log (para o filtro de usuário).
 *
 * @returns Usuários distintos (id + nome de exibição).
 */
export function useAuditUsers(): UseQueryResult<AuditUserOptionInterface[]> {
  return useQuery({
    queryKey: [
      'audit',
      'users',
    ],
    queryFn: () => apiFetch<AuditUserOptionInterface[]>('/audit/users'),
  });
}

/**
 * Baixa os registros que casam os filtros como arquivo JSONL (um JSON por linha). Busca via
 * `GET /audit/export` (sem paginação, até o teto do servidor) e dispara o download no navegador.
 *
 * @param query - Filtros atuais (paginação ignorada).
 *
 * @returns Resolve quando o download é disparado.
 */
export async function downloadAuditJsonl(query: AuditQueryInterface): Promise<void> {
  const rows = await apiFetch<AuditLogEntryInterface[]>(`/audit/export${toQuery({
    ...query,
    page: undefined,
  })}`);

  const jsonl = rows.map((row) => JSON.stringify(row)).join('\n');

  const blob = new Blob(
    [jsonl],
    { type: 'application/x-ndjson' },
  );

  // Usa o helper (append no DOM + revoga a object URL no próximo tick): revogar na mesma stack do
  // `click()` cancela o download no Chromium, e o `<a>` fora do DOM não dispara no Firefox.
  triggerBlobDownload(
    blob,
    'audit-log.jsonl',
  );
}
