import { expect, test } from '@playwright/test';
import { installMockApi } from './fixtures/mock-api';

/**
 * Gate de autenticação do `AuthProvider`: o boot consulta `/auth/me` e decide entre login,
 * acesso pendente e app montado. Hermético — `/auth/me` é mockado por cenário.
 */
test.describe(
  'Autenticação (gate)',
  () => {
    test('sem sessão (401) → tela de login', async ({ page }) => {
      await installMockApi(
        page,
        { scenario: 'unauthenticated' },
      );

      await page.goto('/');

      await expect(page.getByRole(
        'button',
        { name: /Entrar com SSO/i },
      )).toBeVisible();

      // Não montou o app.
      await expect(page.getByRole(
        'link',
        { name: 'Assistente' },
      )).toHaveCount(0);
    });

    test('autenticado → app monta com o nav (inclui admin) e o nome do usuário', async ({ page }) => {
      await installMockApi(page);
      await page.goto('/');

      await expect(page.getByRole(
        'link',
        { name: 'Assistente' },
      ).first()).toBeVisible();

      await expect(page.getByRole(
        'link',
        { name: 'Relatórios' },
      ).first()).toBeVisible();

      await expect(page.getByText('E2E Tester').first()).toBeVisible();

      // Item de admin (`users:manage`) vive no dropdown "Admin" — abre e confere.
      // `exact` evita casar o botão de perfil ("… Administrador").
      await page.getByRole(
        'button',
        {
          name: 'Admin',
          exact: true,
        },
      ).click();

      await expect(page.getByRole(
        'link',
        { name: 'Usuários e acessos' },
      ).first()).toBeVisible();
    });

    test('autenticado SEM papel → acesso pendente (não monta o app)', async ({ page }) => {
      await installMockApi(
        page,
        { scenario: 'pending' },
      );

      await page.goto('/');

      await expect(page.getByRole(
        'heading',
        { name: /Acesso pendente/i },
      )).toBeVisible();

      await expect(page.getByRole(
        'link',
        { name: 'Assistente' },
      )).toHaveCount(0);
    });
  },
);
