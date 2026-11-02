# 0001. Delivery data from S3 through DuckDB

- Status: accepted
- Date: 2026-06-18 (recorded 2026-11-01)

## Context

Every tool that answers "what happened to this shipping" needs the delivery events: per recipient,
from `queued` to the final status. Those events already exist, durably, as the **detailed report**
in S3 (`s3://example-sms-delivery-reports`), written by the messaging platform.

## Options

1. **Ingest into MySQL** (a hot store of `messages`/`message_events`) and query it with Prisma.
2. **Query S3 on demand** with an embedded engine (DuckDB, `httpfs`), caching the partitions a query
   reads as Parquet in `/tmp`.
3. A managed query service over S3 (Athena) behind the API.

## Decision

Option 2 — `DuckDbAuditQueryService` behind the `AUDIT_QUERY` token. The hot store of option 1
existed and was dropped (migration `20260618000000_drop_delivery_hot_store`).

- No ingestion pipeline to run and keep consistent; S3 stays the single source of truth.
- MySQL keeps only application data (incidents, rules, chat, users, audit log).
- Athena adds latency per query and cost per scan without a cache we control.

## Consequences

- The first query over a window is cold (it reads S3); repeated ones are served from the `/tmp`
  cache, evicted by age and size (`ATENA_AUDIT_CACHE_MAX_MB`, `_MAX_AGE_HOURS`). See
  [tech-debt.md](../tech-debt.md) items 5 and 7.
- Every query is windowed by send time with a symmetric scan buffer for late statuses, and clipped
  to `ATENA_AUDIT_MIN_QUERY_DATE`; the engine runs in UTC and converts only at the edges.
- Tests run DuckDB in-process over local fixture directories (`ATENA_AUDIT_SOURCE_ROOT`).
