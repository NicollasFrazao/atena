// ESLint flat config of the web app (React + TypeScript). It inherits the shared base
// (../../eslint.shared.mjs) and adds only what is specific to the frontend: hooks, react-refresh
// and browser globals.
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import { sharedConfigs, testOverrides } from '../../eslint.shared.mjs';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  ...sharedConfigs({
    tsconfigRootDir: import.meta.dirname,
    allowDefaultProject: ['playwright.config.ts'],
  }),
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'error',
        { allowConstantExport: true },
      ],
    },
  },
  {
    files: [
      '**/*.spec.{ts,tsx}',
      'e2e/**/*.ts',
    ],
    ...testOverrides,
  },
);
