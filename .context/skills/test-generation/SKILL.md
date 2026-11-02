---
type: skill
name: Test Generation
description: Generate comprehensive test cases for code. Use when Writing tests for new functionality, Adding tests for bug fixes (regression tests), or Improving test coverage for existing code
skillSlug: test-generation
phases: [E, V]
generated: 2026-06-10
status: filled
scaffoldVersion: "2.0.0"
---
## Workflow

Context: Atena's production code and test runners exist — **Jest** (+ ts-jest) in `apps/api` (`npm test`, `npm run test:e2e`), **Vitest** in `apps/web` (`npm test`) and **Playwright** for browser e2e (`apps/web/e2e/`, `npm run e2e`), all run by CI (`.github/workflows/ci.yml`). Specs already exist next to the code (`*.spec.ts`, `*.e2e.spec.ts`); follow their patterns. The original reference prototype is not included in the repo.

1. **Identify what to test and place it against the 5 principles.** In Atena, the highest-value test paths are those that protect security and integrity: deterministic tools, server-side validation of resolve, PII masking + audit, LLM refusal, RBAC, WS/reconnection, contract shapes.
2. **Deterministic tools:** given a fixed input, the tool returns the expected shape (`@atena/types`). Test that execution is server-side (the app runs the query, the LLM does not touch the database) and that each invocation writes audit `tool_call` (the handler carries `@Audit('tool_call', 'info')`). Compare the output with the matching type in `@atena/types` (e.g. `search_shippings` → `PaginatedEnvelopeInterface<SearchResultRowInterface>` / §C.1).
3. **Server-side validation of resolve (§D)** — the densest test case, with a table of cases:
   - `action_category` outside the enum → rejected (the DTO's `@IsIn`).
   - `action_description` < 20 chars → rejected (< 10 on `auto_resolved` → rejected).
   - category ∈ {provider_escalated, internal_escalated} without `escalated_to` → rejected.
   - invalid transition (e.g. resolved → resolved) → rejected; detected|acknowledged|auto_resolved → resolved → accepted.
   - success writes `incident_activity` (status_change) + audit `incident_resolve`.
4. **PII + audit:** phone/content masked by default; reveal returns the full value AND writes audit (`reveal_phone`/`reveal_content`); deny reveal without permission (`pii:reveal`).
5. **LLM refusal:** an out-of-scope request / one that would require fabricated data → the stream emits `refusal`, not `tool_call`; no made-up structured data. Use `FakeLlmProvider` or mock the Bedrock provider.
6. **RBAC guards:** a `viewer`/`support_analyst` gets 403 on `rules:edit`, `pii:reveal` and `ops:run` routes and only `admin` passes `users:manage`; `support_lead` passes the lead routes. An endpoint without a session → 401.
7. **WS `/ws/support`:** `incident.created`/`incident.updated`/`incident.auto_resolved` events in the format of `03-websocket-events.md` (`WsServerEvent`); a handshake without a valid session is rejected. The handoff's reconnection (exponential backoff capped at 30 s + re-fetch of `GET /api/incidents?status=detected,acknowledged` on reconnect) is not what the client does today (socket.io-client default reconnection + query invalidation on WS events) — test the real behavior and flag the gap.
8. **Contract shapes:** assert that each response matches `@atena/types` / `docs/openapi.yaml` (snake_case fields, ISO 8601).
9. **Error states:** tool timeout/failure → inline error + retry; WS down → persistent strip; 401 → back to the login.
10. Keep each test deterministic and isolated (mock at the boundary: Prisma, S3/DuckDB engine, Amazon Bedrock, clock).

## Examples

**Server-side validation of resolve (Jest, NestJS service) — table of cases** (`buildService` and `VALID_RESOLVE` as in `apps/api/src/incidents/incident-lifecycle.service.spec.ts`, which mocks Prisma, `AuditService`, `IncidentsService` and `SupportGateway`):
```typescript
describe('IncidentLifecycleService.resolve (validation §D)', () => {
  it('rejects action_description < 20 chars', async () => {
    const { service } = buildService({
      id: 'INC-2401',
      status: 'detected',
    });

    await expect(service.resolve(
      'INC-2401',
      {
        action_category: 'other',
        action_description: 'short',
      },
      'analyst-1',
    )).rejects.toBeInstanceOf(AppException);
  });

  it.each([
    'provider_escalated',
    'internal_escalated',
  ] as const)('requires escalated_to when category=%s', async (category) => {
    const { service } = buildService({
      id: 'INC-2401',
      status: 'detected',
    });

    await expect(service.resolve(
      'INC-2401',
      {
        action_category: category,
        action_description: 'Opened a ticket with the provider and followed up.',
      },
      'analyst-1',
    )).rejects.toBeInstanceOf(AppException);
  });

  it('only transitions from detected|acknowledged|auto_resolved → resolved', async () => {
    const {
      service,
      prisma,
    } = buildService({
      id: 'INC-9',
      status: 'resolved',
    });

    await expect(service.resolve(
      'INC-9',
      VALID_RESOLVE,
      'analyst-1',
    )).rejects.toBeInstanceOf(AppException);

    expect(prisma.incident.update).not.toHaveBeenCalled();
  });

  it('on success, writes incident_activity (status_change) + audit incident_resolve', async () => {
    const {
      service,
      prisma,
      audit,
    } = buildService({
      id: 'INC-2401',
      status: 'acknowledged',
    });

    await service.resolve(
      'INC-2401',
      {
        action_category: 'provider_escalated',
        action_description: 'Escalated to the provider through the priority channel.',
        escalated_to: 'ProviderA #91234',
      },
      'analyst-1',
    );

    expect(prisma.incidentActivity.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ activityType: 'status_change' }),
    }));

    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'incident_resolve' }));
  });
});
```

**Masked PII + audit on reveal:**
```typescript
it('search returns phone_masked by default, never phone_full', async () => {
  const service = new ShippingsService(auditQueryReturning([
    shippingRecord({ phoneE164: '+5511987651234' }),
  ]));

  const result = await service.search({ phone: '+5511987651234' });

  expect(result.rows[0].phone_masked).toContain('****');
  expect(result.rows[0].phone_full).toBeUndefined();
});

it('the search handler is audited as tool_call and the reveal handler as reveal_phone (pii)', () => {
  const reflector = new Reflector();

  expect(reflector.get(AUDIT_KEY, ShippingsController.prototype.search)).toEqual({
    action: 'tool_call',
    severity: 'info',
  });

  expect(reflector.get(AUDIT_KEY, ShippingsController.prototype.revealPhone)).toEqual({
    action: 'reveal_phone',
    severity: 'pii',
  });
});

it('the phone reveal returns phone_full', async () => {
  const service = new RevealService(
    auditQueryWithShipping({ phoneE164: '+5511987651234' }),
    cacheStub,
  );

  await expect(service.revealPhone('4f3a2b1c-1111')).resolves.toEqual({
    shipping_id: '4f3a2b1c-1111',
    phone_full: '+5511987651234',
  });
});
```
(`auditQueryReturning`, `shippingRecord`, `auditQueryWithShipping` and `cacheStub` stand for the small stub helpers the existing specs build over `AuditQueryServiceInterface`; see `shippings.service.spec.ts` and `reveal.service.spec.ts`.)

## Quality Bar

- Generate tests only over code that exists, with the runner of the target app (Jest in `apps/api`, Vitest in `apps/web`, Playwright for browser e2e), following the existing specs.
- Tools tested as deterministic and server-side (the LLM does not touch the database); output validated against `@atena/types` / `docs/openapi.yaml`; each tool call writes audit `tool_call`.
- Resolve covered by a table of cases spanning all of §D: enum, ≥20/≥10 chars, conditional escalated_to, valid/invalid transitions, writing incident_activity + audit.
- PII masking tested both ways: masked by default (no silent reveal) and the reveal writes audit (`reveal_phone`/`reveal_content`, severity `pii`).
- LLM refusal tested: out of scope emits `refusal`, never made-up structured data.
- RBAC: 403 for roles lacking the permission (per `permissions.ts`); 401 without a session (REST and WS handshake).
- WS: event format per `03-websocket-events.md`; rejects a handshake without a session; reconnection tested as implemented, with the gap against the handoff (30 s cap + re-fetch of active incidents) flagged.
- Determinism and isolation: mock at the boundary (Prisma, S3/DuckDB engine, Amazon Bedrock, clock); no dependency on network, real time or order between tests. Test behavior, not implementation; AAA; descriptive names.

## Resource Strategy

- No `scripts/`/`references/`/`assets/` of its own: the source shapes for assertions live in `@atena/types` and `docs/openapi.yaml` (historically §C of `01-backend-api-contract.md`).
- Test fixtures derive from `@atena/types` (single source of truth) and from the existing specs' helpers — do not duplicate shapes inline.
- Reference §D of the contract and `apps/api/prisma/schema.prisma` (historically §5.3 of `02-data-model.md`) for the resolve rules instead of re-copying enums into the tests.
