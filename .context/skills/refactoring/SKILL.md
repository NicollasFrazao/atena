---
type: skill
name: Refactoring
description: Refactor code safely with a step-by-step approach. Use when Improving code structure without changing behavior, Reducing code duplication, or Simplifying complex logic
skillSlug: refactoring
phases: [E]
generated: 2026-06-10
status: filled
scaffoldVersion: "2.0.0"
---
## Workflow

Context: the production code exists — `apps/api` (NestJS), `apps/web` (React + in-house components on the `--at-*` tokens) and `packages/types` (`@atena/types`). The original reference prototype (`prototype/*.jsx`) is not included in the repo; it only survives as screenshots and the design reference in `docs/design_handoff_atena/`. Refactoring in Atena means the usual internal refactorings of that code, plus bringing screens closer to the design without copying prototype JSX — always without breaking the 5 principles or the contract shapes.

1. **Define the invariant to preserve.** In Atena that is more than "same behavior": it means keeping (a) the 5 principles (README §5), (b) the contract shapes (`@atena/types` / `docs/openapi.yaml`; origin in §C of `01-backend-api-contract.md`), (c) `snake_case` at the API ↔ `snake_case` in the DB (with Prisma Client's camelCase mapped at the edge).
2. **Make sure there is a safety net.** Tests exist — Jest in `apps/api`, Vitest in `apps/web`, Playwright for browser e2e — run them before/after (`npm test`). Where a path has no tests, add one first or validate against the `@atena/types` shape and the spec's requirements; do not refactor blindly anything that touches audit/PII/validation.
3. **Design parity without copying JSX:** use the prototype screenshots and `05-design-reference.md` only as a behavior and layout reference; implement with the in-house components of `apps/web/src/` and Phosphor. The prototype hand-reimplemented primitives because it ran standalone — that reimplementation is not something to bring back. E.g. the prototype's `SearchResults` is `SearchResultsCard` (`apps/web/src/chat/tool-cards/SearchResultsCard.tsx`), consuming `SearchResultRowInterface` (§C.1).
4. **Extract shared types into `@atena/types`.** Types derived from the contract shapes (`SearchResultRowInterface` §C.1, `ShippingTrailInterface` §C.2, `IncidentInterface` §C.5, etc.) go into the `@atena/types` package (`packages/types/src/index.ts`), imported by backend and frontend — a single source of truth. Do not duplicate the shape in two places.
5. **One change at a time, frequent commits** (Conventional Commits, see `AGENTS.md` and `.context/docs/code-style.md`).
6. **Revalidate the invariants:** PII still masked by default and reveal still generates audit; tools still server-side (the LLM does not touch the database); ack/resolve still outside the tool catalog; server-side validation of resolve (§D) intact; response shape unchanged.

## Examples

**Extract a shared type into `@atena/types` (instead of duplicating the shape):**
```typescript
// Before: the incident shape redefined in the backend and copied in the frontend (they drift over time).

// After: packages/types/src/index.ts — single source, derived from §C.5
export type IncidentSeverityType = 'info' | 'warning' | 'critical';
export type IncidentStatusType = 'detected' | 'acknowledged' | 'resolved' | 'auto_resolved';
export type DimensionType = 'provider' | 'customer' | 'route' | 'global';

export interface IncidentInterface {
  id: string;                      // PK `id` in the DB as well
  rule: string;
  severity: IncidentSeverityType;
  status: IncidentStatusType;
  dimension_type: DimensionType;   // snake_case at the API (Prisma Client: dimensionType)
  dimension_value: string;
  detected_at: string;             // ISO 8601 UTC
  // ...the rest per §C.5 / docs/openapi.yaml
}
// Backend (NestJS) and frontend (React) import the SAME type. The camelCase→snake_case
// mapping of Prisma Client lives at the API edge (service/serializer), never in the UI.
```

**Port a prototype behavior without copying JSX:**
```
The prototype's PhoneCell (with useMaskedPhone) hand-implemented masking/reveal on the client.
In production it is RevealField (apps/web/src/chat/tool-cards/RevealField.tsx), preserving the PII invariant —
  phone_masked by default; reveal only with permission + confirmation; the reveal calls the backend
  (POST /api/shippings/{id}/reveal-phone), which returns phone_full AND writes audit 'reveal_phone' (principle 5).
Do NOT port client-side masking logic as the truth: the app decides what to reveal.
```

## Quality Bar

- A refactoring preserves the 5 principles — if the change lets the LLM touch the database, exposes ack/resolve as a tool, removes the audit of a reveal, or unmasks PII by default, it is NOT a refactoring, it is a security regression.
- Immutable contract shapes: after the change, the response/payload still matches `@atena/types` / `docs/openapi.yaml`. Renaming an API field is a contract break, not a refactor.
- `snake_case` at the API ↔ `snake_case` in the DB always preserved; the mapping from Prisma Client's camelCase stays at the edge.
- Matching the design = implementing with the in-house components on the `--at-*` tokens, never pasting prototype JSX. The prototype's hand reimplementation of components is disposable.
- Shared types go into `@atena/types`; never duplicate the same shape in backend and frontend.
- The server-side validation of resolve (§D) and the immutability of `audit_log` (INSERT+SELECT only) are not loosened by "cleanup".
- Without tests/a safety net, do not refactor sensitive paths (audit, PII, validation, RBAC). Small commits, Conventional Commits.

## Resource Strategy

- No `scripts/`/`references/`/`assets/` of its own: the behavior reference is the code itself plus `docs/design_handoff_atena/`, and the shapes live in `@atena/types`.
- For the destination of types, point to the `@atena/types` package (`packages/types/src/index.ts`) instead of inventing paths.
- Reference `@atena/types`/`docs/openapi.yaml` and `apps/api/prisma/schema.prisma` (historically §C of the contract and §5.3 of `02-data-model.md`) for shapes/enums instead of re-copying them here.
