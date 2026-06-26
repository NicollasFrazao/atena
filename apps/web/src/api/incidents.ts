import { useQuery, type UseQueryResult } from '@tanstack/react-query';
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
 * @param {IncidentsQueryInterface} query - Filtros/paginação.
 * @returns {Promise<PaginatedEnvelopeInterface<IncidentInterface>>} Página de incidentes.
 */
export function listIncidents(
  query: IncidentsQueryInterface,
): Promise<PaginatedEnvelopeInterface<IncidentInterface>> {
  return apiFetch(`/incidents${toQuery(query)}`);
}

/**
 * Busca um incidente e suas atividades pelo id.
 *
 * @param {string} id - Id do incidente.
 * @returns {Promise<IncidentDetailInterface>} Incidente + atividades.
 */
export function getIncident(id: string): Promise<IncidentDetailInterface> {
  return apiFetch(`/incidents/${id}`);
}

/**
 * Query do incidente + atividades (habilitada só quando `id` é não-nulo).
 *
 * @param {string | null} id - Id do incidente (ou `null` para desabilitar).
 * @returns {UseQueryResult<IncidentDetailInterface>} Estado da query.
 */
export function useIncidentDetail(id: string | null): UseQueryResult<IncidentDetailInterface> {
  return useQuery({
    queryKey: [
      'incident',
      id,
    ],
    queryFn: () => getIncident(id as string),
    enabled: id !== null,
  });
}

/**
 * Busca a amostra REAL de envios relacionados ao incidente (`GET /incidents/:id/shippings`).
 *
 * @param {string} id - Id do incidente.
 * @param {number} [limit] - Tamanho da amostra (omitido = default do servidor; maior p/ o download CSV).
 * @returns {Promise<IncidentShippingsInterface>} Amostra (rows + total) ou `available: false`.
 */
export function getIncidentShippings(
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
 * @param {string} id - Id do incidente.
 * @returns {Promise<void>} Resolve quando o download é disparado.
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
 * @param {string | null} id - Id do incidente (ou `null` para desabilitar).
 * @returns {UseQueryResult<IncidentShippingsInterface>} Estado da query.
 */
export function useIncidentShippings(id: string | null): UseQueryResult<IncidentShippingsInterface> {
  return useQuery({
    queryKey: [
      'incident-shippings',
      id,
    ],
    queryFn: () => getIncidentShippings(id as string),
    enabled: id !== null,
  });
}

/**
 * Reconhece um incidente (`detected` → `acknowledged`): `POST /incidents/:id/acknowledge`.
 *
 * @param {string} id - Id do incidente.
 * @returns {Promise<IncidentDetailInterface>} Incidente atualizado + atividades.
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
 * @param {string} id - Id do incidente.
 * @param {ResolveIncidentPayload} payload - Categoria/descrição da ação (+ escalonamento/tags).
 * @returns {Promise<IncidentDetailInterface>} Incidente resolvido + atividades.
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
 * @param {IncidentsQueryInterface} query - Filtros/paginação.
 * @returns {UseQueryResult<PaginatedEnvelopeInterface<IncidentInterface>>} Estado da query.
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
 * @returns {UseQueryResult<number>} Total de incidentes abertos.
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
