# 01 — Contrato de API

Endpoints REST + WebSocket e o catálogo de tools. Os **response shapes** abaixo são extraídos dos mocks do protótipo (`prototype/data.jsx`) — eles são o contrato que o backend deve cumprir.

> Convenções: JSON, `camelCase` nos campos da API (o protótipo usa camelCase; o schema Postgres usa snake_case — mapeie no ORM). Datas em ISO 8601 UTC. Autenticação via Bearer token (SSO) em todos os endpoints. Toda resposta de erro segue `{ error: { code, message } }`.

---

## A. Chat & sessões

```
POST   /api/chat/sessions                    → cria sessão, retorna { sessionId }
GET    /api/chat/sessions                     → lista sessões do usuário (histórico)
GET    /api/chat/sessions/{id}/messages       → histórico de mensagens da sessão
POST   /api/chat/sessions/{id}/messages       → envia mensagem do usuário (SSE/stream de resposta)
```

### POST `/api/chat/sessions/{id}/messages`
Request:
```json
{ "text": "status do telefone +55 11 98765-1234 nas últimas 4h" }
```
Resposta: **stream** (Server-Sent Events ou chunked). Sequência de eventos:
```
event: tool_call     data: { "name": "search_messages", "args": {...}, "status": "running" }
event: tool_result   data: { "name": "search_messages", "status": "success", "result": {...} }  // shape em §C
event: text_delta    data: { "delta": "Encontrei 6 envios…" }   // streaming token a token
event: done          data: { "messageId": "...", "refusal": null }
```
Se o pedido for fora de escopo, em vez de `tool_call` o stream emite:
```
event: refusal  data: { "reason": "fora_de_escopo", "explanation": "...", "canDo": [...] }
```

### Histórico de sessão (item da lista — shape do protótipo `MOCK.history[]`)
```json
{
  "id": "sess-2026-05-28-002",
  "title": "Investigação INC-2401 — Twilio insufficient balance",
  "startedAt": "Hoje, 14:02",
  "messageCount": 12,
  "toolCount": 4,
  "pinned": true,
  "tags": ["inc-2401", "twilio", "creditbank"],
  "preview": "Você: Tenho um cliente reclamando…",
  "duration": "8 min",
  "hasIncident": true
}
```

---

## B. Catálogo de tools

O LLM só pode invocar estas tools. Cada tool tem um endpoint REST espelhado (usado pela tool e diretamente pela UI quando aplicável).

### Fase 1
| Tool | Endpoint | Input | Output |
|---|---|---|---|
| `search_messages` | `GET /api/messages/search` | `{ phone?, messageId?, dateRange, status?, provider?, customerId?, limit, page }` | lista paginada (§C.1) |
| `get_message_trail` | `GET /api/messages/{id}/trail` | `{ messageId }` | mensagem + eventos (§C.2) |
| `analyze_message_content` | `POST /api/messages/analyze` | `{ text? } \| { messageId? }` | score + categorias (§C.3) |
| `generate_delivery_report` | `POST /api/reports/delivery` | `{ dateRange, groupBy[], filters? }` | agregado (§C.4) |
| `list_providers` | `GET /api/providers` | `{}` | `string[]` |
| `list_customers` | `GET /api/customers` | `{ search? }` | `[{ id, name }]` |

### Fase 2
| Tool | Endpoint | Input | Output |
|---|---|---|---|
| `list_incidents` | `GET /api/incidents` | `{ status?, severity?, dateRange?, dimension?, limit, page }` | lista paginada (§C.5) |
| `get_incident` | `GET /api/incidents/{id}` | `{ incidentId }` | incidente + atividades |
| `generate_incident_report` | `POST /api/reports/incidents` | `{ dateRange, filters? }` | métricas + lista (§C.6) |

> ⚠️ `acknowledge_incident` e `resolve_incident` **NÃO são tools do LLM.** Só via UI:
> ```
> POST /api/incidents/{id}/acknowledge
> POST /api/incidents/{id}/resolve        # valida campos obrigatórios server-side
> POST /api/incidents/{id}/comment
> ```

---

## C. Response shapes (do protótipo)

### C.1 `search_messages` → linha de resultado (`MOCK.searchResults[]`)
```json
{
  "id": "4f3a2b1c-1111",
  "phoneMasked": "+55 11 9****-1234",
  "phoneFull": "+55 11 98765-1234",     // só retornar se o usuário tiver permissão + reveal (gera audit)
  "status": "failed",                    // delivered | failed | pending | unknown
  "provider": "Twilio",
  "customer": "CreditBank",
  "requestedAt": "há 12 min",            // backend pode mandar ISO; UI formata relativo
  "errorHint": "INSUFFICIENT_BALANCE"    // null se sem erro
}
```
Envelope paginado: `{ rows: [...], page, totalPages, total, latencyMs }`.

### C.2 `get_message_trail` (`MOCK.trail`)
```json
{
  "messageId": "4f3a2b1c-1111",
  "customer": "CreditBank",
  "provider": "Twilio",
  "phoneMasked": "+55 11 9****-1234",
  "finalStatus": "failed",
  "contentRef": "s3://at-msg-content/2026/05/28/4f3a2b1c-1111.txt",
  "contentPreview": "…",                 // só após reveal (audit). Mascarado por padrão.
  "events": [
    { "type": "api_request",      "label": "Requisição API recebida", "at": "14:02:18.421", "detail": "POST /v2/messages — 320 B — auth OK" },
    { "type": "routing",          "label": "Roteamento → Twilio",      "at": "14:02:18.498", "detail": "..." },
    { "type": "provider_attempt", "label": "Tentativa 1 — Twilio",     "at": "14:02:18.612", "detail": "HTTP 402 ..." },
    { "type": "webhook_status",   "label": "Webhook status: failed",   "at": "14:02:24.107", "detail": "..." },
    { "type": "final",            "label": "Status final: failed",     "at": "14:02:24.198", "detail": "..." }
  ]
}
```
`event.type` ∈ `api_request | routing | provider_attempt | webhook_status | final`.

### C.3 `analyze_message_content` (`MOCK.risk`)
```json
{
  "score": 0.72,
  "verdict": "medium",                   // low | medium | high
  "categories": [
    { "name": "Urgência financeira", "strength": 0.81 },
    { "name": "Link encurtado",      "strength": 0.68 }
  ],
  "explanation": "…texto contextualizado do serviço de risco…"
}
```

### C.4 `generate_delivery_report` (`MOCK.report`)
```json
{
  "window": "Últimas 24h",
  "totals": { "sent": 184320, "delivered": 173812, "failed": 9214, "pending": 1294 },
  "byProvider": [ { "name": "Twilio", "sent": 92340, "delivered": 84120, "rate": 91.1 } ],
  "hourly": [97.4, 97.6, ...],           // taxa de entrega % por hora (24 buckets)
  "topErrors": [ { "code": "INSUFFICIENT_BALANCE", "count": 4812, "provider": "Twilio" } ],
  "csvUrl": "/api/reports/{id}/export.csv"
}
```

### C.5 `list_incidents` → incidente (`MOCK.incidents[]`)
```json
{
  "id": "INC-2401",
  "rule": "Queda de taxa de entrega — Twilio",
  "severity": "critical",                // info | warning | critical
  "status": "detected",                  // detected | acknowledged | resolved | auto_resolved
  "dimensionType": "provider",           // provider | customer | route | global
  "dimensionValue": "Twilio",
  "detectedAt": "há 4 min",
  "window": "14:02 → agora (4 min)",
  "summary": "Taxa de entrega caiu de 97% para 87%…",
  "metrics": { "baseline": "97.0%", "current": "87.1%", "threshold": "< 95%", "sample": "2.4k tentativas" },
  "relatedMessages": 184,
  "assignee": null
}
```

### C.6 `generate_incident_report` / incidente resolvido (`MOCK.resolvedIncidents[]`)
```json
{
  "id": "INC-2395",
  "severity": "warning",
  "rule": "Spike de falhas — CreditBank",
  "resolvedAt": "há 4h",
  "action": "provider_escalated",        // ver enum action_category em 02-data-model
  "analyst": "Joana M.",
  "duration": "38m",
  "escalatedTo": "Twilio (suporte) — ticket #91188"
}
```

---

## D. POST `/api/incidents/{id}/resolve` — payload + validação

Request:
```json
{
  "actionCategory": "provider_escalated",
  "actionDescription": "Contatei a Twilio pelo canal comercial…",   // mín. 20 chars
  "escalatedTo": "Twilio Support — ticket #91234",                   // obrigatório se category é *_escalated
  "relatedMessageIds": ["4f3a2b1c-1111", "7c8d9e0f-2222"],
  "tags": ["fornecedor-twilio", "cliente-creditbank"]
}
```
**Validação server-side (não confiar na UI):**
- `actionCategory` ∈ enum (ver `02-data-model.md`).
- `actionDescription` ≥ 20 chars (≥ 10 chars no fluxo `auto_resolved`).
- Se `actionCategory ∈ { provider_escalated, internal_escalated }` → `escalatedTo` obrigatório.
- Só permite transição de `acknowledged`/`detected`/`auto_resolved` → `resolved`.
- Toda mudança escreve em `incident_activity` (status_change) + audit log.

---

## E. Observabilidade (página admin — `MOCK.observability`)
`GET /api/observability` → métricas do próprio assistente: sessões, tokens, custo, MTTA, latência por tool (p50/p95/p99), erros por tool, consumo de tokens por hora, status do WebSocket, contagem de recusas por motivo. Alimentar de métricas reais (OpenTelemetry / Prometheus).
