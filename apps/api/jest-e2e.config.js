/**
 * Jest (ts-jest) — suíte e2e de INTEGRAÇÃO da Atena (MySQL real).
 * Casa só `*.e2e-spec.ts` (fora do `make test`); rode via `make test-e2e`,
 * que sobe o banco, migra, semeia e exporta DATABASE_URL.
 */
module.exports = {
  testEnvironment: 'node',
  moduleFileExtensions: [
    'js',
    'json',
    'ts',
  ],
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
    // ESM-only dependencies, compiled to CommonJS for Jest's runtime (Node 22 has no Jest
    // require(esm) support; that needs Node 24.9+).
    '^.+\\.js$': [
      'ts-jest',
      {
        tsconfig: {
          allowJs: true,
          module: 'commonjs',
          verbatimModuleSyntax: false,
        },
      },
    ],
  },
  transformIgnorePatterns: ['/node_modules/(?!(openid-client|oauth4webapi|jose)/)'],
  moduleNameMapper: {
    '^@atena/types$': '<rootDir>/../../packages/types/src/index.ts',
  },
};
