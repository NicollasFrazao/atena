/**
 * Jest (ts-jest) of the API. Tests are compiled as CommonJS (overriding the base tsconfig's
 * `nodenext`, which Jest's CommonJS runtime does not consume directly). ESM-only dependencies
 * (NestJS 12, openid-client) load through Jest's native `require(esm)`, which needs Node 24.9+ and
 * `--experimental-vm-modules` (set by the `test` scripts).
 */
const COVERAGE_THRESHOLD = 80;

module.exports = {
  testEnvironment: 'node',
  moduleFileExtensions: [
    'js',
    'json',
    'ts',
  ],
  rootDir: '.',
  testRegex: '\\.spec\\.ts$',
  setupFiles: ['<rootDir>/test-setup.ts'],
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
  // `npm run test:coverage` measures every source file, not only those a test imports.
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.spec.ts',
    '!src/**/*.e2e-spec.ts',
    // Entry points only wire tested parts together: the Nest bootstrap and the APM preload.
    '!src/main.ts',
    '!src/tracing.ts',
  ],
  coverageReporters: [
    'text-summary',
    'text',
    'lcov',
    'json-summary',
  ],
  coverageThreshold: {
    global: {
      statements: COVERAGE_THRESHOLD,
      branches: COVERAGE_THRESHOLD,
      functions: COVERAGE_THRESHOLD,
      lines: COVERAGE_THRESHOLD,
    },
  },
  moduleNameMapper: {
    '^@atena/types$': '<rootDir>/../../packages/types/src/index.ts',
  },
};
