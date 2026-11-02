---
type: skill
name: Security Audit
description: Review code and infrastructure for security weaknesses. Use when Reviewing code for security vulnerabilities, Assessing authentication/authorization, or Checking for OWASP top 10 issues
skillSlug: security-audit
phases: [R, V]
generated: 2026-06-10
status: filled
scaffoldVersion: "2.0.0"
---
## Workflow

Atena security audit. The product's risk surface is SMS PII (phone + content) and the integrity of the incident record. Before auditing, read `README` §5 (5 principles), `.context/docs/security.md` and `apps/api/prisma/schema.prisma` (`02-data-model.md` is the historical reference). Besides the generic OWASP top 10, run the Atena-specific controls below.

1. **PII masked by default (RNF-1.4):** confirm that the phone (`phone_masked` by default; `phone_full` never exposed without reveal) and the SMS content (hidden until reveal) arrive masked. A phone or content reveal ALWAYS writes to the audit log (`reveal_phone` / `reveal_content`, severity `pii`) — `POST /api/shippings/{id}/reveal-phone|reveal-content` with `@Requires('pii:reveal')` + `@Audit(...)`. See `RevealField` (`apps/web/src/chat/tool-cards/RevealField.tsx`) as the UI side of the behavior — the decision to reveal is server-side, not client-side.
2. **Raw SMS content only on S3:** verify that sensitive text is not in any MySQL column — there is no shipping/message table in MySQL; the content and the phone live in the S3 detailed report and are read on demand via DuckDB (with the transient `/tmp` cache), with audited access when revealed. No PII in application logs.
3. **No phone in searches/logs:** logs carry IDs/`phone_hash` (code-style rule), never the phone; the search's E.164 `phone` filter is applied inside the DuckDB query over S3, and only `method + path` (no query string) is logged, so the phone does not leak into logs.
4. **Immutable audit log (RNF-1.5):** `audit_log` only accepts INSERT + SELECT (no UPDATE/DELETE); app role with restricted permission (a database grant — not present in the migrations); 1-year retention; ideally append-only/partitioned. Confirm that every sensitive action generates an entry (`tool_call`, `reveal_phone`, `reveal_content`, `incident_created`, `incident_ack`, `incident_resolve`, `session_start`, `export_report`, `rule_update`, `user_role_update`, `user_status_update`) via the global NestJS interceptor (`@Audit`) or, for incident/rule changes, written by the service (`AuditService.record`).
5. **Per-endpoint RBAC:** every endpoint has a `@Requires(perm)` guard (map in `apps/api/src/auth/rbac/permissions.ts`). `support_analyst` (chat/search/trail/reports/incidents incl. ack/resolve/comment) does NOT reveal PII, does NOT edit rules and does NOT run ops — `pii:reveal`, `rules:edit` and `ops:run` are `support_lead`+, and `users:manage` is `admin` only; reading reports (`reports:view`) and the audit log (`audit:view`) is granted to every role. An endpoint without a guard, or a permission check only in the UI, is a finding.
6. **Double server-side validation (resolve §D):** the UI disables fields, but the backend ALWAYS revalidates — `action_category` ∈ enum; `action_description` ≥ 20 chars (≥ 10 on `auto_resolved`); `escalated_to` required if category ∈ {provider_escalated, internal_escalated}; only the transition detected|acknowledged|auto_resolved → resolved; each change writes `incident_activity` + audit. Also make sure ack/resolve/comment are NOT LLM tools (state changes out of the model's reach — principle 3).
7. **The LLM neither fabricates nor executes:** the model never touches the database; all structured data comes from a tool's return; an out-of-scope request → explicit refusal. The LLM is Nova Pro via Amazon Bedrock (Converse API), with no prompt retention.
8. **Auth / session:** auth on every endpoint (OIDC restricted to the `@example.com` domain, session in a JWT cookie `atena_session`; only `/health` and `/auth/*` are public; the WS validates the session cookie in the handshake). OIDC via Microsoft Entra ID, behind an auth abstraction (`IdentityProviderInterface`) so the IdP can be swapped easily, restricted to the `@example.com` domain, no password of our own; roles come from the app's database (`users`/`user_roles`), assigned by an admin, not from the IdP. Confirm that the domain is validated server-side and that identities from outside the domain are rejected. Expired session → 401 → back to the login. The session is also required on the WS `/ws/support` upgrade. `AUTH_DEV_BYPASS` must be off in production.
9. **Secrets:** no `.env`/`.pem`/`.key`/`*secret*` in the repo — blocked by `.context/harness/policy.json`. No hardcoded credentials.
10. **Document the findings** with severity and fix (use the audit_log severity scale as a reference: info | warning | pii | config).

## Examples

**Audit report (Atena-specific findings):**
```
## Security Audit — Atena

### Critical
1. [PII] Endpoint GET /api/shippings/search returns phone_full without reveal or audit
   - The phone must come masked by default; it is only revealed with permission + reveal,
     which writes audit 'reveal_phone' (severity pii, RNF-1.4).
   - Fix: mask in the serializer; separate reveal route that writes the audit entry.

### High
2. [RBAC] PUT /api/rules/{id} without @Requires('rules:edit')
   - Any support_analyst edits the anomaly rules' thresholds.
   - Fix: permission guard on the endpoint; rule_update generates audit 'rule_update'.
3. [VALIDATION §D] POST /api/incidents/{id}/resolve trusts the UI
   - The backend does not revalidate action_description ≥ 20 chars nor escalated_to for
     provider_escalated; it accepts the transition resolved→resolved.
   - Fix: double server-side validation per §D + incident_activity + audit.

### Medium
4. [PII in logs] the E.164 phone logged with the search query string
   - Fix: log only method + path and IDs/phone_hash; never PII in logs/indexes. SMS content only on S3.

### config
5. [Audit] audit_log with UPDATE permission granted to the app role
   - Breaks immutability (RNF-1.5). Fix: revoke UPDATE/DELETE; INSERT+SELECT only.
```

## Quality Bar

- PII masked by default; phone/content reveal ALWAYS generates audit (`reveal_phone`/`reveal_content`, severity `pii`). The decision to reveal is server-side.
- Raw SMS content and phone only on S3 (read via DuckDB, never stored in MySQL); IDs/`phone_hash` in logs; zero PII in application logs.
- Immutable `audit_log`: INSERT+SELECT only, 1-year retention; every sensitive action recorded via the global interceptor or the owning service.
- Per-endpoint RBAC with a server-side `@Requires(perm)` guard (permissions per role in `permissions.ts`) — a UI-only check does not count. Auth on every endpoint (OIDC restricted to the `@example.com` domain, validated server-side); the WS validates the session in the handshake; 401 → re-login.
- Double validation: the backend revalidates the whole resolve (§D) regardless of the UI. Ack/resolve/comment outside the LLM tool catalog.
- The LLM never touches the database; all structured data comes from a tool; out of scope → refusal. Nova Pro via Amazon Bedrock (Converse API), with no prompt retention.
- No secrets in the repo (`policy.json` blocks `.env`/`.pem`/`.key`/`*secret*`); no hardcoded credentials.
- Findings with severity and a concrete fix (file:line). Also cover the OWASP top 10 (injection, broken authz, sensitive data exposure, vulnerable deps).

## Resource Strategy

- No `scripts/`/`references/`/`assets/` of its own: the controls fit in `SKILL.md`, and the data model/rules live in `apps/api/prisma/schema.prisma`, `.context/docs/security.md` and the `README` §5.
- Reference §D of `01-backend-api-contract.md` and the enums of `schema.prisma` (action_category, the audit_log action) instead of duplicating them.
- The secrets scope is defined by `.context/harness/policy.json` — consult it, do not re-copy the list.
