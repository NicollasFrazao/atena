// ESLint (flat config) do app web (React + TS). Herda a base compartilhada da Atena
// (../../eslint.shared.mjs: typescript-eslint + sonarjs/recommended + bloco estrito de code-style)
// e acrescenta só o específico de frontend: hooks, react-refresh e globals do browser.
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import { sharedConfigs } from '../../eslint.shared.mjs';

export default tseslint.config(
  { ignores: ['dist'] },
  ...sharedConfigs,
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
        'warn',
        { allowConstantExport: true },
      ],
    },
  },
);
