/** Jest (ts-jest) do backend da Atena. Compila os testes como CommonJS
 * (override do `nodenext` do tsconfig base, que o Jest/CJS não consome direto). */
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
  moduleNameMapper: {
    '^@atena/types$': '<rootDir>/../../packages/types/src/index.ts',
  },
};
