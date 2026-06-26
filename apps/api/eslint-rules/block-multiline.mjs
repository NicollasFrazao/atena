/**
 * Regra ESLint local da Atena: **corpo de bloco de controle nunca inline**.
 *
 * Para `if`/`else`/`for`/`for-in`/`for-of`/`while`/`do-while`/`try`/`catch`/`finally`,
 * o `{` é seguido de quebra de linha e o `}` é precedido de quebra — ou seja, o corpo
 * fica em suas próprias linhas (combina com `curly: all` para eliminar `if` inline).
 *
 * Só INSERE quebras (após `{` e antes de `}`); a indentação fica a cargo do
 * `@stylistic/indent`. Corpos de função/arrow não são alvo (já são multilinha na prática).
 */

/** Força o corpo de um BlockStatement (não vazio) a ficar em linhas próprias. */
function handleBlock(
  context,
  sc,
  block,
) {
  if (
    block?.type !== 'BlockStatement'
    || block.body.length === 0
  ) {
    return;
  }

  const open = sc.getFirstToken(block);
  const close = sc.getLastToken(block);
  const first = block.body[0];
  const last = block.body[block.body.length - 1];
  const needsOpen = open.loc.end.line === first.loc.start.line;
  const needsClose = last.loc.end.line === close.loc.start.line;

  if (
    !needsOpen
    && !needsClose
  ) {
    return;
  }

  context.report({
    node: block,
    messageId: 'multiline',
    fix(fixer) {
      const fixes = [];

      if (needsOpen) {
        fixes.push(fixer.insertTextAfter(
          open,
          '\n',
        ));
      }

      if (needsClose) {
        fixes.push(fixer.insertTextBefore(
          close,
          '\n',
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
    docs: { description: 'Corpo de bloco de controle (if/loops/try...) em suas próprias linhas.' },
    fixable: 'whitespace',
    schema: [],
    messages: { multiline: 'O corpo do bloco não pode ser inline — use linhas próprias.' },
  },

  create(context) {
    const sc = context.sourceCode;

    return {
      IfStatement(node) {
        handleBlock(
          context,
          sc,
          node.consequent,
        );

        if (node.alternate?.type === 'BlockStatement') {
          handleBlock(
            context,
            sc,
            node.alternate,
          );
        }
      },
      ForStatement: (node) => handleBlock(
        context,
        sc,
        node.body,
      ),
      ForInStatement: (node) => handleBlock(
        context,
        sc,
        node.body,
      ),
      ForOfStatement: (node) => handleBlock(
        context,
        sc,
        node.body,
      ),
      WhileStatement: (node) => handleBlock(
        context,
        sc,
        node.body,
      ),
      DoWhileStatement: (node) => handleBlock(
        context,
        sc,
        node.body,
      ),
      CatchClause: (node) => handleBlock(
        context,
        sc,
        node.body,
      ),
      TryStatement(node) {
        handleBlock(
          context,
          sc,
          node.block,
        );

        handleBlock(
          context,
          sc,
          node.finalizer,
        );
      },
    };
  },
};
