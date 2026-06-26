import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { ObservabilityInterface } from '@atena/types';
import { apiFetch } from './client';

/**
 * Snapshot de observabilidade do assistente (`GET /observability`) por janela temporal.
 *
 * @param {string} window - Janela (`24h`/`7d`/`30d`/`all`).
 * @returns {Promise<ObservabilityInterface>} Métricas agregadas (sem PII).
 */
export function getObservability(window: string): Promise<ObservabilityInterface> {
  return apiFetch(`/observability?window=${encodeURIComponent(window)}`);
}

/**
 * Query do snapshot de observabilidade (react-query) por janela; atualiza a cada 30s.
 *
 * @param {string} window - Janela (`24h`/`7d`/`30d`/`all`).
 * @returns {UseQueryResult<ObservabilityInterface>} Estado da query.
 */
export function useObservability(window: string): UseQueryResult<ObservabilityInterface> {
  return useQuery({
    queryKey: [
      'observability',
      window,
    ],
    queryFn: () => getObservability(window),
    refetchInterval: 30_000,
  });
}
