# 0003. The LLM only chooses tools

- Status: accepted
- Date: 2026-06-12 (recorded 2026-11-01)

## Context

The assistant answers questions about shippings, incidents and reports for a support team. Its
answers drive decisions about customers, and the data includes PII.

## Options

1. Let the model query data directly (generated SQL, or broad data access).
2. **The model picks from a fixed catalog of read-only tools**; the API validates the arguments,
   runs the tool, masks PII and audits the call; with no applicable tool, the model returns a
   structured refusal.

## Decision

Option 2, the first of the non-negotiable principles in
[development-conventions.md](../development-conventions.md).

- Every fact in an answer comes from a tool result the API produced and audited.
- PII leaves the API only through the audited reveal endpoints, never through the model.
- Incident state changes (`acknowledge`, `resolve`) are deliberately **not** tools: they are REST
  endpoints with server-side validation, used from the UI.

## Consequences

- A question outside the catalog gets a refusal (`fora_do_escopo`) instead of a best guess; new
  capabilities mean new tools, each with its REST mirror and tests.
- The orchestrator (`chat/orchestrator.service.ts`) is provider-agnostic behind
  `LlmProviderInterface`; `FakeLlmProvider` makes it testable without Bedrock.
