---
type: skill
name: Api Design
description: Design RESTful APIs following best practices. Use when Designing new API endpoints, Restructuring existing APIs, or Planning API versioning strategy
skillSlug: api-design
phases: [P, R]
generated: 2026-06-10
status: filled
scaffoldVersion: "2.0.0"
---
## Workflow

> REPOSITORY STATE: the NestJS backend is implemented (`apps/api`). The current HTTP contract is `docs/openapi.yaml`, and the response shapes live in `@atena/types` (`packages/types/src/index.ts`). The handoff (`docs/design_handoff_atena/01-backend-api-contract.md`) is the historical origin of these conventions; its shapes were extracted from the prototype mocks (not included in the repo) and were written in camelCase, while the project later chose **snake_case for every API request and response** (`.context/docs/code-style.md`).

1. Identify the tool behind the endpoint. In Atena, almost every REST endpoint mirrors an LLM tool (`search_shippings` ↔ `GET /api/shippings/search`). Confirm whether what you are designing is Phase 1 (search/trail/analyze/report/list) or Phase 2 (incidents) — or an endpoint without a tool (ack/resolve/comment).
2. Model the resource in snake_case in MySQL (see `apps/api/prisma/schema.prisma`; `02-data-model.md` is historical) and expose **snake_case at the API** too. Prisma Client is camelCase internally, so map to snake_case at the edge — in the services/serializers that build the response and in the DTOs that read the input — never in the consumer. URL segments are `kebab-case`, plural nouns (e.g. `/api/delivery-reports`).
3. Choose the right HTTP method: `GET` for read tools (search, trail, list), `POST` for tools that process/aggregate (`analyze`, `reports/delivery`) and for incident state mutations (`acknowledge`, `resolve`, `comment`).
4. Define request and response matching the shape in `@atena/types` exactly (and document it in `docs/openapi.yaml`). Dates go out in ISO 8601 UTC; the UI formats the relative form ("há 12 min" ("12 min ago")). Every list uses the paginated envelope `{ rows, page, total_pages, total, latency_ms }`.
5. Standardize errors as `{ error: { code, message } }` — always, on every endpoint, with a coherent HTTP status (400 malformed input rejected by the `ValidationPipe`, 401 missing/invalid session, 403 RBAC, 404, 409 invalid state transition, 422 business-rule validation).
6. Apply the guards: OIDC session (JWT cookie `atena_session`, issued after the Microsoft Entra login) on EVERY endpoint (OIDC restricted to the `@example.com` domain; only `/health` and `/auth/*` are `@Public`); per-endpoint permission guard via `@Requires(perm)` (4 roles — admin/support_lead/support_analyst/viewer — mapped to permissions in `apps/api/src/auth/rbac/permissions.ts`); audit on the sensitive actions (`tool_call`, `reveal_phone`, `reveal_content`, `export_report`, `incident_*`, `rule_update`), via `@Audit(action, severity)` on the handler or written by the service for incident/rule changes.
7. For incident mutations, do the double server-side validation (§D of the contract) — never trust the UI.
8. For the chat, design the SSE stream; for real-time incidents, the WS events (`03-websocket-events.md`).

## Examples

**Read endpoint mirroring a tool (`search_shippings`):**
```
GET /api/shippings/search?phone=...&status=failed&provider=ProviderA&customer_id=...&date_range=24h&page=1&limit=20
Cookie: atena_session=<jwt>

200 OK
{
  "rows": [
    {
      "id": "4f3a2b1c-1111",
      "campaign_id": "c-9001",
      "phone_masked": "+55 11 9****-1234",
      "status": "failed",
      "provider": "ProviderA",
      "customer": "Customer 1001",
      "channel": "sms",
      "app_id": null,
      "requested_at": "2026-05-28T14:02:18Z",
      "finalized_at": "2026-05-28T14:02:21Z",
      "error_hint": "insufficient_credits"
    }
  ],
  "page": 1, "total_pages": 4, "total": 73, "latency_ms": 42
}
```
`phone_full` and the SMS content do NOT come by default — only after an authorized reveal (`POST /api/shippings/{id}/reveal-phone` / `reveal-content`, permission `pii:reveal`), which writes an audit entry (`reveal_phone`/`reveal_content`).

**State mutation with server-side validation (`POST /api/incidents/{id}/resolve` — §D):**
```
POST /api/incidents/INC-2401/resolve
{
  "action_category": "provider_escalated",
  "action_description": "Contacted the provider through the commercial channel and opened a priority ticket.",
  "escalated_to": "ProviderA Support — ticket #91234",
  "related_shipping_ids": ["4f3a2b1c-1111"],
  "tags": ["provider-a"]
}
```
Validate in the backend (do not trust the UI):
- `action_category` ∈ { provider_recovered, provider_escalated, internal_escalated, false_positive, customer_communicated, monitoring_only, other }
- `action_description` ≥ 20 chars (≥ 10 in the `auto_resolved` flow)
- if `action_category ∈ { provider_escalated, internal_escalated }` → `escalated_to` required
- only transitions from `detected | acknowledged | auto_resolved` → `resolved`
- writes `incident_activity` (status_change) + `audit_log` (incident_resolve)

**Validation error:**
```
422 Unprocessable Entity
{ "error": { "code": "validation_error", "message": "escalated_to é obrigatório quando a categoria é de escalonamento" } }
```
(The message is the product's Portuguese text: "escalated_to is required when the category is an escalation".)

**Chat stream (`POST /api/chat/sessions/{id}/messages`):**
```
event: tool_call    data: { "name": "search_shippings", "args": {...}, "status": "running" }
event: tool_result  data: { "name": "search_shippings", "status": "success", "result": {...} }
event: text_delta   data: { "delta": "Encontrei 6 envios…" }
event: done         data: { "message_id": "...", "refusal": null, "session_title": "..." }
```
(`text_delta` carries the assistant's Portuguese answer, here "I found 6 shippings…"; the stream may also carry `thinking_delta` and `tool_progress`.)
Out of scope, instead of `tool_call`:
```
event: refusal  data: { "reason": "fora_do_escopo", "explanation": "...", "can_do": [...] }
```

## Quality Bar

- snake_case at the API (every request and response), snake_case in the DB — always. Prisma Client's camelCase stays internal; the mapping lives at the edge (services/serializers and DTOs) and does not leak to the client.
- Dates in ISO 8601 UTC in the response; never send a relative string from the backend.
- Lists ALWAYS in the envelope `{ rows, page, total_pages, total, latency_ms }`. Do not invent `{ data, meta }`.
- Errors ALWAYS `{ error: { code, message } }`. `code` is stable and in lowercase snake_case (e.g. `validation_error`, `invalid_state_transition`, `not_found`); `message` is Brazilian Portuguese for the human.
- OIDC session (JWT cookie) required on every endpoint (OIDC restricted to the `@example.com` domain); without a valid session → 401 (the web client sends the user back to the login).
- Per-endpoint RBAC via the NestJS permission guard (`@Requires(perm)`): editing rules is `rules:edit` (`support_lead`+), revealing PII and PII exports are `pii:reveal` (`support_lead`+), user management is `users:manage` (admin); reports (`reports:view`) and the audit log (`audit:view`) are readable by every role.
- Every Phase 1/2 tool has a mirrored endpoint; `acknowledge`/`resolve`/`comment` are NOT tools — only REST + UI.
- PII masked by default; `phone_full`/content only with reveal + audit.
- Incident mutation validation is double and server-side; the UI validates only for UX, the backend is the authority.
- The LLM does not fabricate data: if there is no tool/data, the stream emits `refusal`, not made-up text.

## Resource Strategy

- Keep the canonical contract in `docs/openapi.yaml` and the shapes in `@atena/types` (`docs/design_handoff_atena/01-backend-api-contract.md` is the historical reference); this SKILL points there, it does not duplicate.
- Add `references/` here only if a catalog of error codes or enums grows too large for the contract.
- A `scripts/` candidate now that the backend exists: a type/contract checker that keeps `docs/openapi.yaml` aligned with `@atena/types`.
- Do not duplicate shapes — they live in `@atena/types` (`packages/types/src/index.ts`); cite the file.
