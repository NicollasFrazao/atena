---
type: doc
name: development-workflow
description: Day-to-day engineering processes, branching, and contribution guidelines
category: workflow
generated: 2026-06-10
status: filled
scaffoldVersion: "2.0.0"
---

## Development Workflow

**Estado atual: só existe DESIGN HANDOFF.** O repositório da Atena ainda não tem código de produção — não há `package.json` do produto, backend nem frontend. O único conteúdo real é o pacote de handoff em [`docs/design_handoff_atena/`](../../docs/design_handoff_atena/) (specs `01`–`06`, `decisions.md`, `spec-assistente-suporte.md`, `screenshots/`) e o protótipo de design de alta fidelidade em `docs/(protótipo original, não incluído)*.jsx`. **Não há toolchain do produto ainda** (sem scripts npm de build/test/run da Atena).

> Atenção: os comandos `npm install` / `npm run dev` / `npm run build` / `npm run test` citados em [`AGENTS.md`](../../AGENTS.md) referem-se à ferramenta de scaffolding de contexto (dotcontext) que gera este `.context/`, **não** ao produto Atena. Não invente scripts npm da Atena — eles não existem.

O trabalho de hoje, portanto, é: (1) tratar o protótipo + as specs como fonte da verdade; (2) implementar o backend e recriar o frontend conforme os documentos; (3) seguir a ordem de implementação por sprints abaixo. Toda a stack (NestJS, Prisma, MySQL, S3, Amazon Bedrock (modelo Nova Pro via Bedrock, Converse API, streaming + tool use), React + styled-components) é **direção pretendida** pelo [README do handoff](../../docs/design_handoff_atena/README.md), ainda não montada.

### Ordem de implementação (sprints do handoff)

Sequência recomendada em [README §7](../../docs/design_handoff_atena/README.md):

**Sprint 0 — Fundação**
1. Auth: login social institucional (OIDC, domínio restrito) (SSO corporativo completo é débito residual — ver [`tech-debt.md`](./tech-debt.md)) + RBAC (`support_analyst`, `support_lead`).
2. Schema MySQL + migrations (de [02-data-model.md](../../docs/design_handoff_atena/02-data-model.md)).
3. Interceptor de audit log global.

**Sprint 1 — Fase 1 (self-service, read-only)**
4. Tools determinísticas: `search_shippings`, `get_shipping_trail`, `analyze_shipping_content`, `generate_delivery_report`, `list_providers`, `list_customers`.
5. Orquestrador LLM (sessão de chat, streaming, tool routing) + recusa explícita.
6. Mascaramento de PII + reveal com log.
7. Frontend do chat + tool results (recriar do protótipo).

**Sprint 2 — Fase 2 (proativo)**
8. Detector de anomalias (começar via webhook do Grafana Alertmanager → cria incidente).
9. WebSocket gateway + push de incidente ([03-websocket-events.md](../../docs/design_handoff_atena/03-websocket-events.md)).
10. Ciclo de vida do incidente + endpoints `acknowledge`/`resolve` com validação server-side.
11. Tela de Regras, Relatórios de incidente, Audit log viewer, Observabilidade.

### Como usar o protótipo + screen-to-endpoint map

- O protótipo (`prototype/*.jsx`) é **referência de design**, não código para copiar. No codebase real, use os componentes do `atena-design-system` (Button, Badge, Card, Table, Dialog, Tabs, Switch) em vez de recriar à mão como o protótipo fez por rodar standalone.
- Os mocks em `prototype/data.jsx` são o **contrato de shape**: o backend deve responder exatamente no formato que o protótipo consome (ver [01 §C](../../docs/design_handoff_atena/01-backend-api-contract.md)).
- Para saber qual endpoint alimenta cada tela, use [04-screen-to-endpoint-map.md](../../docs/design_handoff_atena/04-screen-to-endpoint-map.md) (mapeia cada componente do protótipo → endpoint + nota), junto com os shapes de [01](../../docs/design_handoff_atena/01-backend-api-contract.md).
- Paridade visual: tokens e telas em [05-design-reference.md](../../docs/design_handoff_atena/05-design-reference.md) (Plankton `#077E70`, semânticas, Manrope/Inter, raio 4px, Phosphor Icons, sem emoji, PT-BR informal).

## Branching & Releases

- **Branch principal:** `master` (PRs costumam mirar `master`).
- Não há fluxo de release formalizado ainda (sem código de produto). Recomenda-se trunk-based / feature branches curtas por sprint.
- **Conventional Commits** são obrigatórios ([AGENTS.md](../../AGENTS.md)), por exemplo `feat(scaffolding): add doc links`. Para o produto, escopos naturais por módulo: `feat(chat): ...`, `feat(tools): ...`, `feat(incidents): ...`, `feat(audit): ...`, `feat(rules): ...`.
- Ao commitar/abrir PR, só faça quando o usuário pedir; se estiver em `master`, crie uma branch antes.

## Local Development

**Não há comandos de build/run/test do produto Atena** — o produto ainda não foi iniciado. Os únicos comandos disponíveis no repo hoje pertencem à ferramenta de scaffolding (dotcontext) descrita em [AGENTS.md](../../AGENTS.md):

- Install (scaffolding tooling): `npm install`
- Sessão interativa (scaffolding tooling): `npm run dev`
- Build do bundle (scaffolding tooling): `npm run build`
- Testes (scaffolding tooling): `npm run test`

Quando o backend Atena nascer (Sprint 0), os comandos pretendidos virão de um `package.json` NestJS (ex.: scripts de migration do Prisma sobre MySQL, `start:dev`, testes Jest) — mas **isso ainda não existe**, então não os assuma. Para experimentar a UI hoje, abra o protótipo standalone em `docs/(protótipo original, não incluído)`.

## Code Review Expectations

Itens de [AGENTS.md](../../AGENTS.md) e dos princípios não-negociáveis da Atena que um review deve verificar:

- Conventional Commits respeitados; PR com amostra de output/markdown quando o comportamento muda.
- Cross-link de novos scaffolds em `docs/README.md` e `agents/README.md`.
- **Princípios não-negociáveis** ([README §5](../../docs/design_handoff_atena/README.md)): o LLM não acessa o banco; nenhum dado estruturado fabricado pelo LLM (sem tool → recusa); `acknowledge`/`resolve` **nunca** como tool, só REST com validação server-side; toda ação auditável escrevendo no audit log; PII mascarada por padrão e reveal logado.
- **Validação dupla**: a UI desabilita o botão, mas o backend revalida (categoria/descrição/escalated_to/transição de estado).
- Paridade com os shapes do contrato ([01 §C](../../docs/design_handoff_atena/01-backend-api-contract.md)) e com os tokens de design ([05](../../docs/design_handoff_atena/05-design-reference.md)).
- Convenções: tipos compartilhados (`@atena/types`), snake_case no DB / camelCase na API.

## Onboarding Tasks

Para quem está começando:

1. Ler, nesta ordem: [README do handoff](../../docs/design_handoff_atena/README.md) → `spec-assistente-suporte.md` → [02-data-model.md](../../docs/design_handoff_atena/02-data-model.md) → [01-backend-api-contract.md](../../docs/design_handoff_atena/01-backend-api-contract.md).
2. Abrir o protótipo (`prototype/app.jsx` como entry) e percorrer chat → tool results → incidentes para entender o comportamento pretendido.
3. Decorar os 5 princípios não-negociáveis e [decisions.md](../../docs/design_handoff_atena/decisions.md).
4. Conferir as **decisões pendentes que destravam** a implementação ([06-pending-decisions.md](../../docs/design_handoff_atena/06-pending-decisions.md) e [decisions.md](../../docs/design_handoff_atena/decisions.md)): (1) conteúdo de SMS em claro no hot store vs. só no S3; (2) top-3 cenários de anomalia (thresholds default); (3) onde mora o audit log (mesmo MySQL vs. serviço dedicado). Decisões já batidas: banco MySQL (Prisma), LLM via Amazon Bedrock (modelo Nova Pro), login social institucional (OIDC, domínio restrito) (SSO corporativo completo é débito residual). Sprint 2 não fecha sem (2).
5. Primeira tarefa natural: implementar o schema MySQL + migrations de Sprint 0 a partir de [02](../../docs/design_handoff_atena/02-data-model.md).

## Cross-References

- [Architecture Notes](./architecture.md)
- [Data Flow & Integrations](./data-flow.md)
- [Testing Strategy](./testing-strategy.md)
- [Tooling](./tooling.md)
- Handoff: [README](../../docs/design_handoff_atena/README.md) · [decisions.md](../../docs/design_handoff_atena/decisions.md) · [04 — Screen→Endpoint Map](../../docs/design_handoff_atena/04-screen-to-endpoint-map.md)
