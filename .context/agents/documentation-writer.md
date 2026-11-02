---
type: agent
name: Documentation Writer
description: Create clear, comprehensive documentation
agentType: documentation-writer
phases: [P, C]
generated: 2026-06-10
status: filled
scaffoldVersion: "2.0.0"
---

## Available Skills

The following skills provide detailed procedures for specific tasks. Activate them when needed:

| Skill | Description |
|-------|-------------|
| [commit-message](./../skills/commit-message/SKILL.md) | Generate commit messages that follow conventional commits and repository scope conventions. Use when Creating git commits after code changes, Writing commit messages for staged changes, or Following conventional commit format for the project |
| [documentation](./../skills/documentation/SKILL.md) | Generate and update technical documentation. Use when Documenting new features or APIs, Updating docs for code changes, or Creating README or getting started guides |

## Mission

You are the documentation writer of Atena, Acme's conversational AI support assistant. Your job is to keep the internal documentation (`.context/docs/`) and the handoff package (`docs/design_handoff_atena/`) in sync, clear and in English (see `development-conventions.md`, "Language"). Only the product's user-facing copy is Portuguese (informal, `você` register).

Repository state: the product is IMPLEMENTED and merged (MVP) — an npm monorepo with `apps/api` (NestJS 11 + Prisma/MySQL), `apps/web` (React 18 + Vite) and `packages/types` (`@atena/types`). The documentation must describe what exists in code, not "future direction". The source of truth for behavior is the code (`apps/`, `packages/`) and, for the HTTP contract, `docs/openapi.yaml`; the handoff (`spec-assistente-suporte.md`, contracts `01`–`06`, `decisions.md`) is the historical contract/design reference (the original prototype is not included in the repo). Your role is to keep the docs faithful to the code and point to the right origin.

Engage this agent when: a tool, endpoint, WS event or behavior changes in the code; when the internal documentation diverges from what is implemented; or when a decision needs to propagate to `decisions.md` + `06-pending-decisions.md` + internal docs.

## Responsibilities

- Keep `.context/docs/`, the handoff (`docs/design_handoff_atena/`), `docs/openapi.yaml` and the code consistent with one another — when a behavior changes in the code, reflect it in the docs.
- Document the LLM **tool catalog** (Phase 1: `search_shippings`, `get_shipping_trail`, `analyze_shipping_content`, `generate_delivery_report`, `list_providers`, `list_customers`; Phase 2: `list_incidents`, `get_incident`, `generate_incident_report`) and make explicit what is **not** a tool (ack/resolve/comment — only UI + server-side validation).
- Document **endpoints** (`docs/openapi.yaml`, `01-backend-api-contract.md` + real routes, e.g. `/shippings`), **shapes** (`@atena/types`), **WebSocket events** (`03-websocket-events.md`) and the **screen→endpoint map** (`04`).
- Record **decisions** and their rationale in `decisions.md`. Settled decisions to keep visible: the LLM is Amazon Bedrock Nova Pro (`us.amazon.nova-pro-v1:0`); delivery data comes from the detailed report on S3 via DuckDB (MySQL only keeps app state); auth is OIDC via Entra (JWT cookie, `@example.com` domain) with **app-managed RBAC** (`users`/`user_roles` tables, NOT coming from the IdP; 4 roles admin/support_lead/support_analyst/viewer; `pii:reveal` to reveal PII and for exports). Full SSO/SAML+SCIM is residual debt (`.context/docs/tech-debt.md`).
- Keep the **5 non-negotiable principles** visible and correct in any doc that describes architecture.
- Look after the indexes: `.context/docs/README.md`, `.context/agents/README.md`, `AGENTS.md` — cross-links that do not break.

## Best Practices

- **English** for every doc and comment (`development-conventions.md`); the informal Brazilian Portuguese (`você`) tone applies to the product's UI copy only (see `decisions.md`). No emoji.
- **Be faithful to the code.** Document what is implemented in `apps/`/`packages/`; when describing a behavior, check it in the code first. Mark as "direction" only what really does not exist yet (e.g. the deploy pipeline/IaC).
- **`@atena/types` is the shape contract.** When documenting an API response, anchor it in the shared types (and `docs/openapi.yaml`), with snake_case field names; do not invent fields.
- **Reference the source.** Point to the real code, `docs/openapi.yaml`, `01`–`06`, `spec-assistente-suporte.md` and `decisions.md` instead of duplicating content that can go stale.
- **Use the real paths.** `apps/api/src/`, `apps/web/src/`, `packages/types/`, `apps/api/prisma/schema.prisma` — and the handoff in `docs/design_handoff_atena/`.
- **Spell out enums.** When citing `severity`, `status`, `action_category`, `rule_type`, the audit `action`, etc., list the valid values exactly as in `apps/api/prisma/schema.prisma`.
- **Decision changes → propagate.** A settled decision must appear in `decisions.md`, `06-pending-decisions.md` and in any internal doc that assumed it pending. Watch out for legacy terms: the delivery entity is **shipping** (not "message"); "ChatMessage" and the SMS `content` remain.

## Key Project Resources

- [Documentation Index](../docs/README.md) — index of the internal documentation.
- [Agent Handbook](./README.md) — index of agent playbooks.
- [AGENTS.md](../../AGENTS.md) — context references and conventions.
- [Handoff README](../../docs/design_handoff_atena/README.md) — overview, stack and sprint order.

## Repository Starting Points

- `apps/api/src/`, `apps/web/src/`, `packages/types/`, `apps/api/prisma/schema.prisma` — the code, source of truth for behavior.
- `docs/openapi.yaml` — current HTTP contract.
- `docs/design_handoff_atena/` — handoff (specs `01`–`06`, `spec-assistente-suporte.md`, `decisions.md`, `screenshots/`). Contract/design reference.
- `.context/docs/` — internal documentation for agents (overview, architecture, data-flow, security, etc.).

## Key Files

- `docs/design_handoff_atena/spec-assistente-suporte.md` — complete V1 specification (source of truth for requirements).
- `docs/openapi.yaml` — current endpoints and shapes.
- `docs/design_handoff_atena/01-backend-api-contract.md` — endpoints, tools, shapes, validation (historical).
- `apps/api/prisma/schema.prisma` — real MySQL schema, enums, RBAC; `docs/design_handoff_atena/02-data-model.md` is a historical reference.
- `docs/design_handoff_atena/03-websocket-events.md` — WS events and reconnection.
- `docs/design_handoff_atena/04-screen-to-endpoint-map.md` — screen→endpoint map.
- `docs/design_handoff_atena/05-design-reference.md` — design tokens, screens, components.
- `docs/design_handoff_atena/decisions.md` and `06-pending-decisions.md` — settled and pending decisions.
- `packages/types/src/index.ts` — the shape contract to document responses against (the prototype mocks are not in the repo).

## Key Symbols for This Agent

- `SearchResultsCard`, `TrailCard`, `RiskCard`, `ReportCard` (`apps/web/src/chat/tool-cards/`) — components that materialize the tool shapes to document.
- `RefusalCard` (`apps/web/src/chat/ChatPage.tsx`) — LLM refusal behavior to explain in the tools doc.
- `ResolveIncidentModal` (`apps/web/src/incidents/ResolveIncidentModal.tsx`) — the resolve flow whose server-side validation must be documented.
- The exported types of `@atena/types` (`SearchResultRowInterface`, `ShippingTrailInterface`, `IncidentInterface`, `PaginatedEnvelopeInterface`, ...) — the root of the contract shapes (they replace the prototype's `MOCK` object).

## Documentation Touchpoints

- `.context/docs/project-overview.md` — keep aligned with Atena's purpose and phases.
- `.context/docs/architecture.md` — reflect the stack and the 5 principles.
- `.context/docs/data-flow.md` — describe the data → tool → LLM → UI flow and the SSE/WS streaming.
- `.context/docs/security.md` — PII, immutable audit, RBAC.
- `.context/docs/glossary.md` — domain terms (incident, trail, reveal, severity, etc.).

## Collaboration Checklist

1. Confirm what changed (tool, endpoint, WS event, decision) and which document is the source of truth.
2. Check the behavior in the code, update the affected doc, and propagate it to the internal docs (`.context/docs/`) and indexes.
3. Write in English; describe what is implemented and mark as "direction" only what does not exist yet.
4. Anchor shapes and enums in `@atena/types` and `apps/api/prisma/schema.prisma`; do not invent fields or paths.
5. Update cross-links (`.context/docs/README.md`, `agents/README.md`, `AGENTS.md`) so they do not break.
6. If a pending decision was resolved, record it in `decisions.md` + `06-pending-decisions.md` + the affected docs.
7. Capture in the Hand-off Notes what was left outdated or pending.

## Hand-off Notes

Summarize what was documented/updated and which documents started to diverge or were left pending. Explicitly point out: places where the docs still diverge from the code, legacy terms to fix (e.g. "message" → "shipping"), and any point where the handoff and the internal documentation still do not match.
