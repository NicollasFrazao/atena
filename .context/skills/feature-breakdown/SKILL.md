---
type: skill
name: Feature Breakdown
description: Break down features into implementable tasks. Use when Planning new feature implementation, Breaking large tasks into smaller pieces, or Creating implementation roadmap
skillSlug: feature-breakdown
phases: [P]
generated: 2026-06-10
status: filled
scaffoldVersion: "2.0.0"
---
## Workflow

Context: the Atena repo holds the implemented MVP — `apps/api` (NestJS 11 + Prisma/MySQL, DuckDB over S3), `apps/web` (React 18 + Vite) and `packages/types` (`@atena/types`); the design handoff (`docs/design_handoff_atena/`) is the historical spec/design reference (the original React prototype is not included in the repo). Every feature breakdown starts from the existing code and contracts (`@atena/types`, `docs/openapi.yaml`) and describes work that extends them.

1. **Place the feature in the sprint order** of `docs/design_handoff_atena/README.md` §7. All three sprints are already delivered, so a new feature extends one of these layers; nothing of Phase 2 goes in without its foundation:
   - **Sprint 0 — Foundation:** auth (OIDC via Microsoft Entra, restricted to the `@example.com` domain, session in a JWT cookie) + app-managed RBAC (4 roles — admin/support_lead/support_analyst/viewer — mapped to permissions, `@Requires(perm)`), MySQL schema + migrations (`apps/api/prisma/schema.prisma`), global audit log interceptor.
   - **Sprint 1 — Phase 1 (self-service):** deterministic tools, LLM orchestrator (chat/stream/tool routing + refusal), PII masking + reveal-with-audit, chat frontend.
   - **Sprint 2 — Phase 2 (proactive):** anomaly detector, WS gateway + push, incident lifecycle (server-side ack/resolve), Rules/Reports/Audit/Observability screens.
2. **Link screen → endpoint → shape → tool** using `04-screen-to-endpoint-map.md`. Every UI feature must name: the screen component (in `apps/web/src/`), the REST/WS endpoint(s), the response shape (`@atena/types` / `docs/openapi.yaml`) and the tool (if any).
3. **Break it into independent tasks** following Atena's natural vertical slice: migration (only for app state — delivery data lives on S3) → endpoint/tool (backend) → type in `@atena/types` → UI (in-house components on the `--at-*` tokens). Each task testable in isolation.
4. **Apply the 5 principles as acceptance criteria on every relevant task** (see the Quality Bar). E.g. a tool task always has the criterion "writes audit `tool_call`"; a PII task always has "masked by default + reveal generates audit".
5. **Mark what depends on a PENDING DECISION** (`06-pending-decisions.md` / `decisions.md`). Already settled in `decisions.md`: SMS content may live in an easy-access store read through to S3 (implemented as S3 + the `/tmp` cache; the MySQL delivery hot store was dropped), the top-3 anomaly scenarios and default rule thresholds (`.context/docs/anomaly-scenarios.md`), and the audit log as an append-only table in the same database (INSERT + SELECT only). Do not invent a decision — flag anything still open as a blocker.
6. **Order by dependency:** the foundation unblocks everything; tools depend on the S3/DuckDB engine (delivery) or the schema (app state); the UI depends on the endpoint's shape; ack/resolve depend on incidents + WS.
7. **Concrete acceptance criteria** per task: the endpoint responds in the exact shape of `@atena/types`, the RBAC guard is applied, server-side validation is covered.

## Examples

**Feature: shipping search (Sprint 1, Phase 1) — as it was broken down, mapped to today's code**
```
## Feature: Shipping search
Screen: apps/web/src/chat/tool-cards/SearchResultsCard.tsx  →  GET /api/shippings/search  →  SearchResultRowInterface (§C.1)  →  tool search_shippings

### T1 — Delivery data source (pre-req)
- No MySQL table: shippings come from the S3 detailed report via DuckDB (apps/api/src/audit-query/),
  phone normalized to digits-only, grain per recipient (campaign_id+phone), /tmp cache.
- Acceptance: the engine answers a windowed search; partitions served from cache when hot.

### T2 — Endpoint GET /api/shippings/search + tool search_shippings
- Input { phone?, status?, provider?, channel?, error_hint?, customer_id?, campaign_id?, date_from?, date_to?, date_range?, page, limit }.
- The app runs the query (the AI does NOT touch the database — principle 1); @Requires('messages:search'); envelope { rows, page, total_pages, total, latency_ms }.
- Acceptance: the response matches SearchResultRowInterface (§C.1); each call writes audit action 'tool_call'.

### T3 — Shared type in @atena/types
- SearchResultRowInterface + PaginatedEnvelopeInterface<T> (snake_case at the API; Prisma Client camelCase mapped at the edge).
- Acceptance: backend and frontend import the same type.

### T4 — UI SearchResultsCard (in-house components on the --at-* tokens)
- phone_masked by default; RevealField reveals phone_full only with permission + reveal → audit 'reveal_phone' (principle 5).
- Clickable row → opens the trail (get_shipping_trail).
- Acceptance: reuses the in-house components (do NOT copy prototype JSX); error state = inline tool error + "tentar de novo" ("try again").

### Dependencies: T2,T4 depend on T1; T4 depends on T3; reveal depends on the audit interceptor (Sprint 0).
### Settled: delivery data is read from S3 (+ /tmp cache), never from MySQL; phone_full/content are served only by the reveal endpoints.
```

**Feature: Resolve incident (Sprint 2, Phase 2)**
```
## Feature: Incident resolution
Screen: apps/web/src/incidents/ResolveIncidentModal.tsx → POST /api/incidents/{id}/resolve → validation §D
WARNING: resolve is NOT an LLM tool (principle 3) — only via UI + server-side validation.

### T1 — Resolve endpoint with server-side validation (§D)
- action_category ∈ enum (provider_recovered/provider_escalated/internal_escalated/false_positive/customer_communicated/monitoring_only/other).
- action_description ≥ 20 chars (≥ 10 on auto_resolved); if category ∈ {provider_escalated, internal_escalated} → escalated_to required.
- Only transition acknowledged|detected|auto_resolved → resolved.
- Acceptance: the backend revalidates everything (the UI disables, but it is not the source of truth); writes incident_activity (status_change) + audit 'incident_resolve'; emits WS incident.updated.

### T2 — UI ResolveIncidentModal (in-house dialog)
- Acceptance: required fields mirror §D; button disabled until valid; server-side error shown.
```

## Quality Bar

- **The 5 principles become acceptance criteria**, not comments: (1) the app runs query/RBAC/data, the LLM never touches the database; (2) all structured data comes from a tool, otherwise explicit refusal (`RefusalCard`); (3) ack/resolve/comment are NOT tools — only UI + server-side validation; (4) every tool call / reveal / incident change writes the audit log; (5) PII (phone, SMS content) masked by default, reveal generates audit.
- Every UI feature explicitly names screen (component in `apps/web/src/`) → endpoint → shape (`@atena/types`) → tool. Without that mapping, the task is incomplete.
- No Phase 2 task goes in before its foundation is ready: without a data source there is no tool; without the audit interceptor there is no reveal; without RBAC there is no endpoint.
- Response shapes are a contract: the acceptance criterion cites the matching type in `@atena/types` (e.g. §C.1 = `SearchResultRowInterface`).
- snake_case at the API ↔ snake_case in the DB, with Prisma Client's camelCase mapped at the edge (services/serializers/DTOs), never leaking camelCase to the UI.
- Pending decisions stay marked as an explicit blocker — do not choose on your own a PII, threshold or audit-storage policy that is not already settled.
- Recreating the prototype ≠ copying JSX: UI tasks use the in-house components of `apps/web/src/` on the `--at-*` tokens. Informal PT-BR in user-facing strings.

## Resource Strategy

- Do not create `scripts/`/`references/`/`assets/` for this skill: feature breakdown is a textual planning exercise; the canonical artifacts already live in the code, `docs/openapi.yaml` and `docs/design_handoff_atena/`.
- If a feature keeps reusing the same shapes, reference `@atena/types` and `docs/openapi.yaml` (historically `01-backend-api-contract.md` §C and `02-data-model.md`) by name — do not duplicate the schema here (avoids diverging from the code).
- The expected output is the task breakdown itself (Markdown), not files in the repo; keep everything in `SKILL.md`.
