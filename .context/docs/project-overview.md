---
type: doc
name: project-overview
description: High-level overview of the project, its purpose, and key components
category: overview
generated: 2026-06-10
status: filled
scaffoldVersion: "2.0.0"
---

## Project Overview

**Atena** is the conversational AI assistant of the communication platform. It gives authorized support teams **self-service access to SMS sending data** — shipping search, the complete delivery trail, content risk analysis and deliverability reports — and **detects anomalies proactively**, creating incidents, notifying in real time (socket.io) and recording, in a structured way, the action taken on each one. The core principle is that **the AI is an interpreter, not an executor**: the LLM translates natural language into calls to deterministic _tools_; the application runs the query, applies RBAC and accesses the data — the LLM never touches the database and never fabricates data.

> **Current state of the repository (MVP implemented):** the product **is built**. It is an **npm monorepo** with `apps/api` (NestJS 11 + Prisma/MySQL), `apps/web` (React 18 + Vite) and `packages/types` (`@atena/types`). Microsoft Entra OIDC auth enabled and validated; app-managed RBAC; deterministic tools, LLM orchestrator (Amazon Nova Pro via Bedrock, with a fake fallback), shipping search/trail/reports over the **detailed report in S3** (via DuckDB), incidents + detector + realtime push, rules (CRUD + shadow mode), audited PII reveal, user/role admin, audit log and observability — all present. The design handoff package (`docs/design_handoff_atena/`) remains as a **historical design/contract reference**, not as the source of truth for what exists.

## Codebase Reference

> **Semantic Snapshot**: Use `context({ action: "getMap", section: "all" })` for the generated stack, architecture layers, key files and dependency hotspots.

## Quick Facts

- Root: `~/atena`
- Primary language: **TypeScript** end to end (Node.js/NestJS on the back end, React on the front end).
- State: **MVP implemented** (Phases 1 and 2 delivered; merged into `master`).
- Structure: **npm workspaces monorepo** — `apps/api`, `apps/web`, `packages/types`.
- Design/contract reference (historical): [spec-assistente-suporte.md](../../docs/design_handoff_atena/spec-assistente-suporte.md), [01-backend-api-contract.md](../../docs/design_handoff_atena/01-backend-api-contract.md).
- API I/O convention: **`snake_case`** at the edge (a revision of the handoff, which was camelCase). See [code-style.md](./code-style.md).
- Semantic snapshot: `context({ action: "getMap", section: "all" })`

## Entry Points

- **Backend:** `apps/api/src/main.ts` — NestJS app exposing REST under the `/api` prefix, an SSE stream in the chat and a **socket.io** gateway at `/ws/support`.
- **Frontend:** `apps/web/src/main.tsx` / `App.tsx` — React + Vite app, routing between Chat, Incidents, Reports, Rules, Audit, Observability, User admin and Login.
- **Shared types:** `packages/types/src/index.ts` (`@atena/types`) — shapes for shippings, tools, WS/SSE events, RBAC, etc.

## Key Exports

- **LLM tool catalog:** `search_shippings`, `get_shipping_trail`, `analyze_shipping_content`, `generate_delivery_report`, `list_providers`, `list_customers` (self-service); `list_incidents`, `get_incident`, `generate_incident_report` (incidents). Implemented in the orchestrator (`apps/api/src/chat/orchestrator.service.ts`) with a mirrored REST endpoint.
- **REST + WebSocket endpoints:** controllers in `apps/api/src/*` (routes under `/api`, e.g. `/shippings/*`, `/incidents/*`, `/rules`, `/reports/*`, `/observability`, `/audit`, `/admin/*`, `/auth/*`) and the socket.io gateway `/ws/support`.
- **Shared types package** `@atena/types` (`packages/types`) — consumed by back end and front end.

## File Structure & Code Organization

- `apps/api/` — NestJS 11 back end. Feature modules in `src/`: `auth` (OIDC + RBAC), `admin`/`users`, `chat` (orchestrator + ThinkingSplitter), `llm` (bedrock + fake), `shippings` (search/trail/reveal/analysis), `audit-query` (DuckDB engine over S3), `catalog`, `reports`, `incidents`, `detector`, `rules`, `realtime` (socket.io), `observability`, `audit`, `retention`, `cache`, `config`, `prisma`, `common`. Schema in `prisma/schema.prisma`.
- `apps/web/` — React 18 + Vite front end. Features in `src/`: `chat`, `incidents`, `reports`, `rules`, `audit`, `observability`, `admin`, `auth`, `history`, `realtime`, `user`, `components`, `styles` (CSS design system + tokens), `api`, `util`.
- `packages/types/` — `@atena/types`, the shared contract.
- `docs/design_handoff_atena/` — handoff package (specs `01`–`06`, `decisions.md`, `spec-assistente-suporte.md`, `screenshots/`; the `prototype/` folder is no longer in the repository). **Historical reference** for design/contract.
- `.context/` — the dotcontext knowledge base (docs, agents, skills, harness).
- `Makefile`, `docker-compose.yml`, `.env.example` — local tooling (see [tooling.md](tooling.md)).

## Technology Stack Summary

End-to-end TypeScript stack. **Backend:** NestJS 11 (modules + DI, auth/RBAC guards, global audit log interceptor, **socket.io** gateway), **Prisma** over **MySQL** as the store for **application data only** (chat, incidents, rules, audit log, users/roles) — **DELIVERY data does not live in MySQL**. **Amazon Nova Pro** (`us.amazon.nova-pro-v1:0`) via **Amazon Bedrock Converse** (streaming + tool use) for the orchestrator, with a **fake provider** when there are no credentials. **Frontend:** React 18 + Vite + Phosphor Icons + CSS (design system with tokens), informal PT-BR. **Observability:** Datadog APM (dd-trace) + metrics via DogStatsD (hot-shots), **optional** (opt-in).

## Core Framework Stack

- **Backend:** NestJS 11 — modules + DI, auth/RBAC guards, interceptors (audit/metrics), socket.io gateway.
- **Delivery data (source of truth):** **detailed report in S3** (`s3://example-sms-delivery-reports`, from `example-sms-delivery-reports`/webhook-dispatcher), queried **on demand** by the `AuditQueryService` engine (embedded DuckDB + transient cache in `/tmp`). Per-recipient grain `(campaign_id, phone)`, `id = md5(campaign_id||'|'||phone)`.
- **Application data:** MySQL via Prisma (chat, incidents, rules, audit log, users/roles). Versioned migrations. **Raw content/PII** lives in S3; `/tmp` is an ephemeral/rebuildable cache (read-through from S3).
- **LLM:** Amazon Nova Pro via Amazon Bedrock Converse (streaming + tool use); deterministic fake fallback. The AI never accesses the database directly.
- **Real-time:** **socket.io** gateway (`/ws/support`), authenticated by the same session (JWT cookie).

## UI & Interaction Libraries

- **Acme CSS design system** — its own components and tokens (`apps/web/src/styles/design-system`); the front end does **not** use styled-components nor the external `atena-design-system` package (the prototype only re-implemented it by hand because it ran standalone).
- **Phosphor Icons** (`@phosphor-icons/react`) — no emoji in the product.
- **Acme design tokens** — primary `plankton800` (#077E70) + semantic colors (danger/warning/info/success). See [05-design-reference.md](../../docs/design_handoff_atena/05-design-reference.md).
- Other front-end libraries: `react-router-dom`, `@tanstack/react-query`, `react-markdown`, `socket.io-client`.
- Product language: **PT-BR**, informal register (`você`). The delivery entity is displayed as **"Envio"** (Shipping).

## Development Tools Overview

The monorepo is driven by npm workspaces + a `Makefile`. Flows: `make env` (generates `apps/api/.env`), `make up`/`make dev` (Docker), `make migrate`, `make seed`, `npm run dev` (API on the host), `make web` (Vite), `make test`/`make test-e2e`, `npm run lint`. Details in [tooling.md](tooling.md) and [development-workflow.md](development-workflow.md).

## Getting Started Checklist

1. Read this overview, [architecture.md](architecture.md) and [data-flow.md](./data-flow.md) for the current state.
2. Run it locally: `make env`, adjust `apps/api/.env` (in dev `AUTH_DEV_BYPASS=true`, `LLM_PROVIDER=fake`), `make up` (or `npm run dev` + `make web`).
3. Review the 5 non-negotiable principles (the AI does not execute, does not fabricate data, incidents are not a tool, everything is audited, PII is masked) — see [architecture.md](architecture.md).
4. For design/contract history (shapes, screens), consult the handoff in [docs/design_handoff_atena/](../../docs/design_handoff_atena/) — keeping in mind that the API now serializes in `snake_case` ([code-style.md](./code-style.md)).
5. Check the residual technical debt in [tech-debt.md](./tech-debt.md).

## Next Steps

The MVP is delivered. Residual work (see [tech-debt.md](./tech-debt.md)): full corporate SSO (SAML + SCIM); EC2 IAM Role for S3 (read credentials today); post-redeploy pre-warming of the `/tmp` cache; catalog cache (`list_customers`/`list_providers`); investigating the intermittent hang of the post-tool turn on Bedrock; measuring the volume of untracked pre-`queued` failures. Stakeholder: Acme / Support team. Related: [architecture.md](architecture.md), [development-workflow.md](development-workflow.md), [tooling.md](tooling.md).
