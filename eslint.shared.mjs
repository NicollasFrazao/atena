// Shared ESLint base of the monorepo (API, web and @atena/types): the single source of the rules,
// so the workspaces cannot drift. Each workspace's eslint.config.mjs spreads `sharedConfigs` and
// adds only what is specific to it (web: React hooks and browser globals).
//
// Every rule is at "error" and the lint scripts run with --max-warnings 0, so every finding fails.
// The reasons behind the choices are in .context/docs/development-conventions.md.
import stylistic from '@stylistic/eslint-plugin';
import jsdoc from 'eslint-plugin-jsdoc';
import sonarjs from 'eslint-plugin-sonarjs';
import tseslint from 'typescript-eslint';
import blockMultiline from './eslint-rules/block-multiline.mjs';
import jsdocTagSpacing from './eslint-rules/jsdoc-tag-spacing.mjs';
import multilineIfCondition from './eslint-rules/multiline-if-condition.mjs';
import onePerLine from './eslint-rules/one-per-line.mjs';

const MAX_COGNITIVE_COMPLEXITY = 15;
const MAX_NESTING_DEPTH = 3;
const MAX_PARAMETERS = 4;
const MAX_LINE_LENGTH = 120;
const DUPLICATE_STRING_THRESHOLD = 3;

const local = {
  rules: {
    'block-multiline': blockMultiline,
    'jsdoc-tag-spacing': jsdocTagSpacing,
    'multiline-if-condition': multilineIfCondition,
    'one-per-line': onePerLine,
  },
};

/** Sonar rules on top of `recommended` (which already has the unused-code rules at error). */
const sonarRules = {
  ...sonarjs.configs.recommended.rules,
  'sonarjs/cognitive-complexity': ['error', MAX_COGNITIVE_COMPLEXITY],
  // Off in `recommended`, on here: dead code, duplication and needless indirection.
  'sonarjs/no-unused-function-argument': 'error',
  'sonarjs/no-duplicate-string': ['error', { threshold: DUPLICATE_STRING_THRESHOLD }],
  'sonarjs/no-collapsible-if': 'error',
  'sonarjs/prefer-immediate-return': 'error',
  'sonarjs/no-commented-code': 'error',
  'sonarjs/no-inconsistent-returns': 'error',
  'sonarjs/no-variable-usage-before-declaration': 'error',
};

const readabilityRules = {
  'max-depth': ['error', MAX_NESTING_DEPTH],
  '@typescript-eslint/max-params': ['error', { max: MAX_PARAMETERS }],
  curly: ['error', 'all'],
  eqeqeq: ['error', 'always', { null: 'ignore' }],
  // No one-letter names; generic type parameters are the exception.
  'id-length': ['error', { min: 2, properties: 'never', exceptions: ['T', 'K', 'V', 'U'] }],
  '@typescript-eslint/no-unused-vars': [
    'error',
    { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
  ],
  '@typescript-eslint/no-unused-expressions': 'error',
  '@typescript-eslint/no-magic-numbers': [
    'error',
    {
      ignore: [-1, 0, 1, 2],
      ignoreEnums: true,
      ignoreNumericLiteralTypes: true,
      ignoreReadonlyClassProperties: true,
      ignoreTypeIndexes: true,
      ignoreDefaultValues: true,
    },
  ],
  'local/block-multiline': 'error',
  'local/multiline-if-condition': 'error',
  'local/one-per-line': 'error',
};

const layoutRules = {
  '@stylistic/indent': ['error', 2],
  '@stylistic/no-tabs': 'error',
  '@stylistic/comma-dangle': ['error', 'always-multiline'],
  '@stylistic/max-len': [
    'error',
    {
      code: MAX_LINE_LENGTH,
      tabWidth: 2,
      ignoreComments: true,
      ignoreUrls: true,
      ignoreStrings: true,
      ignoreTemplateLiterals: true,
      ignoreRegExpLiterals: true,
    },
  ],
  '@stylistic/max-statements-per-line': ['error', { max: 1 }],
  '@stylistic/object-curly-newline': ['error', { multiline: true, consistent: true }],
  '@stylistic/multiline-ternary': ['error', 'always'],
  '@stylistic/padding-line-between-statements': [
    'error',
    { blankLine: 'always', prev: '*', next: 'return' },
    { blankLine: 'always', prev: '*', next: ['break', 'continue', 'throw'] },
    { blankLine: 'always', prev: 'multiline-block-like', next: '*' },
    { blankLine: 'always', prev: '*', next: 'multiline-block-like' },
    { blankLine: 'always', prev: 'multiline-const', next: '*' },
    { blankLine: 'always', prev: '*', next: 'multiline-const' },
    { blankLine: 'always', prev: 'multiline-let', next: '*' },
    { blankLine: 'always', prev: '*', next: 'multiline-let' },
    { blankLine: 'always', prev: 'multiline-expression', next: '*' },
    { blankLine: 'always', prev: '*', next: 'multiline-expression' },
  ],
  '@stylistic/lines-between-class-members': ['error', 'always'],
  '@stylistic/padded-blocks': ['error', 'never'],
  '@stylistic/no-multiple-empty-lines': ['error', { max: 1, maxBOF: 0, maxEOF: 0 }],
  '@stylistic/no-trailing-spaces': 'error',
  '@stylistic/eol-last': ['error', 'always'],
};

const documentationRules = {
  ...jsdoc.configs['flat/recommended-typescript-error'].rules,
  // Every exported symbol carries a doc comment (TSDoc). The fixer is off: it
  // inserts an empty block, which satisfies the rule and documents nothing.
  'jsdoc/require-jsdoc': [
    'error',
    {
      publicOnly: true,
      enableFixer: false,
      require: {
        ArrowFunctionExpression: true,
        ClassDeclaration: true,
        FunctionDeclaration: true,
        MethodDefinition: true,
      },
      contexts: [
        'TSInterfaceDeclaration',
        'TSTypeAliasDeclaration',
        'TSEnumDeclaration',
        'ExportNamedDeclaration > VariableDeclaration',
      ],
      checkConstructors: false,
    },
  ],
  // @param / @returns / @yields only when they add something the type does not say.
  'jsdoc/require-param': 'off',
  'jsdoc/require-returns': 'off',
  'jsdoc/require-yields': 'off',
  // A destructured parameter (React props, option objects) is documented as a whole
  // (`@param props - ...`); its members are documented on their type.
  'jsdoc/check-param-names': ['error', { checkDestructured: false }],
  // A function that throws says so with @throws.
  'jsdoc/require-throws': 'error',
  // TSDoc's `@throws {@link X}` and inline links are not JSDoc types.
  'jsdoc/valid-types': 'off',
  'jsdoc/check-tag-names': ['error', { typed: true, definedTags: ['remarks', 'privateRemarks', 'typeParam'] }],
  // One blank line after the summary; the blank lines between tags are the local rule's.
  'jsdoc/tag-lines': ['error', 'any', { startLines: 1 }],
  'jsdoc/sort-tags': [
    'error',
    {
      linesBetween: 1,
      tagSequence: ['remarks', 'typeParam', 'param', 'returns', 'throws', 'example', 'see'].map((tag) => ({ tags: [tag] })),
    },
  ],
  'jsdoc/require-throws-type': 'off',
  'local/jsdoc-tag-spacing': 'error',
};

/**
 * The configuration every workspace uses: typescript-eslint `strictTypeChecked` and
 * `stylisticTypeChecked` with type information from the workspace's tsconfig files, then the
 * project rules. Plain JavaScript files (configs, scripts) get the project rules without the
 * type-aware ones.
 *
 * @param {object} options - Where the workspace's tsconfig.json lives, and the few files outside
 *   any tsconfig that still need type information (`allowDefaultProject` globs).
 * @param {string} options.tsconfigRootDir - The workspace directory.
 * @param {string[]} [options.allowDefaultProject] - Files linted with the default project.
 * @returns {import('eslint').Linter.Config[]} The flat config entries.
 */
export function sharedConfigs({ tsconfigRootDir, allowDefaultProject = [] }) {
  return [
    ...tseslint.configs.strictTypeChecked,
    ...tseslint.configs.stylisticTypeChecked,
    {
      languageOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        parserOptions: {
          projectService: { allowDefaultProject },
          tsconfigRootDir,
        },
      },
      plugins: { '@stylistic': stylistic, jsdoc, sonarjs, local },
      settings: { jsdoc: { mode: 'typescript' } },
      rules: {
        ...sonarRules,
        ...readabilityRules,
        ...layoutRules,
        ...documentationRules,
        '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
        // Nest modules are empty classes whose content is the @Module() decorator.
        '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
      },
    },
    {
      files: ['**/*.{js,mjs,cjs}'],
      extends: [tseslint.configs.disableTypeChecked],
    },
  ];
}

/**
 * Tests: literals and repeated strings are the assertions themselves, and test helpers are not public API.
 * Jest's matchers (`expect.any`, `expect.objectContaining`), `mock.calls` and supertest's
 * `res.body` are typed `any` by the libraries, and `expect(mock.method)` passes a method by
 * reference on purpose, so the type-aware rules about `any` and unbound methods do not apply.
 */
export const testOverrides = {
  rules: {
    // A literal amount, status or delay is the readable form of a test case.
    '@typescript-eslint/no-magic-numbers': 'off',
    'sonarjs/no-duplicate-string': 'off',
    'jsdoc/require-jsdoc': 'off',
    '@typescript-eslint/unbound-method': 'off',
    '@typescript-eslint/no-unsafe-member-access': 'off',
    '@typescript-eslint/no-unsafe-argument': 'off',
    '@typescript-eslint/no-unsafe-assignment': 'off',
    '@typescript-eslint/no-unsafe-call': 'off',
    '@typescript-eslint/no-unsafe-return': 'off',
  },
};
