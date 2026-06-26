---
type: skill
name: Feature Breakdown
description: Break down features into implementable tasks. Use when Planning new feature implementation, Breaking large tasks into smaller pieces, or Creating implementation roadmap
skillSlug: feature-breakdown
phases: [P]
generated: 2026-06-10
status: filled
scaffoldVersion: "2.0.0"
---
## Workflow

Contexto: o repo do Atena hoje é só DESIGN HANDOFF (specs + protótipo React em `docs/design_handoff_atena/`). NÃO existe código de produção. Toda quebra de feature parte do handoff e descreve trabalho a fazer — não há produção para "estender".

1. **Situe a feature na ordem de sprints** do `docs/design_handoff_atena/README.md` §7. Nada de Fase 2 antes da fundação:
   - **Sprint 0 — Fundação:** auth (login social institucional (OIDC, domínio restrito) — OIDC pelo provedor do email corporativo, restrito ao domínio `@example.com`) + RBAC (`support_analyst`/`support_lead`), schema MySQL + migrations (`02-data-model.md`), interceptor de audit log global.
   - **Sprint 1 — Fase 1 (self-service):** tools determinísticas, orquestrador LLM (chat/stream/tool routing + recusa), mascaramento de PII + reveal-com-audit, frontend do chat.
   - **Sprint 2 — Fase 2 (proativo):** detector de anomalias, WS gateway + push, ciclo de vida do incidente (ack/resolve server-side), telas de Regras/Relatórios/Audit/Observabilidade.
2. **Ligue tela → endpoint → shape → tool** usando `04-screen-to-endpoint-map.md`. Toda feature de UI deve nomear: o componente do protótipo, o(s) endpoint(s) REST/WS, o shape de resposta (§C de `01-backend-api-contract.md`) e a tool (se houver).
3. **Quebre em tarefas independentes** seguindo a fatia vertical natural do Atena: migration → endpoint/tool (backend) → tipo em `@atena/types` → UI (recriar do protótipo, não copiar JSX). Cada tarefa testável isoladamente.
4. **Aplique os 5 princípios como critério de aceite em cada tarefa relevante** (ver Quality Bar). Ex.: tarefa de tool sempre tem critério "escreve audit `tool_call`"; tarefa de PII sempre tem "mascarado por padrão + reveal gera audit".
5. **Marque o que depende de DECISÃO PENDENTE** (`06-pending-decisions.md` / `decisions.md`): PII no hot store vs só S3, thresholds default das regras, onde mora o audit log. Não invente a decisão — sinalize como bloqueio.
6. **Ordene por dependência:** Sprint 0 destrava tudo; tools dependem do schema; UI depende do shape do endpoint; ack/resolve dependem de incidents + WS.
7. **Critérios de aceite concretos** por tarefa: endpoint responde no shape exato do `data.jsx`, guard RBAC aplicado, validação server-side coberta.

## Examples

**Feature: Busca de mensagens (Sprint 1, Fase 1)**
```
## Feature: Busca de mensagens
Tela: tool-results.jsx SearchResults  →  GET /api/messages/search  →  shape §C.1  →  tool search_messages

### T1 — Migration messages + message_events (Sprint 0, pré-req)
- Tabelas conforme 02-data-model.md (snake_case): phone_e164 + phone_hash, content_ref (sem texto sensível).
- Aceite: migration sobe; índices idx_messages_phone / customer_time / status_time / provider_time criados.

### T2 — Endpoint GET /api/messages/search + tool search_messages
- Input { phone?, messageId?, dateRange, status?, provider?, customerId?, limit, page }.
- App roda a query (a IA NÃO toca o banco — princípio 1); guard RBAC; envelope { rows, page, totalPages, total, latencyMs }.
- Aceite: response bate com MOCK.searchResults[] (§C.1); cada invocação escreve audit action 'tool_call'.

### T3 — Tipo compartilhado em @atena/types
- SearchRow, SearchResponse derivados do shape §C.1 (camelCase API ↔ snake_case DB no ORM).
- Aceite: backend e frontend importam o mesmo tipo.

### T4 — UI SearchResults (recriar do protótipo c/ atena-design-system)
- phoneMasked por padrão; PhoneCell revela phoneFull só com permissão + reveal → audit 'reveal_phone' (princípio 5).
- Linha clicável → abre trilha (get_message_trail).
- Aceite: usa Table/Badge do design-system (NÃO copiar o JSX do protótipo); estado de erro = ToolError inline + "tentar de novo".

### Dependências: T2,T4 dependem de T1; T4 depende de T3; reveal depende do audit interceptor (Sprint 0).
### Bloqueio pendente: PII no hot store vs só S3 afeta como phoneFull/contentRef são servidos.
```

**Feature: Resolver incidente (Sprint 2, Fase 2)**
```
## Feature: Resolução de incidente
Tela: incidents.jsx ResolveModal → POST /api/incidents/{id}/resolve → validação §D
ATENÇÃO: resolve NÃO é tool do LLM (princípio 3) — só via UI + validação server-side.

### T1 — Endpoint resolve com validação server-side (§D)
- actionCategory ∈ enum (provider_recovered/provider_escalated/internal_escalated/false_positive/customer_communicated/monitoring_only/other).
- actionDescription ≥ 20 chars (≥ 10 no auto_resolved); se category ∈ {provider_escalated, internal_escalated} → escalatedTo obrigatório.
- Só transição acknowledged|detected|auto_resolved → resolved.
- Aceite: backend revalida tudo (UI desabilita, mas não é fonte de verdade); escreve incident_activity (status_change) + audit 'incident_resolve'; emite WS incident.updated.

### T2 — UI ResolveModal (design-system Dialog)
- Aceite: campos obrigatórios espelham §D; botão desabilitado até válido; erro server-side exibido.
```

## Quality Bar

- **5 princípios viram critério de aceite**, não comentário: (1) a app roda query/RBAC/dados, o LLM nunca toca o banco; (2) todo dado estruturado vem de tool, senão recusa explícita (`RefusalCard`); (3) ack/resolve/comment NÃO são tools — só UI + validação server-side; (4) toda tool call / reveal / mudança de incidente escreve audit log; (5) PII (telefone, conteúdo de SMS) mascarada por padrão, reveal gera audit.
- Toda feature de UI nomeia explicitamente tela (componente do protótipo) → endpoint → shape (§C) → tool. Sem esse mapeamento, a tarefa está incompleta.
- Nenhuma tarefa de Fase 2 entra antes da fundação (Sprint 0) estar pronta: sem schema não há tool; sem audit interceptor não há reveal; sem RBAC não há endpoint.
- Shapes de resposta são contrato: o critério de aceite cita o mock correspondente em `prototype/data.jsx` (ex.: §C.1 = `MOCK.searchResults[]`).
- camelCase na API ↔ snake_case no DB: mapeamento sempre no ORM, nunca vazando snake_case pra UI.
- Decisões pendentes ficam marcadas como bloqueio explícito — não escolha por conta própria política de PII no hot store, thresholds ou local do audit log.
- Recriar o protótipo ≠ copiar o JSX: tarefa de UI exige usar componentes reais do `atena-design-system`. PT-BR informal nas strings de usuário.

## Resource Strategy

- Não criar `scripts/`/`references/`/`assets/` para esta skill: a quebra de feature é um exercício de planejamento textual; os artefatos canônicos já vivem em `docs/design_handoff_atena/`.
- Se uma feature recorrer sempre aos mesmos shapes, referencie `01-backend-api-contract.md` §C e `02-data-model.md` por seção — não duplique o schema aqui (evita divergir do handoff).
- Saída esperada é a própria quebra de tarefas (Markdown), não arquivos no repo; mantenha tudo em `SKILL.md`.
