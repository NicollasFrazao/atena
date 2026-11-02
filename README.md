# Atena

AI conversational assistant for messaging platforms. It gives authorized support teams **self-service access to SMS delivery data** (search, delivery trail, risk analysis, reports) and **detects anomalies proactively** (incidents pushed in real time, with a structured resolution flow).

> **Core principle:** the AI is an **interpreter, not an executor**. The LLM turns natural language into calls to deterministic _tools_; the **application** runs the query, enforces RBAC and reads the data. The LLM never touches the data source and never makes data up.

---

## Current state

The MVP is **implemented** end to end, with a NestJS backend and a React frontend: chat with an LLM orchestrator and deterministic tools, an anomaly detector with real-time push, the incident lifecycle, reports, rules, auditing, observability, OIDC login (Microsoft Entra) and role administration (RBAC).

- **Backend:** [`apps/api`](apps/api/), NestJS 11.
- **Frontend:** [`apps/web`](apps/web/), React 18 + Vite.
- **Shared contract:** [`packages/types`](packages/types/), `@atena/types`.

The current HTTP contract is in [`docs/openapi.yaml`](docs/openapi.yaml). The original design handoff is in [`docs/design_handoff_atena/`](docs/design_handoff_atena/). It is **historical** and differs from the current state in several places (see the note at the top of its README).

---

## Non-negotiable principles

1. **The AI is an interpreter, not an executor.** The application runs the query, enforces RBAC and reads the data; the LLM only receives the structured result.
2. **The LLM does not make up data.** Every piece of structured data comes from a tool result; with no applicable tool, the answer is an explicit refusal.
3. **Changing an incident's state is not a tool.** `acknowledge`/`resolve` only happen through the UI, with server-side validation.
4. **Everything is audited.** Messages, tool calls, PII reveals, exports and incident changes go to an immutable, append-only audit log through a global interceptor.
5. **PII is masked by default.** Phone numbers and SMS content arrive masked; revealing them (or exporting them in clear) requires `pii:reveal` and writes an audit log entry.

---

## Stack

- **Backend:** TypeScript + **NestJS 11** (modules/DI, guards, interceptors, a WebSocket gateway over Socket.IO).
- **Application database:** **MySQL** through **Prisma**. It stores only the **application's** state (incidents, rules, chat sessions and messages, users and roles, `audit_log`), **not** the delivery data.
- **Delivery data source:** the **detailed report** in **S3** is the source of truth, queried with **DuckDB** through a transient read-through cache in `/tmp` (fewer round trips to S3). MySQL has no messages table.
- **LLM:** **Amazon Bedrock** (**Amazon Nova Pro**, Converse API with streaming and tool use), behind a swappable abstraction (`LLM_PROVIDER`). Without credentials (`AWS_BEARER_TOKEN_BEDROCK`) it falls back to a deterministic _fake_ provider (dev, local and tests).
- **Auth:** corporate social login over **OIDC** (Microsoft 365 / Entra ID), restricted to the organization's domain, with a JWT session cookie (`SameSite=None; Secure`). The provider is pluggable.
- **RBAC managed in the app:** roles live in the database (assigned by an admin) and **do not** come from the IdP. Four roles (`admin` / `support_lead` / `support_analyst` / `viewer`) map to permissions (a map in code, `@Requires`). The JWT carries identity only.
- **Frontend:** **React 18** + **Vite**, React Router, TanStack Query, the Socket.IO client and Phosphor Icons.
- **Deployment:** a **Docker** image on **EC2**, with a host volume mounted at `/tmp` (the DuckDB cache).
- **Observability:** APM through **Datadog** (dd-trace, opt-in) plus basic assistant metrics derived from the audit log.

---

## Repository layout

```
apps/api/              # NestJS backend (LLM orchestrator + tools + REST/WS)
  prisma/schema.prisma # MySQL schema (application state) + migrations/
  src/                 # config, prisma, auth (OIDC+RBAC), audit, llm (Bedrock/Nova),
                       #   audit-query (S3↔DuckDB), shippings, incidents, reports,
                       #   rules, catalog, chat, detector, observability, admin, retention
  Dockerfile           # multi-stage image
apps/web/              # React + Vite frontend (chat, incidents, reports, rules,
                       #   history, audit, admin/users, observability)
packages/types/        # @atena/types: shapes shared between API and web
docs/openapi.yaml      # CURRENT HTTP contract
docs/design_handoff_atena/  # ORIGINAL design handoff (project input; historical)
.context/              # knowledge base (dotcontext): docs, agents, skills, plans
docker-compose.yml     # local | production profiles
Makefile               # task entry point
```

---

## Running locally

**Prerequisites:** Node ≥ 20, Docker + Docker Compose.

```bash
# 1. environment variables: generates apps/api/.env (NEVER committed) from the template
make env            # creates .env from .env.example; fill in the values

# 2. dependencies
make install

# 3. start the local stack (API + MySQL in Docker)
make up ENV=local
#   or: make dev   → starts with AUTH_DEV_BYPASS=true (no login; dev ONLY)

# 4. database migrations
make migrate

# 5. health check
curl localhost:3000/health   # -> {"status":"ok","service":"atena-api"}
```

- API only (on the host, watch mode, fast iteration): `make api`.
- Frontend (Vite, on the host): `make web`.
- Smoke test of the main endpoints: `make smoke`.

`make help` lists every target.

### Environment variables

The app always reads **a single `.env`** (`apps/api/.env`), **generated at runtime** and **never committed** (in production from **SSM / Secrets Manager**; locally through `make env`). The only env file in git is the template, [`.env.example`](.env.example). Relevant keys: `DATABASE_URL`, `LLM_PROVIDER`/`BEDROCK_MODEL_ID`/`AWS_BEARER_TOKEN_BEDROCK`, S3 (detailed report source), OIDC (`AUTH_*`), `AUTH_ADMIN_EMAILS` (admin bootstrap), `APP_TIMEZONE` (defaults to BRT) and `AUTH_DEV_BYPASS` (off in production).

---

## API and contract

- Every endpoint lives under the **`/api`** prefix, except `GET /health` (an infrastructure probe at the root).
- Responses use `snake_case`; errors have the shape `{ "error": { "code": "...", "message": "..." } }`; paginated lists use the envelope `{ rows, page, total_pages, total, latency_ms }`.
- The delivery entity is the **shipping** (routes under `/shippings/*`; it used to be `message`).
- Chat and reports respond as an **SSE stream**; incidents are pushed over **WebSocket** (Socket.IO).
- The full contract is in [`docs/openapi.yaml`](docs/openapi.yaml).

### Delivery window (send-based)

Volumes and rates are always measured **on the send time** (`requested_at`) within the window, not on when the delivery was finalized. A shipping's trail extends backwards to show its terminal events. The engine works in UTC and converts only at the edges to the display time zone (`APP_TIMEZONE`, default UTC-3/BRT).

---

## Database

- The schema is in [`apps/api/prisma/schema.prisma`](apps/api/prisma/schema.prisma) (MySQL, **application state only**), with versioned migrations in `apps/api/prisma/migrations/`.
- `make migrate` (dev) / `prisma migrate deploy` (production, in the container entrypoint).
- `audit_log` is **append-only**: the application's database role should only have INSERT + SELECT.
- **Delivery data is not stored in the database**: it comes from the detailed report in S3, queried with DuckDB.

---

## RBAC

| Role | Summary |
|---|---|
| `viewer` | Read-only (search, trail, reports, incidents, rules, audit, observability). |
| `support_analyst` | Viewer + incident operations (comment, acknowledge, resolve). |
| `support_lead` | Analyst + sensitive actions: reveal PII (`pii:reveal`), edit rules, trigger ops routines. |
| `admin` | Everything + user and role management (`/admin`). |

Roles are assigned by an admin on the `/admin/usuarios` screen and stored in the database. `pii:reveal` is required both for reveals (`reveal-phone`/`reveal-content`) and for CSV exports with phone numbers in clear.

---

## Documentation

- **Current HTTP contract:** [`docs/openapi.yaml`](docs/openapi.yaml).
- **Context base for people and coding agents:** start at [`.context/docs/README.md`](.context/docs/README.md) — [development conventions](.context/docs/development-conventions.md) (normative) · [architecture](.context/docs/architecture.md) · [data flow](.context/docs/data-flow.md) · [security](.context/docs/security.md) · [tooling](.context/docs/tooling.md) · [anomaly scenarios](.context/docs/anomaly-scenarios.md) · [technical debt](.context/docs/tech-debt.md)
- **Contributing:** [CONTRIBUTING.md](CONTRIBUTING.md) · **Security:** [SECURITY.md](SECURITY.md)
- **Design handoff (original / historical):** [README](docs/design_handoff_atena/README.md).

---

## Conventions

- **Quality gate:** type-aware ESLint with the Sonar and TSDoc rules (no warnings allowed), `tsc`, layer rules (dependency-cruiser), unused code (knip), tests with coverage gates, Playwright, and the context check — one CI job per check. The commands are in [CONTRIBUTING.md](CONTRIBUTING.md).
- **Commits:** [Conventional Commits](https://www.conventionalcommits.org/) in English (e.g. `feat(api): ...`, `chore(db): ...`), checked by commitlint.
- **Secrets:** never in git. `.env` is generated at runtime and is in `.gitignore`.
- **PII:** never log it in clear; use masked phone numbers or IDs and `severity: pii` in the audit log.
