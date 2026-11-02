# Architecture decision records

One file per decision that shaped the code and would be expensive to reverse. Each says what was
decided, what else was considered, and what it costs. A superseded record stays, marked as such.

The product and design decisions taken during the design handoff (layout, notification style,
scope of v1) are in [`docs/design_handoff_atena/decisions.md`](../../../docs/design_handoff_atena/decisions.md);
the records below cover the architecture.

| # | Decision | Status |
| --- | --- | --- |
| [0001](0001-delivery-data-from-s3-through-duckdb.md) | Delivery data is read on demand from the detailed report in S3 through embedded DuckDB, not stored in MySQL | Accepted |
| [0002](0002-snake-case-at-the-api-edge.md) | Every API request and response is `snake_case`; the code inside is camelCase | Accepted |
| [0003](0003-the-llm-only-chooses-tools.md) | The LLM only chooses tools; the API runs them, and incident state changes are not tools | Accepted |
