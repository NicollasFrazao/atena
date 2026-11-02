/**
 * Jest (ts-jest) of the API. Tests are compiled as CommonJS (overriding the base tsconfig's
 * `nodenext`, which Jest's CommonJS runtime does not consume directly).
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
