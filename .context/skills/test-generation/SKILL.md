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

Contexto: hoje NÃO há código de produção nem runner de testes configurado no Atena — só o protótipo de referência (`docs/(protótipo original, não incluído)*.jsx`). Esta skill descreve como gerar testes QUANDO o código de produção existir; o runner provável é Jest (stack TS/NestJS). Não afirme que existem testes hoje.

1. **Identifique o que testar e situe pelos 5 princípios.** No Atena, os caminhos de maior valor de teste são os que protegem segurança e integridade: tools determinísticas, validação server-side do resolve, mascaramento de PII + audit, recusa do LLM, RBAC, WS/reconexão, shapes de contrato.
2. **Tools determinísticas:** dado um input fixo, a tool retorna o shape esperado (§C). Teste que a execução é server-side (a app roda a query, o LLM não toca o banco) e que cada invocação escreve audit `tool_call`. Compare o output com o mock correspondente em `prototype/data.jsx` (ex.: `search_messages` → `MOCK.searchResults[]` / §C.1).
3. **Validação server-side do resolve (§D)** — caso de teste mais denso, com tabela de casos:
   - `actionCategory` fora do enum → rejeita.
   - `actionDescription` < 20 chars → rejeita (< 10 no `auto_resolved` → rejeita).
   - category ∈ {provider_escalated, internal_escalated} sem `escalatedTo` → rejeita.
   - transição inválida (ex.: resolved → resolved) → rejeita; detected|acknowledged|auto_resolved → resolved → aceita.
   - sucesso escreve `incident_activity` (status_change) + audit `incident_resolve`.
4. **PII + audit:** telefone/conteúdo mascarados por padrão; reveal retorna o valor cheio E grava audit (`reveal_phone`/`reveal_content`); negar reveal sem permissão.
5. **Recusa do LLM:** pedido fora de escopo / que pediria dado fabricado → stream emite `refusal`, não `tool_call`; nenhum dado estruturado inventado.
6. **RBAC guards:** `support_analyst` recebe 403 em relatórios gerenciais / edição de regras / audit log; `support_lead` passa. Endpoint sem token → 401.
7. **WS `/ws/support`:** eventos `incident.created`/`incident.updated`/`incident.auto_resolved` no formato de `03-websocket-events.md`; handshake sem token válido é rejeitado; reconexão com backoff exponencial (cap 30s) e re-fetch `GET /api/incidents?status=detected,acknowledged` ao reconectar.
8. **Shapes de contrato:** snapshot/asserção de que cada response bate com `data.jsx`/§C (campos camelCase, ISO 8601).
9. **Estados de erro (`error-states.jsx`):** tool timeout → ToolError + retry; WS down → faixa persistente; 401 → overlay de re-login.
10. Mantenha cada teste determinístico e isolado (mock no boundary: Prisma, S3, Amazon Bedrock, clock).

## Examples

**Validação server-side do resolve (Jest, NestJS service) — tabela de casos:**
```typescript
describe('IncidentsService.resolve (validação §D)', () => {
  const base = { actionCategory: 'provider_recovered',
                 actionDescription: 'a'.repeat(20) }; // 20 chars OK

  it('rejeita actionDescription < 20 chars', async () => {
    await expect(svc.resolve('INC-2401', { ...base, actionDescription: 'curto' }))
      .rejects.toThrow(/20/);
  });

  it.each(['provider_escalated', 'internal_escalated'])(
    'exige escalatedTo quando category=%s', async (cat) => {
      await expect(svc.resolve('INC-2401', { ...base, actionCategory: cat }))
        .rejects.toThrow(/escalatedTo/);
  });

  it('só transiciona de detected|acknowledged|auto_resolved → resolved', async () => {
    db.incident('INC-9').status = 'resolved';
    await expect(svc.resolve('INC-9', base)).rejects.toThrow(/transi/);
  });

  it('no sucesso, escreve incident_activity (status_change) + audit incident_resolve', async () => {
    await svc.resolve('INC-2401', { ...base, actionCategory: 'provider_escalated',
                                    escalatedTo: 'Twilio #91234' });
    expect(activityRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ activityType: 'status_change' }));
    expect(auditRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'incident_resolve' }));
  });
});
```

**PII mascarada + audit no reveal:**
```typescript
it('search_messages retorna phoneMasked por padrão, sem audit de reveal', async () => {
  const res = await tools.searchMessages({ phone: '+5511987651234', dateRange });
  expect(res.rows[0].phoneMasked).toMatch(/9\*+/);
  expect(res.rows[0].phoneFull).toBeUndefined();
  expect(auditRepo.insert).toHaveBeenCalledWith(
    expect.objectContaining({ action: 'tool_call' }));        // tool gera tool_call
  expect(auditRepo.insert).not.toHaveBeenCalledWith(
    expect.objectContaining({ action: 'reveal_phone' }));     // reveal NÃO acontece sozinho
});

it('reveal de telefone retorna phoneFull e grava audit reveal_phone', async () => {
  const full = await svc.revealPhone('4f3a2b1c-1111', analystWithPermission);
  expect(full).toBe('+55 11 98765-1234');
  expect(auditRepo.insert).toHaveBeenCalledWith(
    expect.objectContaining({ action: 'reveal_phone', severity: 'pii' }));
});
```

## Quality Bar

- Não afirmar que há testes hoje; gerar testes só sobre código que exista. Runner provável Jest — ajuste ao que o projeto adotar.
- Tools testadas como determinísticas e server-side (LLM não toca o banco); output validado contra o mock em `prototype/data.jsx`/§C; cada tool call escreve audit `tool_call`.
- Resolve coberto por tabela de casos cobrindo §D inteiro: enum, ≥20/≥10 chars, escalated_to condicional, transições válidas/inválidas, escrita de incident_activity + audit.
- Mascaramento de PII testado nos dois sentidos: mascarado por padrão (sem reveal silencioso) e reveal grava audit (`reveal_phone`/`reveal_content`, severity `pii`).
- Recusa do LLM testada: fora de escopo emite `refusal`, nunca inventa dado estruturado.
- RBAC: 403 para `support_analyst` em rotas de lead; 401 sem token (REST e handshake WS).
- WS: formato de evento conforme `03-websocket-events.md`; rejeita handshake sem token; reconexão com backoff cap 30s + re-fetch de incidentes ativos.
- Determinismo e isolamento: mock no boundary (Prisma, S3, Amazon Bedrock, relógio); sem dependência de rede, tempo real ou ordem entre testes. Testar comportamento, não implementação; AAA; nomes descritivos.

## Resource Strategy

- Sem `scripts/`/`references/`/`assets/` próprios enquanto não houver runner/código: os shapes-fonte para asserção já vivem em `prototype/data.jsx` e §C de `01-backend-api-contract.md`.
- Quando o backend existir, fixtures de teste devem derivar de `@atena/types` (uma fonte de verdade) e dos mocks do protótipo — não duplicar shapes inline.
- Referencie §D do contrato e §5.3 de `02-data-model.md` para as regras do resolve em vez de recopiar enums nos testes.
