import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type {
  ChatMessageInterface,
  ChatSessionListItemInterface,
} from '@atena/types';
import { apiFetch } from './client';

/**
 * Lista as sessões de chat (mais recentes primeiro): `GET /chat/sessions`.
 *
 * @returns Resumo das sessões.
 */
export function listSessions(): Promise<ChatSessionListItemInterface[]> {
  return apiFetch('/chat/sessions');
}

/**
 * Mensagens persistidas de uma sessão, em ordem cronológica: `GET /chat/sessions/:id/messages`.
 *
 * @param id - Id da sessão.
 *
 * @returns Mensagens da sessão.
 */
export function getSessionMessages(id: string): Promise<ChatMessageInterface[]> {
  return apiFetch(`/chat/sessions/${id}/messages`);
}

/**
 * Renomeia uma sessão (título do cabeçalho/histórico): `PATCH /chat/sessions/:id`.
 *
 * @param id - Id da sessão.
 * @param title - Novo título (1–200 chars).
 *
 * @returns Sessão renomeada.
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
 * @param id - Id da sessão.
 * @param pinned - `true` fixa, `false` desafixa.
 *
 * @returns Sessão atualizada.
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
 * @returns Estado da query.
 */
export function useSessions(): UseQueryResult<ChatSessionListItemInterface[]> {
  return useQuery({
    queryKey: ['sessions'],
    queryFn: listSessions,
  });
}
