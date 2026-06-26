---
name: bug-investigation
description: Investigate bugs systematically and perform root cause analysis. Use when Investigating reported bugs, Diagnosing unexpected behavior, or Finding the root cause of issues
---

## Workflow

> ESTADO DO REPO: só existe o protótipo de design (`docs/(protótipo original, não incluído)*.jsx`) e as specs. Não há backend nem app de produção ainda. Investigações hoje recaem sobre comportamento esperado vs. contrato/shape, não sobre stack traces de produção. Reproduza com mocks (`prototype/data.jsx`), nunca com PII real.

1. Reproduza com mock. Use os shapes de `prototype/data.jsx` (mesma fonte do `01-backend-api-contract.md` §C). Se o bug é de UI, abra o protótipo; se é de contrato, compare a resposta esperada com o shape documentado.
2. Para um problema de entrega de SMS, siga a TRILHA: a tool `get_message_trail` (`GET /api/messages/{id}/trail`) devolve `events[]` na ordem `api_request → routing → provider_attempt → webhook_status → final`. O ponto onde a sequência quebra é a causa raiz (ex.: `provider_attempt` com `HTTP 402` → `INSUFFICIENT_BALANCE`).
3. Para bug de chat/stream, valide a sequência SSE: `tool_call → tool_result → text_delta → done`, ou `refusal` quando fora de escopo. Um stream que pula `tool_result` e mesmo assim emite `text_delta` com dados é violação do princípio "LLM não fabrica dados".
4. Para bug de tempo real, cheque os 3 estados de erro do protótipo (`prototype/error-states.jsx`): `ToolError` (tool falhou/timeout), `WebSocketStatusStrip` (WS desconectado/reconectando) e `SessionExpiredOverlay` (401, token rejeitado).
5. Forme a hipótese checando o shape: campo faltando, snake_case vazando como camelCase, data relativa vindo do backend em vez de ISO, `phoneFull`/`contentPreview` vindo sem reveal.
6. Verifique reconexão WS: ao reconectar, o cliente DEVE chamar `GET /api/incidents?status=detected,acknowledged` para repreencher estado — não confiar só no stream (eventos perdidos na queda).
7. Documente a causa raiz e o princípio violado. Proponha o fix mais simples que respeita os 5 princípios.
8. NUNCA logue PII (telefone em claro, conteúdo de SMS). Use `phoneMasked`/`phoneHash` em qualquer log ou nota de investigação.

## Examples

**Bug: chat mostra número de mensagens que a tool não retornou**
```
## Bug: resposta da IA cita "184 envios" mas o tool_result trouxe 6

### Reprodução (mock):
1. Sessão de chat, pergunta "status do telefone +55 11 98765-1234 nas últimas 4h"
2. Stream emite tool_call search_messages → tool_result com rows.length = 6
3. text_delta diz "Encontrei 184 envios…"

### Investigação:
- O 184 bate com relatedMessages do MOCK.incidents (INC-2401), não com search
- LLM cruzou contexto e fabricou número fora do tool_result

### Causa raiz:
Violação do Princípio 2 (LLM não fabrica dados). O número tem de vir do
envelope { total } do tool_result, não da memória do modelo.

### Fix:
Prompt/guardrail: toda contagem citada referencia o campo `total` do último
tool_result correspondente; senão, recusa explícita.
```

**Bug: WS não recupera incidentes após queda de rede**
```
## Bug: incidente criado durante WS offline some da lista

### Reprodução:
1. Conexão WS cai (WebSocketStatusStrip mostra "Desconectado")
2. Detector cria INC-2402 nesse intervalo (incident.created perdido)
3. WS reconecta; lista de incidentes não mostra INC-2402

### Causa raiz:
Cliente confiou só no stream. Eventos durante a queda foram perdidos
(03-websocket-events.md: "não confiar só no stream").

### Fix:
No reconnect, GET /api/incidents?status=detected,acknowledged e mesclar
estado antes de voltar a escutar o WS. Backoff exponencial 1s→2s→…cap 30s.
```

## Quality Bar

- Reproduza com mock antes de teorizar; `prototype/data.jsx` é a fonte de shapes.
- NUNCA logue PII. Telefone vai mascarado (`+55 11 9****-1234`) ou como `phone_hash`; conteúdo de SMS nunca em claro.
- Para entrega de SMS, ande pela trilha `message_events` na ordem canônica e localize o evento que quebra.
- Para chat, a sequência SSE válida é `tool_call → tool_result → text_delta → done` (ou `refusal`); dado em `text_delta` sem `tool_result` é red flag.
- Confirme contratos de shape: camelCase, ISO 8601 UTC, envelope paginado, `{ error: { code, message } }`.
- Cheque os 3 estados de erro do protótipo antes de declarar bug novo — pode ser estado já previsto.
- Reconexão WS deve repreencher via REST; eventos perdidos são esperados, perda de estado não.
- Escreva nota de causa raiz que nomeie qual dos 5 princípios foi violado, quando aplicável.

## Resource Strategy

- Use os arquivos do protótipo como laboratório: `error-states.jsx`, `chat.jsx`, `tool-results.jsx`, `data.jsx`.
- Adicione `references/` só se acumular um catálogo de erros de provider (ex.: mapa `INSUFFICIENT_BALANCE → HTTP 402`).
- Não crie `scripts/` de repro automatizada enquanto não houver código executável; hoje a repro é manual sobre o protótipo.
- Não crie arquivos de PII de exemplo; sempre dados mascarados/fictícios.
