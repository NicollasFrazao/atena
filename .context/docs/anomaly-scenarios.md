---
type: doc
name: anomaly-scenarios
description: Top-3 prioritized anomaly scenarios + default anomaly_rules thresholds, derived from the analysis of production logs
category: analysis
generated: 2026-06-12
status: filled
---

# Anomaly scenarios (Phase 2) — analysis of production logs

> Resolves pending decision #4 ([decisions.md](../../docs/design_handoff_atena/decisions.md)). Defines the **top-3 scenarios** and the **default thresholds** of the `anomaly_rules` ([02-data-model.md](../../docs/design_handoff_atena/02-data-model.md)), based on real logs.
>
> **Note (the data source has moved):** this analysis was done over the **general logs** in `s3://at-api-logs-prod` (an approach now **abandoned**). Production auditing now consumes the SMS **detailed report** in `s3://example-sms-delivery-reports` (via DuckDB), which is per-recipient and has normalized status — so caveat #1 (event ≠ message) no longer applies to the current engine. The **prioritized scenarios and the default thresholds below remain valid** (they were seeded as the rules' defaults and the 4 detectors are implemented); read the numbers as the **historical study** that calibrated them.

## Methodology
- **Source:** `at-api-logs-prod` (gzipped JSON Lines via firehose; schema = `LogInterface`: `timestamp`, `level`, `service`, `message`, `context.payload` with `status`, and `status_code`/`response_time`/`error`).
- **Sample:** last 150 objects → **761,630 records**, window **2026-06-12T22:51 → 2026-06-13T00:45 UTC** (~2h, late night).
- Status classification: success (`delivered`); terminal failure (`undelivered`, `failed`, `invalid_number`, `policy_block`, `expired`, `unreachable`, `generic_error`); in transit (`queued`, `dispatched`, `sent`).

### Caveats (read before locking in thresholds)
1. **Event ≠ message.** I counted status *events*, not unique messages. Each message emits several events (queued→dispatched→sent→delivered/undelivered). The real **per-message** rate requires deduplicating by identifier (`internal_identifier`/`hash`/`correlation_id`) and taking the **final status**. The percentages below are an event-level proxy.
2. **`delivered` is under-reported.** Many carriers/campaigns do not return a DLR; the real success stays as `sent` (38,544 in the sample). Agreeing with the team on whether `sent` counts as success changes the rate drastically.
3. **Short, nighttime window.** Baselines need to be **time-of-day aware** and calibrated over 7–30 days. The numbers below are a starting point.

## Findings
- **Services:** `process-messages-sms` 411,745 · `status-webhook-receiver` 291,231 · `webhook-dispatcher` 57,098 · voice 1,350.
- **Levels:** info 734,238 · warn 27,368 · **error 24** → anomalies do **not** come from the log level; they come from the delivery status distribution.
- **Delivery rate (proxy) per customer:**

  | Customer | Terminal events | Delivery | Top failures |
  |---|---:|---:|---|
  | `1001` (betting) | 178,723 | **4.6%** | undelivered 66k, invalid_number 35k, failed 33k, **policy_block 31k** |
  | `?` (callbacks without user_id) | 111,527 | 7.8% | undelivered 67k, failed 34k |
  | `1002` | 4,423 | **63.0%** | invalid_number, undelivered |
  | `8349` | 2,362 | **68.0%** | undelivered, invalid_number |
  | `8200` | 306 | **0.0%** | **generic_error 153**, failed 153 |
  | `7746` | 67 | 0.0% | invalid_number 56 |

- **Volatility:** delivery swings from **1.1%** (blasts of 80k–105k events) to **64%** across 10-min windows — the peaks coincide with mass campaigns from `1001`.
- **SMS provider:** only **Provider C** appears (115k `[ProviderSmsStatus]` tags). Voice uses Provider E. → the `provider` dimension is weak for SMS today; prioritize `customer` and `global`.
- **Dominant warn:** "Phone number … is marked as bounced and cannot receive messages" (27,192).

## Top-3 prioritized scenarios

### 1. Delivery rate drop per customer — `delivery_rate_drop`, dim. `customer` (critical)
The most actionable signal: delivery varies from 4.6% to 68% **per customer** and each one has its own baseline. A **global** alarm would be noisy (dominated by `1001`). Detect when a customer's rate falls below its own baseline, with a **volume guard** (e.g. ≥ 500 terminal events in the window) so it does not fire for tiny customers.

### 2. Spike in one failure category — `consistent_error` / `failure_spike`, dim. `customer` (warning→critical)
The failures are distinct and diagnostic:
- rising `policy_block` → content blocked by policy/carrier (typical of betting).
- rising `invalid_number` → old/dirty contact list.
- sustained `generic_error` → **broken integration** (e.g. `8200` at 100% generic_error and 0% delivery).

### 3. Status callback silence — `webhook_silence`, dim. `provider`/`global` (critical)
`status-webhook-receiver` processes a high, steady flow (~291k/2h). If the callbacks (Provider C) **stop** for X min, we go blind on delivery (provider down / our receiver down). Related per-customer case: "No webhook URL configured for the given app ID" (153) = the customer does not receive its own callbacks.

## Proposed default thresholds (`anomaly_rules`)

The `name` values are the rule names shown in the product UI, kept verbatim in Portuguese (English meaning in parentheses).

| rule_id | name | rule_type | dimension | severity | threshold | unit | window_min |
|---|---|---|---|---|---:|---|---:|
| `r-delivery-drop-customer` | Queda de entrega por cliente (Delivery drop per customer) | `delivery_rate_drop` | `customer` | `critical` | 3 | `σ` | 15 |
| `r-policy-block-spike` | Spike de bloqueio por política (Policy block spike) | `consistent_error` | `customer` | `warning` | 30 | `%` | 15 |
| `r-invalid-number-spike` | Spike de número inválido (Invalid number spike) | `consistent_error` | `customer` | `warning` | 25 | `%` | 30 |
| `r-integration-error` | Erro de integração (generic_error) (Integration error) | `failure_spike` | `customer` | `critical` | 5 | `%` | 10 |
| `r-webhook-silence-provider` | Silêncio de callbacks (Provider C) (Callback silence) | `webhook_silence` | `provider` | `critical` | 15 | `min` | 15 |

**Calibration notes**
- `delivery_rate_drop`: use **σ vs a rolling per-customer baseline** (not an absolute floor — baselines range from 4.6% to 68%). Alternative: relative drop ≥ 20 p.p. Minimum volume guard ≥ 500 terminal events.
- `consistent_error`: threshold = % of the customer's terminal volume in that category, within the window.
  **Implemented** (2026-06) as the **dominant category** — the rule fires on the largest
  `error_hint` category that crosses the threshold, with no target-category column (decision D1 of the plan
  `detectores-consistent-error-webhook-silence`). `webhook_silence`: `threshold` in **minutes** = maximum
  gap without a status (`finalized_at`) despite sends in the window, dim. `provider`.
- `r-integration-error`: `generic_error` is rare overall, but 100% for broken customers → low threshold + critical severity.
- The minimum volume guard and the time-of-day baseline have **no** column in the current `anomaly_rules` table → treat them as detector parameters or extend the schema (item for the backend).

## Next steps
- Validate the **definition of success** (`delivered` vs `delivered+sent`) with product/support — it changes every threshold.
- Recompute baselines over 7–30 days with per-message deduplication (final status), not per event.
- Seed these rows as the defaults of the Rules screen ([04](../../docs/design_handoff_atena/04-screen-to-endpoint-map.md)).
