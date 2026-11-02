/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const DEV_SERVER_PORT = 5173;

/**
 * The coverage gate of the standards is 80% on all four metrics. The web app is far below it:
 * the unit tests cover the logic modules (SSE parsing, reveal, formatting, time, the chat hook),
 * while the pages and components are covered only by the Playwright suite, which does not report
 * coverage. Until component tests exist, the gate is a ratchet at the measured floor, so coverage
 * cannot drop. Re-measured on 2026-11-02 with Vitest 5, whose AST-aware remapping counts branches
 * and functions differently from Vitest 2 (same tests): statements 17.39%, branches 14.31%,
 * functions 12.39%, lines 17.55%.
 * Raise these numbers with every test added, up to 80.
 * See .context/docs/tech-debt.md, "Web unit coverage below the 80% gate".
 */
const COVERAGE_FLOOR = {
  statements: 17,
  branches: 14,
  functions: 12,
  lines: 17,
};

/**
 * Vite config of the web app. `server.port` is 5173; the API is at `VITE_API_URL`
 * (default http://localhost:3000), with CORS already enabled on the backend.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: DEV_SERVER_PORT,
    strictPort: false,
  },
  test: {
    environment: 'node',
    // Vitest runs the unit tests in `src`; `e2e/**` are Playwright specs with their own runner.
    include: ['src/**/*.{spec,test}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.{spec,test}.{ts,tsx}',
        // Entry point: mounts the app into the DOM; the Playwright suite is its check.
        'src/main.tsx',
        'src/vite-env.d.ts',
      ],
      reporter: [
        'text-summary',
        'text',
        'lcov',
      ],
      thresholds: COVERAGE_FLOOR,
    },
  },
});
