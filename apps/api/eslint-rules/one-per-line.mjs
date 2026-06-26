/**
 * Regra ESLint local da Atena: **um item por linha quando há mais de um**.
 *
 * Cobre (ver .context/docs/code-style.md):
 * - parâmetros de definição de função/método (`params`);
 * - argumentos de chamada/`new` (`arguments`);
 * - propriedades de objeto literal e de desestruturação `{}` (ObjectExpression/ObjectPattern);
 * - elementos de array literal `[]` e de desestruturação (ArrayExpression/ArrayPattern);
 * - membros de type literal inline `{ a: T; b: U }` (TSTypeLiteral).
 *
 * PULA: decorators (`@Audit('x','y')`), DSL de teste (`describe`/`it`/...) e
 * params com decorators (ex.: `@Body()`).
 *
 * O fixer só INSERE quebras de linha (preserva comentários/código); a indentação
 * fica a cargo do `@stylistic/indent` e a vírgula final do `@stylistic/comma-dangle`.
 */

/** Globais de teste cujas chamadas (string + callback) não devem ser quebradas. */
const TEST_DSL = new Set([
  'describe',
  'it',
  'test',
  'beforeAll',
  'afterAll',
  'beforeEach',
  'afterEach',
  'xdescribe',
  'xit',
  'fdescribe',
  'fit',
]);

/** Verdadeiro se cada item já está em sua própria linha (entre `open` e `close`). */
function isOnePerLine(
  open,
  items,
  close,
) {
  if (open.loc.end.line === items[0].loc.start.line) {
    return false;
  }

  for (let index = 1; index < items.length; index++) {
    if (items[index - 1].loc.end.line === items[index].loc.start.line) {
      return false;
    }
  }

  return items[items.length - 1].loc.end.line !== close.loc.start.line;
}

/** Reporta e corrige (inserindo quebras) quando há > 1 item fora de 1-por-linha. */
function check(
  context,
  sc,
  node,
  rawItems,
  open,
  close,
) {
  const items = rawItems.filter(Boolean);

  if (
    items.length <= 1
    || !open
    || !close
  ) {
    return;
  }

  if (isOnePerLine(
    open,
    items,
    close,
  )) {
    return;
  }

  context.report({
    node,
    messageId: 'onePerLine',
    fix(fixer) {
      const fixes = [];

      if (open.loc.end.line === items[0].loc.start.line) {
        fixes.push(fixer.insertTextAfter(
          open,
          '\n',
        ));
      }

      for (let index = 1; index < items.length; index++) {
        if (items[index - 1].loc.end.line !== items[index].loc.start.line) {
          continue;
        }

        const comma = sc.getTokenAfter(
          items[index - 1],
          (token) => token.value === ',',
        );

        if (
          comma
          && comma.range[1] <= items[index].range[0]
        ) {
          fixes.push(fixer.insertTextAfter(
            comma,
            '\n',
          ));
        } else {
          fixes.push(fixer.insertTextBefore(
            items[index],
            '\n',
          ));
        }
      }

      if (items[items.length - 1].loc.end.line === close.loc.start.line) {
        fixes.push(fixer.insertTextBefore(
          close,
          '\n',
        ));
      }

      return fixes;
    },
  });
}

/** Parênteses que cercam uma lista de params/args (`(` antes do 1º, `)` após o último). */
function parensAround(
  sc,
  first,
  last,
) {
  return {
    open: sc.getTokenBefore(
      first,
      (token) => token.value === '(',
    ),
    close: sc.getTokenAfter(
      last,
      (token) => token.value === ')',
    ),
  };
}

/** Checa os parâmetros de uma definição de função/método. */
function checkParams(
  context,
  sc,
  node,
) {
  const params = node.params ?? [];

  if (params.length <= 1) {
    return;
  }

  if (params.some((param) => Array.isArray(param.decorators) && param.decorators.length > 0)) {
    return;
  }

  const open = sc.getFirstToken(
    node,
    (token) => token.value === '(',
  );

  const close = sc.getTokenAfter(
    params[params.length - 1],
    (token) => token.value === ')',
  );

  check(
    context,
    sc,
    node,
    params,
    open,
    close,
  );
}

/** Checa os argumentos de uma chamada/`new` (pula decorators e DSL de teste). */
function checkArgs(
  context,
  sc,
  node,
) {
  const args = node.arguments ?? [];

  if (args.length <= 1) {
    return;
  }

  if (node.parent?.type === 'Decorator') {
    return;
  }

  if (
    node.callee?.type === 'Identifier'
    && TEST_DSL.has(node.callee.name)
  ) {
    return;
  }

  const {
    open,
    close,
  } = parensAround(
    sc,
    args[0],
    args[args.length - 1],
  );

  check(
    context,
    sc,
    node,
    args,
    open,
    close,
  );
}

/** Checa os itens entre `{}`/`[]` (objetos/arrays literais e de desestruturação). */
function checkBracketed(
  context,
  sc,
  node,
  items,
) {
  if (items.filter(Boolean).length > 1) {
    check(
      context,
      sc,
      node,
      items,
      sc.getFirstToken(node),
      sc.getLastToken(node),
    );
  }
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'layout',
    docs: { description: 'Um item por linha quando há mais de um (params, args, objetos, arrays).' },
    fixable: 'whitespace',
    schema: [],
    messages: { onePerLine: 'Com mais de um item, cada um deve ficar em sua própria linha.' },
  },

  create(context) {
    const sc = context.sourceCode;

    return {
      ObjectExpression: (node) => checkBracketed(
        context,
        sc,
        node,
        node.properties,
      ),
      ObjectPattern: (node) => checkBracketed(
        context,
        sc,
        node,
        node.properties,
      ),
      ArrayExpression: (node) => checkBracketed(
        context,
        sc,
        node,
        node.elements,
      ),
      ArrayPattern: (node) => checkBracketed(
        context,
        sc,
        node,
        node.elements,
      ),
      TSTypeLiteral: (node) => checkBracketed(
        context,
        sc,
        node,
        node.members,
      ),
      FunctionDeclaration: (node) => checkParams(
        context,
        sc,
        node,
      ),
      FunctionExpression: (node) => checkParams(
        context,
        sc,
        node,
      ),
      ArrowFunctionExpression: (node) => checkParams(
        context,
        sc,
        node,
      ),
      TSDeclareFunction: (node) => checkParams(
        context,
        sc,
        node,
      ),
      CallExpression: (node) => checkArgs(
        context,
        sc,
        node,
      ),
      NewExpression: (node) => checkArgs(
        context,
        sc,
        node,
      ),
    };
  },
};
