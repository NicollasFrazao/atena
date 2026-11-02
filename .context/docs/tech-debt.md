# Technical debt — Atena

> Items consciously deferred or simplified in the MVP, to be revisited later. Created on 2026-06-12. Related decisions in [decisions.md](../../docs/design_handoff_atena/decisions.md).

## 0. Already resolved (summary)
- **Microsoft Entra OIDC auth** enabled and validated (state/nonce/PKCE + JWT cookie session). See item 1.
- **App-managed RBAC** (roles in the database, `@Requires`), supersedes the old Entra App Roles debt. See item 1.
- **Real LLM:** Amazon Nova Pro (`us.amazon.nova-pro-v1:0`) via Bedrock Converse; fake provider without credentials.
- **Delivery source = detailed report in S3** (`s3://example-sms-delivery-reports`), via DuckDB + `/tmp` cache; `messages`/`message_events` dropped. The general-logs contract of `messaging-api` was **abandoned**.
- **message→shipping rename completed** (tools `search_shippings`/`get_shipping_trail`, `shipping_id`, routes `/shippings/*`, incidents with `related_shipping_ids`). "campaign" remains.
- **Top-3 anomaly scenarios** defined (item 3) and detectors implemented (4 rules + shadow mode).

## 1. Authentication: institutional social login (OIDC via Microsoft 365) in the MVP
- **Decision:** the MVP authenticates via **social login with the institutional email** — OIDC through **Microsoft 365 (Entra ID)**, restricted to the `@example.com` domain. No password of its own. RBAC (`support_analyst` / `support_lead`) mapped after login.
- **Swappability:** the provider sits behind an **auth abstraction** (OIDC interface) so the IdP can be swapped easily (e.g. Google Workspace) without rewriting the rest. This is a requirement of the decision, not debt.
- **State (2026-06-21):** OIDC login enabled **end to end** (plan `auth-oidc-entra`): state/nonce/PKCE, real exchange of `code` for a token, **stateless JWT cookie session** (`atena_session`, `SameSite=None; Secure`), `GET /auth/me`, `logout` and a login screen on the front end. `AUTH_DEV_BYPASS` remains as a **dev fallback** (the cookie takes precedence); **production must set `AUTH_DEV_BYPASS=false`**.
- **App-managed RBAC (2026-06-21, plan `rbac-users-permissions`):** roles **no longer come from the IdP** — `mapRoles` was removed. There are now `users`/`user_roles` tables; the user is **persisted at login** (upsert) and roles are **assigned by an admin** (`/admin/usuarios`). A **roles→permissions** model (map in code `auth/rbac/permissions.ts`; guard `@Requires(perm)`); roles read from the database **per request** (~30s cache, invalidated on mutations). States: no role → `access_pending` (gate on the front end); `disabled` → `access_disabled`. Bootstrap via `AUTH_ADMIN_EMAILS`. Dev devBypass = `admin`. Initial catalog: `admin`/`support_lead`/`support_analyst`/`viewer`. **This supersedes the old `support_lead`/Entra App Roles debt.**
- **Residual debts:**
  - **No central session revocation** (stateless JWT): the cookie cannot be invalidated before `exp` (8h). **Role revocation** is already immediate (short cache + database lookup); only the cookie itself cannot be revoked. If needed, a server-side session or a short refresh + denylist.
  - **No CSRF token** — `SameSite=None` gives up the cookie's protection; currently covered by state/nonce/PKCE (login). Sensitive mutations (admin, lifecycle) already require a permission + are audited; when exposing broader cross-site mutations, add double-submit/a CSRF token.
  - **Role→permissions map in code** (not editable by the admin in the database). Enough for the MVP; if custom roles/permissions are needed at runtime, promote to `roles`/`permissions`/`role_permissions` tables.
  - **No FK** from the existing tables (`chat_sessions.user_id` etc.) to `users` (avoids clashing with `dev-user`/legacy). Add it once the legacy data is migrated.
  - Full corporate SSO / **SAML + SCIM**, in case more than the social login is needed.
- **When:** cookie revocation/CSRF/FK if/when the product requires it; SAML/SCIM likewise (does not block the MVP).
- **Pending (human) validation:** the real round trip with Microsoft (interactive login in the browser) must be validated by an operator — it requires the app registered in Entra with the `redirect_uri` (`/api/auth/callback`) and a corporate credential. Flow/session/domain + **the entire RBAC** covered by tests + a structural smoke test (forged cookies).

## 2. Database: adapting the PostgreSQL → MySQL schema
The model in [02-data-model.md](../../docs/design_handoff_atena/02-data-model.md) was written for PostgreSQL. Items to adapt for **MySQL**:
- `UUID` PK → `CHAR(36)` or `BINARY(16)` (generated in the app or `UUID()`).
- `TIMESTAMPTZ` → `DATETIME` in UTC (or `TIMESTAMP`).
- `JSONB` → `JSON`.
- `TSTZRANGE` (`incidents.detection_window`) → two `DATETIME` columns (`detection_window_start` / `_end`).
- `UUID[]` (`related_shipping_ids`) and `TEXT[]` (`tags`) → a `JSON` column or a join table.
- `INET` (`audit_log.ip_address`) → `VARCHAR(45)`.
- Monthly partitioning of `audit_log` → `RANGE` partition by a time column in MySQL.
- Indexes: no GIN; use regular / functional (JSON) indexes when needed.
- **audit_log immutability:** guarantee it via the app role's permissions (INSERT + SELECT only).

## 3. (resolved) Top-3 anomaly scenarios
- Defined from the production logs (`at-api-logs-prod`) — see [anomaly-scenarios.md](anomaly-scenarios.md). Residual open points: validate the definition of success with product (`delivered` vs `delivered+sent`); recompute baselines over 7–30 days + per-message deduplication (final status, not event); evaluate extra columns in `anomaly_rules` (minimum volume guard, time-of-day baseline).

## 4. (resolved) Synchronization of the context base (.context)
- Pass completed on 2026-06-12: docs (`.context/docs/*`), playbooks (`.context/agents/*`), skills (`.context/skills/*`) and the plan `.context/plans/atena-mvp.md` updated for **MySQL** + **Amazon Bedrock**, with the data strategy (S3 = durable origin of the raw data; `/tmp` = transient read-through cache; MySQL = metadata + audit) and institutional social login (OIDC via Microsoft 365). Keep it in sync as new decisions come up.

## 5. Transient cache in `/tmp` — sizing and durability
- `/tmp` (Docker volume on the EC2 instance) is the **transient cache** of the raw data (decision #8): it reduces repeated requests to S3 within a short period and keeps raw data out of MySQL. It is **ephemeral/rebuildable** — lost on restart/redeploy; that is fine because the origin is S3.
- **Invariants:** nothing durable lives only in `/tmp` — `audit_log` (immutable, 1 year) and metadata in **MySQL**; origin of the raw data in **S3**.
- **To be decided (infra):** ~~TTL/eviction and disk limit of `/tmp`~~ (eviction by age+size + cleanup of orphaned version dirs implemented in the audit engine — `ATENA_AUDIT_CACHE_MAX_MB`/`_MAX_AGE_HOURS`); EBS vs instance store; **warming (pre-populating) after redeploy** (pre-warming — still pending); cache size vs raw data volume.

## 6. Audit: untracked pre-`queued` flow exits (medium term)
- **Context:** Atena counts from the **detailed report** (`example-sms-delivery-reports`), whose first record for a campaign is the `queued`. Failures in the producer **before** `dispatchStatus('queued')` (parse / `calculateCreditByMessage` / `validatePayload` / `resolveSmsHashId`) **create no record** in the detailed report → Atena does not see them (they only become an error entry in the general logs).
- **Decision (MVP):** accept the gap — these failures are rare (the message has already passed through main-api). Channel: we cover **SMS Short + SMS Flash** (`campaign_type IN ('sms','sms_flash')`, decision revised on 2026-06-25; previously SMS Short only). Voice/RCS remain out.
- **Medium term:** **measure the volume** (pre-`queued` errors per day vs number of campaigns in the detailed report) and decide whether it is worth changing the producer. If relevant: the producer emits an early failure status (the detailed report does not use `hashId`, so it can be emitted before `resolveSmsHashId`); the failed parse (no `campaign_id`) stays in the log only. A cheap alternative on the consumer side: reconcile the intake (`[Action] enqueued`, aggregated) against the campaigns in the detailed report.

## 7. Catalog (`list_customers`/`list_providers`): scan and result size
- **Context:** the catalog tools scan S3 for the `DISTINCT` customers/providers. In a live validation, `list_customers` took >2min (cold scan over the wide default window).
- **(resolved) broad scan:** ~~clamp to the window/minimum date~~ — the tools are now **windowed** (`date_from`/`date_to`/`date_range`) and clipped to `ATENA_AUDIT_MIN_QUERY_DATE` (commit `c4cc0ac`); without a window they become `[minQueryDate, now]`. Validated live: "clientes nas últimas 24h" ("customers in the last 24h") dropped from >2min to **~6s**. Improper selection by the LLM has also been mitigated (descriptions + system prompt).
- **Residual:** (a) a **cache** for the catalog (customers/providers change slowly) with a TTL, for repeated calls without another query having warmed the partitions; (b) **result size** — a busy window can have MANY distinct customers, and dumping the whole list into the LLM makes generation slow/expensive. Consider `limit` + a count (e.g. "N customers; here are the top/most recent") instead of the full list.

## 8. (resolved) Bedrock: the post-tool turn hung (stream without chunks)
- **Root cause (2026-06-29):** it was NOT Bedrock — it was the **blocked Node event loop**. The log `[converse] send 52807ms · 1º token 1ms` gave it away: the Bedrock Promise had already resolved, but the loop did not process it for ~52s (**synchronous** I/O on the hot path — `writeFileSync` in the S3 object prefetch — + detector contention on the **single** DuckDB instance). The chat stream runs on the same loop → it blew the idle timeout.
- **Fix (commit `8131d1b`):** the prefetch moved to `fs/promises.writeFile` (non-blocking → `send` dropped from ~52s to ~1–12s); detector with a configurable interval `DETECT_INTERVAL_SECONDS` (60→180s, less contention); LLM idle timeout 60→120s; and the controller's silent `catch` now **logs** the real cause. Validated live (the question that used to fail now gets an answer).
- **Residual (hardware limit, not software):** a BROAD query (multi-day report) still takes ~88s = **DuckDB compute on 2 CPUs**. A worker thread was evaluated and **discarded** (the compute already runs off the loop, in DuckDB's threads; 2 instances risk OOM in 4GB). See memory `duckdb-event-loop-contention`.

## 9. AWS credentials: S3 via IAM Role (done in the app) · Bedrock via Bearer (by design)
- **S3 (detailed report):** DuckDB uses `CREATE SECRET … PROVIDER credential_chain` → it resolves on its own either **static/STS keys** (`AWS_ACCESS_KEY_ID`/`SECRET`/`SESSION_TOKEN`) in local dev OR the **instance IAM Role** (EC2/ECS) in production, with no keys in `.env`. Nothing to do in the app — the EC2 instance just needs the role with `s3:GetObject`/`s3:ListBucket` on the detailed report bucket.
- **Bedrock (LLM):** authenticates via `AWS_BEARER_TOKEN_BEDROCK` (Bearer), **MANDATORY** when `LLM_PROVIDER=bedrock` (`LlmModule` fails fast without it). It does NOT use the IAM Role — by design decision.
- **Remaining (infra/AWS, outside the app):** attach the IAM Role to the EC2 instance and provide the Bedrock Bearer via a secret (SSM/Secrets Manager) in production. `.env.example` already reflects the real values (`ATENA_SMS_STATUS_BUCKET=example-sms-delivery-reports`, `BEDROCK_MODEL_ID=us.amazon.nova-pro-v1:0`).

## 10. (resolved) CI
- **Done (2026-06-29):** `.github/workflows/ci.yml` — **API** job (lint + Jest tests) + **Web** job (lint + Vitest unit + hermetic **Playwright e2e** on Chromium); the e2e joined the gate (lint + `typecheck:e2e`). Green on GitHub Actions; runs on push/PR to `master`.
- **Residual:** CI does not cover `make test-e2e` (API e2e with a DB) nor deploy; lint uses `--fix` (does not fail on auto-fixable items). Enough for the MVP.

## 11. Full corporate SSO (SAML + SCIM)
- The MVP uses OIDC (Microsoft Entra) with app-managed roles. Full corporate SSO (SAML + SCIM provisioning) remains **residual debt** — it does not block the MVP. See item 1.

## 12. Observability: prototype KPIs without a real data source
- **Context (2026-06-29):** when aligning the Observability screen with the prototype, some of the mock's numbers **have no real source** in the backend. Conscious decision: keep the UI **faithful to the real data** (do not fabricate numbers), leaving these as debt. The UI/style part (latency bar, green WS + background, refusals card, tokens) has already been aligned.
- **WebSocket — "average" and "average lag":** `SupportGateway` only exposes `connected` (live) + `peak` (in memory, process scope). There is no time series of connections nor RTT measurement — the card shows only **connected + peak**. For the prototype's 4 stats: (a) **average** = a rolling in-memory counter in the gateway (cheap, but process-scoped, not per window — a somewhat "vanity" metric); (b) **average lag** = a **ping/pong protocol** (web client + gateway measuring RTT), more involved. The ideal would be **persisted telemetry** (time series) so it is truly per window, like the other KPIs.
- **Refusals — breakdown by reason:** the refusal **is persisted + counted** (real data), but the orchestrator (`buildRefusal`) **always emits a single reason** `fora_do_escopo`. The prototype shows 3 (`fora_de_escopo`/`falta_de_contexto`/`prompt_injection`) — a **mock**. For the real breakdown: a **refusal classifier** in the orchestrator (distinguishing the reason via Bedrock's `stop_details` / a heuristic on the request). The per-reason example already exists on the front end (static map `REFUSAL_REASON_EXAMPLE`), ready for the extra reasons when they exist.
- **When:** when the product wants real WS metrics (telemetry) or the refusals breakdown; **none of this blocks** current usage (the UI shows the real data that exists).

## 13. Web unit coverage below the 80% gate
- **Context (2026-11-01):** the standards require 80% coverage on statements, branches, functions and lines. The API meets it (94.4 / 82.7 / 89.4 / 94.2). The web app does not: its Vitest suite covers the logic modules (SSE parsing, reveal, formatting, time, the chat hook, the incident banner), while pages and components are exercised only by the Playwright suite, which does not report coverage. Measured: statements 16.7%, branches 54.7%, functions 43.7%, lines 16.7% over `apps/web/src`.
- **Decision:** the threshold was not lowered silently: `apps/web/vite.config.ts` holds a **ratchet at the measured floor** (16 / 54 / 42 / 16), so coverage cannot drop, and this item tracks the gap.
- **What closes it:** component tests with `jsdom` + Testing Library for the pages (chat, incidents, reports, rules, audit, admin, observability) with the API mocked at `apiFetch`, raising the floor in `vite.config.ts` with each batch until all four metrics reach 80% — or, alternatively, merging Playwright coverage (V8 via `page.coverage`) into the report.

## 14. Dependency advisories below the audit gate
- **Context (2026-11-01):** CI fails on production advisories of severity **high** or above (`npm audit --omit=dev --audit-level=high`). The high ones found when the gate was introduced were fixed (lockfile updates, `dd-trace` ≥ 5.134, `multer` 2.5.0 through `overrides`, because `@nestjs/platform-express` 11 pins 2.4.0).
- **Open:** two **moderate** advisories in `react-router` 6 (open redirect via backslash in `<Link>`/`useNavigate`; constructor injection in SSR hydration, which this SPA does not use). The fix is react-router 7, a major upgrade.
- **What closes it:** migrate `react-router-dom` 6 → 7 (route definitions and data APIs), then drop the `multer` override once `@nestjs/platform-express` ships a fixed version.

## 15. Code comments still in Portuguese
- **Context:** the standards require everything in English. The context base, the tooling and every comment written since 2026-11-01 are in English; most older code comments (TSDoc of the API and web modules, inline comments), the `Makefile` help texts, `docs/` (handoff, cost notes) and some identifiers of pages (`UsuariosPage`, `RelatoriosPage`, route `/admin/usuarios`) are still in Portuguese. User-facing UI strings stay in Portuguese by design.
- **What closes it:** translate module by module when a file is touched for other reasons; rename the page components (`UsersPage`, `ReportsPage`) in a dedicated `refactor` PR; translate `docs/` last (historical).

## 16. Behaviour found while raising coverage (not changed)
- **`audit-query/duckdb-audit-query.service.ts`, `fetchObjectToLocal`:** when an S3 response has no `Body`, it writes an empty file; DuckDB then fails the whole query with "Input is not a GZIP stream", so this fallback never helps. Decide whether to skip the partition or fail with a clear error.
- **`cache/s3-tmp-content-cache.ts`, `get()`:** `parseRef(ref)` runs before the `try`, so a malformed ref (e.g. `s3://bucket-only`) throws, although the interface documents `null` on failure. The spec asserts the current behaviour.
- **Incident detection-window fallbacks:** the schema says the window columns are `NOT NULL`, but the service still falls back when they are missing (a spec relies on it). Decide whether the fallback should exist.

## 17. Dependabot holds the NestJS, Vite, Vitest and React majors
- **Context (2026-11-02):** NestJS 12 (#25), Vitest 5 with a newer Vite (#26) and React 19 with react-router 7 (#32) break the build when bumped alone; `.github/dependabot.yml` ignores their semver-major updates so the weekly PRs do not reopen.
- **What closes it:** the three migrations, each removing its own `ignore` entries.
