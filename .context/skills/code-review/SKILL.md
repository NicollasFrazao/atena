---
type: skill
name: Code Review
description: Review code quality, patterns, and best practices. Use when Reviewing code changes for quality, Checking adherence to coding standards, or Identifying potential bugs or issues
skillSlug: code-review
phases: [R, V]
generated: 2026-06-10
status: filled
scaffoldVersion: "2.0.0"
---
## Workflow

> REPOSITORY STATE: production code exists — `apps/api` (NestJS 11 + Prisma/MySQL), `apps/web` (React 18 + Vite) and `packages/types` (`@atena/types`). This checklist is what reviews of that code apply. The original design prototype (`prototype/*.jsx`) was a design reference, is NOT included in the repo, and must never be copied as production code.

1. Understand what the change touches: chat/stream, tool/endpoint, incident, rule, audit, WS, or UI. Each area has its own invariants (below).
2. Check the 5 non-negotiable principles first — they are blocking:
   - The AI is an interpreter: the app runs query/RBAC/data; the LLM never touches the database.
   - The LLM does not fabricate data: every number/fact comes from a tool_result; otherwise, explicit refusal.
   - Incident state is not a tool: ack/resolve/comment only via UI + server-side validation.
   - Everything audited: sensitive actions write `audit_log` via the global interceptor (`@Audit`) or, for incident/rule changes, from the service.
   - PII masked by default: phone/content reveal generates an audit entry.
3. Check per-endpoint RBAC: `@Requires(perm)` guard applied, with the right permission from `apps/api/src/auth/rbac/permissions.ts` (e.g. `rules:edit` and `pii:reveal` for `support_lead`+, `users:manage` for admin; `reports:view` and `audit:view` are in the `viewer` base set).
4. Check the API contract: snake_case in every request/response (Prisma Client's camelCase mapped at the edge), snake_case in the DB, ISO 8601 UTC, envelope `{ rows, page, total_pages, total, latency_ms }`, error `{ error: { code, message } }`. Also check the code style (`.context/docs/code-style.md`) and that `npm run lint` passes.
5. Check shapes against `@atena/types` (and `docs/openapi.yaml`) — frontend and backend must match the shared types that became the contract.
6. Frontend: reuses the in-house components of `apps/web/src/` with the `--at-*` tokens (there is no external `atena-design-system` package; do not recreate Button/Badge/Card); Phosphor icons; Plankton + semantic colors (Thanos out of v1); informal PT-BR (`você`) in the user-facing copy.
7. Incident mutation validation: confirm the backend revalidates (does not trust the UI) — category within the enum, `action_description` ≥ 20 chars, `escalated_to` if `*_escalated`, allowed status transition.
8. Point out the most impactful findings first; explain why by citing the principle or the handoff/context doc; praise correct patterns.

## Examples

**Blocking finding — PII leaking without reveal/audit:**
```ts
// PROBLEM (violates Principle 5 + 4):
return rows.map((record) => ({ id: record.id, phone_full: record.phoneE164, status: record.finalStatus }));

// FIX: mask by default; phone_full only under an authorized reveal, writing an audit entry.
return rows.map((record) => ({
  id: record.id,
  phone_masked: maskPhone(record.phoneE164),
  status: record.finalStatus,
}));
// reveal → dedicated endpoint (POST /api/shippings/:id/reveal-phone) with
// @Requires('pii:reveal') + @Audit('reveal_phone', 'pii')
```

**Blocking finding — ack/resolve exposed as a tool:**
```ts
// PROBLEM (violates Principle 3): resolving an incident cannot be an LLM tool.
export const TOOL_NAMES = [
  // ...
  'resolve_incident',
] as const;

// FIX: remove it from the tool catalog. Resolve only through REST + UI:
// POST /api/incidents/{id}/resolve with server-side validation (§D of the contract).
```

**Finding — API contract out of the standard:**
```ts
// PROBLEM: wrong envelope and camelCase leaking.
return { data: rows, meta: { page, totalPages } };   // wrong

// FIX:
return {
  rows,
  page,
  total_pages: totalPages,
  total,
  latency_ms: latencyMs,
};   // right: canonical envelope, snake_case
```

**Praise + light note — the frontend reuses the in-house components:**
```tsx
// GOOD: uses the in-house StatusPill/SeverityBadge instead of recreating them.
<SeverityBadge severity="critical" />   // just confirm informal PT-BR in the microcopy
```

## Quality Bar

- The 5 principles are blocking; any violation stops the approval.
- PII masked by default; reveal always generates an audit entry (`reveal_phone`/`reveal_content`, severity `pii`).
- Every sensitive action writes `audit_log` (`tool_call`, `incident_*`, `export_report`, `rule_update`, `session_start`, `user_role_update`, `user_status_update`).
- Incident state is never a tool; ack/resolve/comment only through REST + UI with double server-side validation.
- The LLM never touches the database; the app runs query/RBAC. No number in the AI's answer without a `tool_result`.
- Per-endpoint RBAC via `@Requires(perm)`; check the right permission (and therefore role) per `permissions.ts`.
- Contract: snake_case API (mapped at the edge from Prisma Client's camelCase) / snake_case DB, ISO 8601 UTC, paginated envelope, `{ error: { code, message } }`.
- Shapes match `@atena/types` / `docs/openapi.yaml`; divergence is a contract defect.
- Frontend uses the in-house components on the `--at-*` tokens and Phosphor; do not recreate components; Plankton + semantic palette; informal PT-BR in the UI copy.
- `policy.json` blocks `.env`/`.pem`/`.key`/`*secret*` — no secret in the diff.

## Resource Strategy

- The canonical security/PII checklist lives in `.context/docs/security.md` and in the `security-audit` skill; cite them instead of duplicating.
- Add `references/` only if a per-area checklist (chat, incidents, ws) grows too large to fit here.
- Lint already exists (ESLint flat config in `apps/api/eslint.config.mjs`, with local rules such as `local/one-per-line`); a PII guard rule would be a candidate for `scripts/`/lint.
- Review the real code; the original prototype was only a design reference.
