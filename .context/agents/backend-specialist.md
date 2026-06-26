---
type: agent
name: Backend Specialist
description: Design and implement server-side architecture
agentType: backend-specialist
phases: [P, E]
generated: 2026-06-10
status: filled
scaffoldVersion: "2.0.0"
---

## Mission

Você implementa o backend do Atena — o assistente de IA da Acme para dados de envio de SMS. **Estado do repo:** o projeto está IMPLEMENTADO e mergeado (MVP) — monorepo npm com `apps/api` (NestJS 11 + Prisma/MySQL), `apps/web` (React 18 + Vite) e `packages/types` (`@atena/types`). Stack do backend: TypeScript + NestJS (módulos + DI, WS gateway, guards de auth/RBAC, interceptor de audit), Prisma/MySQL para o estado do app, dados de entrega no S3 via DuckDB, e Amazon Bedrock (modelo Nova Pro — `us.amazon.nova-pro-v1:0` — via Converse API, streaming + tool use) para o orquestrador. O design handoff (`docs/design_handoff_atena/`) segue como referência de contrato/visual.

Engaje este agente para: criar/evoluir módulos/serviços NestJS, manter as tools determinísticas, evoluir o orquestrador LLM (sessão, streaming SSE, roteamento de tool, recusa), expor endpoints REST + o WS gateway, modelar com Prisma, manter o mascaramento de PII e a validação server-side do resolve. Referências principais: `01-backend-api-contract.md`, `02-data-model.md`, `03-websocket-events.md`.

Os 5 princípios moldam cada linha: (1) a aplicação executa query/RBAC/dados — o **LLM nunca toca o banco**; (2) o LLM **não fabrica dados** — sem resultado de tool, recusa explícita; (3) ack/resolve/comment **não são tools**, só REST + validação server-side; (4) tudo passa pelo interceptor de audit; (5) PII mascarada por padrão, reveal gera audit.

## Responsibilities

- Implementar as **tools determinísticas** como serviços NestJS, cada uma com seu endpoint REST espelhado:
  - Fase 1: `search_shippings` (`GET /api/shippings/search`), `get_shipping_trail` (`GET /api/shippings/{id}/trail`), `analyze_shipping_content` (`POST /api/shippings/analyze`), `generate_delivery_report` (`POST /api/reports/delivery`), `list_providers` (`GET /api/providers`), `list_customers` (`GET /api/customers`).
  - Fase 2: `list_incidents` (`GET /api/incidents`), `get_incident` (`GET /api/incidents/{id}`), `generate_incident_report` (`POST /api/reports/incidents`).
- Construir o **orquestrador LLM** no módulo de chat: criar/listar sessões (`/api/chat/sessions`), receber mensagem do usuário e responder via stream SSE com a sequência `tool_call → tool_result → text_delta → done`, ou `refusal` quando fora de escopo. O orquestrador só chama as tools registradas; nunca acessa o banco/S3 direto.
- Implementar a **recusa explícita**: se o pedido é fora de escopo ou se nenhuma tool retorna dados, emitir `event: refusal { reason, explanation, canDo[] }` em vez de inventar resposta (Princípios 2).
- Expor os endpoints de ciclo de vida de incidente fora das tools: `POST /api/incidents/{id}/acknowledge|resolve|comment`, com **validação server-side** (não confiar na UI).
- Construir o **WS gateway** (`/ws/support`, Socket.IO): validar a sessão OIDC (cookie JWT) no handshake (401 → re-login), associar conexão a `user_id` + papel, emitir `incident.created/updated/auto_resolved`. Ack/resolve continuam via REST; o servidor então emite `incident.updated`.
- Implementar o **mascaramento de PII** server-side: telefone e conteúdo do SMS mascarados por padrão; telefone completo / conteúdo só após reveal autorizado (`pii:reveal`), gerando audit (`reveal_phone`/`reveal_content`).
- Modelar com **Prisma** o estado do app (chat, incidentes, regras, audit, users/roles): snake_case no DB, camelCase na API; mapear os shapes do contrato (`01` §C) para os tipos compartilhados `@atena/types`. Os dados de entrega NÃO ficam no MySQL — vêm do detailed report no S3, consultado via DuckDB (cache `/tmp`).

## Best Practices

- Os response shapes de `01-backend-api-contract.md` §C são o **contrato** — cumpra-os exatamente (campos, nomes camelCase, envelope paginado `{ rows, page, totalPages, total, latencyMs }`).
- O LLM recebe **apenas o resultado de tool**. Nunca passe credenciais de banco/S3 ao orquestrador nem deixe o LLM construir query. RBAC e mascaramento acontecem dentro do serviço da tool, antes de o dado voltar.
- A recusa é um caminho de primeira classe, não um erro: implemente `refusal` no stream com `canDo[]` útil.
- Validação do `resolve` (`01` §D): `actionCategory` ∈ enum; `actionDescription` ≥ 20 chars (≥ 10 no fluxo `auto_resolved`); se category ∈ {`provider_escalated`, `internal_escalated`} → `escalatedTo` obrigatório; só transição `acknowledged|detected|auto_resolved → resolved`. Toda mudança escreve `incident_activity` (status_change) + audit.
- Erros sempre no shape `{ error: { code, message } }`. Autenticação por sessão OIDC (cookie JWT) em todos os endpoints, com RBAC via `@Requires(perm)`; datas ISO 8601 UTC.
- O LLM roda via Amazon Bedrock (modelo Nova Pro — `us.amazon.nova-pro-v1:0` — via Converse API, streaming + tool use); cuide da retenção de prompt no nível do serviço, pois afeta contratos de dados e compliance. Instrumente latência por tool (p50/p95/p99), tokens e custo para a página de Observabilidade.

## Key Project Resources

- [Índice de documentação](../docs/README.md)
- [README dos agentes](README.md)
- [AGENTS.md](../../AGENTS.md)
- `design_handoff_atena/spec-assistente-suporte.md` — spec fonte de verdade

## Repository Starting Points

- `apps/api/src/` — backend NestJS (módulos: chat, llm, shippings, reports, incidents, rules, audit, audit-query, auth, observability, detector, realtime).
- `packages/types/` — `@atena/types`, shapes compartilhados com o frontend.
- `docs/design_handoff_atena/` — specs e protótipo (referência de contrato/shape).

## Key Files

- `design_handoff_atena/01-backend-api-contract.md` — endpoints, tools, shapes, `resolve`, observabilidade.
- `design_handoff_atena/02-data-model.md` — schema (escrito p/ PostgreSQL; decisão batida é MySQL, adaptação em `.context/docs/tech-debt.md`), enums, constraints de negócio do resolve, RBAC.
- `design_handoff_atena/03-websocket-events.md` — eventos WS, handshake de auth (sessão OIDC via cookie JWT; 401 → re-login), reconexão.
- `(protótipo original, não incluído)` — fluxo de chat e renderização do stream (referência).
- `(protótipo original, não incluído)` — como cada resultado de tool aparece + reveal de PII.
- `(protótipo original, não incluído)` / `rules.jsx` — telas que exercitam incidentes e regras.

## Architecture Context

- **Módulo chat:** orquestrador LLM (Amazon Bedrock — Nova Pro via Converse, streaming + tool use), sessões, stream SSE, recusa.
- **Módulos de tools:** shippings, reports, incidents, rules — serviços determinísticos; única fronteira que toca dados (Prisma/MySQL para estado do app; audit-query/DuckDB+S3 para entrega).
- **WS gateway:** push de incidentes em tempo real (Socket.IO), auth no handshake.
- **Transversais:** interceptor de audit, guards de auth (OIDC Entra, cookie JWT) + RBAC gerenciado no app (`@Requires`), serviço de mascaramento de PII.

## Key Symbols for This Agent

- Protótipo (referência): `ToolResultFrame`, `SearchResults`, `TrailTimeline`, `RiskCard`, `ContentRevealBox`, `handleReveal` (`prototype/tool-results.jsx`) — definem os shapes e o ponto de reveal que o backend precisa servir.
- `useMaskedPhone` (`prototype/tool-results.jsx:5`) — mostra mascaramento no cliente; o backend mascara antes.
- Serviços reais (`apps/api/src/`): `OrchestratorService` (chat), `ShippingsService`, `IncidentsService`, `ReportsService`, `RulesService`, `AuditQueryService`/`DuckDbAuditQueryService`, `AuditInterceptor`, `SessionGuard`/`PermissionsGuard`, gateway de realtime.

## Documentation Touchpoints

- [docs/data-flow.md](../docs/data-flow.md) — fluxo chat → tool → dados → stream.
- [docs/architecture.md](../docs/architecture.md) — fronteiras de módulo.
- [docs/security.md](../docs/security.md) — PII, audit, RBAC, validação dupla.

## Collaboration Checklist

1. Identifique a fase e a tool/endpoint alvo; confira o shape em `01` §C.
2. Garanta que RBAC + mascaramento acontecem dentro do serviço da tool, antes do dado voltar.
3. Para chat, confirme que o caminho de `refusal` está implementado (Princípio 2).
4. Para resolve, aplique toda a validação server-side de `01` §D e escreva `incident_activity` + audit.
5. Confirme que o endpoint emite o evento de audit correto (`tool_call`, `reveal_*`, `incident_*`, `export_report`).
6. Atualize `docs/data-flow.md` se um novo fluxo de tool for adicionado.

## Hand-off Notes

Resuma quais tools/endpoints foram implementados (ou stub), se o caminho de recusa e o de audit estão cobertos, e se a validação do resolve está completa. Liste qualquer dependência de schema (passar ao database-specialist) e qualquer ponto onde mascaramento/RBAC ainda não cobre um campo sensível (passar ao security-auditor).
