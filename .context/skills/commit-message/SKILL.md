---
type: skill
name: Commit Message
description: Generate commit messages that follow conventional commits and repository scope conventions. Use when Creating git commits after code changes, Writing commit messages for staged changes, or Following conventional commit format for the project
skillSlug: commit-message
phases: [E, C]
generated: 2026-06-10
status: filled
scaffoldVersion: "2.0.0"
---
## Workflow

> CONVENTION (AGENTS.md, `.context/docs/code-style.md`): Conventional Commits, e.g. `feat(scaffolding): add doc links`. Subject and body are in English (`development-conventions.md`, "Language"), imperative, lower case; commitlint checks the format in the `commit-msg` hook and in CI. The repo holds the implemented app (`apps/api`, `apps/web`, `packages/types`), so the scopes are the per-module ones listed in `code-style.md` (the delivery entity is `shipping`, not `message`). The type decides the version: `feat` → minor; `fix`/`perf`/`refactor` → patch; `!` or `BREAKING CHANGE:` → major.

1. Review what is staged (`git diff --staged`) and isolate one logical change per commit.
2. Choose the type: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `style`, `perf`.
3. Choose the Atena scope according to the area touched (list from `code-style.md`):
   - `api`, `llm`, `chat`, `shippings`, `catalog`, `incidents`, `detector`, `rules`, `auth`, `audit`, `admin`, `observability`, `db`
   - `make`, `context`, `deps` (Makefile, `.context/` knowledge base, dependencies)
4. Write the subject in English, imperative, lower case, ≤ 72 chars, no trailing period ("add", not "added"/"adding").
5. Use the body for the why, not the what (the diff shows the what) — especially when the change touches one of the 5 principles or the API contract.
6. Reference an incident/decision when it makes sense (e.g. "ref decisions.md", "RF-2.4").
7. Close with the co-authorship trailer required by the harness.

## Examples

**Tool/endpoint feature:**
```
feat(shippings): add search_shippings with paginated envelope

Mirrors GET /api/shippings/search in docs/openapi.yaml.
phone_full only under an authorized reveal; response masked by default.

Co-Authored-By: Nova Pro <noreply@anthropic.com>
```

**Fix respecting a principle (the LLM does not fabricate data):**
```
fix(chat): block counts cited without a matching tool_result

The AI cited a total outside the returned envelope. Now every count
references the `total` field of the latest tool_result; otherwise, refusal.

Co-Authored-By: Nova Pro <noreply@anthropic.com>
```

**Server-side incident validation:**
```
feat(incidents): validate resolve in the backend (category, description, escalation)

action_description >= 20 chars; escalated_to required on *_escalated;
transition only from detected/acknowledged/auto_resolved -> resolved.
Writes incident_activity + audit_log. Ref 01-backend-api-contract §D.

Co-Authored-By: Nova Pro <noreply@anthropic.com>
```

**Real time and audit:**
```
fix(incidents): refill incidents via REST on WS reconnect

Exponential backoff capped at 30s; GET /api/incidents?status=detected,acknowledged
on reconnect so events lost during the drop are not missed.

Co-Authored-By: Nova Pro <noreply@anthropic.com>
```

**Knowledge base (`.context/`):**
```
docs(context): record the persistent-banner decision for incidents

Co-Authored-By: Nova Pro <noreply@anthropic.com>
```

## Quality Bar

- Conventional Commits always: `type(scope): subject`.
- Subject in English, imperative, lower case, ≤ 72 chars, no trailing period.
- Scope from the Atena list (`api|llm|chat|shippings|catalog|incidents|detector|rules|auth|audit|admin|observability|db|make|context|deps`); do not invent a loose scope.
- One logical change per commit.
- The body explains the why; cite the principle, RF/RNF or handoff doc when relevant.
- NEVER include PII (real phone, SMS content) in the message.
- End with the trailer `Co-Authored-By: Nova Pro <noreply@anthropic.com>`.
- Breaking change in the API contract → use `feat!`/`fix!` or a `BREAKING CHANGE:` footer.

## Resource Strategy

- The scope list is canonical in `.context/docs/code-style.md`; keep this file in sync with it (or move it to `references/scopes.md` and point there if it grows).
- Do not create commit `scripts/` (commitlint hooks) unless the team adopts them; they are a candidate now that the toolchain exists.
- Do not duplicate the conventions of AGENTS.md and `code-style.md`; cite them.
