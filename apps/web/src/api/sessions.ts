import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type {
  ChatMessageInterface,
  ChatSessionListItemInterface,
} from '@atena/types';
import { apiFetch } from './client';

/**
 * Lista as sessões de chat (mais recentes primeiro): `GET /chat/sessions`.
 *
 * @returns {Promise<ChatSessionListItemInterface[]>} Resumo das sessões.
 */
export function listSessions(): Promise<ChatSessionListItemInterface[]> {
  return apiFetch('/chat/sessions');
}

/**
 * Mensagens persistidas de uma sessão, em ordem cronológica: `GET /chat/sessions/:id/messages`.
 *
 * @param {string} id - Id da sessão.
 * @returns {Promise<ChatMessageInterface[]>} Mensagens da sessão.
 */
export function getSessionMessages(id: string): Promise<ChatMessageInterface[]> {
  return apiFetch(`/chat/sessions/${id}/messages`);
}

/**
 * Renomeia uma sessão (título do cabeçalho/histórico): `PATCH /chat/sessions/:id`.
 *
 * @param {string} id - Id da sessão.
 * @param {string} title - Novo título (1–200 chars).
 * @returns {Promise<{ session_id: string; title: string }>} Sessão renomeada.
 */
export function renameSession(
  id: string,
  title: string,
): Promise<{
  session_id: string;
  title: string
}> {
  return apiFetch(
    `/chat/sessions/${id}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    },
  );
}

/**
 * Fixa/desafixa uma sessão no histórico: `PATCH /chat/sessions/:id` com `{ pinned }`.
 *
 * @param {string} id - Id da sessão.
 * @param {boolean} pinned - `true` fixa, `false` desafixa.
 * @returns {Promise<{ session_id: string; title: string; pinned: boolean }>} Sessão atualizada.
 */
export function setSessionPinned(
  id: string,
  pinned: boolean,
): Promise<{
  session_id: string;
  title: string;
  pinned: boolean
}> {
  return apiFetch(
    `/chat/sessions/${id}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ pinned }),
    },
  );
}

/**
 * Query da lista de sessões (react-query).
 *
 * @returns {UseQueryResult<ChatSessionListItemInterface[]>} Estado da query.
 */
export function useSessions(): UseQueryResult<ChatSessionListItemInterface[]> {
  return useQuery({
    queryKey: ['sessions'],
    queryFn: listSessions,
  });
}

/**
 * Query das mensagens de uma sessão (habilitada só quando `id` é não-nulo).
 *
 * @param {string | null} id - Id da sessão (ou `null` para desabilitar).
 * @returns {UseQueryResult<ChatMessageInterface[]>} Estado da query.
 */
export function useSessionMessages(id: string | null): UseQueryResult<ChatMessageInterface[]> {
  return useQuery({
    queryKey: [
      'session-messages',
      id,
    ],
    queryFn: () => getSessionMessages(id as string),
    enabled: id !== null,
  });
}
