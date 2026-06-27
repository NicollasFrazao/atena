import { expect, test, type Locator, type Page } from '@playwright/test';
import { installMockApi } from './fixtures/mock-api';

/** Uma rota do nav + uma âncora estável que prova que a página montou. */
interface NavCase {
  label: string;
  path: string;
  /** `primary` fica na topbar; `admin` vive no dropdown "Admin" (precisa abrir antes de clicar). */
  group: 'primary' | 'admin';
  anchor: (page: Page) => Locator;
}

const CASES: NavCase[] = [
  {
    label: 'Incidentes',
    path: '/incidentes',
    group: 'primary',
    anchor: (page) => page.getByPlaceholder(/Buscar por código, cliente/i),
  },
  {
    label: 'Relatórios',
    path: '/relatorios',
    group: 'primary',
    anchor: (page) => page.getByPlaceholder(/Cliente \(id\)/i),
  },
  {
    label: 'Histórico',
    path: '/historico',
    group: 'primary',
    anchor: (page) => page.getByPlaceholder(/Buscar por código, título/i),
  },
  {
    label: 'Regras de anomalia',
    path: '/regras',
    group: 'admin',
    anchor: (page) => page.getByText(
      'Queda de entrega por cliente',
      { exact: false },
    ).first(),
  },
  {
    label: 'Observabilidade',
    path: '/observabilidade',
    group: 'admin',
    anchor: (page) => page.getByText(/Amazon Nova Pro/i).first(),
  },
  {
    label: 'Audit log',
    path: '/auditoria',
    group: 'admin',
    anchor: (page) => page.getByPlaceholder(/Buscar por recurso/i),
  },
  {
    label: 'Usuários e acessos',
    path: '/admin/usuarios',
    group: 'admin',
    anchor: (page) => page.getByPlaceholder(/Buscar por nome ou e-mail/i),
  },
];

/** Abre o dropdown "Admin" da topbar (onde vivem regras/observabilidade/audit/usuários). */
async function openAdminMenu(page: Page): Promise<void> {
  // `exact` evita casar o botão de perfil ("… Administrador").
  await page.getByRole(
    'button',
    {
      name: 'Admin',
      exact: true,
    },
  ).click();
}

/**
 * Navegação autenticada: a partir do Assistente (`/`), abre o item do nav e confere que a URL muda
 * e a página renderiza (âncora estável). Cada página carrega seus dados via fixtures.
 */
test.describe('Navegação (autenticado)', () => {
  test.beforeEach(async ({ page }) => {
    await installMockApi(page);
    await page.goto('/');
    await expect(page.getByRole(
      'link',
      { name: 'Assistente' },
    ).first()).toBeVisible();
  });

  for (const navCase of CASES) {
    test(`navega para ${navCase.label}`, async ({ page }) => {
      if (navCase.group === 'admin') {
        await openAdminMenu(page);
      }

      await page.getByRole(
        'link',
        { name: navCase.label },
      ).first().click();

      // `/` não é metacaractere de regex — o path entra literal.
      await expect(page).toHaveURL(new RegExp(`${navCase.path}$`));
      await expect(navCase.anchor(page)).toBeVisible();
    });
  }

  test('volta para o Assistente (/) e mostra o campo de pergunta', async ({ page }) => {
    await page.getByRole(
      'link',
      { name: 'Incidentes' },
    ).first().click();
    await expect(page).toHaveURL(/\/incidentes$/);

    await page.getByRole(
      'link',
      { name: 'Assistente' },
    ).first().click();
    await expect(page).toHaveURL(/localhost:\d+\/$/);
    await expect(page.getByPlaceholder(/Pergunte algo/i)).toBeVisible();
  });
});
