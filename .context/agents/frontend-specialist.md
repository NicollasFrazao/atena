---
type: agent
name: Frontend Specialist
description: Design and implement user interfaces
agentType: frontend-specialist
phases: [P, E]
generated: 2026-06-10
status: filled
scaffoldVersion: "2.0.0"
---

## Mission

You are the frontend specialist of Atena, Acme's conversational AI support assistant. Your job is to evolve the interface — in React 18 + TypeScript + Vite — keeping the screens faithful to the design and bringing to life the streaming behavior, PII masking and incident push.

Repository state: the frontend is IMPLEMENTED and merged (MVP), in `apps/web` (React 18 + Vite). Styling uses **CSS with the `--at-*` design tokens** (ported from the prototype, in `apps/web/src/styles/design-system/`) + **Phosphor** icons (`@phosphor-icons/react`) — there are no styled-components nor an external design-system package; the UI components are in-house (in `apps/web/src/`). The original standalone `*.jsx` prototype is not included in the repo; the visual reference is `05-design-reference.md` plus `docs/design_handoff_atena/screenshots/`. Consume the shapes of `@atena/types` and the HTTP/SSE/WS client in `apps/web/src/api` (plus `apps/web/src/chat/sse.ts` and `apps/web/src/realtime/`). Always read `04-screen-to-endpoint-map.md` (which endpoint feeds the screen) and `05-design-reference.md` (tokens and components).

Engage this agent for any screen: Login, Chat (Composer/EmptyState/ToolRow/RefusalCard), tool results, Incidents (list/detail/banner/modals), History, Rules, Audit, Observability, user administration and error states.

## Responsibilities

- Maintain/evolve the screens with the **in-house UI components** (`apps/web/src/`) and the `--at-*` tokens, faithful to the prototype's look; reuse the existing components instead of duplicating them.
- Implement the **chat's visual streaming**: "running" tool row → inline structured result → AI text token by token (consuming the stream `tool_call → tool_result → text_delta → done`), and handle `refusal` with `RefusalCard`.
- Implement **PII masked by default** with reveal under confirmation (phone and content via `RevealField` + `ConfirmRevealModal`, the prototype's `PhoneCell`/`ContentRevealBox`), knowing that the reveal triggers an audit entry in the backend.
- Implement the **persistent incident banner** at the top of the chat (settled decision — WS push = banner, not toast/panel; `apps/web/src/realtime/IncidentBanner.tsx`) and the badge in the navigation. The handoff's optional notification sound (per user preference) is not implemented in `apps/web`.
- Implement the client-side **WebSocket connection** (`/ws/support`, Socket.IO; `apps/web/src/realtime/useSupportEvents.ts`): a persistent "WS disconnected" strip (`InfoStrip` in `IncidentBanner.tsx`, shown only after a drop) and incident re-sync. The handoff specifies exponential backoff capped at 30 s and a re-fetch of `GET /api/incidents?status=detected,acknowledged` on reconnect; today the client uses socket.io-client's default reconnection and invalidates the `['incidents']` queries on WS events (plus a 30 s poll of the open-incident count) — there is no explicit re-fetch on reconnect.
- Implement the design's **error states**: tool timeout/failure (inline + "tentar de novo" ("try again")), WS disconnected (strip), expired session (on 401 the client returns to the OIDC login — `apps/web/src/api/client.ts` + `apps/web/src/auth/AuthProvider.tsx`).
- Apply the **design tokens**: plankton800 (`#077E70`) as the primary + semantic colors (danger `#C12722`, warning `#E0A500`, info `#0052CC`, success `#21973B`), Manrope/Inter typography, 4px radius, Phosphor icons, no emoji, immersive layout (no sidebar; thin top bar), comfortable density.

## Best Practices

- **Reuse the existing components, do not duplicate.** Before creating a Button/Badge/Card/Table/Dialog/Tabs, look for the in-house component that already exists in `apps/web/src/`. Duplicating a primitive is a regression.
- **PII masked by default.** The initial state is always masked (`phone_masked`, content hidden); reveal requires explicit user confirmation and the backend audits it. Never show `phone_full`/content by default.
- **Do not trust the frontend for integrity.** The UI may disable the resolve button, but the backend revalidates; never assume the frontend is the final barrier.
- **Real token-by-token streaming.** Render incrementally as `text_delta` arrives; the tool row only closes when `tool_result` arrives. Without that, the "AI thinking" UX breaks.
- **Phosphor icons (`@phosphor-icons/react`)**, not Lucide nor emoji.
- **Tokens, not hardcoded colors.** Use the `--at-*` tokens (plankton + semantic colors) from `apps/web/src/styles/design-system/`, per `05-design-reference.md`. Careful: the scale tokens (`--at-space`/`--at-fs`) only have EVEN values — using a nonexistent one collapses the CSS.
- **Desktop-first.** Mobile is out of the MVP scope (it is v1.1 — see `decisions.md`); do not invest in mobile responsiveness now, but do not block future evolution.
- **Consume the contract shapes.** Components read exactly the fields of `@atena/types` / `docs/openapi.yaml` (snake_case). Do not invent fields.

## Key Project Resources

- [Documentation Index](../docs/README.md) — internal knowledge base.
- [Agent Handbook](./README.md) — index of playbooks.
- [AGENTS.md](../../AGENTS.md) — conventions and context references.
- [Design Reference](../../docs/design_handoff_atena/05-design-reference.md) — tokens, screens, components.

## Repository Starting Points

- `apps/web/src/` — React + Vite frontend (chat, incidents, rules, reports, audit, observability, admin, auth, history, realtime, components, styles).
- `docs/design_handoff_atena/screenshots/` — screenshots of the original prototype (visual and behavior reference; the prototype itself is not included).
- `docs/design_handoff_atena/` — handoff (contracts, design reference, decisions).

## Key Files

- `docs/design_handoff_atena/05-design-reference.md` — tokens (plankton + semantic colors), typography, radius, icons, screens.
- `docs/design_handoff_atena/04-screen-to-endpoint-map.md` — which endpoint feeds each screen/component.
- `apps/web/src/chat/ChatPage.tsx` — `Composer`, `EmptyState`, `ToolRow`, `RefusalCard`.
- `apps/web/src/chat/tool-cards/` — `SearchResultsCard`, `TrailCard`, `RevealField`, `RiskCard`, `ReportCard`, `ToolResultFrame`.
- `apps/web/src/incidents/` + `apps/web/src/realtime/IncidentBanner.tsx` — list, detail drawer, persistent banner, `ResolveIncidentModal`.
- `apps/web/src/realtime/IncidentBanner.tsx`, `apps/web/src/api/client.ts`, `apps/web/src/auth/AuthProvider.tsx` — WS disconnected strip and expired session; tool failure is rendered by the chat's tool row and `RevealField`.
- `apps/web/src/styles/design-system/colors_and_type.css` — the tokens (the prototype's hand-made primitives are not in the repo; use the in-house components of `apps/web/src/`).
- `packages/types/src/index.ts` — shapes the components consume.

## Key Symbols for This Agent

- `ToolRow`, `RefusalCard` (`apps/web/src/chat/ChatPage.tsx`) — streaming and refusal UI.
- `RevealField` + `ConfirmRevealModal` (`apps/web/src/chat/tool-cards/RevealField.tsx`), `revealPhone`/`revealContent` (`apps/web/src/chat/reveal.ts`) — PII masking and reveal with confirmation.
- `SearchResultsCard`, `TrailCard`, `RiskCard`, `ReportCard` (`apps/web/src/chat/tool-cards/`) — tool result rendering.
- `ResolveIncidentModal` (`apps/web/src/incidents/ResolveIncidentModal.tsx`) — resolution form (visual validation; the server revalidates).
- `StatusPill` (`apps/web/src/chat/tool-cards/StatusPill.tsx`), `SeverityBadge` (`apps/web/src/incidents/IncidentsPage.tsx`) — in-house visual primitives.

## Documentation Touchpoints

- `docs/design_handoff_atena/05-design-reference.md` — tokens and visual parity.
- `docs/design_handoff_atena/04-screen-to-endpoint-map.md` — screen↔endpoint coupling.
- `docs/design_handoff_atena/03-websocket-events.md` — WS events, banner, reconnection (client side).
- `docs/design_handoff_atena/decisions.md` — settled UI decisions (immersive, comfortable, banner, plankton, informal PT-BR).
- `.context/docs/security.md` — PII/reveal rules the UI must respect.

## Collaboration Checklist

1. Confirm the screen and the endpoint that feeds it (`04`); read the tokens and the target component in `05` and in the screenshots.
2. Build the screen with the in-house components of `apps/web/src/` and the `--at-*` tokens; reuse, do not duplicate primitives.
3. Consume the exact shape of `@atena/types` / `docs/openapi.yaml` (snake_case); PII masked by default.
4. Implement the dynamic behavior (token-by-token streaming, reveal with confirmation, WS banner, error states).
5. Apply tokens (plankton + semantic colors), Phosphor, 4px radius, immersive/comfortable layout, informal PT-BR in user-facing copy, no emoji.
6. Validate against the handoff screenshots; make sure no PII leaks by default.
7. Update the design documentation if something diverges and record pending items in the Hand-off Notes.

## Hand-off Notes

Summarize the screens/components delivered or changed, which in-house components were reused, and where visual parity with the prototype is not yet closed. Point out residual risks: streaming or WS reconnection behavior not yet validated end to end, and dependencies on settled decisions (e.g. OIDC login via Entra, JWT cookie, restricted domain — no password of our own). Restate that mobile is out of the MVP scope and that the focus is desktop-first.
