# 0002. snake_case at the API edge

- Status: accepted
- Date: 2026-06-15 (recorded 2026-11-01)

## Context

The design handoff specified camelCase JSON. The database is `snake_case` (Prisma `@map`), the
tools the LLM calls take arguments, and the LLM reads the tool results back as JSON.

## Options

1. camelCase everywhere at the API, as the handoff said.
2. **`snake_case` for every request and response** (query, body, JSON), camelCase inside the code,
   mapped at the edge (DTOs and the services that build responses).

## Decision

Option 2, recorded in [code-style.md](../code-style.md), "API (input and output)".

- One naming for everything the outside sees: the REST API, the tool arguments and results the LLM
  handles, the CSV exports and the database columns.
- The shapes live once, in `@atena/types`, consumed by both apps.

## Consequences

- Prisma results are camelCase and must be mapped before leaving a service; a missed mapping is a
  contract bug the typed `@atena/types` interfaces catch at compile time.
- The error envelope is `{ error: { code, message } }` and the page envelope is
  `{ rows, page, total_pages, total, latency_ms }`.
