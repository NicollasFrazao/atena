---
type: doc
name: security
description: Security policies, authentication, secrets management, and compliance requirements
category: security
generated: 2026-06-10
status: filled
scaffoldVersion: "2.0.0"
---

# Security & Compliance Notes

> Repository state: **MVP implemented**. The controls below reflect the **current code** (`apps/api/src`), with historical design references in the handoff ([`README.md` §5 (principles)](../../docs/design_handoff_atena/README.md), [`01`](../../docs/design_handoff_atena/01-backend-api-contract.md), [`02`](../../docs/design_handoff_atena/02-data-model.md)). Note: the API serializes in `snake_case` at the edge (a revision of the handoff).

Atena gives support teams access to SMS sending data — which includes **PII** (phone number and message content) and customer data. That is why security is not a separable module: it is built into the 5 non-negotiable architecture principles. The core controls are:

1. **PII masked by default**, revealed only through an explicit, audited action.
2. **Immutable audit log (1 year)** for every sensitive action.
3. **RBAC** with four roles, enforced by a guard on every endpoint.
4. **Double validation** (the UI disables + the backend revalidates) for state changes.
5. **The AI is an interpreter, not an executor**: the LLM never touches the database and never fabricates data.

## Authentication & Authorization

**Authentication (OIDC + JWT cookie session).** Auth is **Microsoft Entra OIDC** (state/nonce/PKCE), behind `IdentityProviderInterface` (IdP-swappable), **restricted to the `@example.com` domain**, with no password of its own. Exchanging the `code` for a token creates a **stateless JWT cookie session** (`atena_session`, `SameSite=None; Secure; HttpOnly`, TTL 8h); the same cookie authenticates the REST endpoints and the socket.io handshake of `/ws/support`. Endpoints: `/api/auth/login|callback|me|logout`. In dev, `AUTH_DEV_BYPASS` resolves a stub user — **fail-closed**: only effective with `=true` **and** `NODE_ENV != production`. **Full corporate SSO (SAML + SCIM) is residual debt** (see [`tech-debt.md`](./tech-debt.md)).

**Expired session.** A rejected/expired cookie returns **401 Unauthorized**; the frontend reacts with a blocking overlay that offers re-login. The ongoing conversation is preserved in the History (`chat_sessions`/`chat_messages`), so the 401 does not discard work. No central revocation of the cookie before the 8h `exp` (residual debt); **role** revocation is immediate (short cache + database lookup).

**Authorization (app-managed RBAC).** Roles in the database (`users`/`user_roles`), **assigned by an admin — they do NOT come from the IdP**. Catalog: `admin`, `support_lead`, `support_analyst`, `viewer`. A **roles→permissions** model (map in code `auth/rbac/permissions.ts`); guard **`@Requires(perm)`** (AND of the permissions) running before the tool/handler. Roles read from the database per request (~30s cache). Access gate: no role → `access_pending`; `disabled` → `access_disabled`. Admin bootstrap via `AUTH_ADMIN_EMAILS`. Key permissions: `pii:reveal` (reveal phone/content **and** the CSV exports with PII), `incidents:ack`/`resolve`/`comment`, `rules:edit`, `users:manage`.

Permission is the application's responsibility, never the LLM's (principle 1): someone who asks for a restricted action in natural language does not bypass RBAC — the tool is executed by the application under the endpoint's guard, which denies it without the permission.

## Secrets & Sensitive Data

**PII masked by default (principle 5 / RNF-1.4).** The two PII fields — phone and SMS content — arrive **masked** in every tool response. The clear-text value only appears after an explicit *reveal* by the user, which **creates an audit log entry**:

- **Phone** — the response carries a masked `phone`; the clear-text phone is only returned by `POST /shippings/:id/reveal-phone` when the user has the `pii:reveal` permission → audit action `reveal_phone`.
- **SMS content** — `content_preview` only comes **after** a reveal (`POST /shippings/:id/reveal-content`); masked by default. The front end requires a **confirmation** step before revealing, with an explicit warning that the action is audited → audit action `reveal_content`. Read via the transient (read-through) cache of the raw data: it is read first from **`/tmp`**; if the content is not there, it is **fetched from S3** (via `content_ref`) on demand **with access logging**, populating `/tmp`.

**Separation of app data (MySQL) vs `/tmp` vs S3.** **DELIVERY data does not live in MySQL** — it comes from the **detailed report in S3** (`s3://example-sms-delivery-reports`), queried by DuckDB. MySQL stores only application data (chat, incidents, rules, audit log, users/roles). Sensitive content/PII lives in **S3**; reads use a transient (read-through) cache: first `/tmp`, and if it is not there, it is fetched from S3 (via `content_ref`), populating `/tmp` — to avoid many requests to S3 in a short period and to keep raw data out of the database. `/tmp` is an ephemeral/rebuildable cache; the durable raw content lives in S3 (secure default).

**No phone PII in logs.** In the audit grain the phone is normalized to digits only and used to compose the id (`md5(campaign_id||'|'||phone)`); the code rule is **never log PII** — logs use IDs/`phone_hash`, and only `method + path` (no query string). See [code-style.md](./code-style.md).

**Immutable audit log (RNF-1.5).** The `audit_log` table is **append-only**. The application role receives **only INSERT + SELECT** — no UPDATE/DELETE at the database level. It is filled by a **global NestJS interceptor** (`@Audit`, principle 4), not by ad-hoc calls. The `action` enum includes: `tool_call`, `reveal_phone`, `reveal_content`, `incident_created`, `incident_ack`, `incident_resolve`, `session_start`, `export_report`, `rule_update`, `user_role_update`, `user_status_update`; `severity` ∈ `info | warning | pii | config`. Each entry records `user_id` (or `system` for the detector), `resource`, `ip_address` and `metadata`.

**Secrets in the repo (harness policy).** [`.context/harness/policy.json`](../harness/policy.json) has `defaultEffect: allow` but a `deny` rule (`block-secrets`) that blocks any path `**/.env*`, `**/*.pem`, `**/*.key`, `**/*secret*`. In production, secrets (client secret / OIDC credentials of the institutional social login, Amazon Bedrock credentials, S3/MySQL credentials) must come from a vault / secret manager — never committed. The `.gitignore` should reinforce the same. Currently no real `.env` exists in the repo.

## Compliance & Policies

- **RNF-1.4 — PII masked by default + audited reveal** (phone and content; confirmation before revealing content; `pii:reveal` permission).
- **RNF-1.5 — Immutable audit log** (append-only, INSERT+SELECT role, global `@Audit` interceptor).
- **RNF-1.6 — App-managed RBAC** (roles `admin`/`support_lead`/`support_analyst`/`viewer` in the database, `@Requires(perm)` guard per endpoint).
- **Principle 2 — The LLM does not fabricate data.** All structured data (phone, ID, status, number) comes from the return value of a deterministic tool run by the application. A request with no applicable tool → **explicit refusal** (`RefusalCard`), never an invented value. The catalog's read-only tools are `search_shippings`, `get_shipping_trail`, `analyze_shipping_content`, `generate_delivery_report`, `list_providers`, `list_customers`, `list_incidents`, `get_incident`, `generate_incident_report`.
- **Principle 3 — Incident state changes are not an LLM tool.** `acknowledge`/`resolve`/`comment` only via UI + server-side validation; the LLM can neither trigger nor influence these transitions.
- **Retention** — chat (sessions/messages): configurable daily job (`CHAT_RETENTION_DAYS`, default 90). Delivery data comes from the detailed report in S3 (there is no local purge). Audit log: append-only.

## Incident Response

Here "incident" has two meanings — do not mix them up:

**1. Product incidents (shipping anomalies).** The anomaly detector creates `incidents` and pushes them via **socket.io** (`incident.created/updated/auto_resolved`). The lifecycle (`detected → acknowledged → resolved | auto_resolved`) is controlled **only by the UI**, with **double validation** (RF-2.4):

- The UI disables buttons/fields according to the state, **and** the backend **revalidates** every `POST /api/incidents/:id/resolve`. Server-side rules: `action_category` mandatory; `action_description` ≥ 20 chars (≥ 10 in the `auto_resolved` flow); if `action_category` ∈ {`internal_escalated`, `provider_escalated`} → `escalated_to` mandatory; only allows the transition from `acknowledged`/`detected`/`auto_resolved` → `resolved`. Every change writes to `incident_activity` (`status_change`) **+** the audit log (`incident_ack` / `incident_resolve`). Client-side validation is only UX — the source of truth is the backend.

**2. Security incident response (operational).** There is no formalized runbook nor contact list — a gap to fill according to the team/infra. The **audit log** is the main forensic source (who revealed which PII, when, from which IP, and which tools ran), and observability (`GET /api/observability`, optional Datadog) covers the behavior of the assistant itself (usage/latency per tool, errors, refusals).

See also [`architecture.md`](./architecture.md) for how these controls fit into the orchestrator → tools → data flow.

## Phase 1 — verification (Sprint 1, V phase)

Validation checklist for the Phase 1 backend (code + automated tests, no infra):

- **PII masked by default.** `ShippingsService.search`/`getTrail` return `phone_masked` and omit `content_preview`; a test guarantees that the middle digits of the phone do not leak (`shippings.service.spec`).
- **Reveal only on demand and audited.** `POST /shippings/:id/reveal-phone` and `/reveal-content` expose the full data only in the response (never in log/audit), with `@Audit('reveal_phone'|'reveal_content','pii')`; unavailable content → 422 (`reveal.service.spec`).
- **The LLM does not fabricate data.** The orchestrator only routes tools from the catalog; no applicable tool → `refusal` event (`orchestrator.service.spec`). Structured data always comes from the return value of a deterministic tool.
- **Everything audited.** Tool endpoints with `@Audit('tool_call')` (global interceptor) and every tool run by the orchestrator writes `tool_call` via `AuditService`. Append-only audit log.
- **RBAC enforced.** Global `AuthGuard` + permissions guard (`APP_GUARD`); endpoints require `@Requires(perm)`; `/health` and `/auth/*` are `@Public`. **Real OIDC login enabled and validated** (state/nonce/PKCE + JWT cookie session); in dev, `auth.devBypass` resolves a stub `admin` user (fail-closed: `=true` AND `NODE_ENV != production`). Tests cover 401/403 denial.
- **Input validation.** `class-validator` DTOs + global `ValidationPipe` (`whitelist`+`transform`); errors in the shape `{ error: { code, message } }` via `AllExceptionsFilter`.
- **Observability.** Global `MetricsInterceptor` logs latency/error per request (no PII); the orchestrator logs latency per tool and records `latency_ms` in the audit metadata. Metrics via DogStatsD/Datadog (optional).
- **HTTP e2e.** Full pipeline (prefix/pipe/guards/interceptors/SSE/filter): `http.e2e.spec` (mocked Prisma, runs in `make test`) **and** `db.e2e-spec` — **integration against real MySQL** via `make test-e2e` (starts the database, migrates, seeds; validates search/trail/providers/reveal+audit/report/chat-SSE over the seed).

**Notes:**
- End-to-end content reveal depends on S3 credentials/bucket (unavailable content → 422).

## Phase 2 — verification (Sprint 2, V phase)

Validation checklist for Phase 2 (incidents + detection + real time + tools/report + observability):

- **Principle 3 — state change is not an LLM tool.** The lifecycle (`acknowledge`/`resolve`/`comment`) lives **only** in `IncidentLifecycleController` (REST), separate from the read side; the orchestrator has NO ack/resolve/comment case in `execute()` — the only incident tools exposed to the LLM are read-only (`list_incidents`/`get_incident`/`generate_incident_report`). Verified by the tests (lifecycle service + e2e) and by inspecting the orchestrator's `switch`.
- **Server-side double validation (§D).** `IncidentLifecycleService` revalidates every transition: `acknowledge` only from `detected`; `resolve` only from `detected`/`acknowledged`/`auto_resolved` (otherwise **409**); `action_description` ≥ 20 chars (≥ 10 for `auto_resolved`) and `escalated_to` mandatory for `*_escalated` (otherwise **422**). Covered by `incident-lifecycle.service.spec` + e2e (real `409`/`422`).
- **RBAC on every endpoint.** `@Requires(perm)` on incidents (read + lifecycle), rules (`GET/PUT /rules`), incident report (`POST /reports/incidents`), detector (`POST /dev/detect`), observability (`GET /observability`) and user admin. Global guards run before the handler.
- **Everything audited.** `incident_ack`/`incident_resolve` written explicitly by the lifecycle (metadata with `incident_id`/`action_category`, no PII); `rule_update` on every rule edit (severity `config`); `user_role_update`/`user_status_update` on admin changes; the read-only tools are recorded as `tool_call`.
- **No PII in incidents / WS / observability.** Incidents aggregate by **dimension** (provider/customer) — `detectionPayload` carries rule/window/summary/metrics, never phone/content. socket.io events (`incident.created/updated/auto_resolved`, `connection.status`) carry id/status/metrics, no PII. `GET /observability` exposes counts (sessions, usage per tool, reveals, WS connections), no PII.
- **Authenticated socket.io.** The `/ws/support` handshake requires the JWT cookie session; without an identity, it disconnects. Dev: `auth.devBypass` accepts without a cookie (same as REST).
- **The detector neither fabricates nor closes improperly.** It creates an incident without duplicating an open dimension; it auto-resolves only when the anomaly goes away. A rule in **shadow mode** records but does not notify. `system` is the actor (no `user_id`) on automatic activities.

**Notes (Phase 2):**
- **`POST /api/dev/detect`** is a DEV trigger (RBAC-guarded); the scheduled scan is turned on by `DETECT_ENABLED`. In production, consider gating/removing the dev trigger.
- The delivery source is the **detailed report in S3** (`example-sms-delivery-reports`); the covered channel is `sms`/`sms_flash` (voice/RCS out).
