---
type: doc
name: development-conventions
description: Normative conventions — quality gate, principles, layer rules, documentation and readability, commits, branches, PRs, language
category: workflow
generated: 2026-11-01
status: filled
scaffoldVersion: "2.0.0"
---

# Development conventions

What is mandatory when changing this repository. Setup and day-to-day commands are in
[development-workflow.md](development-workflow.md); project-specific style (API shapes, naming,
NestJS and Prisma) is in [code-style.md](code-style.md). This file holds only what must hold without
anything prompting it, written as commands.

## Quality gate

**Before every commit, run the gate, one command at a time, from the repository root** (the first
two prepare what the type-aware lint and the compiler read):

```bash
npm run build -w @atena/types   # the apps consume the contract from its build
npm run prisma:generate         # the API compiles against the generated Prisma client
npm run lint                    # ESLint, root tooling + every workspace, --max-warnings 0
npm run typecheck               # tsc --noEmit for api, web (app and e2e) and types
npm run check:architecture      # dependency-cruiser layer rules and cycles
npm run check:unused            # knip: unused files, exports, types, dependencies
npm run test:coverage           # Jest (api, 80% gate) + Vitest (web, coverage floor)
npm run test:tooling            # tests of the local ESLint rules and the context script
npm run e2e -w @atena/web       # Playwright, hermetic (builds and serves the app, mocks /api)
npm run check:context           # agent surfaces are copies of .context/docs/README.md
```

These are the CI jobs (`lint`, `typecheck`, `architecture`, `unused`, `test-api`, `test-web`,
`e2e-web`, `tooling`, `context`, plus `audit` and `commitlint`), one job per check, every one meant to
be a required check on `master`. A green local gate means a green CI.

- Run them **one at a time**. The type-aware lint, `tsc` and the test suites each take from a few
  hundred MB to more than a GB; running them in parallel on a small machine is how it runs out of
  memory.
- The `pre-commit` hook runs ESLint on the staged files only, and `commit-msg` runs commitlint.
  They are a fast first filter, not the gate.
- A rule is fixed in the code, never silenced. A targeted `eslint-disable-next-line <rule> -- <reason>`
  is allowed only where the rule truly does not apply, with the reason on the same line (the
  accepted case so far: a Nest constructor that injects more than four dependencies). No
  file-level or blanket disables; exceptions in `knip.jsonc` and `.dependency-cruiser.cjs` carry
  their reason next to them.
- Coverage never goes down. The API keeps **80%** on statements, branches, functions and lines
  (`apps/api/jest.config.js`). The web app is below the 80% target and is held by a ratchet at its
  measured floor (`apps/web/vite.config.ts`, [tech-debt.md](tech-debt.md) item 13): raise the floor
  when you add tests, never lower it, never widen the exclusions to pass.

## Non-negotiable principles

These come from the product and every change keeps them; the tests that protect them are blocking
([testing-strategy.md](testing-strategy.md)).

1. **The AI is an interpreter.** The LLM sits behind `LlmProviderInterface`; it chooses tools, the API
   runs them. The LLM never touches the database or S3.
2. **No fabricated data.** A request no tool can answer gets a structured refusal, not an invented
   answer.
3. **Incident state changes are not tools.** `acknowledge` and `resolve` are REST endpoints with
   server-side validation, used by the UI only.
4. **Everything sensitive is audited.** Every auditable action writes an immutable `audit_log` entry
   (`@Audit` or `AuditService.record`).
5. **PII is masked by default.** A full phone number or message content is returned only through
   the audited reveal endpoints, with `pii:reveal`; PII never goes into logs.

## Layer rules

Enforced by `npm run check:architecture` (`.dependency-cruiser.cjs`); the reasoning is in
[architecture.md](architecture.md), "Layer rules".

- `packages/types` imports nothing: it is the contract, plain types only.
- `apps/api` and `apps/web` never import each other; they share only `@atena/types`.
- API: `src/common` and `src/config` import no feature module; nothing but a module imports a
  controller; DTOs import only other DTOs and `src/common`.
- Web: `src/api` (HTTP client and queries) and `src/util` never import a component (`.tsx`);
  `src/util` imports no feature module.
- No import cycles, no orphan module (entry points, tests and declaration files excepted), no
  production module importing a test.

## Documentation in code (TSDoc)

Enforced by `eslint-plugin-jsdoc` and the local `jsdoc-tag-spacing` rule.

- **Every exported symbol has a doc comment**: classes, functions, methods of exported classes,
  interfaces, type aliases, enums and exported constants. One summary sentence saying what it does
  for the caller; `@remarks` for the why. Members of interfaces and DTOs are documented on the member
  (`/** ... */` above it), not with `@property` on the type.
- No types in tags: TypeScript already states them (`@param id - ...`, not `@param {string} id`).
  `@param`, `@returns` and `@yields` only when they add something the type does not say; a function
  that documents one parameter documents all of them; a destructured parameter is documented as a
  whole (`@param props - ...`).
- `@throws {@link ErrorClass} when ...` for every error a caller must handle: a function with a
  `throw` and no `@throws` fails the lint.
- Tag order: `@remarks`, `@typeParam`, `@param`, `@returns`, `@throws`, `@example`, `@see`, with one
  blank line between kinds and one after the summary.
- Comments explain **why**, not what. No commented-out code. No `TODO` / `FIXME` markers
  (`sonarjs/todo-tag`): deferred work is an issue or an item in [tech-debt.md](tech-debt.md).

## Readability rules

Enforced by ESLint at error level (`eslint.shared.mjs`):

- typescript-eslint `strictTypeChecked` and `stylisticTypeChecked`; no `any` leaking through
  (`no-unsafe-*`), no unnecessary conditions — make a type truthful (`| undefined`) instead of
  deleting a guard on data that can really be missing.
- Cognitive complexity at most **15** per function (`sonarjs/cognitive-complexity`); nesting at most
  **3** (`max-depth`); at most **4** parameters (`@typescript-eslint/max-params`) — beyond that, take
  one object with a named interface.
- One statement per line. With more than one item, every parameter, argument, property and array
  element goes on its own line (`local/one-per-line`). A condition with `&&` / `||` puts each clause
  on its own line, operator leading (`local/multiline-if-condition`). Ternaries are multi-line.
  Control-block bodies are never inline (`local/block-multiline`, `curly: all`).
- Blank lines around multi-line blocks and statements, and before `return`, `throw`, `break` and
  `continue`.
- No magic numbers outside tests: name them (`MS_PER_MINUTE` in `src/common/units.ts` /
  `src/util/units.ts`, `MAX_PAGE_SIZE`, `HttpStatus.OK`). In the web app, design tokens come from
  `cssVar` / `cssValue` (`apps/web/src/styles/tokens.ts`), never as repeated strings.
- No unused code: variables, imports, arguments, private members, dead stores (`sonarjs`,
  `@typescript-eslint/no-unused-vars`) and no unused file, export or dependency (`knip`).
- No string literal duplicated three times or more outside tests (`sonarjs/no-duplicate-string`).

## Naming

[code-style.md](code-style.md), "Naming", is the rule: suffixes by kind (`XxxService`,
`XxxInterface`, `XxxType`, `XxxDto`), `snake_case` at the API edge and camelCase inside, no
abbreviations and no one-letter names (`id-length`), domain vocabulary from [glossary.md](glossary.md)
(the delivery entity is a **shipping**, not a message). Booleans read as predicates.

## Language

Code, comments, log messages, error messages, documentation, commit messages, issues and pull
requests are in **English**. The product UI is in Portuguese for its users: user-facing strings stay
in Portuguese. Older code comments are still in Portuguese ([tech-debt.md](tech-debt.md) item 15);
any comment you write or rewrite is in English.

## Branches, commits and pull requests

- `master` is the default branch and is never pushed to directly. Branch prefixes: `feat/`, `fix/`,
  `docs/`, `refactor/`, `chore/`, `test/`, `ci/`.
- Commits follow **Conventional Commits** (`type(scope): description`), checked by commitlint in the
  `commit-msg` hook and, for every commit of a pull request, in CI. Scopes are the modules: `api`,
  `web`, `types`, `llm`, `chat`, `shippings`, `catalog`, `incidents`, `detector`, `rules`, `auth`,
  `audit`, `admin`, `observability`, `db`, `make`, `context`, `deps`, `ci`.
- **The commit type is the version.** `feat` → minor; `fix`, `perf`, `refactor` → patch; a `!` after
  the type or a `BREAKING CHANGE:` footer → major; `docs`, `test`, `build`, `ci`, `chore`, `style` →
  no release.
- Small pull requests, one concern each. The PR template asks for the what and why, the issue, the
  verification **as results** ("395/395 API tests, coverage 94/83/89/94"), and the risks.
- Link the issue with an English closing keyword (`Closes #12`); anything else does not link.

## Context base

`.context/docs/` is the source. `AGENTS.md`, `.claude/CLAUDE.md` and
`.github/copilot-instructions.md` are copies of `.context/docs/README.md` written by
`npm run export:context`; edit the source and re-export. Never generate the surfaces with the
dotcontext `exportDocs`, `exportContext` or `reverseSync` tools: they write targets this repository
does not control and re-import generated files as sources.
