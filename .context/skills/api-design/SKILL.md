---
type: skill
name: Api Design
description: Design RESTful APIs following best practices. Use when Designing new API endpoints, Restructuring existing APIs, or Planning API versioning strategy
skillSlug: api-design
phases: [P, R]
generated: 2026-06-10
status: filled
scaffoldVersion: "2.0.0"
---
## Workflow

> ESTADO DO REPO: ainda não existe backend. Estas são as convenções de DIREÇÃO ditadas pelo handoff (`docs/design_handoff_atena/01-backend-api-contract.md`). Os response shapes são extraídos dos mocks do protótipo (`prototype/data.jsx`) e são o contrato que o backend NestJS deverá cumprir.

1. Identifique a tool por trás do endpoint. No Atena, quase todo endpoint REST espelha uma tool do LLM (`search_messages` ↔ `GET /api/messages/search`). Confirme se o que você está desenhando é Fase 1 (search/trail/analyze/report/list) ou Fase 2 (incidents) — ou um endpoint sem tool (ack/resolve/comment).
2. Modele o recurso em snake_case no MySQL (ver `02-data-model.md`) e exponha camelCase na API. O mapeamento snake↔camel é responsabilidade do ORM (Prisma), nunca do consumidor.
3. Escolha o método HTTP correto: `GET` para tools de leitura (search, trail, list), `POST` para tools que processam/agregam (`analyze`, `reports/delivery`) e para mutações de estado de incidente (`acknowledge`, `resolve`, `comment`).
4. Defina request e response batendo exatamente com o shape do `data.jsx`. Datas saem em ISO 8601 UTC; a UI formata o relativo ("há 12 min"). Toda lista usa o envelope paginado `{ rows, page, totalPages, total, latencyMs }`.
5. Padronize erro como `{ error: { code, message } }` — sempre, em todo endpoint, com status HTTP coerente (401 token rejeitado, 403 RBAC, 404, 422 validação).
6. Aplique os guards: Bearer token OIDC (login social institucional) em TODOS os endpoints (OIDC restrito ao domínio `@example.com`); guard de RBAC por papel (`support_analyst` vs `support_lead`); interceptor de audit nas ações sensíveis (`tool_call`, `reveal_phone`, `reveal_content`, `export_report`, `incident_*`, `rule_update`).
7. Para mutação de incidente, faça a validação dupla server-side (§D do contrato) — nunca confie na UI.
8. Para o chat, projete o stream SSE; para incidentes em tempo real, os eventos WS (`03-websocket-events.md`).

## Examples

**Endpoint de leitura espelhando tool (`search_messages`):**
```
GET /api/messages/search?phone=...&status=failed&provider=Twilio&customerId=...&dateRange=...&page=1&limit=20
Authorization: Bearer <token>

200 OK
{
  "rows": [
    {
      "id": "4f3a2b1c-1111",
      "phoneMasked": "+55 11 9****-1234",
      "status": "failed",
      "provider": "Twilio",
      "customer": "CreditBank",
      "requestedAt": "2026-05-28T14:02:18Z",
      "errorHint": "INSUFFICIENT_BALANCE"
    }
  ],
  "page": 1, "totalPages": 4, "total": 73, "latencyMs": 42
}
```
`phoneFull` e `contentPreview` NÃO vêm por padrão — só após reveal autorizado, que grava audit (`reveal_phone`/`reveal_content`).

**Mutação de estado com validação server-side (`POST /api/incidents/{id}/resolve` — §D):**
```
POST /api/incidents/INC-2401/resolve
{
  "actionCategory": "provider_escalated",
  "actionDescription": "Contatei a Twilio pelo canal comercial e abri ticket prioritário.",
  "escalatedTo": "Twilio Support — ticket #91234",
  "relatedMessageIds": ["4f3a2b1c-1111"],
  "tags": ["fornecedor-twilio"]
}
```
Validar no backend (não confiar na UI):
- `actionCategory` ∈ { provider_recovered, provider_escalated, internal_escalated, false_positive, customer_communicated, monitoring_only, other }
- `actionDescription` ≥ 20 chars (≥ 10 no fluxo `auto_resolved`)
- se `actionCategory ∈ { provider_escalated, internal_escalated }` → `escalatedTo` obrigatório
- só transita de `detected | acknowledged | auto_resolved` → `resolved`
- escreve `incident_activity` (status_change) + `audit_log` (incident_resolve)

**Erro de validação:**
```
422 Unprocessable Entity
{ "error": { "code": "ESCALATED_TO_REQUIRED", "message": "escalatedTo é obrigatório quando a categoria é provider_escalated" } }
```

**Stream do chat (`POST /api/chat/sessions/{id}/messages`):**
```
event: tool_call    data: { "name": "search_messages", "args": {...}, "status": "running" }
event: tool_result  data: { "name": "search_messages", "status": "success", "result": {...} }
event: text_delta   data: { "delta": "Encontrei 6 envios…" }
event: done         data: { "messageId": "...", "refusal": null }
```
Fora de escopo, em vez de `tool_call`:
```
event: refusal  data: { "reason": "fora_de_escopo", "explanation": "...", "canDo": [...] }
```

## Quality Bar

- camelCase na API, snake_case no DB — sempre. O mapeamento vive no ORM, não vaza para o cliente.
- Datas em ISO 8601 UTC na resposta; nunca mande string relativa do backend.
- Listas SEMPRE no envelope `{ rows, page, totalPages, total, latencyMs }`. Não invente `{ data, meta }`.
- Erro SEMPRE `{ error: { code, message } }`. `code` é estável e em SCREAMING_SNAKE; `message` é PT-BR para o humano.
- Bearer token OIDC (login social institucional) obrigatório em todo endpoint (OIDC restrito ao domínio `@example.com`); sem token → 401 (a UI mostra `SessionExpiredOverlay`).
- RBAC por endpoint via guard NestJS: relatórios gerenciais, editar regras e ver audit são `support_lead`.
- Cada tool da Fase 1/2 tem endpoint espelhado; `acknowledge`/`resolve`/`comment` NÃO são tools — só REST + UI.
- PII mascarada por padrão; `phoneFull`/`contentPreview` só com reveal + audit.
- Validação de mutação de incidente é dupla e server-side; a UI valida só para UX, o backend é a autoridade.
- LLM não fabrica dados: se não houver tool/dado, o stream emite `refusal`, não texto inventado.

## Resource Strategy

- Mantenha o contrato canônico em `docs/design_handoff_atena/01-backend-api-contract.md`; este SKILL aponta para lá, não duplica.
- Adicione `references/` aqui só se um catálogo de códigos de erro ou de enums crescer demais para o contrato.
- Não crie `scripts/` antes de existir backend; quando existir, um gerador de tipos a partir do contrato (alinhado com `@atena/types`) seria candidato.
- Não duplique shapes — eles vivem em `prototype/data.jsx`; cite o arquivo.
