import { expect, test } from '@playwright/test';
import { installMockApi } from './fixtures/mock-api';

/**
 * Relatório de entregabilidade: a página consome o stream SSE (`POST /reports/delivery/stream`),
 * que o mock responde com um frame `result` contendo o relatório sintético. Prova que o stream é
 * parseado e o detalhamento por provedor renderiza.
 */
test.describe(
  'Relatório de entregabilidade',
  () => {
    test('renderiza o detalhamento por provedor a partir do stream SSE mockado', async ({ page }) => {
      await installMockApi(page);
      await page.goto('/relatorios');

      // by_provider do relatório: nomes literais (sem depender de formatação numérica de locale).
      await expect(page.getByText(
        'sinch',
        { exact: false },
      ).first()).toBeVisible();

      await expect(page.getByText(
        'zapsms',
        { exact: false },
      ).first()).toBeVisible();
    });
  },
);
