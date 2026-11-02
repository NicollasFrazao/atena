// ESLint flat config of the shared types package (@atena/types), on the shared base
// (../../eslint.shared.mjs).
import tseslint from 'typescript-eslint';
import { sharedConfigs } from '../../eslint.shared.mjs';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
    ],
  },
  ...sharedConfigs({ tsconfigRootDir: import.meta.dirname }),
);
