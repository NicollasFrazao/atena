// ESLint flat config of the API. The rules come from the shared base (../../eslint.shared.mjs).
import tseslint from 'typescript-eslint';
import { sharedConfigs, testOverrides } from '../../eslint.shared.mjs';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'prisma/migrations/**',
    ],
  },
  ...sharedConfigs({
    tsconfigRootDir: import.meta.dirname,
    allowDefaultProject: [
      'test-setup.ts',
      'prisma/seed.ts',
    ],
  }),
  {
    files: [
      '**/*.spec.ts',
      '**/*.e2e-spec.ts',
      'test-setup.ts',
    ],
    ...testOverrides,
  },
);
