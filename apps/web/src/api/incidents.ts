import { skipToken, useQuery, type UseQueryResult } from '@tanstack/react-query';
import type {
  IncidentActivityInterface,
  IncidentInterface,
  IncidentShippingsInterface,
  PaginatedEnvelopeInterface,
  ResolveIncidentPayload,
} from '@atena/types';
import { downloadFile } from '../util/download';
import { apiFetch } from './client';
import { API_URL } from './config';

/** Filtros da listagem de incidentes (CSV nos campos multivalorados; "open" = detected+acknowledged). */
export interface IncidentsQueryInterface {
  status?: string;
  severity?: string;
  dimension?: string;
  shadow?: string;
  page?: number;
  limit?: number;
}

/** Incidente + atividades (resposta do GET /incidents/:id). */
export type IncidentDetailInterface = IncidentInterface & {
  activities: IncidentActivityInterface[];
};

/** Monta a query-string a partir dos filtros (omite os vazios). */
function toQuery(query: IncidentsQueryInterface): string {
  const params = new URLSearchParams();

  if (query.status) {
    params.set(
      'status',
      query.status,
    );
  }

  if (query.severity) {
    params.set(
      'severity',
      query.severity,
    );
  }

  if (query.dimension) {
    params.set(
      'dimension',
      query.dimension,
    );
  }

  if (query.shadow) {
    params.set(
      'shadow',
      query.shadow,
    );
  }

  if (query.page) {
    params.set(
      'page',
      String(query.page),
    );
  }

  if (query.limit) {
    params.set(
      'limit',
      String(query.limit),
    );
  }

  const qs = params.toString();

  return qs
    ? `?${qs}`
    : '';
}

/**
 * Lista incidentes (envelope paginado) conforme os filtros.
 *
 * @param query - Filtros/paginação.
 *
 * @returns Página de incidentes.
 */
function listIncidents(
  query: IncidentsQueryInterface,
): Promise<PaginatedEnvelopeInterface<IncidentInterface>> {
  return apiFetch(`/incidents${toQuery(query)}`);
}

/**
 * Busca um incidente e suas atividades pelo id.
 *
 * @param id - Id do incidente.
 *
 * @returns Incidente + atividades.
 */
function getIncident(id: string): Promise<IncidentDetailInterface> {
  return apiFetch(`/incidents/${id}`);
}

/**
 * Query do incidente + atividades (habilitada só quando `id` é não-nulo).
 *
 * @param id - Id do incidente (ou `null` para desabilitar).
 *
 * @returns Estado da query.
 */
export function useIncidentDetail(id: string | null): UseQueryResult<IncidentDetailInterface> {
  return useQuery({
    queryKey: [
      'incident',
      id,
    ],
    queryFn: id === null
      ? skipToken
      : () => getIncident(id),
  });
}

/**
 * Busca a amostra REAL de envios relacionados ao incidente (`GET /incidents/:id/shippings`).
 *
 * @param id - Id do incidente.
 * @param [limit] - Tamanho da amostra (omitido = default do servidor; maior p/ o download CSV).
 *
 * @returns Amostra (rows + total) ou `available: false`.
 */
function getIncidentShippings(
  id: string,
  limit?: number,
): Promise<IncidentShippingsInterface> {
  const qs = limit === undefined
    ? ''
    : `?limit=${limit}`;

  return apiFetch(`/incidents/${id}/shippings${qs}`);
}

/**
 * Baixa os envios IMPACTADOS de um incidente (EXATAMENTE os ids do detector) como CSV, via
 * `GET /incidents/:id/shippings/export` — gerado no servidor em stream. O telefone sai **EM CLARO**;
 * o acesso é auditado no servidor (`export_report`, severidade `pii`). O arquivo já vem com BOM +
 * delimitador `;` (pronto para o Excel pt-BR).
 *
 * @param id - Id do incidente.
 *
 * @returns Resolve quando o download é disparado.
 *
 * @throws {Error} Se a resposta não for 2xx.
 */
export async function downloadIncidentExport(id: string): Promise<void> {
  await downloadFile(
    `${API_URL}/api/incidents/${id}/shippings/export`,
    `atena-incidente-${id}.csv`,
  );
}

/**
 * Query da amostra de envios relacionados (habilitada só com `id` não-nulo). Cache compartilhado
 * entre o detalhe do incidente e o modal de resolução (mesma queryKey).
 *
 * @param id - Id do incidente (ou `null` para desabilitar).
 *
 * @returns Estado da query.
 */
export function useIncidentShippings(id: string | null): UseQueryResult<IncidentShippingsInterface> {
  return useQuery({
    queryKey: [
      'incident-shippings',
      id,
    ],
    queryFn: id === null
      ? skipToken
      : () => getIncidentShippings(id),
  });
}

/**
 * Reconhece um incidente (`detected` → `acknowledged`): `POST /incidents/:id/acknowledge`.
 *
 * @param id - Id do incidente.
 *
 * @returns Incidente atualizado + atividades.
 */
export function acknowledgeIncident(id: string): Promise<IncidentDetailInterface> {
  return apiFetch(
    `/incidents/${id}/acknowledge`,
    { method: 'POST' },
  );
}

/**
 * Resolve um incidente manualmente (§D): `POST /incidents/:id/resolve`. As regras de tamanho da
 * descrição e a obrigatoriedade de `escalated_to` também são validadas no servidor.
 *
 * @param id - Id do incidente.
 * @param payload - Categoria/descrição da ação (+ escalonamento/tags).
 *
 * @returns Incidente resolvido + atividades.
 */
export function resolveIncident(
  id: string,
  payload: ResolveIncidentPayload,
): Promise<IncidentDetailInterface> {
  return apiFetch(
    `/incidents/${id}/resolve`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  );
}

/**
 * Query da listagem de incidentes (react-query), reativa aos filtros.
 *
 * @param query - Filtros/paginação.
 *
 * @returns Estado da query.
 */
export function useIncidents(
  query: IncidentsQueryInterface,
): UseQueryResult<PaginatedEnvelopeInterface<IncidentInterface>> {
  return useQuery({
    queryKey: [
      'incidents',
      query,
    ],
    queryFn: () => listIncidents(query),
  });
}

/**
 * Contagem de incidentes ABERTOS (detected+acknowledged) para o badge da navegação. Atualiza a cada
 * 30s; o invalidate por evento WS fica a cargo de quem escuta o socket.
 *
 * @returns Total de incidentes abertos.
 */
export function useOpenIncidentCount(): UseQueryResult<number> {
  return useQuery({
    queryKey: [
      'incidents',
      'open-count',
    ],
    queryFn: () => listIncidents({
      status: 'open',
      limit: 1,
    }).then((page) => page.total),
    refetchInterval: 30_000,
  });
}
