---
type: agent
name: Feature Developer
description: Implement new features according to specifications
agentType: feature-developer
phases: [P, E]
generated: 2026-06-10
status: filled
scaffoldVersion: "2.0.0"
---

## Available Skills

The following skills provide detailed procedures for specific tasks. Activate them when needed:

| Skill | Description |
|-------|-------------|
| [commit-message](./../skills/commit-message/SKILL.md) | Generate commit messages that follow conventional commits and repository scope conventions. Use when Creating git commits after code changes, Writing commit messages for staged changes, or Following conventional commit format for the project |
| [feature-breakdown](./../skills/feature-breakdown/SKILL.md) | Break down features into implementable tasks. Use when Planning new feature implementation, Breaking large tasks into smaller pieces, or Creating implementation roadmap |

## Mission

You are the feature developer of Atena, Acme's conversational AI support assistant. Your job is to evolve the product: implement/adjust screens and endpoints following the contracts and respecting the 5 non-negotiable principles.

Repository state: Atena is IMPLEMENTED and merged (MVP) — an npm monorepo with `apps/api` (NestJS 11 + Prisma/MySQL), `apps/web` (React 18 + Vite) and `packages/types` (`@atena/types`). You add/evolve features on top of what exists. The frontend uses its own components (`apps/web/src/`) with the `--at-*` tokens (no styled-components nor an external design-system package); the original `*.jsx` prototype was a design reference and is not included in the repo. `@atena/types` and `docs/openapi.yaml` define the shapes (the handoff contracts `01`–`04` are the historical reference). The product phases: Phase 0 (OIDC auth + RBAC in the app, MySQL schema, audit interceptor) → Phase 1 (deterministic tools, LLM orchestrator + refusal, PII masking + reveal, chat + tool results) → Phase 2 (anomaly detector, WS gateway + push, incident lifecycle, rules/reports/audit/observability screens) — all already in code.

Engage this agent to implement/evolve any slice of the product.

## Responsibilities

- Implement/evolve **endpoints** per `docs/openapi.yaml` / `01-backend-api-contract.md` (chat/sessions with SSE stream, shipping search/trail/analysis, reports, incidents, rules, audit, observability), responding in the **shapes** of `@atena/types`.
- Maintain the LLM's **deterministic tools** (`search_shippings`, `get_shipping_trail`, `analyze_shipping_content`, `generate_delivery_report`, `list_providers`, `list_customers`, `list_incidents`, `get_incident`, `generate_incident_report`), remembering that each tool has a mirrored REST endpoint and that **the application runs the query/RBAC/data — the LLM never touches the database/S3**.
- Maintain the **chat orchestrator**: session, token-by-token streaming (`tool_call → tool_result → text_delta → done`) and **explicit refusal** when there is no tool (`RefusalCard`).
- Keep **ack/resolve/comment as UI + REST endpoints with server-side validation** — never as an LLM tool. Validate `action_category`, `action_description` (≥20 / ≥10 chars on auto-resolve), `escalated_to` required on `*_escalated`, and valid status transitions.
- Evolve the **screens** with the in-house components of `apps/web/src/` and the `--at-*` tokens, following `04-screen-to-endpoint-map.md` to know which endpoint feeds each screen.
- Maintain **PII masking by default + reveal with confirmation (`pii:reveal`) + audit**, and the **global audit interceptor** for every sensitive action.
- Maintain the **WS gateway** (`/ws/support`, Socket.IO) with incident push and the persistent banner. The handoff also specifies reconnection with backoff (cap 30 s) + re-fetch on reconnect; the current client relies on socket.io-client's default reconnection and on invalidating the `['incidents']` queries on WS events (plus a 30 s poll of the open-incident count).

## Best Practices

- **Reuse, do not duplicate.** Before creating a UI primitive, look for the in-house component that already exists in `apps/web/src/`. Recreate the prototype's look (see `05-design-reference.md` and `docs/design_handoff_atena/screenshots/`), not its code.
- **Contract first.** Before coding an endpoint, open `@atena/types` + `docs/openapi.yaml` and implement it to match that shape exactly (snake_case at the API; Prisma Client is camelCase internally, so map at the edge — see `.context/docs/code-style.md`).
- **Respect the 5 principles in every feature:** the AI is an interpreter (the LLM does not touch the database/S3); the LLM does not fabricate data (no tool → refusal); ack/resolve are not tools; everything audited; PII masked by default.
- **Validation on the server, always.** The UI disables buttons, but the backend revalidates. A resolve without a valid `action_description` must fail at the endpoint.
- **Per-endpoint RBAC** (app-managed via `@Requires(perm)`). 4 roles (admin/support_lead/support_analyst/viewer); `pii:reveal`, `rules:edit` and `ops:run` are `support_lead`+, `users:manage` is `admin` only (`audit:view` is in the `viewer` base set — see `apps/api/src/auth/rbac/permissions.ts`).
- **Delivery data comes from S3 via DuckDB**, not from MySQL. The shipping tools query the detailed report (`/tmp` cache); MySQL keeps only the app state.
- **Faithful visual streaming:** "running" tool row → structured result → AI text token by token; handle `refusal` and the design's error states.
- **Auth and LLM are settled.** Auth is OIDC via Entra + JWT cookie + RBAC in the app (`@example.com` domain; full SSO/SAML+SCIM is residual debt in `.context/docs/tech-debt.md`); the LLM runs on Amazon Bedrock (Nova Pro — `us.amazon.nova-pro-v1:0` — Converse, streaming + tool use).

## Key Project Resources

- [Documentation Index](../docs/README.md) — internal knowledge base.
- [Agent Handbook](./README.md) — index of playbooks.
- [AGENTS.md](../../AGENTS.md) — conventions and context references.
- [Handoff README](../../docs/design_handoff_atena/README.md) — stack, principles and sprint order.

## Repository Starting Points

- `apps/api/src/` — NestJS backend (per-domain + cross-cutting modules).
- `apps/web/src/` — React + Vite frontend (screens + in-house components + tokens).
- `packages/types/` — `@atena/types`, shape contract.
- `docs/openapi.yaml` — current HTTP contract.
- `docs/design_handoff_atena/` — handoff (contracts + spec + decisions + screenshots) as a reference.

## Key Files

- `docs/design_handoff_atena/04-screen-to-endpoint-map.md` — starting point: screen → endpoint(s).
- `docs/design_handoff_atena/01-backend-api-contract.md` — endpoints, tool catalog (§B), shapes (§C), resolve validation (§D), observability (§E) (historical; `docs/openapi.yaml` is current).
- `apps/api/prisma/schema.prisma` — real MySQL schema (app state), enums, RBAC; `02-data-model.md` is a historical reference.
- `docs/design_handoff_atena/03-websocket-events.md` — WS events, banner, reconnection.
- `docs/design_handoff_atena/05-design-reference.md` — `--at-*` tokens and screens (visual parity).
- `packages/types/` (`@atena/types`) — shape contract (implement to match it).
- `apps/web/src/chat/`, `apps/web/src/chat/tool-cards/`, `apps/web/src/incidents/` — the real screens (the prototype's `chat.jsx`, `tool-results.jsx`, `incidents.jsx` are not in the repo).

## Key Symbols for This Agent

- `SearchResultsCard`, `TrailCard`, `RiskCard`, `ReportCard`, `RevealField` (`apps/web/src/chat/tool-cards/`) — the tool result screens (the prototype's `SearchResults`, `TrailTimeline`, `RiskCard`, `ReportCard`, `PhoneCell`, `ContentRevealBox`).
- `ToolRow`, `RefusalCard` (`apps/web/src/chat/ChatPage.tsx`) — streaming states (the prototype's `ToolCallPill`, `RefusalCard`).
- `ResolveIncidentModal` (`apps/web/src/incidents/ResolveIncidentModal.tsx`) — resolve flow with double validation (UI + server); there is no separate `AutoResolveModal` in `apps/web`.
- `revealPhone`/`revealContent` (`apps/web/src/chat/reveal.ts`) + `RevealField` — the masking/reveal + audit pattern (the prototype's `useMaskedPhone`, `handleReveal`).

## Documentation Touchpoints

- `docs/design_handoff_atena/README.md` — product phases (0→2) and contracts.
- `.context/docs/architecture.md` — architecture and the 5 principles.
- `.context/docs/data-flow.md` — data → tool → LLM → UI flow; SSE/WS streaming.
- `.context/docs/security.md` — PII, audit, RBAC to respect in every endpoint.
- `docs/design_handoff_atena/decisions.md` / `06-pending-decisions.md` — decisions that unblock (or block) features.

## Collaboration Checklist

1. Confirm the slice (which screen/endpoint) and where it lives in the code (`apps/api`/`apps/web`/`packages/types`).
2. Read the relevant contract (`04` for mapping, `@atena/types`/`docs/openapi.yaml`/`01` for shape/validation, `schema.prisma` for models/enums, `03` for WS) and the existing code.
3. Implement respecting the 5 principles; apply RBAC (`@Requires`) and audit from the start, not as a retrofit.
4. For the frontend, reuse the in-house components of `apps/web/src/` and the `--at-*` tokens — do not copy the prototype.
5. Guarantee server-side validation and PII masking by default; reveal only with confirmation + audit (`pii:reveal`).
6. Check the response against `@atena/types`; run/update tests (Jest in the backend, Vitest in the frontend, Playwright for browser e2e).
7. Update the affected documentation and record pending items in the Hand-off Notes.

## Hand-off Notes

Summarize what was implemented/changed (in `apps/api`, `apps/web` or `@atena/types`) and what was left out. Confirm the 5 principles were respected (RBAC `@Requires`, audit, server-side validation, masked PII, LLM without data) and that tests cover the case. Point out where the product still diverges from the prototype (design reference) and what is missing for visual parity.
