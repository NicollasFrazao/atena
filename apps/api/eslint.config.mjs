// ESLint (flat config) do backend da Atena. As regras vêm da base compartilhada (../../eslint.shared.mjs):
// typescript-eslint recommended + sonarjs/recommended + bloco estrito (code-style.md).
import tseslint from 'typescript-eslint';
import { sharedConfigs } from '../../eslint.shared.mjs';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'prisma/migrations/**',
    ],
  },
  ...sharedConfigs,
);
