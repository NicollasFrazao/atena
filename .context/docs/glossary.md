---
type: doc
name: glossary
description: Project terminology, type definitions, domain entities, and business rules
category: glossary
generated: 2026-06-10
status: filled
scaffoldVersion: "2.0.0"
---

## Glossary & Domain Concepts

Domain terminology of Atena — the communication platform's conversational AI assistant, focused on self-service access to SMS sending data and proactive anomaly detection. The definitions reflect the **current code** (MVP implemented); the handoff ([01](../../docs/design_handoff_atena/01-backend-api-contract.md), [02](../../docs/design_handoff_atena/02-data-model.md), [05](../../docs/design_handoff_atena/05-design-reference.md)) is a historical design/contract reference.

> Note: the types/shapes are exported from **`@atena/types`** (`packages/types/src/index.ts`), consumed by back end and front end. The API serializes in **`snake_case`** at the edge (a revision of the handoff). The delivery entity is called **"shipping"** (UI = "Envio").

## Type Definitions

Contract types/shapes (in `@atena/types`):

- **`SearchResultRowInterface`** — search row: `shipping_id`, `phone` (masked), `status`, `provider`, `customer`, `channel`, `app_id`, `requested_at`, `finalized_at`, `error_hint`. Paginated envelope: `{ rows, page, total_pages, total, latency_ms }`.
- **`ShippingTrailInterface`** — trail of a shipping: `shipping_id`, `customer`, `provider`, `phone` (masked), `final_status`, `content_ref`, `content_preview?`, `events[]`.
- **`ShippingTrailEvent`** — trail item: `{ type, label, at, detail }`.
- **`RiskAnalysisInterface`** — risk: `score`, `verdict`, `categories[]`, `explanation`.
- **`DeliveryReportInterface`** — deliverability report: `window`, `totals`, `by_provider[]`, `hourly[]`, `top_errors[]`, `csv_url`.
- **`IncidentInterface`** — incident: `id`, `rule`, `severity`, `status`, `dimension_type`, `dimension_value`, `detected_at`, `window`, `summary`, `metrics`, `related_shipping_ids`, `assignee`.
- **`AnomalyRuleInterface`** — rule (table `anomaly_rules`): `id`, `name`, `rule_type`, `dimension`, `enabled`, `severity`, `threshold`, `threshold_unit`, `window_minutes`, `shadow_mode`.
- **`AuditLogEntryInterface`** — audit entry: `id`, `occurred_at`, `user_id`, `action`, `resource`, `detail`, `severity`, `ip_address`, `metadata`.
- **RBAC**: `RoleType`, `PermissionType`, `UserStatusType`; `SessionUserInterface`, `AdminUserInterface`.
- **WebSocket events** (`WsServerEvent`, socket.io): `incident.created`, `incident.updated`, `incident.auto_resolved`, `connection.status`.
- **Chat SSE stream events** (`ChatStreamEvent`): `tool_call`, `tool_result`, `text_delta`, `done`, `refusal`.

## Enumerations

Domain enums (from [02-data-model.md](../../docs/design_handoff_atena/02-data-model.md) and [01](../../docs/design_handoff_atena/01-backend-api-contract.md)):

- **`final_status`** (shipping): `delivered | failed | pending | unknown`.
- **trail event types**: `api_request | routing | provider_attempt | webhook_status | final` (derived from the detailed report; there is no longer a `message_events` table).
- **`incidents.severity`**: `info | warning | critical`.
- **`incidents.status`**: `detected | acknowledged | resolved | auto_resolved`.
- **`incidents.dimension_type`** / **`anomaly_rules.dimension`**: `provider | customer | route | global`.
- **`action_category`** (resolve): `provider_recovered | provider_escalated | internal_escalated | false_positive | customer_communicated | monitoring_only | other`.
- **`anomaly_rules.rule_type`**: `delivery_rate_drop | failure_spike | consistent_error | webhook_silence` (immutable in the UI).
- **`anomaly_rules.threshold_unit`**: `% | σ | min`.
- **`audit_log.action`**: `tool_call | reveal_phone | reveal_content | incident_created | incident_ack | incident_resolve | session_start | export_report | rule_update | user_role_update | user_status_update`.
- **`audit_log.severity`**: `info | warning | pii | config`.
- **`chat_messages.role`**: `user | assistant`.
- **`risk.verdict`**: `low | medium | high`.
- **Channel (`channel`)**: `sms | sms_flash` (Short + Flash; voice/RCS out).
- **RBAC roles** (`RoleType`): `admin | support_lead | support_analyst | viewer`.
- **`UserStatusType`**: `active | disabled`.

## Core Terms

- **Tool** — a deterministic function the LLM can invoke (its only action surface): `search_shippings`, `get_shipping_trail`, `analyze_shipping_content`, `generate_delivery_report`, `list_providers`, `list_customers`, `list_incidents`, `get_incident`, `generate_incident_report`. Each one has a mirrored REST endpoint. **Not tools:** incident `acknowledge`/`resolve`/`comment`.
- **Orchestrator** — the component (`chat/orchestrator.service.ts`) that runs the tool-use loop via Amazon Bedrock (Amazon Nova Pro `us.amazon.nova-pro-v1:0`, Converse API, streaming + tool use): it interprets NL → picks a tool, the application executes it, the result goes back to the LLM, which generates the text. The orchestrator (the application) accesses data; **the LLM never touches the database**. Without Bedrock credentials, a deterministic **fake provider** takes over.
- **ThinkingSplitter** — utility (`chat/thinking-splitter.ts`) that separates the `<thinking>…</thinking>` tags Nova emits inline in the stream, isolating the reasoning from the final text.
- **Refusal** — when no tool applies, the stream emits `refusal` instead of `tool_call`. Guarantees that the LLM **does not fabricate data**. UI: `RefusalCard`.
- **Trail** — the complete timeline of a shipping (`get_shipping_trail`), made up of the detailed report events in chronological order. UI: `TrailTimeline`.
- **trail event types** — lifecycle events of a shipping: `api_request` (request received), `routing` (provider choice), `provider_attempt` (attempt at the provider), `webhook_status` (status reported by webhook), `final` (final status).
- **Incident** — a record of a detected anomaly (table `incidents`), created by the detector; stores the IDs of the impacted shippings in `related_shipping_ids`.
- **Shadow mode** — an anomaly rule under silent observation: it detects and **records** the incident (marked `shadow=true`) but **does not notify**. Used to calibrate thresholds without noise.
- **Incident lifecycle** — `detected` (just created by the detector) → `acknowledged` (an analyst acknowledged it) → `resolved` (resolved with a recorded action) or `auto_resolved` (the metric returned to baseline without intervention). Transitions to `resolved` only from `detected`/`acknowledged`/`auto_resolved`.
- **Severity** — how serious the incident is: `info`, `warning`, `critical`. Mapped to semantic colors (info `#0052CC`, warning `#E0A500`, critical = danger `#C12722`).
- **Dimension** — the axis on which the anomaly occurs: `provider`, `customer`, `route`, `global`. Has `dimensionType` + `dimensionValue` (e.g. provider / "Provider D").
- **action_category** — mandatory category when resolving an incident: `provider_recovered`, `provider_escalated`, `internal_escalated`, `false_positive`, `customer_communicated`, `monitoring_only`, `other`. Feeds the management report.
- **anomaly_rule and rule_types** — a detection rule (table `anomaly_rules`), editable on the Rules screen (threshold/dimension/window/severity/enabled). Types: `delivery_rate_drop` (drop in delivery rate), `failure_spike` (spike in failures), `consistent_error` (recurring error), `webhook_silence` (webhook silence). `rule_type` is immutable in the UI.
- **MTTA / MTTR** — Mean Time To Acknowledge / Mean Time To Resolve. Key metrics of the incident reports and of observability; design goal MTTA < 5 min (addressed by the persistent banner).
- **PII reveal** — the action of revealing the phone (`reveal_phone`) or the content (`reveal_content`), which arrive masked by default. Requires the **`pii:reveal`** permission; content is read first from the transient (read-through) cache of the raw data (`/tmp`) and, if it is not there, fetched from S3 via `content_ref` (populating `/tmp`). Every reveal creates an audit entry (severity `pii`). Endpoints: `POST /shippings/:id/reveal-phone`/`reveal-content`. The same permission unlocks the **CSV exports with PII**.
- **phone (E.164)** — phone number in E.164 format (e.g. `+5511987651234`); displayed masked by default. In the audit grain, normalized to **digits only**.
- **content_ref** — pointer to the raw SMS content in S3. Sensitive text is never stored in clear text in MySQL (delivery data does not live in MySQL).
- **Per-recipient grain (`campaign_id`, `phone`)** — the audit groups by `campaign_id` + `phone`, with `id = md5(campaign_id||'|'||phone)`; `phone` normalized to digits only at ingestion.
- **`requested_at` / `finalized_at`** — the instant of the **send** (`queued`) and the instant of the **outcome**. The search/report window is by **send** (`requested_at`); the rate-rule detector looks at the outcome. The partition scan is **symmetric** (±`lateStatusBuffer`, default ~48–72h).
- **Transient cache (`/tmp`)** — read-through cache of the raw data derived from the detailed report, materialized as parquet files in `/tmp` (a Docker volume on an EC2 instance in prod). Reads from `/tmp`; on a miss, **fetches from S3** populating `/tmp`. **Ephemeral/rebuildable** — nothing durable lives only here. Eviction by age+size (`ATENA_AUDIT_CACHE_MAX_MB`/`_MAX_AGE_HOURS`). Three tiers: (a) `/tmp` = ephemeral cache; (b) **S3** = durable origin of the raw data and the content; (c) **MySQL** = application data + `audit_log` (durable).
- **Audit log** — immutable record (table `audit_log`, INSERT + SELECT only) of every auditable action; fed by a global NestJS interceptor (`@Audit`).
- **RBAC (roles→permissions)** — roles `admin`/`support_lead`/`support_analyst`/`viewer` in the database (`users`/`user_roles`), **assigned by an admin** (they do not come from the IdP). Roles→permissions map in code (`auth/rbac/permissions.ts`); guard `@Requires(perm)` (AND of the permissions). E.g. `pii:reveal`, `incidents:*`, `rules:edit`, `users:manage`. Roles read from the database per request (~30s cache).
- **Auth (MVP)** — **Microsoft Entra OIDC** (state/nonce/PKCE), behind `IdentityProviderInterface` (IdP-swappable), **restricted to the `@example.com` domain**, with no password of its own. **Stateless JWT cookie session** (`atena_session`, `SameSite=None; Secure; HttpOnly`), validated on REST endpoints and at the socket.io handshake. User persisted at login (upsert); roles read from the database. In dev, `AUTH_DEV_BYPASS` (fail-closed: only effective with `=true` **and** `NODE_ENV != production`) resolves a stub user with the `admin` role. Admin bootstrap via `AUTH_ADMIN_EMAILS`.
- **SSO** — Acme's full corporate Single Sign-On (SAML + SCIM); **residual debt** (the MVP already uses OIDC). See [tech-debt.md](./tech-debt.md).
- **Plankton** — the assistant's primary brand color (`plankton800 #077E70`, teal). Thanos (purple) is out of the MVP; the palette is Plankton + semantic colors.
- **Incident banner** — a persistent red strip at the top of the chat, the style chosen for incident push (vs. a toast or an auto-opened panel): high visibility without interrupting what the analyst is doing.

## Acronyms & Abbreviations

- **PII** — Personally Identifiable Information (phone, SMS content). Masked by default.
- **MTTA / MTTR** — Mean Time To Acknowledge / Resolve.
- **RBAC** — Role-Based Access Control.
- **SSO** — full corporate Single Sign-On (Acme, SAML + SCIM). Residual debt (see [tech-debt.md](./tech-debt.md)); the MVP already uses OIDC.
- **SAML / OIDC** — OIDC (Microsoft Entra) is the MVP's auth protocol; SAML (full corporate SSO) is residual debt.
- **SSE** — Server-Sent Events (stream of the chat response).
- **WS** — WebSocket (socket.io at `/ws/support`, incident push).
- **LLM** — Large Language Model (Amazon Nova Pro `us.amazon.nova-pro-v1:0` via Amazon Bedrock Converse; fake provider without credentials).
- **RF / RNF** — Requisito Funcional / Não-Funcional (Functional / Non-Functional Requirement; in `spec-assistente-suporte.md`).
- **E.164** — international phone number format.
- **ORM** — Object-Relational Mapper (Prisma, over MySQL).
- **DI** — Dependency Injection (NestJS modules).
- **CSV** — export format for reports/search (`csv_url`; export with PII requires `pii:reveal`).
- **APM / DogStatsD** — observability via Datadog (dd-trace + hot-shots); optional/opt-in.

## Personas / Actors

- **support_analyst (support analyst)** — chat user. Investigates customer complaints, searches shippings, opens trails, analyzes content risk, acknowledges (ack) and resolves incidents.
- **support_lead (support lead)** — does everything the analyst does + generates management reports (MTTA/MTTR, distribution by action), edits anomaly rules and views the audit log.
- **admin** — manages users and roles (`/admin/usuarios`), in addition to what the lead does.
- **viewer** — read-only access (the most restricted role).
- **Anomaly detector (system actor)** — creates incidents automatically, fires `incident.created` and `incident.auto_resolved`. Appears in the audit log as `system`.

## Domain Rules & Invariants

Non-negotiable business rules (from [README §5](../../docs/design_handoff_atena/README.md), [01 §D](../../docs/design_handoff_atena/01-backend-api-contract.md), [02](../../docs/design_handoff_atena/02-data-model.md)):

- **The LLM does not access the database** and **does not fabricate data**: all structured data comes from a tool's return value; no applicable tool → refusal.
- **Incident state changes are never an LLM tool**: `acknowledge`/`resolve`/`comment` only via REST/UI with server-side validation.
- **Resolve validation (server-side):** `actionCategory` ∈ enum; `actionDescription` ≥ 20 chars (≥ 10 in the `auto_resolved` flow); if `actionCategory ∈ {provider_escalated, internal_escalated}` → `escalatedTo` mandatory; only transitions from `detected`/`acknowledged`/`auto_resolved` → `resolved`; every change writes to `incident_activity` + the audit log.
- **`rule_type` immutable in the UI** (only threshold/dimension/window/severity/enabled are editable); every change creates a `rule_update` audit entry.
- **PII masked by default**; reveal requires the `pii:reveal` permission (and, for content, a confirmation) and always creates an audit entry (severity `pii`). Raw content only in S3 (not in MySQL).
- **Immutable audit log**: no UPDATE/DELETE; the app role has only INSERT + SELECT.
- **Delivery data outside MySQL:** it comes from the detailed report in S3 via DuckDB; chat retention is configurable (default 90d, `retention` module).
- **Data convention:** snake_case in the DB **and at the API edge** (a revision of the handoff, which was camelCase); dates in ISO 8601 UTC; errors in the format `{ error: { code, message } }`.
- **Localization:** informal PT-BR (`você`), no emoji in the product.

## Cross-References

- [Project Overview](./project-overview.md)
- [Architecture Notes](./architecture.md)
- [Data Flow & Integrations](./data-flow.md)
- Handoff: [01 — API Contract](../../docs/design_handoff_atena/01-backend-api-contract.md) · [02 — Data Model](../../docs/design_handoff_atena/02-data-model.md) · [05 — Design Reference](../../docs/design_handoff_atena/05-design-reference.md)
