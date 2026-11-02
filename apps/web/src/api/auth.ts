import type { SessionUserInterface } from '@atena/types';
import { apiFetch } from './client';
import { API_URL } from './config';

/**
 * Usuário autenticado da sessão atual: `GET /auth/me`.
 * Lança {@link ApiError} 401 se não houver sessão (cookie ausente/inválido) — o `AuthProvider`
 * usa isso para decidir entre tela de login e app.
 *
 * @returns Identidade da sessão (`sub`/`email`/`name`/`roles`).
 */
export function fetchMe(): Promise<SessionUserInterface> {
  return apiFetch('/auth/me');
}

/**
 * Encerra a sessão (limpa o cookie no backend): `POST /auth/logout`.
 *
 * @returns Resolve quando a sessão foi encerrada.
 */
export function logout(): Promise<void> {
  return apiFetch(
    '/auth/logout',
    { method: 'POST' },
  );
}

/**
 * URL absoluta do início do login OIDC (`GET /api/auth/login`). É uma navegação top-level do
 * navegador (não `fetch`), pois o fluxo redireciona para o IdP e volta.
 *
 * @returns URL para `window.location.href` no botão de login / re-login.
 */
export function loginUrl(): string {
  return `${API_URL}/api/auth/login`;
}
