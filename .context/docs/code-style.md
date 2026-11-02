---
type: doc
name: code-style
description: Atena code style rules — established/aligned in the P (planning) phase, followed in the E (execution) phase
category: conventions
generated: 2026-06-15
status: filled
---

# Code Style — Atena

> These rules are **established/revised in the P (planning) phase** of each sprint and followed in the E (implementation) phase. Convention changes land here before they become code.

## API (input and output)
- **`snake_case` in ALL API request and response objects** (query params, body and response JSON). _A revision relative to the handoff, which specified camelCase._
- The database is already `snake_case` (Prisma `@map`); the Prisma Client is camelCase internally → **map to `snake_case` at the API edge** (services/serializers that build the response and DTOs that read the input).
- Errors always in the shape: `{ "error": { "code": "...", "message": "..." } }`.
- Paginated envelope: `{ rows, page, total_pages, total, latency_ms }`.
- Dates in ISO 8601 UTC (string).

## Naming
- **Classes**: `PascalCase` **with the layer/kind suffix** — `Service`, `Controller`, `Repository`, `Module`, `Guard`, `Interceptor`, `Filter`, `Pipe`, `Provider`, `Dto`, `Exception` (and the like).
- **Interfaces and type aliases**: `PascalCase` **with the kind suffix** — interface → `XxxInterface` (e.g. `IdentityProviderInterface`, `ContentCacheInterface`); type alias/union → `XxxType` (e.g. `RoleType`, `AuditActionType`). **Exception**: names that already carry a semantic suffix (`Payload`, `Event`, `Config`, `Entry`, `Dto`) or that already end in `Type` are kept as is (e.g. `ResolveIncidentPayload`, `WsServerEvent`, `AtenaConfig`, `AuditEntry`, `DimensionType`). _The `enum`s of the Prisma schema are database constructs and fall outside this rule._
- **Variables, attributes and methods**: `camelCase` (internal code).
- **Semantic, verbose names — no abbreviations and no single-letter names.** The identifier says, in full, what the thing **is/represents**: `message` (not `m`/`msg`), `record`/`row` (not `r`/`rec`), `payload` (not `p`), `index` (not `i`), `accumulator`/`value` (not `acc`/`v`), `error` (not `e`/`err`), `const [name, aggregate]` (not `const [a, b]`). Applies to variables, attributes and **parameters — including callbacks** of `sort`/`reduce`/`map`/`filter` and comparators. **Exception**: generic type parameters (`T`, `K`, `V`). Enforced by ESLint `id-length` (minimum 2; see `eslint.shared.mjs`); verbosity/semantics beyond length is a convention (review), not lint.
- **I/O attributes of the edge layer** (request DTOs and response JSON): `snake_case`. That is: **internal camelCase ↔ edge snake_case** (map in the DTO/serializer).
- **API resources**: `kebab-case` in URL segments (e.g. `/api/delivery-reports`), **RESTful** (plural nouns + HTTP methods + correct status codes).

## Formatting
- **One item per line when there is more than one.** Applies to: **parameters/arguments** in method/function definitions and calls; object literal **attributes**; array literal **elements**. With a single item, keep it inline. When multiline, use a **trailing comma**.
- Also applies to **destructuring** (object `const { a, b }` and array `const [a, b]`). **Does not apply** to: decorators (`@Audit('x','y')`), test DSL (`describe`/`it`/…), `import`/`export` lists and TS _type literals_.
- Enforced by the local rule **`local/one-per-line`** (`eslint-rules/one-per-line.mjs`, with its RuleTester tests).
- **Ternaries always multiline** (condition / `?` / `:`), via `@stylistic/multiline-ternary`:
  ```ts
  typeof x === 'string'
    ? x
    : undefined
  ```
- **Maximum width of 120 columns** (`@stylistic/max-len`), **ignoring** comments, strings, template literals, URLs and regex (unavoidable content is not broken). Matches the VSCode external ruler (`editor.rulers: [80, 120]`).
- **Indentation: 2 spaces, no tabs** (`@stylistic/indent` = 2 + `@stylistic/no-tabs`; mirrors `editor.insertSpaces` + `[typescript]/[javascript].tabSize: 2`).
- **No trailing whitespace** (`@stylistic/no-trailing-spaces`) and a **newline at end of file** (`@stylistic/eol-last`; mirrors `files.insertFinalNewline`).
- Example:
  ```ts
  // > 1 → one per line
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

## Vertical spacing
- **No blank line at the start or end of a block** (right after `{` or right before `}`).
- **Flow exits** (`return`, `break`, `continue`, `throw`) have **one blank line above** — except when it is the only/first statement of the block.
- A **multiline statement** (an `if`/`for`/`try`/`switch` block, a multiline `const`/`let` declaration, a multiline expression) is **surrounded by a blank line** (before and after); adjacent simple statements may stay together. Enforced via ESLint (`@stylistic/padding-line-between-statements`, `padded-blocks`).

## Control flow
- **Always braces** (`curly`): `if`/`else`/`for`/`while`/… never without braces, and **never inline** — the body goes on its own lines (`local/block-multiline`):
  ```ts
  if (q.phone) {
    where.phoneE164 = q.phone;
  }
  ```
- **Compound condition** (`&&`/`||`): each clause on its own line, operator on the left, parentheses on their own lines (`local/multiline-if-condition`):
  ```ts
  if (
    !requiredRoles
    || requiredRoles.length === 0
  ) {
    return true;
  }
  ```

## Errors, exceptions and layers
- **Structured exceptions**: every error response in the shape `{ error: { code, message } }`, produced by a **global exception filter** (`AllExceptionsFilter`). For domain errors, throw `AppException(code, message, status)`.
- **Deep layers throw; the edge logs (log boundary)**: services/domain **throw** exceptions (they do not catch-and-swallow); **logging** happens at the edge (exception filter / interceptor), not deep down.
- **Never log PII** — use IDs/`phone_hash`; log only `method + path` (no query string).

## Database / Prisma
- **PK = `id`** on every entity; **FK = `<entity>_id`**.
- `snake_case` columns via `@map`; models `@@map` to the `snake_case` table.
- Versioned migrations (`prisma migrate`); `audit_log` is append-only.

## TypeScript
- `strict` on; avoid `any` (prefer `unknown` + narrowing). Casts only with a justification.
- **Always resolve ESLint, including the Sonar rules**: `npm run lint` (the shared base `eslint.shared.mjs`, spread by each workspace's `eslint.config.mjs`) with no errors or warnings. Unused parameter in a stub → `_` prefix.
- **Pending work is not left as a marker in the code**: no `TODO`/`FIXME`/`@todo` (`sonarjs/todo-tag` fails). Deferred work becomes an issue or an item in [tech-debt.md](tech-debt.md). Do not disguise a marker to silence the rule — record the work where it is tracked.
- `module/moduleResolution: nodenext`.

## NestJS
- One module per feature; **service** (logic/data) + **controller** (thin HTTP) + **DTO** (`class-validator`).
- Global `ValidationPipe` (`whitelist: true, transform: true`).
- **`@Audit(action, severity)`** on every sensitive action (the global interceptor writes to the audit log).
- Auth/RBAC via a global guard (`AuthGuard` + permissions guard); endpoints require `@Requires(perm)`. Real OIDC enabled; `/health` and `/auth/*` are `@Public`.

## Non-negotiable principles (summary)
- The AI is an interpreter: the **LLM provider** sits behind `LlmProvider`; the application executes the tools and touches the database — the AI never touches the database.
- **PII masked by default**; reveal only through an audited endpoint; **never PII in logs** (use `phone_hash`/IDs).
- Incident state changes are not an LLM tool (UI only + server-side validation).

## Documentation (TSDoc)
- The rules are in [development-conventions.md](development-conventions.md), "Documentation in code (TSDoc)", enforced by `eslint-plugin-jsdoc`: a doc comment on every exported symbol, **no types in tags** (TypeScript states them), `@throws {@link X}` for every error a caller must handle, members documented on the member instead of `@property`, one blank line between tag kinds.
- Doc comments describe **intent/contract and invariants** (e.g. "PII masked", "creates an audit entry"), not what the type already makes obvious.

## Commits
- **Conventional Commits in English**, checked by commitlint. Per-module scopes: `api`, `web`, `types`, `llm`, `chat`, `shippings`, `catalog`, `incidents`, `detector`, `rules`, `auth`, `audit`, `admin`, `observability`, `db`, `make`, `context`, `deps`, `ci` (the delivery entity is `shipping`, not `message`). See [development-conventions.md](development-conventions.md).
