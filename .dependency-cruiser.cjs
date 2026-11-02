// Layer rules, checked by `npm run check:architecture`. The reasoning is in
// .context/docs/architecture.md, "Layer rules".
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'A cycle makes load order matter and the module boundaries meaningless.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'types-package-imports-nothing',
      severity: 'error',
      comment: '@atena/types is the API contract: plain types, no runtime dependency, no app code.',
      from: { path: '^packages/types/src/' },
      to: { pathNot: '^packages/types/src/' },
    },
    {
      name: 'apps-do-not-import-each-other',
      severity: 'error',
      comment: 'The API and the web app share only @atena/types.',
      from: { path: '^apps/(api|web)/' },
      to: { path: '^apps/(api|web)/', pathNot: '^apps/$1/' },
    },
    {
      name: 'api-common-is-a-leaf',
      severity: 'error',
      comment: 'src/common and src/config are shared by every feature module, so they import none of them.',
      from: { path: '^apps/api/src/(common|config)/' },
      to: { path: '^apps/api/src/', pathNot: '^apps/api/src/(common|config)/' },
    },
    {
      name: 'api-nothing-imports-controllers',
      severity: 'error',
      comment: 'Controllers are the HTTP edge: modules register them, nothing else depends on them.',
      from: { path: '^apps/api/src/', pathNot: ['\\.module\\.ts$', '\\.spec\\.ts$'] },
      to: { path: '\\.controller\\.ts$' },
    },
    {
      name: 'api-dtos-are-leaves',
      severity: 'error',
      comment: 'DTOs describe request shapes: validation decorators and shared types only.',
      from: { path: '^apps/api/src/.+/dto/' },
      to: { path: '^apps/api/src/', pathNot: ['^apps/api/src/.+/dto/', '^apps/api/src/common/'] },
    },
    {
      name: 'web-data-layer-has-no-ui',
      severity: 'error',
      comment: 'src/api (HTTP client and queries) and src/util are below the components: they never import a .tsx module.',
      from: { path: '^apps/web/src/(api|util)/' },
      to: { path: '\\.tsx$' },
    },
    {
      name: 'web-util-is-a-leaf',
      severity: 'error',
      comment: 'src/util holds pure helpers used everywhere, so it imports no feature module.',
      from: { path: '^apps/web/src/util/' },
      to: { path: '^apps/web/src/', pathNot: '^apps/web/src/util/' },
    },
    {
      name: 'production-code-does-not-import-tests',
      severity: 'error',
      from: { path: '^(apps|packages)/[^/]+/src/', pathNot: '\\.(spec|e2e-spec)\\.tsx?$' },
      to: { path: '(\\.(spec|e2e-spec)\\.tsx?$|^apps/web/e2e/)' },
    },
    {
      name: 'not-to-unresolvable',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'no-orphans',
      severity: 'error',
      comment: 'A module nothing imports is dead code (entry points, tests and declaration files excepted).',
      from: {
        orphan: true,
        pathNot: [
          '^apps/api/src/main\\.ts$',
          '^apps/web/src/main\\.tsx$',
          // The package entry; the apps consume its build through the @atena/types package name.
          '^packages/types/src/index\\.ts$',
          '\\.(spec|e2e-spec)\\.tsx?$',
          '\\.d\\.ts$',
        ],
      },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(dist|coverage)/' },
    tsPreCompilationDeps: true,
    combinedDependencies: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.ts', '.tsx', '.js', '.mjs', '.d.ts'],
      mainFields: ['types', 'typings', 'module', 'main'],
    },
  },
};
