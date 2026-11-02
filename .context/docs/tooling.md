---
type: doc
name: tooling
description: Scripts, IDE settings, automation, and developer productivity tips
category: tooling
generated: 2026-06-10
status: filled
scaffoldVersion: "2.0.0"
---

# Tooling & Productivity Guide

> **Current state: MVP implemented.** npm monorepo — `apps/api` (NestJS 11), `apps/web` (React 18 + Vite), `packages/types` (`@atena/types`). Prisma/MySQL, Docker/compose with profiles (`local`/`production`/`observability`), Jest (back end) + Vitest (front end), ESLint flat config, dd-trace + DogStatsD (optional). **CI exists** (`.github/workflows/ci.yml`). The handoff in [`docs/design_handoff_atena/`](../../docs/design_handoff_atena/) is a historical design reference. The context base lives in [`.context/`](../) (docs, agents, skills), scaffolded with the **dotcontext** MCP; its local state (config, harness, caches, plans) is not versioned.

## Commands {#comandos-sprint-0}

npm monorepo + Makefile (run from the root unless stated otherwise):

| Command | What it does |
|---|---|
| `npm install` | installs the monorepo dependencies |
| `make env` | creates `apps/api/.env` from `.env.example` |
| `make up ENV=local` | brings up API + MySQL in Docker (profile `local`) |
| `make dev` | brings it up in Docker with `AUTH_DEV_BYPASS=true` |
| `make down` | tears the stack down |
| `make api` / `make web` | API (watch) / front end (Vite) **on the host**, without Docker |
| `make migrate` (or `npm run prisma:migrate`) | applies migrations (dev) |
| `make seed` | seeds the database (in the container) |
| `npm run build` | builds `@atena/types` + `@atena/api` + `@atena/web` |
| `npm run dev` | API in watch mode on the host (reads `apps/api/.env`) |
| `make test` / `make test-e2e` | tests (unit + mocked e2e) / real MySQL integration |
| `npm run lint` | ESLint on the root tooling and every workspace, `--max-warnings 0` |
| `npm run lint:fix` | the same with `--fix` (layout and other mechanical fixes) |
| `make smoke` | smoke test of health + main endpoints |
| `make datadog` | brings up the Datadog agent (profile `observability`, opt-in) |

> The `.env` lives in **`apps/api/.env`** (never versioned; generated at runtime via `make env`; in prod via SSM/Secrets Manager). `DATABASE_URL` host: **`mysql`** when running in Docker (`make up`), **`127.0.0.1`** when running on the host (`npm run dev`). The front end reads `VITE_APP_TIMEZONE` at build time.

## Required Tooling

### In use

- **Node.js ≥ 20 + TypeScript** — same language for back end/front end; shared types in `@atena/types` (`packages/types`).
- **NestJS 11** (`apps/api`) — modules/controllers/guards/interceptors; **socket.io** gateway (`@nestjs/platform-socket.io`); auth/RBAC guards (`@Requires`).
- **Prisma CLI** (`prisma`) — versioned migrations + typed client; schema in `apps/api/prisma/schema.prisma` (snake_case in the DB via `@map`). MySQL stores **application data only**; delivery data comes from the **detailed report in S3** via DuckDB + `/tmp` cache.
- **DuckDB** (`@duckdb/node-api` or equivalent) — embedded query engine over S3 (`audit-query` module).
- **Amazon Bedrock** (`@aws-sdk/client-bedrock-runtime`) — LLM orchestrator with Amazon Nova Pro (`us.amazon.nova-pro-v1:0`, Converse API). No credentials → `FakeLlmProvider`.
- **Jest** (back end) + **Vitest** (front end) — test runners (see [`testing-strategy.md`](./testing-strategy.md)).
- **ESLint flat config** — the shared base `eslint.shared.mjs` + local rules (`eslint-rules/*`, `@stylistic`), spread by each workspace's `eslint.config.mjs`; see "Quality gate" below.
- **Vite 5** (`apps/web`) — front-end build/dev server; libraries: `react`, `react-router-dom`, `@tanstack/react-query`, `@phosphor-icons/react`, `socket.io-client`, `react-markdown`.
- **Own CSS design system** (`apps/web/src/styles/design-system`) — tokens + components; **no** styled-components nor external `atena-design-system`.
- **Datadog (optional)** — APM via `dd-trace` (`apps/api/src/tracing.ts`, imported first) + metrics via `hot-shots` (DogStatsD) in the `observability` module; feeds `GET /api/observability`. Does **not** use OpenTelemetry/Prometheus.
- **Docker / docker-compose** — profiles `local` (with MySQL), `production` (without MySQL, external RDS) and `observability` (Datadog agent). Intended deploy: an image on an **EC2** instance with a volume → `/tmp` (transient read-through cache of S3, ephemeral/rebuildable).

## Recommended Automation

**Today — context flow via dotcontext:**

- Codebase map: call the context tool with `context({ action: "getMap" })` for a self-updating snapshot (stack, structure, key files). Useful when orienting an agent on the state of the repo.
- Scaffolding fill: `context({ action: "listToFill" })` lists pending docs/agents/skills; `fillSingle` fills one file at a time (frontmatter preserved, `status: unfilled → filled`).

**Quality automation in use:**

- Type generation: `prisma generate` after migrations; build of `@atena/types`, consumed by back end and front end.
- Audit log as a **global NestJS interceptor** (`@Audit`, not scattered calls) — compliance automation, not optional.
- `dd-trace` imported first in `main.ts` (via `tracing.ts`); best-effort metrics via DogStatsD.
- **CI** (`.github/workflows/ci.yml`), one job per check, on pushes to `master` and on pull requests; it does not cover `make test-e2e` nor deploy (see [tech-debt.md](./tech-debt.md) item 10). The jobs are listed under "Quality gate" below.
- **Git hooks** (husky): `pre-commit` runs lint-staged — ESLint on the staged files with each file's workspace config, and `npm run check:context` when the context index or a surface is staged; `commit-msg` runs commitlint.
- **Dependabot** (`.github/dependabot.yml`): weekly npm (grouped) and GitHub Actions updates. **CodeQL** (`.github/workflows/codeql.yml`, job `CodeQL`): `security-and-quality` queries on pull requests, pushes to `master` and weekly.

## IDE / Editor Setup

- **TypeScript/ESLint** integrated into the editor (format-on-save, inline lint). VSCode with `editor.rulers: [80, 120]`, `tabSize: 2`, `insertSpaces`, `files.insertFinalNewline` (matches the code style).
- **Prisma** (schema syntax highlighting + autocomplete).
- **SonarLint** (optional) — the Sonar rules that matter already run inside ESLint through `eslint-plugin-sonarjs`, so the editor's ESLint integration shows them.

## Productivity Tips

- **Types come from `@atena/types`.** Before implementing/changing an endpoint, adjust the shape in `packages/types` (serialized in `snake_case` at the edge) — back end and front end share it. Build the package before the gate.
- **Delivery data = detailed report in S3.** To work on search/trail/report, the engine is `audit-query` (DuckDB over S3 + `/tmp` cache); in tests, point `ATENA_AUDIT_SOURCE_ROOT` to a fixture directory.
- **LLM in dev:** `LLM_PROVIDER=fake` avoids cost/credentials; `FakeLlmProvider` is deterministic.
- **The handoff is historical.** The `*.jsx` prototype and the `prototype/data.jsx` mocks were the design/contract reference (that folder is no longer in the repository); the real front end uses its own CSS design system.

See [`development-workflow.md`](./development-workflow.md) for the contribution flow, [`testing-strategy.md`](./testing-strategy.md) for the test runners and [`code-style.md`](./code-style.md) for the conventions.

## Quality gate

### npm scripts (root)

| Script | What it runs | Catches |
| --- | --- | --- |
| `lint` | `eslint` on the root tooling, then `lint` in every workspace, `--max-warnings 0` | type-aware errors (`strictTypeChecked`), sonarjs bugs and smells, cognitive complexity, unused code, magic numbers, missing TSDoc, layout |
| `typecheck` | `tsc --noEmit` in every workspace (web: app and e2e projects) | type errors |
| `check:architecture` | `depcruise` over `apps/*/src`, `apps/web/e2e`, `packages/types/src` | layer violations, cycles, orphans, unresolvable imports |
| `check:unused` | `knip` (`knip.jsonc`, per workspace) | unused files, exports, types and dependencies; unlisted dependencies |
| `test` / `test:coverage` | Jest (api) and Vitest (web), with the coverage gates | behaviour |
| `test:tooling` | Vitest on `eslint-rules/*.test.mjs` and `scripts/*.test.mjs` | regressions in the local rules and the context script |
| `check:context` / `export:context` | `scripts/check-context-surfaces.mjs` | agent surfaces drifting from `.context/docs/README.md` |

Workspace scripts: `lint`, `lint:fix`, `typecheck`, `test`, `test:coverage` in each app; `e2e` and `e2e:ui` (Playwright) in `@atena/web`; `test:e2e` (real MySQL) in `@atena/api`.

### ESLint (`eslint.shared.mjs`)

- typescript-eslint `strictTypeChecked` and `stylisticTypeChecked`, with type information from each workspace's tsconfig (`projectService`).
- `eslint-plugin-sonarjs` `recommended` at error, plus `cognitive-complexity` (15), `no-unused-function-argument`, `no-duplicate-string` (threshold 3), `no-collapsible-if`, `prefer-immediate-return`, `no-commented-code`, `no-inconsistent-returns`, `no-variable-usage-before-declaration`.
- `eslint-plugin-jsdoc` (`recommended-typescript-error`, `require-jsdoc` on exports, `require-throws`, tag order, one blank line after the summary).
- `@stylistic` layout rules and the local rules in `eslint-rules/` (`one-per-line`, `multiline-if-condition`, `block-multiline`, `jsdoc-tag-spacing`), each with RuleTester tests.
- Core: `max-depth` 3, `@typescript-eslint/max-params` 4, `id-length` 2, `curly`, `eqeqeq`, `@typescript-eslint/no-magic-numbers`.
- Tests (`*.spec.ts(x)`, `e2e/`) relax only what the test libraries type as `any` (`no-unsafe-*`, `unbound-method`), magic numbers, duplicated strings and `require-jsdoc`; the reason is in `testOverrides`.

### CI jobs (`.github/workflows/ci.yml`)

`lint`, `typecheck`, `architecture`, `unused`, `test-api` (Jest, 80% gate, coverage artifact), `test-web` (Vitest, coverage floor, artifact), `e2e-web` (Playwright, report artifact), `tooling`, `audit` (`npm audit --omit=dev --audit-level=high`), `context`, `commitlint` (pull requests only, every commit of the PR); `CodeQL` in `codeql.yml`.

Two transition jobs keep the check names the branch ruleset required before this layout — `API · lint + testes` (passes when `lint`, `typecheck` and `test-api` passed) and `Web · lint + unit + e2e (Playwright)` (passes when `lint`, `typecheck`, `test-web` and `e2e-web` passed). Remove them once the ruleset requires the jobs above.
