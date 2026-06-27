import { defineConfig, devices } from '@playwright/test';

/**
 * Configuração do Playwright (e2e de browser do web da Atena).
 *
 * A suíte é HERMÉTICA: nenhum backend/S3/STS é necessário. O app buildado é servido pelo
 * `vite preview` e TODAS as chamadas (`/api/**`) são interceptadas e respondidas com fixtures
 * sintéticas (ver `e2e/fixtures/`). Por isso o build roda com `VITE_API_URL`/`VITE_WS_URL`
 * VAZIOS: o cliente passa a chamar caminhos RELATIVOS (`/api/...`), mesma-origem da preview —
 * sem CORS e sem depender de porta/host.
 *
 * Pré-requisito: `@atena/types` buildado (`npm run build -w @atena/types`) — o build do web o importa.
 */
const PORT = 4173;

export default defineConfig({
  testDir: './e2e',
  // CI: sem retry "mascarando" flake; falha é falha. Local: idem (suíte determinística).
  retries: 0,
  fullyParallel: true,
  // Em CI, proíbe `test.only` esquecido e limita workers (runner compartilhado).
  forbidOnly: !!process.env.CI,
  workers: process.env.CI
    ? 2
    : undefined,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
    // Sem realtime no e2e: o socket.io é abortado nas fixtures; nada de polling pendurado.
    actionTimeout: 10_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    // Build (mesma-origem) + serve estático. Reusa um preview já de pé localmente.
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    env: {
      VITE_API_URL: '',
      VITE_WS_URL: '',
    },
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
