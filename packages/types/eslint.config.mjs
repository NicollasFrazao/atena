// ESLint (flat config) do pacote de tipos compartilhados (@atena/types).
// Herda a base da Atena (../../eslint.shared.mjs): typescript-eslint + sonarjs/recommended + estrito.
import tseslint from 'typescript-eslint';
import { sharedConfigs } from '../../eslint.shared.mjs';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
    ],
  },
  ...sharedConfigs,
);
