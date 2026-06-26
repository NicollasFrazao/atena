import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { AnomalyRuleInterface, UpdateRulePayload } from '@atena/types';
import { apiFetch } from './client';

/**
 * Lista todas as regras de anomalia (`GET /rules`).
 *
 * @returns {Promise<AnomalyRuleInterface[]>} Regras (snake_case).
 */
export function listRules(): Promise<AnomalyRuleInterface[]> {
  return apiFetch('/rules');
}

/**
 * Edita campos permitidos de uma regra (`PUT /rules/:id`); `rule_type` é imutável. A alteração é
 * auditada no servidor.
 *
 * @param {string} id - Id da regra.
 * @param {UpdateRulePayload} payload - Campos a atualizar (parcial).
 * @returns {Promise<AnomalyRuleInterface>} Regra atualizada.
 */
export function updateRule(
  id: string,
  payload: UpdateRulePayload,
): Promise<AnomalyRuleInterface> {
  return apiFetch(
    `/rules/${id}`,
    {
      method: 'PUT',
      body: JSON.stringify(payload),
    },
  );
}

/**
 * Query da lista de regras (react-query).
 *
 * @returns {UseQueryResult<AnomalyRuleInterface[]>} Estado da query.
 */
export function useRules(): UseQueryResult<AnomalyRuleInterface[]> {
  return useQuery({
    queryKey: ['rules'],
    queryFn: listRules,
  });
}
