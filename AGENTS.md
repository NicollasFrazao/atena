# atena: context index

The knowledge base of this repository, for people and for coding agents. Atena is a conversational
AI assistant for a support team: an analyst asks in natural language, an LLM picks read-only tools,
and the API runs them over the delivery reports in S3 and the application data in MySQL. Start
with the project overview, then open the guide the task needs.

## Mandatory for anyone editing this repository

**Before editing any file, read [`development-conventions.md`](/.context/docs/development-conventions.md).**
It is the normative file: the quality gate to run before every commit, the layer rules, the
non-negotiable product principles, the documentation and readability rules the lint enforces,
commits and branches, and the language everything is written in. Its rules are commands, not
background reading.

Three more readings, each with the moment it applies:

- **before writing or changing an API shape, a DTO or a tool** — [`code-style.md`](/.context/docs/code-style.md),
  sections "API (input and output)" and "Naming" (`snake_case` at the edge, the shapes in `@atena/types`);
- **before touching PII, the audit log, RBAC or the incident lifecycle** — [`security.md`](/.context/docs/security.md)
  and the principles in `development-conventions.md`;
- **before changing the audit engine (DuckDB over S3) or a detector** — [`data-flow.md`](/.context/docs/data-flow.md)
  and [`anomaly-scenarios.md`](/.context/docs/anomaly-scenarios.md).

> **This file is the source of the agent surfaces.** `AGENTS.md`, `.claude/CLAUDE.md` and
> `.github/copilot-instructions.md` are byte-for-byte copies of `.context/docs/README.md`, written by
> `npm run export:context` and verified by `npm run check:context` (a CI job). Edit this file, never
> a copy. The rules themselves are not copied into the surfaces: they live in
> `development-conventions.md`, one hop away, so there is a single place to change them.

## Guides

| Guide | What it answers |
| --- | --- |
| [Project overview](/.context/docs/project-overview.md) | What Atena does, for whom, the stack and the entry points |
| [Architecture](/.context/docs/architecture.md) | Modules of the API, the web app, layer rules, key decisions |
| [Development conventions](/.context/docs/development-conventions.md) | **Normative.** Quality gate, principles, code rules, commits, branches, PRs, language |
| [Code style](/.context/docs/code-style.md) | API shapes, naming, formatting, NestJS and Prisma conventions |
| [Development workflow](/.context/docs/development-workflow.md) | Setup, day-to-day commands, the Makefile, local stack |
| [Testing strategy](/.context/docs/testing-strategy.md) | Jest, Vitest and Playwright suites, what each protects, coverage gates |
| [Data flow](/.context/docs/data-flow.md) | Chat → orchestrator → tools → audit engine (DuckDB over S3), incidents, realtime |
| [Anomaly scenarios](/.context/docs/anomaly-scenarios.md) | The detector rules and their default thresholds |
| [Glossary](/.context/docs/glossary.md) | Domain vocabulary (shipping, campaign, incident, reveal…) |
| [Security](/.context/docs/security.md) | OIDC, RBAC, PII masking and reveal, audit log, secrets |
| [Tooling](/.context/docs/tooling.md) | Every npm script, Make target, hook and CI job, and what each one catches |
| [Technical debt](/.context/docs/tech-debt.md) | Known gaps, with the reason they are still open |
| [Decision records](/.context/docs/adr/README.md) | Why S3 + DuckDB for delivery data, why snake_case at the edge, why the LLM never touches data |

## Agents and skills

Playbooks tailored to this repository, for agents that support them: [`agents/`](/.context/agents/README.md)
(code reviewer, backend, frontend, database, security, test writer, architect, devops and more) and
[`skills/`](/.context/skills/README.md) (code review, commit message, test generation, API design,
bug investigation and more).

## Repository map

- `apps/api/` — NestJS 11 API: chat + LLM orchestrator (`chat/`, `llm/`), tools over the audit engine
  (`shippings/`, `reports/`, `catalog/`, `audit-query/`), incidents and detector, rules, realtime
  gateway, auth/RBAC, audit log, observability; Prisma schema and migrations in `prisma/`
- `apps/web/` — React 18 + Vite app (pages per feature in `src/`, data layer in `src/api/`,
  Playwright suite in `e2e/`)
- `packages/types/` — `@atena/types`, the API contract shared by both apps
- `eslint.shared.mjs`, `eslint-rules/` — the lint base every workspace uses, and the local
  readability rules with their RuleTester tests
- `scripts/` — `check-context-surfaces.mjs` (export and check of the agent surfaces)
- `docs/` — OpenAPI, Insomnia collection, the historical design handoff and cost notes
- `.github/` — CI, CodeQL, Dependabot, PR and issue templates, CODEOWNERS
- `Makefile`, `docker-compose.yml` — local stack (API + MySQL, optional Datadog agent)
