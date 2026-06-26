/** Jest (ts-jest) — suíte e2e de INTEGRAÇÃO da Atena (MySQL real).
 * Casa só `*.e2e-spec.ts` (fora do `make test`); rode via `make test-e2e`,
 * que sobe o banco, migra, semeia e exporta DATABASE_URL. */
module.exports = {
  testEnvironment: 'node',
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '\\.e2e-spec\\.ts$',
  testTimeout: 30000,
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'commonjs',
          moduleResolution: 'node',
          esModuleInterop: true,
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          verbatimModuleSyntax: false,
        },
      },
    ],
  },
  moduleNameMapper: {
    '^@atena/types$': '<rootDir>/../../packages/types/src/index.ts',
  },
};
