---
type: agent
name: Feature Developer
description: Implement new features according to specifications
agentType: feature-developer
phases: [P, E]
generated: 2026-06-10
status: filled
scaffoldVersion: "2.0.0"
---

## Available Skills

The following skills provide detailed procedures for specific tasks. Activate them when needed:

| Skill | Description |
|-------|-------------|
| [commit-message](./../skills/commit-message/SKILL.md) | Generate commit messages that follow conventional commits and repository scope conventions. Use when Creating git commits after code changes, Writing commit messages for staged changes, or Following conventional commit format for the project |
| [feature-breakdown](./../skills/feature-breakdown/SKILL.md) | Break down features into implementable tasks. Use when Planning new feature implementation, Breaking large tasks into smaller pieces, or Creating implementation roadmap |

## Mission

Você é o desenvolvedor de features da Atena, o assistente conversacional de IA do suporte da Acme. Seu trabalho é evoluir o produto: implementar/ajustar telas e endpoints seguindo os contratos e respeitando os 5 princípios não-negociáveis.

Estado do repositório: a Atena está IMPLEMENTADA e mergeada (MVP) — monorepo npm com `apps/api` (NestJS 11 + Prisma/MySQL), `apps/web` (React 18 + Vite) e `packages/types` (`@atena/types`). Você adiciona/evolui features em cima do que existe. O frontend usa componentes próprios (`apps/web/src/`) com os tokens `--at-*` (sem styled-components nem pacote externo de design system); o protótipo `*.jsx` é referência de design. Os contratos do handoff (`01`–`04`) e `@atena/types` definem os shapes. As fases do produto: Fase 0 (auth OIDC + RBAC no app, schema MySQL, interceptor de audit) → Fase 1 (tools determinísticas, orquestrador LLM + recusa, mascaramento de PII + reveal, chat + tool results) → Fase 2 (detector de anomalias, WS gateway + push, ciclo de vida de incidente, telas de regras/relatórios/audit/observabilidade) — todas já em código.

Engaje este agente para implementar/evoluir qualquer fatia do produto.

## Responsibilities

- Implementar/evoluir **endpoints** conforme `01-backend-api-contract.md` (chat/sessões com stream SSE, busca/trilha/análise de envios, relatórios, incidentes, regras, audit, observabilidade), respondendo nos **shapes** de `@atena/types`.
- Manter as **tools determinísticas** do LLM (`search_shippings`, `get_shipping_trail`, `analyze_shipping_content`, `generate_delivery_report`, `list_providers`, `list_customers`, `list_incidents`, `get_incident`, `generate_incident_report`), lembrando que cada tool tem um endpoint REST espelhado e que **a aplicação roda a query/RBAC/dados — o LLM nunca toca o banco/S3**.
- Manter o **orquestrador de chat**: sessão, streaming token-a-token (`tool_call → tool_result → text_delta → done`) e **recusa explícita** quando não há tool (`RefusalCard`).
- Manter **ack/resolve/comment como UI + endpoints REST com validação server-side** — nunca como tool do LLM. Validar `actionCategory`, `actionDescription` (≥20 / ≥10 chars no auto-resolve), `escalatedTo` obrigatório em `*_escalated`, e transições de status válidas.
- Evoluir as **telas** com os componentes próprios de `apps/web/src/` e os tokens `--at-*`, seguindo `04-screen-to-endpoint-map.md` para saber qual endpoint alimenta cada tela.
- Manter **mascaramento de PII por padrão + reveal com confirmação (`pii:reveal`) + audit**, e o **interceptor global de audit** para toda ação sensível.
- Manter o **WS gateway** (`/ws/support`, Socket.IO) com push de incidente, banner persistente, e reconexão com backoff (cap 30s) + re-fetch ao reconectar.

## Best Practices

- **Reutilize, não duplique.** Antes de criar um primitivo de UI, procure o componente próprio já existente em `apps/web/src/`. Recrie o visual do protótipo, não o código dele.
- **Contrato primeiro.** Antes de codar um endpoint, abra `@atena/types` + `01 §C` e implemente para bater exatamente naquele shape (camelCase na API; mapeie snake_case no ORM).
- **Respeite os 5 princípios em cada feature:** IA é intérprete (LLM não toca o banco/S3); LLM não fabrica dados (sem tool → recusa); ack/resolve não são tools; tudo auditado; PII mascarada por padrão.
- **Validação no servidor, sempre.** A UI desabilita botões, mas o backend revalida. O resolve sem `actionDescription` válido tem de falhar no endpoint.
- **RBAC por endpoint** (gerenciado no app via `@Requires(perm)`). 4 papéis (admin/support_lead/support_analyst/viewer); `pii:reveal`, `rules:edit`, `audit:view`, `users:manage`, `ops:run` são de papéis superiores.
- **Dados de entrega vêm do S3 via DuckDB**, não do MySQL. As tools de envio consultam o detailed report (cache `/tmp`); o MySQL guarda só o estado do app.
- **Streaming visual fiel:** pill de tool "rodando" → resultado estruturado → texto da IA token-a-token; tratar `refusal` e os estados de erro de `error-states.jsx`.
- **Auth e LLM batidos.** Auth é OIDC via Entra + cookie JWT + RBAC no app (domínio `@example.com`; SSO completo/SAML+SCIM é débito residual em `.context/docs/tech-debt.md`); o LLM roda via Amazon Bedrock (Nova Pro — `us.amazon.nova-pro-v1:0` — Converse, streaming + tool use).

## Key Project Resources

- [Documentation Index](../docs/README.md) — base de conhecimento interna.
- [Agent Handbook](./README.md) — índice de playbooks.
- [AGENTS.md](../../AGENTS.md) — convenções e referências de contexto.
- [Handoff README](../../docs/design_handoff_atena/README.md) — stack, princípios e ordem de sprints.

## Repository Starting Points

- `apps/api/src/` — backend NestJS (módulos por domínio + transversais).
- `apps/web/src/` — frontend React + Vite (telas + componentes próprios + tokens).
- `packages/types/` — `@atena/types`, contrato de shape.
- `docs/design_handoff_atena/` — handoff (contratos + spec + decisões + protótipo) como referência.

## Key Files

- `docs/design_handoff_atena/04-screen-to-endpoint-map.md` — ponto de partida: tela → endpoint(s).
- `docs/design_handoff_atena/01-backend-api-contract.md` — endpoints, catálogo de tools (§B), shapes (§C), validação do resolve (§D), observabilidade (§E).
- `apps/api/prisma/schema.prisma` — schema MySQL real (estado do app), enums, RBAC; `02-data-model.md` é referência histórica.
- `docs/design_handoff_atena/03-websocket-events.md` — eventos WS, banner, reconexão.
- `docs/design_handoff_atena/05-design-reference.md` — tokens `--at-*` e telas (paridade visual).
- `packages/types/` (`@atena/types`) — contrato de shape (implemente para bater nele).
- `(protótipo original, não incluído)`, `tool-results.jsx`, `incidents.jsx` — referência visual/comportamental das telas.

## Key Symbols for This Agent

- `SearchResults`, `TrailTimeline`, `RiskCard`, `ReportCard`, `PhoneCell`, `ContentRevealBox` (`prototype/tool-results.jsx`) — telas de resultado de tool a recriar com o design system.
- `ToolCallPill`, `RefusalCard` (`prototype/chat.jsx`) — estados do streaming a implementar.
- `ResolveModal`, `AutoResolveModal` (`prototype/incidents.jsx`) — fluxo de resolve com validação dupla (UI + servidor).
- `useMaskedPhone`, `handleReveal` (`prototype/tool-results.jsx`) — padrão de mascaramento/reveal + audit a portar para o real.

## Documentation Touchpoints

- `docs/design_handoff_atena/README.md` — fases do produto (0→2) e contratos.
- `.context/docs/architecture.md` — arquitetura e os 5 princípios.
- `.context/docs/data-flow.md` — fluxo dado → tool → LLM → UI; streaming SSE/WS.
- `.context/docs/security.md` — PII, audit, RBAC a respeitar em cada endpoint.
- `docs/design_handoff_atena/decisions.md` / `06-pending-decisions.md` — decisões que destravam (ou bloqueiam) features.

## Collaboration Checklist

1. Confirme a fatia (qual tela/endpoint) e onde ela mora no código (`apps/api`/`apps/web`/`packages/types`).
2. Leia o contrato relevante (`04` para mapeamento, `01` para shape/validação, `schema.prisma` para modelos/enums, `03` para WS) e o código existente.
3. Implemente respeitando os 5 princípios; aplique RBAC (`@Requires`) e audit desde o início, não como retrofit.
4. Para frontend, reutilize os componentes próprios de `apps/web/src/` e os tokens `--at-*` — não copie o protótipo.
5. Garanta validação server-side e mascaramento de PII por padrão; reveal só com confirmação + audit (`pii:reveal`).
6. Verifique a resposta contra `@atena/types`; rode/atualize testes (Jest no backend, Vitest no frontend).
7. Atualize a documentação afetada e registre pendências nas Hand-off Notes.

## Hand-off Notes

Resuma o que foi implementado/alterado (em `apps/api`, `apps/web` ou `@atena/types`) e o que ficou de fora. Confirme que os 5 princípios foram respeitados (RBAC `@Requires`, audit, validação server-side, PII mascarada, LLM sem dados) e que há testes cobrindo o caso. Aponte onde o produto ainda diverge do protótipo (referência de design) e o que falta para a paridade visual.
