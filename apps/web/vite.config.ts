/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Config do Vite do app web da Atena. `server.port` 5173 (default); a API fica em
 * `VITE_API_URL` (default http://localhost:3000) — CORS já habilitado no backend.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false,
  },
  test: {
    environment: 'node',
    // Unit (vitest) vive em `src`. Os `e2e/**` são specs do Playwright (browser) — runner próprio.
    include: ['src/**/*.{spec,test}.{ts,tsx}'],
  },
});
