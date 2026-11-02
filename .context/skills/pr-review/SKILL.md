---
type: skill
name: Pr Review
description: Review pull requests against team standards and best practices. Use when Reviewing a pull request before merge, Providing feedback on proposed changes, or Validating PR meets project standards
skillSlug: pr-review
phases: [R, V]
generated: 2026-06-10
status: filled
scaffoldVersion: "2.0.0"
---
## Workflow

PR review in Atena (NestJS/Prisma backend + React frontend with in-house components on the `--at-*` tokens). The 5 non-negotiable principles of `docs/design_handoff_atena/README.md` §5 are the backbone of the review. Feedback in English, like everything in the repository (`development-conventions.md`, "Language"). The quality gate must be green and the Verification section must state results.

1. **Understand the PR's goal** and place it in the sprint (Foundation / Phase 1 self-service / Phase 2 proactive).
2. **Run the 5-principle checklist** over the diff (see the Quality Bar). Any violation = request changes, not a suggestion.
3. **Backend (NestJS/Prisma):**
   - The LLM never touches the database — the app runs query/RBAC/data (principle 1). Check that tools only build input and execution is server-side.
   - A new/changed tool writes audit `tool_call`; reveal writes `reveal_phone`/`reveal_content` (principles 4/5).
   - `acknowledge`/`resolve`/`comment` are REST endpoints with a guard + server-side validation, NEVER exposed as an LLM tool (principle 3).
   - Resolve revalidates everything server-side (§D): `action_category` ∈ enum; `action_description` ≥ 20 chars (≥ 10 on `auto_resolved`); `escalated_to` required if category ∈ {provider_escalated, internal_escalated}; only the transition detected|acknowledged|auto_resolved → resolved; writes `incident_activity` (status_change) + audit.
   - Per-endpoint permission guard (`@Requires(perm)`, map in `apps/api/src/auth/rbac/permissions.ts`): `viewer` reads (search/trail/reports/incidents/rules/audit/observability), `support_analyst` adds incident ack/resolve/comment, `support_lead` adds `pii:reveal`, `rules:edit` and `ops:run`, `admin` adds `users:manage`. An endpoint without a guard = blocker.
   - Prisma: snake_case in the DB and snake_case at the API — Prisma Client's camelCase is mapped at the edge (services/serializers and DTOs). A migration must not break the immutability of `audit_log` (INSERT+SELECT only).
4. **Frontend (React, in-house components):**
   - Uses the in-house components of `apps/web/src/` (dialogs, tables, badges, tabs, switches) on the `--at-*` tokens — does not hand-reimplement primitives that already exist, does not copy prototype JSX (there is no external `atena-design-system` package).
   - PII masked by default (`phone_masked`, content hidden); reveal requires confirmation and triggers an audit entry (principle 5).
   - The UI disables an invalid field BUT is not the source of truth — the real validation is server-side (double validation).
   - The design's error states: inline tool error + "tentar de novo" ("try again"), WS disconnected strip, expired session (401 → back to the OIDC login).
5. **Shapes match the contract:** every response/payload agrees with `@atena/types` and `docs/openapi.yaml` (e.g. `SearchResultsCard` consumes `SearchResultRowInterface`, §C.1).
6. **Secrets:** no `.env`/`.pem`/`.key`/`*secret*` in the diff (blocked by `.context/harness/policy.json`); raw SMS content only on S3 (the detailed report, read via DuckDB), never in a MySQL text column nor in a log; logs carry IDs/`phone_hash`, never the phone.
7. **Commits:** Conventional Commits (`AGENTS.md`, `.context/docs/code-style.md`).
8. **Verdict:** approve, request changes or comment, separating required from suggested.

## Examples

**Request changes (principle violation):**
```
Good direction, but there are blockers before merge:

1. [PRINCIPLE 3] incidents.service.ts:88 — `resolve_incident` was registered as an LLM
   tool. Ack/resolve are NOT tools: they have to be POST /api/incidents/{id}/resolve with
   server-side validation (§D). Remove it from the tool catalog.
2. [PRINCIPLE 5] RevealField renders `phone_full` straight from the payload. The phone is
   masked by default; it is only revealed with permission + confirmation, and the reveal
   writes audit 'reveal_phone' (RNF-1.4). Today nothing is written to the audit log.
3. [VALIDATION §D] the resolve endpoint trusts the button's `disabled`. Revalidate
   server-side: action_description ≥ 20 chars and escalated_to required for provider_escalated.

Suggestion (non-blocking): extract the camelCase→snake_case mapping into a serializer.
```

**Approve:**
```
Approved. search_shippings runs 100% server-side (the LLM only builds the input), the shape
matches SearchResultRowInterface (§C.1), the endpoint has its @Requires guard, audit
'tool_call' is written, and the UI reuses the in-house table component. PII masked by default.
```

## Quality Bar

- **5-principle checklist on every relevant PR:** (1) the app runs query/RBAC/data, the LLM never touches the database; (2) structured data only comes from a tool, otherwise explicit refusal (`RefusalCard`); (3) ack/resolve/comment via UI + server-side validation, never as a tool; (4) tool call / reveal / incident change writes the immutable audit log; (5) PII masked by default, reveal generates audit.
- Double validation: the UI disabling is not enough — the backend ALWAYS revalidates. Resolve covers all of §D (enum, ≥20/≥10 chars, escalated_to, valid transitions, incident_activity + audit).
- Shapes match `@atena/types` / `docs/openapi.yaml` — a field or naming divergence (snake_case at the API) is request changes.
- No secret in the diff; SMS content only on S3; IDs/`phone_hash` in logs; no PII in logs.
- The frontend reuses the in-house components (does not reimplement them, does not paste prototype JSX); the design's error states covered; strings in informal PT-BR.
- `audit_log` stays append-only (no UPDATE/DELETE); migrations do not loosen that.
- Conventional Commits. Feedback separates blockers from suggestions and points to file:line.

## Resource Strategy

- No `scripts/`/`references/`/`assets/` of its own: the checklist fits in `SKILL.md` and the contracts live in `@atena/types`, `docs/openapi.yaml` and `docs/design_handoff_atena/`.
- For shapes, reference the types of `@atena/types` (origin: §C of `01-backend-api-contract.md`) by name — do not duplicate JSON here.
- For the resolve validation rules, point to §D of the contract and to `apps/api/prisma/schema.prisma` (historically §5.3 of `02-data-model.md`) instead of re-copying the enum.
