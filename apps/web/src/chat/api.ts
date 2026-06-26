import type {
  ChatMessageInterface,
  ChatSessionListItemInterface,
} from '@atena/types';
import { apiFetch } from '../api/client';

/** Cria uma sessão de chat (título opcional). */
export function createSession(title?: string): Promise<{ session_id: string }> {
  return apiFetch(
    '/chat/sessions',
    {
      method: 'POST',
      body: JSON.stringify({ title }),
    },
  );
}

/** Lista as sessões de chat do usuário (mais recentes primeiro). */
export function listSessions(): Promise<ChatSessionListItemInterface[]> {
  return apiFetch('/chat/sessions');
}

/** Histórico de mensagens de uma sessão (ordem cronológica). */
export function getMessages(sessionId: string): Promise<ChatMessageInterface[]> {
  return apiFetch(`/chat/sessions/${sessionId}/messages`);
}
