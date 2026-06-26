/**
 * Regra ESLint local da Atena: **condição com mais de uma cláusula em linhas separadas**.
 *
 * Quando o teste de um `if`/`while`/`do-while` é uma expressão lógica (`&&`/`||`)
 * com mais de uma cláusula, cada cláusula fica em sua própria linha, com o operador
 * à esquerda (estilo "before") e os parênteses em linhas próprias:
 *
 *   if (
 *     items.length <= 1
 *     || !open
 *     || !close
 *   ) {
 *
 * O fixer insere quebras + indentação explícita (o `@stylistic/indent` não cobre
 * continuação de expressão lógica). Operadores dentro de sub-expressões (ex.:
 * `foo(a || b)`) NÃO são quebrados — só os do topo da árvore lógica.
 */

/** Coleta os tokens de operador lógico (`&&`/`||`) do topo da árvore de `node`. */
function collectLogicalOperators(
  sc,
  node,
  ops,
) {
  if (node.type !== 'LogicalExpression') {
    return;
  }

  collectLogicalOperators(
    sc,
    node.left,
    ops,
  );

  const opToken = sc.getFirstTokenBetween(
    node.left,
    node.right,
    (token) => token.value === node.operator,
  );

  if (opToken) {
    ops.push(opToken);
  }

  collectLogicalOperators(
    sc,
    node.right,
    ops,
  );
}

/** Aplica a regra a um nó com `test` (if/while/do-while). */
function handle(
  context,
  sc,
  node,
) {
  const test = node.test;

  if (test?.type !== 'LogicalExpression') {
    return;
  }

  const open = sc.getTokenBefore(
    test,
    (token) => token.value === '(',
  );

  const close = sc.getTokenAfter(
    test,
    (token) => token.value === ')',
  );

  if (
    !open
    || !close
  ) {
    return;
  }

  const ops = [];

  collectLogicalOperators(
    sc,
    test,
    ops,
  );

  if (ops.length === 0) {
    return;
  }

  const splitAfterOpen = open.loc.end.line === test.loc.start.line;
  const splitBeforeClose = test.loc.end.line === close.loc.start.line;
  const inlineOps = ops.filter((op) => sc.getTokenBefore(op)?.loc.end.line === op.loc.start.line);

  if (
    !splitAfterOpen
    && !splitBeforeClose
    && inlineOps.length === 0
  ) {
    return;
  }

  context.report({
    node: test,
    messageId: 'multiline',
    fix(fixer) {
      // @stylistic/indent não indenta continuação de expressão lógica, então a
      // regra insere a indentação explícita: cláusulas em base+2, `)` em base.
      const base = sc.getFirstToken(node).loc.start.column;
      const inner = `\n${' '.repeat(base + 2)}`;
      const outer = `\n${' '.repeat(base)}`;
      const fixes = [];

      if (splitAfterOpen) {
        fixes.push(fixer.insertTextAfter(
          open,
          inner,
        ));
      }

      for (const op of inlineOps) {
        fixes.push(fixer.insertTextBefore(
          op,
          inner,
        ));
      }

      if (splitBeforeClose) {
        fixes.push(fixer.insertTextBefore(
          close,
          outer,
        ));
      }

      return fixes;
    },
  });
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'layout',
    docs: { description: 'Cada cláusula (&&/||) de uma condição composta em sua própria linha.' },
    fixable: 'whitespace',
    schema: [],
    messages: { multiline: 'Condição com mais de uma cláusula (&&/||) deve ter cada cláusula em sua própria linha.' },
  },

  create(context) {
    const sc = context.sourceCode;

    return {
      IfStatement: (node) => handle(
        context,
        sc,
        node,
      ),
      WhileStatement: (node) => handle(
        context,
        sc,
        node,
      ),
      DoWhileStatement: (node) => handle(
        context,
        sc,
        node,
      ),
    };
  },
};
