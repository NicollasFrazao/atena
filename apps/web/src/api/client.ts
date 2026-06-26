import type { ApiErrorInterface } from '@atena/types';
import { API_URL } from './config';

/** Erro de API no shape do contrato (`{ error: { code, message } }`) + status HTTP. */
export class ApiError extends Error {
  readonly code: string;

  readonly status: number;

  constructor(
    code: string,
    message: string,
    status: number,
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

/** Handler de 401 (sessão expirada) registrado pelo App p/ abrir o overlay. */
let unauthorizedHandler: (() => void) | null = null;

/**
 * Registra o callback chamado quando a API responde 401 (sessão expirada).
 *
 * @param {() => void} handler - Ação (ex.: abrir overlay de re-login).
 *
 * @returns {void}
 */
export function setUnauthorizedHandler(handler: () => void): void {
  unauthorizedHandler = handler;
}

/**
 * Dispara o handler de 401 (sessão expirada). Exposto porque o stream SSE do chat (`sse.ts`) não
 * passa pelo `apiFetch`, mas precisa abrir o MESMO overlay de re-login num 401.
 *
 * @returns {void}
 */
export function notifyUnauthorized(): void {
  unauthorizedHandler?.();
}

/**
 * Fetch tipado contra a API da Atena (prefixo `/api`, JSON, shape de erro do contrato).
 * Em 401, dispara o handler de sessão expirada antes de lançar.
 *
 * @template T - Tipo do corpo de resposta esperado.
 * @param {string} path - Caminho sob `/api` (ex.: `/chat/sessions`).
 * @param {RequestInit} [init] - Opções do fetch (method/body/headers).
 *
 * @returns {Promise<T>} Corpo JSON tipado (ou `undefined` em 204).
 * @throws {ApiError} Em respostas não-2xx (incluindo 401).
 */
export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(
    `${API_URL}/api${path}`,
    {
      ...init,
      // Envia o cookie de sessão (cross-origin web ↔ api); o backend responde com CORS credentials.
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...init?.headers,
      },
    },
  );

  if (response.status === 401) {
    notifyUnauthorized();

    throw new ApiError(
      'unauthorized',
      'Sessão expirada',
      401,
    );
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ApiErrorInterface | null;

    throw new ApiError(
      body?.error?.code ?? 'error',
      body?.error?.message ?? response.statusText,
      response.status,
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}
