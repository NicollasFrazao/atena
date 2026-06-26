// Base de lint COMPARTILHADA da Atena (API + web) — fonte única das regras, para os apps não
// divergirem. As regras de layout refletem .context/docs/code-style.md (formatação + espaçamento).
// Os apps importam `sharedConfigs` e acrescentam só o que é específico (web: react + globals browser).
import tseslint from 'typescript-eslint';
import stylistic from '@stylistic/eslint-plugin';
import sonarjs from 'eslint-plugin-sonarjs';
import onePerLine from './apps/api/eslint-rules/one-per-line.mjs';
import multilineIfCondition from './apps/api/eslint-rules/multiline-if-condition.mjs';
import blockMultiline from './apps/api/eslint-rules/block-multiline.mjs';

/** Bloco estrito (stylistic + regras locais + id-length) — code-style do projeto. */
export const strictConfig = {
  plugins: {
    '@stylistic': stylistic,
    local: {
      rules: {
        'one-per-line': onePerLine,
        'multiline-if-condition': multilineIfCondition,
        'block-multiline': blockMultiline,
      },
    },
  },
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  rules: {
    // Stubs do Sprint 0 usam params/símbolos placeholder; avisa em vez de quebrar.
    '@typescript-eslint/no-unused-vars': [
      'warn',
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        ignoreRestSiblings: true,
      },
    ],
    // Os contratos usam `unknown`/Json; `any` pontual nos stubs não deve quebrar o lint.
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-empty-function': 'off',

    // O projeto rastreia trabalho adiado DELIBERADAMENTE via @todo/TODO (.context/docs/tech-debt.md
    // + planos no dotcontext) — não são lembretes esquecidos. Desliga a regra do sonarjs que trataria
    // todo TODO como erro (manteríamos os marcadores de qualquer forma).
    'sonarjs/todo-tag': 'off',

    // Nomes semânticos e verbosos: sem identificador de uma letra (abreviação).
    // Exceção: parâmetros de tipo genérico. Não checa chaves de objeto (shapes de I/O).
    'id-length': [
      'error',
      {
        min: 2,
        properties: 'never',
        exceptions: [
          'T',
          'K',
          'V',
          'U',
        ],
      },
    ],

    // --- Higiene de layout ---
    '@stylistic/indent': [
      'error',
      2,
    ],
    '@stylistic/no-trailing-spaces': 'error',
    '@stylistic/no-multiple-empty-lines': [
      'error',
      {
        max: 1,
        maxBOF: 0,
        maxEOF: 0,
      },
    ],
    '@stylistic/comma-dangle': [
      'error',
      'always-multiline',
    ],
    // Largura máxima de 120 (ruler externo do VSCode); ignora comentários/strings/URLs/regex.
    '@stylistic/max-len': [
      'error',
      {
        code: 120,
        tabWidth: 2,
        ignoreComments: true,
        ignoreUrls: true,
        ignoreStrings: true,
        ignoreTemplateLiterals: true,
        ignoreRegExpLiterals: true,
      },
    ],
    // Indentação é só espaço (2): proíbe caractere de tabulação.
    '@stylistic/no-tabs': 'error',
    // Arquivo termina com newline (files.insertFinalNewline).
    '@stylistic/eol-last': [
      'error',
      'always',
    ],

    // Objeto/desestruturação multilinha: `{` e `}` em suas próprias linhas (alinha com one-per-line).
    '@stylistic/object-curly-newline': [
      'error',
      {
        multiline: true,
        consistent: true,
      },
    ],

    // --- 1 item por linha quando há > 1 (regra local) ---
    // Cobre params de função, args de chamada/new (exceto decorators e DSL de
    // teste), objetos literais, desestruturação `{}` e arrays literais.
    'local/one-per-line': 'error',
    // Ternário sempre multilinha: condição / `?` / `:`.
    '@stylistic/multiline-ternary': [
      'error',
      'always',
    ],
    // `if`/`while`/etc. sempre com chaves (sem corpo inline).
    curly: [
      'error',
      'all',
    ],
    // Condição composta (&&/||): cada cláusula em sua própria linha.
    'local/multiline-if-condition': 'error',
    // Corpo de bloco de controle (if/loops/try...) nunca inline.
    'local/block-multiline': 'error',

    // --- Espaçamento vertical (multilinha + terminadores de fluxo) ---
    '@stylistic/padded-blocks': [
      'error',
      'never',
    ],
    '@stylistic/lines-between-class-members': [
      'error',
      'always',
    ],
    '@stylistic/padding-line-between-statements': [
      'error',
      {
        blankLine: 'always',
        prev: '*',
        next: 'return',
      },
      {
        blankLine: 'always',
        prev: '*',
        next: [
          'break',
          'continue',
          'throw',
        ],
      },
      {
        blankLine: 'always',
        prev: 'multiline-block-like',
        next: '*',
      },
      {
        blankLine: 'always',
        prev: '*',
        next: 'multiline-block-like',
      },
      {
        blankLine: 'always',
        prev: 'multiline-const',
        next: '*',
      },
      {
        blankLine: 'always',
        prev: '*',
        next: 'multiline-const',
      },
      {
        blankLine: 'always',
        prev: 'multiline-let',
        next: '*',
      },
      {
        blankLine: 'always',
        prev: '*',
        next: 'multiline-let',
      },
      {
        blankLine: 'always',
        prev: 'multiline-expression',
        next: '*',
      },
      {
        blankLine: 'always',
        prev: '*',
        next: 'multiline-expression',
      },
    ],
  },
};

/**
 * Configs compartilhadas, em ordem: typescript-eslint recommended → sonarjs/recommended →
 * bloco estrito (layout/code-style). Os apps espalham isto e adicionam o específico deles.
 */
export const sharedConfigs = [
  ...tseslint.configs.recommended,
  sonarjs.configs.recommended,
  strictConfig,
];
