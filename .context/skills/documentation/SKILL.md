---
type: skill
name: Documentation
description: Generate and update technical documentation. Use when Documenting new features or APIs, Updating docs for code changes, or Creating README or getting started guides
skillSlug: documentation
phases: [P, C]
generated: 2026-06-10
status: filled
scaffoldVersion: "2.0.0"
---
## Workflow

> REPOSITORY STATE: the app is implemented (`apps/api`, `apps/web`, `packages/types`). The current HTTP contract is `docs/openapi.yaml`; the shapes live in `@atena/types`; the product's original design documentation lives in `docs/design_handoff_atena/` (numbered 01–06 + spec + decisions, now a historical reference); the context for agents lives in `.context/docs/`. Keeping them in sync with the code is the job. Language: English for docs and comments (`development-conventions.md`); informal Brazilian Portuguese (`você`) only in the product's UI copy. Be honest: describe what is implemented as fact and mark as DIRECTION only what does not exist yet (e.g. the deploy pipeline/IaC).

1. Identify the audience: agents (`.context/docs/`), API consumers (`docs/openapi.yaml`) or the team's humans/handoff (`docs/design_handoff_atena/`).
2. Determine what changed and which doc is the source of truth for that topic:
   - Tools and endpoints → `docs/openapi.yaml` (current) / `01-backend-api-contract.md` (historical)
   - Schema/tables/enums → `apps/api/prisma/schema.prisma` (current) / `02-data-model.md` (historical)
   - WS events → `03-websocket-events.md`
   - Screen↔endpoint map → `04-screen-to-endpoint-map.md`
   - Design/tokens → `05-design-reference.md`
   - Settled and pending decisions → `decisions.md` / `06-pending-decisions.md`
3. Write where the topic is canonical; in the other docs, cross-link instead of duplicating.
4. Use REAL Atena examples: tools (`search_shippings`, `get_shipping_trail`), endpoints (`POST /api/incidents/{id}/resolve`), shapes from `@atena/types`, enums (`action_category`, `final_status`, `severity`).
5. Clearly mark what is direction vs. implemented. The backend and frontend exist; check the code before describing a behavior.
6. When changing a locked decision, update `decisions.md` (with the rationale) and move the item out of `06-pending-decisions.md` once resolved.
7. Cross-link new scaffolds in `.context/docs/README.md` and `.context/agents/README.md` (AGENTS.md requires it).
8. Review: links resolve, examples match the contract, terminology consistent with `glossary.md`.

## Examples

**Document a new tool (in `docs/openapi.yaml` and the tools section of the context docs):**
```md
### `correlate_incidents` (Phase 1.2 — proposal, NOT implemented)
| Tool | Endpoint | Input | Output |
|---|---|---|---|
| `correlate_incidents` | `GET /api/incidents/correlate` | `{ date_range, dimension }` | correlated list |

Follows the tool↔endpoint pattern. Response in the envelope `{ rows, page, total_pages, total, latency_ms }`.
Not a mutation — it does not touch incident state. See the conventions at the top of this file.
```

**Cross-link instead of duplicating:**
```md
> The `action_category` enum (provider_recovered, provider_escalated, …) is canonical in
> [`schema.prisma`](../../apps/api/prisma/schema.prisma) (historically [`02-data-model.md`](./02-data-model.md)).
> The validation rules on resolve are in [`01-backend-api-contract.md §D`](./01-backend-api-contract.md).
> Here we only reference them.
```

**Record the resolution of a pending decision (`decisions.md`):**
```md
### Audit log: where does it live? — RESOLVED 2026-06-12
Decision: append-only table in the same MySQL, partitioned by month, app role with
INSERT + SELECT only. Rationale: operational simplicity in v1; revisit if volume grows.
(Moved from 06-pending-decisions.md.)
```

## Quality Bar

- English; the handoff in `docs/` is historical and still Portuguese (tech-debt item 15).
- Document in the topic's canonical doc; in the others, cross-link (`docs/openapi.yaml`, 01–06 + decisions.md, `.context/docs/`).
- Real Atena examples: tools, endpoints, shapes from `@atena/types`, true enums. No generic "Users API".
- Honesty: mark direction vs. implemented. The code (`apps/`, `packages/`) is the source of truth for behavior.
- Keep `.context/docs/`, `docs/openapi.yaml` and `docs/design_handoff_atena/` in sync; update the doc in the same change as the content.
- Changed decisions update `decisions.md` with the rationale; resolved pending items leave `06-pending-decisions.md`.
- No PII in examples; masked/fictitious phone numbers.
- Cross-link new scaffolds in `.context/docs/README.md` and `.context/agents/README.md`.

## Resource Strategy

- The product documentation already has a home: `docs/openapi.yaml`, `docs/design_handoff_atena/` and `.context/docs/`. Do not create parallel docs.
- Add `references/` here only for a "where to document what" index if it grows large.
- `scripts/` (doc generators) become possible now that there is code to extract from (e.g. checking `docs/openapi.yaml` against `@atena/types`); today the docs are written by hand.
- Do not touch the code to document it — read it and cite it.
