---
type: doc
name: testing-strategy
description: Test frameworks, patterns, coverage requirements, and quality gates
category: testing
generated: 2026-06-10
status: filled
scaffoldVersion: "2.0.0"
---

# Testing Strategy

> **Current state: a test suite is implemented.** Backend with **Jest** (`apps/api`, `*.spec.ts` + e2e), frontend with **Vitest** (`apps/web`). `make test` runs unit + mocked e2e; `make test-e2e` runs integration against real MySQL. **CI exists** (`.github/workflows/ci.yml`: lint + tests for the API; lint + Vitest + Playwright e2e for the web). The priority of the tests is not "cover everything" — it is to armor the invariants of the 5 principles.

Atena is a system where correctness has security and trust implications: it handles PII, records immutable audit logs and must **refuse** instead of inventing data. Priorities, in this order:

1. **Shape contracts** — each endpoint's response must match `@atena/types` (serialized in `snake_case` at the edge). Contract tests prevent drift between frontend and backend.
2. **Deterministic tools** — the read-only tools (`search_shippings`, `get_shipping_trail`, `analyze_shipping_content`, `generate_delivery_report`, `list_providers`, `list_customers`, `list_incidents`, `get_incident`, `generate_incident_report`) must be deterministic: same input → same output. Test them without the LLM in the loop.
3. **Server-side validation of incident resolve** (§D, RF-2.4) — `action_category` mandatory; `action_description` ≥ 20 chars (≥ 10 for `auto_resolved`); `escalated_to` mandatory when category ∈ {`internal_escalated`, `provider_escalated`}; only transitions `detected`/`acknowledged`/`auto_resolved` → `resolved` (otherwise 409/422). Test that the backend **rejects** even when the UI would let it through (double validation).
4. **PII masking + audit on reveal** (RNF-1.4) — every tool response comes out masked; reveal requires `pii:reveal` and **writes** `reveal_phone`/`reveal_content`. Test that there is no path that returns PII without a record.
5. **Explicit LLM refusal (principle 2)** — a request with no applicable tool → structured refusal, never fabricated data. Test with adversarial prompts.
6. **RBAC guards** — a role without the permission is denied (401 without a session, 403 without the permission); guard `@Requires(perm)`.
7. **socket.io events + reconnection** — format of `incident.created/updated/auto_resolved`; handshake rejected without a session.
8. **Error states** — tool timeout/failure (with retry), disconnected socket, expired session (401 → overlay without losing the saved conversation), Bedrock stream idle timeout.
9. **Audit engine** — `DuckDbAuditQueryService` over local detailed-report fixtures: `(campaign_id, phone)` grain, window by send, symmetric scan, `sms`/`sms_flash` channel.

## Test Types

Test stack in use:

- **Unit (backend)** — **Jest** (`apps/api/jest.config.js`, ts-jest), `*.spec.ts` files (~45 suites). Targets: resolve validators, PII masking, deterministic tools, detector, rules, audit engine, orchestrator, guards.
- **Unit (frontend)** — **Vitest** (`apps/web`), `*.spec.ts`/`*.spec.tsx` (~10 files): auth, chat (useChat/SSE/reveal), realtime (banner), util (time/user), tool-cards.
- **Integration / E2E (backend)** — `apps/api/src/http.e2e.spec.ts` (full pipeline, mocked Prisma, runs in `make test`) and `apps/api/src/db.e2e-spec.ts` (**real MySQL** via `make test-e2e`: starts the database, migrates, seeds; validates search/trail/providers/reveal+audit/report/chat-SSE, rules/incidents/lifecycle/observability/dev-detect over the seed).
- **Contract** — shapes compared against `@atena/types` (compile-time + asserts in the specs).

## Running Tests

Real commands:

- Everything (unit + mocked e2e): `make test` (or `npm test`).
- Backend only: `npm test --workspace @atena/api`.
- Frontend only: `npm run test --workspace @atena/web` (Vitest).
- Integration E2E (real MySQL): `make test-e2e`.
- Lint: `npm run lint`.
- With coverage: `npm run test:coverage` (both apps), or `npm run test:coverage -w @atena/api` / `-w @atena/web`.
- Browser e2e (hermetic, mocked API): `npm run e2e -w @atena/web`.
- Tooling (local ESLint rules, context script): `npm run test:tooling`.

## Quality Gates

- **Security invariants without exception:** the tests for PII masking, audit on reveal, resolve validation and LLM refusal are treated as **blocking**.
- **Lint/types before merge** — `npm run lint` with no errors or warnings (type-aware, with the Sonar rules); `npm run typecheck` with no errors.
- **Coverage** — `npm run test:coverage`. The API enforces **80%** on statements, branches, functions and lines over all of `src` (except the entry points `main.ts` and `tracing.ts`), in `apps/api/jest.config.js`; measured on 2026-11-01: statements 94.4%, branches 82.7%, functions 89.4%, lines 94.2% (395 tests). The web app's unit tests cover the logic modules only (16.7% statements, 54.7% branches, 43.7% functions), so its gate is a ratchet at that floor in `apps/web/vite.config.ts` until component tests exist ([tech-debt.md](./tech-debt.md) item 13). Never lower a threshold or widen an exclusion to pass.
- **CI** — `.github/workflows/ci.yml`, one job per check: `lint`, `typecheck`, `architecture`, `unused`, `test-api`, `test-web`, `e2e-web` (Playwright), `tooling`, `audit`, `context`, `commitlint`, on pushes to `master` and on PRs; `make test-e2e` (real MySQL) is still run locally.

## Troubleshooting

Fragile spots:

- **Do not test the LLM non-deterministically.** Use `FakeLlmProvider`; test the orchestrator, tool routing and refusal — not the model's free-form output. Isolating the AI from the contract tests avoids flakiness.
- **socket.io and timers** — reconnection/idle-timeout tests need fake timers; real sockets cause flakiness.
- **Append-only audit log** — in integration, the test role must replicate INSERT+SELECT only; testing that UPDATE/DELETE fail is part of the immutability gate.
- **Time zone/relative times** — the UI shows relative times and windows in BRT (`APP_TIMEZONE`); pin the clock in tests that compare these values.
- **Audit engine** — use local fixtures (a directory) instead of the real S3; `ATENA_AUDIT_SOURCE_ROOT` points to a directory in the tests.

See [`development-workflow.md`](./development-workflow.md) for where tests fit into the contribution flow.
