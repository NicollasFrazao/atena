import type { ApiErrorInterface } from '@atena/types';
import { API_URL } from './config';
import { HTTP_STATUS_NO_CONTENT, HTTP_STATUS_UNAUTHORIZED } from './http-status';

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

/**
 * The JSON body of an error response as it may really arrive: a gateway, a proxy or a crash can
 * answer with any JSON (or none), so every level of the contract shape may be missing.
 */
export type ApiErrorBodyType = {
  error?: Partial<ApiErrorInterface['error']>;
} | null;

/**
 * The fetch options {@link apiFetch} accepts. Headers are a plain record because they are merged
 * over the default `Content-Type` by spreading.
 */
export type ApiFetchInitType = Omit<RequestInit, 'headers'> & {
  headers?: Record<string, string>;
};

/** Handler de 401 (sessão expirada) registrado pelo App p/ abrir o overlay. */
let unauthorizedHandler: (() => void) | null = null;

/**
 * Registra o callback chamado quando a API responde 401 (sessão expirada).
 *
 * @param handler - Ação (ex.: abrir overlay de re-login).
 */
export function setUnauthorizedHandler(handler: () => void): void {
  unauthorizedHandler = handler;
}

/**
 * Dispara o handler de 401 (sessão expirada). Exposto porque o stream SSE do chat (`sse.ts`) não
 * passa pelo `apiFetch`, mas precisa abrir o MESMO overlay de re-login num 401.
 */
export function notifyUnauthorized(): void {
  unauthorizedHandler?.();
}

/**
 * Fetch tipado contra a API da Atena (prefixo `/api`, JSON, shape de erro do contrato).
 * Em 401, dispara o handler de sessão expirada antes de lançar.
 *
 * @param path - Caminho sob `/api` (ex.: `/chat/sessions`).
 * @param [init] - Opções do fetch (method/body/headers).
 *
 * @returns Corpo JSON tipado (ou `undefined` em 204).
 *
 * @throws {ApiError} Em respostas não-2xx (incluindo 401).
 *
 * @template T - Tipo do corpo de resposta esperado.
 */
export async function apiFetch<T>(
  path: string,
  init?: ApiFetchInitType,
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

  if (response.status === HTTP_STATUS_UNAUTHORIZED) {
    notifyUnauthorized();

    throw new ApiError(
      'unauthorized',
      'Sessão expirada',
      HTTP_STATUS_UNAUTHORIZED,
    );
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ApiErrorBodyType;

    throw new ApiError(
      body?.error?.code ?? 'error',
      body?.error?.message ?? response.statusText,
      response.status,
    );
  }

  if (response.status === HTTP_STATUS_NO_CONTENT) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}
