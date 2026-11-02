// ESLint flat config of the repository root: the tooling written in plain JavaScript (the local
// rules and their tests, the context scripts, the shared base and the tool configs). The
// workspaces have their own eslint.config.mjs, built on eslint.shared.mjs.
import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: [
      'apps/**',
      'packages/**',
      'node_modules/**',
      'coverage/**',
      '.context/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.{js,mjs}'],
    languageOptions: { globals: { ...globals.nodeBuiltin } },
    rules: {
      'no-var': 'error',
      'prefer-const': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-eval': 'error',
    },
  },
];
