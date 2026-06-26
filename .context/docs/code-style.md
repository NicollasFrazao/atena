---
type: doc
name: code-style
description: Regras de code style da Atena — estabelecidas/alinhadas na fase P do planejamento, seguidas na fase E
category: conventions
generated: 2026-06-15
status: filled
---

# Code Style — Atena

> Estas regras são **estabelecidas/revisadas na fase P (planejamento)** de cada sprint e seguidas na fase E (implementação). Mudanças de convenção entram aqui antes de virar código.

## API (entrada e saída)
- **`snake_case` em TODOS os objetos de request e response da API** (query params, body e JSON de resposta). _Revisão em relação ao handoff, que especificava camelCase._
- O banco já é `snake_case` (Prisma `@map`); o Prisma Client é camelCase internamente → **mapear para `snake_case` na borda da API** (serviços/serializers que montam a resposta e DTOs que leem a entrada).
- Erro sempre no shape: `{ "error": { "code": "...", "message": "..." } }`.
- Envelope paginado: `{ rows, page, total_pages, total, latency_ms }`.
- Datas em ISO 8601 UTC (string).

## Nomenclatura
- **Classes**: `PascalCase` **com sufixo da camada/tipo** — `Service`, `Controller`, `Repository`, `Module`, `Guard`, `Interceptor`, `Filter`, `Pipe`, `Provider`, `Dto`, `Exception` (e afins).
- **Interfaces e type aliases**: `PascalCase` **com sufixo do tipo** — interface → `XxxInterface` (ex.: `IdentityProviderInterface`, `ContentCacheInterface`); type alias/union → `XxxType` (ex.: `RoleType`, `AuditActionType`). **Exceção**: nomes que já carregam sufixo semântico (`Payload`, `Event`, `Config`, `Entry`, `Dto`) ou que já terminam em `Type` são mantidos (ex.: `ResolveIncidentPayload`, `WsServerEvent`, `AtenaConfig`, `AuditEntry`, `DimensionType`). _Os `enum` do schema Prisma são construtos de banco e ficam fora desta regra._
- **Variáveis, atributos e métodos**: `camelCase` (código interno).
- **Nomes semânticos e verbosos — sem abreviação nem nome de uma letra.** O identificador diz, por extenso, o que a coisa **é/representa**: `message` (não `m`/`msg`), `record`/`row` (não `r`/`rec`), `payload` (não `p`), `index` (não `i`), `accumulator`/`value` (não `acc`/`v`), `error` (não `e`/`err`), `const [name, aggregate]` (não `const [a, b]`). Vale para variáveis, atributos e **parâmetros — inclusive callbacks** de `sort`/`reduce`/`map`/`filter` e comparadores. **Exceção**: parâmetros de tipo genérico (`T`, `K`, `V`). Enforçado por ESLint `id-length` (mínimo 2; veja [code-style.md] / `eslint.config.mjs`); a verbosidade/semântica além do tamanho é convenção (revisão), não lint.
- **Atributos de I/O da camada de borda** (DTOs de request e JSON de response): `snake_case`. Ou seja: **interno camelCase ↔ borda snake_case** (mapear no DTO/serializer).
- **Resources da API**: `kebab-case` nos segmentos de URL (ex.: `/api/delivery-reports`), **RESTful** (substantivos no plural + métodos HTTP + status codes corretos).

## Formatação
- **Um item por linha quando houver mais de um.** Aplica-se a: **parâmetros/argumentos** de definição e de chamada de método/função; **atributos** de objeto literal; **elementos** de array literal. Com um único item, mantém-se inline. Em multilinha, usar **vírgula final** (trailing comma).
- Aplica-se também à **desestruturação** (objeto `const { a, b }` e array `const [a, b]`). **Não se aplica** a: decorators (`@Audit('x','y')`), DSL de teste (`describe`/`it`/…), listas de `import`/`export` e _type-literals_ TS.
- Enforçado pela regra local **`local/one-per-line`** (`apps/api/eslint-rules/one-per-line.mjs`).
- **Ternário sempre multilinha** (condição / `?` / `:`), via `@stylistic/multiline-ternary`:
  ```ts
  typeof x === 'string'
    ? x
    : undefined
  ```
- **Largura máxima de 120 colunas** (`@stylistic/max-len`), **ignorando** comentários, strings, template literals, URLs e regex (conteúdo inevitável não quebra). Alinha ao ruler externo do VSCode (`editor.rulers: [80, 120]`).
- **Indentação: 2 espaços, sem tabulação** (`@stylistic/indent` = 2 + `@stylistic/no-tabs`; reflete `editor.insertSpaces` + `[typescript]/[javascript].tabSize: 2`).
- **Sem espaços em branco à direita** (`@stylistic/no-trailing-spaces`) e **newline no fim do arquivo** (`@stylistic/eol-last`; reflete `files.insertFinalNewline`).
- Exemplo:
  ```ts
  // > 1 → um por linha
  metodo(
    primeiro,
    segundo,
  );
  const obj = {
    a: 1,
    b: 2,
  };
  const arr = [
    'x',
    'y',
  ];
  // 1 item → inline
  metodo(unico);
  const o = { a: 1 };
  ```

## Espaçamento vertical
- **Sem linha em branco no início ou no fim de um bloco** (logo após `{` ou imediatamente antes de `}`).
- **Encerramento de fluxo** (`return`, `break`, `continue`, `throw`) tem **uma linha em branco acima** — exceto quando é a única/primeira instrução do bloco.
- **Statement multilinha** (bloco `if`/`for`/`try`/`switch`, declaração `const`/`let` multilinha, expressão multilinha) é **cercado por uma linha em branco** (antes e depois); statements simples adjacentes podem ficar juntos. Enforçado via ESLint (`@stylistic/padding-line-between-statements`, `padded-blocks`).

## Controle de fluxo
- **Chaves sempre** (`curly`): `if`/`else`/`for`/`while`/… nunca sem chaves, e **nunca inline** — o corpo fica em linhas próprias (`local/block-multiline`):
  ```ts
  if (q.phone) {
    where.phoneE164 = q.phone;
  }
  ```
- **Condição composta** (`&&`/`||`): cada cláusula em sua própria linha, operador à esquerda, parênteses em linhas próprias (`local/multiline-if-condition`):
  ```ts
  if (
    !requiredRoles
    || requiredRoles.length === 0
  ) {
    return true;
  }
  ```

## Erros, exceções e camadas
- **Exceptions estruturadas**: toda resposta de erro no shape `{ error: { code, message } }`, produzida por um **exception filter global** (`AllExceptionsFilter`). Para erros de domínio, lançar `AppException(code, message, status)`.
- **Deep layers lançam; a borda loga (log boundary)**: serviços/domínio **lançam** exceções (não capturam-e-engolem); o **logging** acontece na borda (exception filter / interceptor), não no fundo.
- **Nunca logar PII** — usar IDs/`phone_hash`; logar apenas `method + path` (sem query string).

## Banco / Prisma
- **PK = `id`** em toda entidade; **FK = `<entidade>_id`**.
- Colunas `snake_case` via `@map`; modelos `@@map` para a tabela em `snake_case`.
- Migrations versionadas (`prisma migrate`); `audit_log` append-only.

## TypeScript
- `strict` ligado; evitar `any` (preferir `unknown` + narrowing). Casts só com justificativa.
- **Sempre resolver ESLint e Sonar**: `npm run lint` (flat config em `apps/api/eslint.config.mjs`) sem erros nem avisos; resolver também os avisos do SonarLint. Parâmetro não usado em stub → prefixo `_`.
- **Pendências usam a tag `@todo`** (ex.: `@todo (auth) aplicar guards`). **Não disfarçar** um todo não resolvido (ex.: trocar por `NOTA`) só para silenciar o S1135 — ou se resolve de fato, ou se mantém como `@todo`.
- `module/moduleResolution: nodenext`.

## NestJS
- Um módulo por feature; **service** (lógica/dados) + **controller** (HTTP fino) + **DTO** (`class-validator`).
- `ValidationPipe` global (`whitelist: true, transform: true`).
- **`@Audit(action, severity)`** em toda ação sensível (o interceptor global grava no audit log).
- Auth/RBAC por guard (`AuthGuard` + `@Roles`) — aplicar quando o login OIDC real existir.

## Princípios não-negociáveis (resumo)
- A IA é intérprete: o **provider LLM** fica atrás de `LlmProvider`; a aplicação executa as tools e toca o banco — a IA nunca toca o banco.
- **PII mascarada por padrão**; reveal só por endpoint auditado; **nunca PII em log** (usar `phone_hash`/IDs).
- Mudança de estado de incidente não é tool do LLM (só UI + validação server-side).

## Documentação (JSDoc)
- **Sempre** documentar com JSDoc: classes, métodos/funções, DTOs e tipos exportados.
- Usar **todas as tags `@` pertinentes ao contexto**: `@param`, `@returns`, `@throws` (quando lança), `@template` (genéricos), `@example`, `@deprecated`, `@see`, `@remarks`.
- **Incluir a tipagem entre `{}`** nas tags: `@param {string} nome - …`, `@returns {Promise<Foo>} …`, `@throws {AppException} …`, `@template {T} …`.
- O JSDoc descreve **intenção/contrato e invariantes** (ex.: "PII mascarada", "gera audit"), não o óbvio do tipo.
- **Linha em branco ao trocar de tag `@`**: tags do mesmo tipo ficam agrupadas (vários `@param` juntos; vários `@property` juntos); ao mudar para outra tag (`@param`→`@returns`, `@returns`→`@throws`, etc.) inserir uma linha `*` em branco entre os grupos.

## Commits
- **Conventional Commits**, em PT-BR no corpo. Escopos usados: `api`, `llm`, `messages`, `catalog`, `chat`, `db`, `make`, `context`, `deps`.
- Trailer: `Co-Authored-By: Nova Pro <noreply@anthropic.com>`.
