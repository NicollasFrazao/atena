// Vitest config of the repository root: the tests of the tooling (local ESLint rules and the
// context surfaces script). The workspaces have their own test runners.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'eslint-rules/**/*.test.mjs',
      'scripts/**/*.test.mjs',
    ],
  },
});
