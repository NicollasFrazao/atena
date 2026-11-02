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
