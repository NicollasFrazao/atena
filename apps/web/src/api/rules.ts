import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { AnomalyRuleInterface, UpdateRulePayload } from '@atena/types';
import { apiFetch } from './client';

/**
 * Lista todas as regras de anomalia (`GET /rules`).
 *
 * @returns Regras (snake_case).
 */
function listRules(): Promise<AnomalyRuleInterface[]> {
  return apiFetch('/rules');
}

/**
 * Edita campos permitidos de uma regra (`PUT /rules/:id`); `rule_type` é imutável. A alteração é
 * auditada no servidor.
 *
 * @param id - Id da regra.
 * @param payload - Campos a atualizar (parcial).
 *
 * @returns Regra atualizada.
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
 * @returns Estado da query.
 */
export function useRules(): UseQueryResult<AnomalyRuleInterface[]> {
  return useQuery({
    queryKey: ['rules'],
    queryFn: listRules,
  });
}
