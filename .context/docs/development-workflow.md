---
type: doc
name: development-workflow
description: Day-to-day engineering processes, branching, and contribution guidelines
category: workflow
generated: 2026-06-10
status: filled
scaffoldVersion: "2.0.0"
---

## Development Workflow

**Current state: MVP implemented.** The repository is an **npm monorepo** — `apps/api` (NestJS 11 + Prisma/MySQL), `apps/web` (React 18 + Vite) and `packages/types` (`@atena/types`). OIDC auth, tools, orchestrator (Nova Pro/fake), search/trail/reports over the detailed report in S3, incidents + detector + realtime, rules, PII reveal, user admin, audit log and observability are all present. The handoff in [`docs/design_handoff_atena/`](../../docs/design_handoff_atena/) is a **historical reference** for design/contract.

> Note: the real API serializes in **`snake_case`** at the edge (a revision of the handoff, which was camelCase). See [code-style.md](./code-style.md).

Today's work is evolving the existing code while following the non-negotiable principles and the code style. Residual work is listed in [tech-debt.md](./tech-debt.md).

### Implementation map (what already exists)

- **Foundation:** Microsoft Entra OIDC auth (state/nonce/PKCE + JWT cookie session) + app-managed RBAC (roles in the database, `@Requires`); MySQL schema + Prisma migrations; global audit interceptor (`@Audit`).
- **Self-service (read-only):** tools `search_shippings`/`get_shipping_trail`/`analyze_shipping_content`/`generate_delivery_report`/`list_providers`/`list_customers`; LLM orchestrator (chat, SSE, tool routing, refusal, `ThinkingSplitter`); PII masking + audited reveal; chat frontend + tool results.
- **Proactive:** anomaly detector (4 rules + shadow mode); socket.io gateway + incident push; incident lifecycle (`acknowledge`/`resolve`/`comment`) with server-side validation; Rules, Reports, Audit, Observability and User admin screens.
- **Delivery data:** the `AuditQueryService` engine (DuckDB over the detailed report in S3 + `/tmp` cache).

### How to use the handoff (historical reference)

- The prototype (`prototype/*.jsx`) and the mocks in `prototype/data.jsx` were the design/contract reference (that folder is no longer in the repository). The production front end uses its **own CSS design system** (`apps/web/src/styles/design-system`), not styled-components nor the external `atena-design-system` package.
- The shapes now live in `@atena/types`; the API serializes in `snake_case`. The screens and tokens in [05-design-reference.md](../../docs/design_handoff_atena/05-design-reference.md) (Plankton `#077E70`, semantic colors, Phosphor Icons, no emoji, informal PT-BR) still apply for visual parity.

## Branching & Releases

- **Main branch:** `master`. PRs target `master`. Trunk-based / short-lived feature branches.
- **Conventional Commits** are mandatory and checked by commitlint (hook and CI). Per-module scopes: `feat(chat)`, `feat(shippings)`, `feat(incidents)`, `feat(audit)`, `feat(rules)`, `feat(auth)`, `feat(detector)`, `fix(...)`, etc. Branch prefixes, the version each type implies and the PR rules are in [development-conventions.md](./development-conventions.md) and [CONTRIBUTING.md](../../CONTRIBUTING.md).
- `master` is protected: work on a branch and open a pull request; the CI jobs are the required checks.
- Commit/open a PR only when the user asks; if you are on `master`, create a branch first.

## Local Development

Real commands (npm monorepo + Makefile; see [tooling.md](./tooling.md)):

- Install: `npm install`
- Generate `.env`: `make env` (creates `apps/api/.env` from `.env.example`)
- Bring everything up in Docker: `make up ENV=local` (or `make dev` with `AUTH_DEV_BYPASS=true`)
- API on the host (watch): `npm run dev` (or `make api`); front end: `make web` (Vite)
- Migrate: `make migrate`; seed: `make seed`
- Tests: `make test` (unit + mocked e2e) / `make test-e2e` (real MySQL)
- Lint: `npm run lint`; health smoke test: `make smoke`
- The full quality gate (lint, typecheck, layer rules, unused code, coverage, Playwright, context check), one command at a time: [development-conventions.md](./development-conventions.md), "Quality gate"
- Datadog (optional): `make datadog`

In dev, use `LLM_PROVIDER=fake` (no Bedrock credentials) and `AUTH_DEV_BYPASS=true` (no login).

## Code Review Expectations

- Conventional Commits respected; PR includes an output sample when behavior changes.
- **Non-negotiable principles** ([README §5](../../docs/design_handoff_atena/README.md)): the LLM does not access the database; no structured data fabricated by the LLM (no tool → refusal); `acknowledge`/`resolve` **never** as a tool, only REST with server-side validation; every auditable action writes to the audit log; PII masked by default and reveal logged (`pii:reveal`).
- **Double validation**: the UI disables the button, but the backend revalidates (category/description/escalated_to/state transition).
- **Code style** ([code-style.md](./code-style.md)) and conventions ([development-conventions.md](./development-conventions.md)): `snake_case` at the API edge; semantic names; one item per line; TSDoc on exports; deferred work in [tech-debt.md](./tech-debt.md), not as `TODO` markers; the gate green.

## Onboarding Tasks

For newcomers:

1. Read, in this order: [project-overview.md](./project-overview.md) → [architecture.md](./architecture.md) → [data-flow.md](./data-flow.md) → [code-style.md](./code-style.md).
2. Run it locally (`make env`, adjust `apps/api/.env`, `make up` or `npm run dev` + `make web`); open the chat and walk through search → tool result → reveal → incidents.
3. Memorize the 5 non-negotiable principles.
4. Review the residual debt in [tech-debt.md](./tech-debt.md).
5. For design/contract history (screens, original shapes), consult the handoff in [docs/design_handoff_atena/](../../docs/design_handoff_atena/).

## Cross-References

- [Architecture Notes](./architecture.md)
- [Data Flow & Integrations](./data-flow.md)
- [Testing Strategy](./testing-strategy.md)
- [Tooling](./tooling.md)
- [Code Style](./code-style.md)
