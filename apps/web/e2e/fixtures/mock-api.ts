import type { Page, Route } from '@playwright/test';
import {
  ADMIN_ROLES,
  ADMIN_USERS,
  AUDIT_LIST,
  AUDIT_SUMMARY,
  AUDIT_USERS,
  CHAT_SESSIONS,
  DELIVERY_REPORT,
  INCIDENTS,
  OBSERVABILITY,
  RULES,
  SESSION_USER,
} from './data';

/** Cenário de sessão que o mock de `/auth/me` encena. */
type AuthScenario = 'authenticated' | 'unauthenticated' | 'pending';

/** Opções do mock da API. */
interface MockOptions {
  scenario?: AuthScenario;
}

/** Responde a rota com JSON. */
async function json(
  route: Route,
  body: unknown,
  status = 200,
): Promise<void> {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

/**
 * Responde a rota com um stream SSE de um único frame `event: result`. O parser do web
 * (`streamDeliveryReport`) separa frames por `\n\n` e resolve no frame `result`.
 */
async function sse(
  route: Route,
  payload: unknown,
): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: 'text/event-stream',
    body: `event: result\ndata: ${JSON.stringify(payload)}\n\n`,
  });
}

/** Tabela GET (path relativo a `/api`, sem query) → fixture. */
const TABLE: Record<string, unknown> = {
  '/chat/sessions': CHAT_SESSIONS,
  '/incidents': INCIDENTS,
  '/rules': RULES,
  '/observability': OBSERVABILITY,
  '/audit': AUDIT_LIST,
  '/audit/summary': AUDIT_SUMMARY,
  '/audit/users': AUDIT_USERS,
  '/admin/users': ADMIN_USERS,
  '/admin/roles': ADMIN_ROLES,
};

/**
 * Instala o mock HERMÉTICO da API no `page`: intercepta `**​/api/**` com fixtures sintéticas e
 * aborta o handshake do socket.io (sem realtime no e2e). Deve ser chamado ANTES do `page.goto`,
 * pois o `AuthProvider` consulta `/auth/me` já no boot.
 *
 * @param page - Página do Playwright.
 * @param [options] - Cenário de sessão (default: `authenticated`).
 */
export async function installMockApi(
  page: Page,
  { scenario = 'authenticated' }: MockOptions = {},
): Promise<void> {
  // Realtime fora do escopo hermético: o app tolera o socket desconectado. O socket.io tenta tanto
  // o handshake HTTP (polling) quanto o upgrade WebSocket — `page.route` só cobre HTTP, então o WS
  // é interceptado à parte (handler vazio = não conecta a servidor nenhum, sem erro de handshake).
  await page.route(
    '**/socket.io/**',
    (route) => route.abort(),
  );

  await page.routeWebSocket(
    '**/socket.io/**',
    () => {
      // Sem realtime no e2e: WS interceptado e deixado mudo.
    },
  );

  await page.route(
    '**/api/**',
    async (route) => {
      const { pathname } = new URL(route.request().url());

      const path = pathname.replace(
        /^\/api/,
        '',
      ) || '/';

      if (path === '/auth/me') {
        if (scenario === 'unauthenticated') {
          return json(
            route,
            {
              error: {
                code: 'unauthorized',
                message: 'Sessão expirada',
              },
            },
            401,
          );
        }

        // `pending`: autenticado SEM papéis → o gate de acesso pendente (não monta o app).
        const user = scenario === 'pending'
          ? {
            ...SESSION_USER,
            roles: [],
            permissions: [],
          }
          : SESSION_USER;

        return json(
          route,
          user,
        );
      }

      // Relatório de entregabilidade: stream SSE.
      if (path === '/reports/delivery/stream') {
        return sse(
          route,
          DELIVERY_REPORT,
        );
      }

      if (path === '/reports/delivery') {
        return json(
          route,
          DELIVERY_REPORT,
          201,
        );
      }

      if (path in TABLE) {
        return json(
          route,
          TABLE[path],
        );
      }

      // GETs dinâmicos (drill-ins) não exercitados na navegação → lista vazia segura.
      return json(
        route,
        [],
      );
    },
  );
}
