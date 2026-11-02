---
type: skill
name: Bug Investigation
description: Investigate bugs systematically and perform root cause analysis. Use when Investigating reported bugs, Diagnosing unexpected behavior, or Finding the root cause of issues
skillSlug: bug-investigation
phases: [E, V]
generated: 2026-06-10
status: filled
scaffoldVersion: "2.0.0"
---
## Workflow

> REPOSITORY STATE: the app is implemented — `apps/api` (NestJS 11 + Prisma/MySQL, DuckDB over S3), `apps/web` (React 18 + Vite) and `packages/types` (`@atena/types`). Investigations cover real code and logs as well as expected behavior vs. contract/shape (`@atena/types`, `docs/openapi.yaml`). The original design prototype is not included in the repo. Reproduce with fixtures/mocks (the existing specs and the seed), never with real PII.

1. Reproduce with a fixture. Use the shapes of `@atena/types` (the same source as `docs/openapi.yaml`; `01-backend-api-contract.md` §C is their historical origin) and the existing specs' fixtures. If the bug is in the UI, run the web app (`apps/web`); if it is a contract bug, compare the actual response with the documented shape.
2. For an SMS delivery problem, follow the TRAIL: the `get_shipping_trail` tool (`GET /api/shippings/{id}/trail`) returns `events[]` in the order `api_request → routing → provider_attempt → webhook_status → final`. The point where the sequence breaks is the root cause (e.g. a failed `provider_attempt` with `error_hint` `insufficient_credits`).
3. For a chat/stream bug, validate the SSE sequence: `tool_call → tool_result → text_delta → done`, or `refusal` when out of scope. A stream that skips `tool_result` and still emits a `text_delta` with data is a violation of the "the LLM does not fabricate data" principle.
4. For a real-time bug, check the 3 canonical error states: tool failure/timeout (the chat's tool row in `apps/web/src/chat/ChatPage.tsx`, and the retry state of `RevealField`), WS disconnected/reconnecting (`InfoStrip` in `apps/web/src/realtime/IncidentBanner.tsx`), and expired session (401 → the client's unauthorized handler in `apps/web/src/api/client.ts` sends the user back to the login).
5. Form the hypothesis by checking the shape: a missing field, Prisma's camelCase leaking where the API must be snake_case, a relative date coming from the backend instead of ISO, `phone_full`/content arriving without reveal.
6. Check the WS reconnection: per the handoff (`03-websocket-events.md`), on reconnect the client MUST refill its state from `GET /api/incidents?status=detected,acknowledged` — not rely on the stream alone (events are lost during the drop). The current client (`apps/web/src/realtime/useSupportEvents.ts`) only invalidates the `['incidents']` queries on WS events and polls the open-incident count every 30 s; there is no explicit re-fetch on reconnect, so treat that as a known gap.
7. Document the root cause and the violated principle. Propose the simplest fix that respects the 5 principles.
8. NEVER log PII (cleartext phone, SMS content). Use `phone_masked` or IDs (`phone_hash`, per the code-style convention) in any log or investigation note.

## Examples

**Bug: the chat shows a shipping count the tool did not return**
```
## Bug: the AI's answer cites "184 shippings" but the tool_result returned 6

### Reproduction (fixture):
1. Chat session, question "status of phone +55 11 98765-1234 in the last 4h"
2. Stream emits tool_call search_shippings → tool_result with rows.length = 6
3. text_delta says "Encontrei 184 envios…" ("I found 184 shippings…")

### Investigation:
- The 184 matches the related_shippings of incident INC-2401, not the search
- The LLM crossed context and fabricated a number outside the tool_result

### Root cause:
Violation of Principle 2 (the LLM does not fabricate data). The number has to come
from the tool_result's { total } envelope, not from the model's memory.

### Fix:
Prompt/guardrail: every count cited references the `total` field of the latest
matching tool_result; otherwise, explicit refusal.
```

**Bug: WS does not recover incidents after a network drop**
```
## Bug: an incident created while the WS was offline is missing from the list

### Reproduction:
1. The WS connection drops (InfoStrip shows "Tempo real desconectado — reconectando…"
   ("Real time disconnected — reconnecting…"))
2. The detector creates INC-2402 in that interval (incident.created lost)
3. The WS reconnects; the incident list does not show INC-2402

### Root cause:
The client relied on the stream alone. Events during the drop were lost
(03-websocket-events.md: "do not rely on the stream alone").

### Fix:
On reconnect, GET /api/incidents?status=detected,acknowledged (or invalidate the
['incidents'] queries) and merge the state before listening to the WS again.
Exponential backoff 1s→2s→…cap 30s.
```

## Quality Bar

- Reproduce with a fixture before theorizing; `@atena/types` is the source of shapes.
- NEVER log PII. The phone goes masked (`+55 11 9****-1234`) or as an ID/`phone_hash`; SMS content never in cleartext.
- For SMS delivery, walk the shipping trail (`get_shipping_trail` events, read from the S3 detailed report — there is no `message_events` table) in the canonical order and find the event that breaks.
- For chat, the valid SSE sequence is `tool_call → tool_result → text_delta → done` (or `refusal`); data in `text_delta` without a `tool_result` is a red flag.
- Confirm shape contracts: snake_case, ISO 8601 UTC, paginated envelope, `{ error: { code, message } }`.
- Check the 3 canonical error states before declaring a new bug — it may be an already-designed state.
- WS reconnection must refill via REST; lost events are expected, lost state is not.
- Write a root-cause note that names which of the 5 principles was violated, when applicable.

## Resource Strategy

- Use the real code and its specs as the lab: `apps/web/src/chat/` (`ChatPage.tsx`, `sse.ts`, `tool-cards/`), `apps/web/src/realtime/`, `apps/api/src/chat/orchestrator.service.ts`, and the types in `packages/types/src/index.ts`.
- Add `references/` only if a catalog of provider errors builds up (e.g. a map of `error_hint` values such as `insufficient_credits`, `invalid_number`, `unreachable`).
- `scripts/` for automated repro are now possible (there is executable code); prefer adding a regression spec (Jest/Vitest/Playwright) over a standalone script.
- Do not create sample PII files; always masked/fictitious data.
