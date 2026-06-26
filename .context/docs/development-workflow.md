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

**Estado atual: MVP implementado.** O repositório é um **monorepo npm** — `apps/api` (NestJS 11 + Prisma/MySQL), `apps/web` (React 18 + Vite) e `packages/types` (`@atena/types`). Auth OIDC, tools, orquestrador (Nova Pro/fake), busca/trilha/relatórios sobre o detailed report no S3, incidentes + detector + realtime, regras, reveal de PII, admin de usuários, audit log e observabilidade estão presentes. O handoff em [`docs/design_handoff_atena/`](../../docs/design_handoff_atena/) é **referência histórica** de design/contrato.

> Atenção: a API real serializa em **`snake_case`** na borda (revisão do handoff, que era camelCase). Ver [code-style.md](./code-style.md).

O trabalho hoje é evoluir o código existente seguindo os princípios não-negociáveis e o code style. Frentes residuais estão em [tech-debt.md](./tech-debt.md).

### Mapa de implementação (o que já existe)

- **Fundação:** auth OIDC Microsoft Entra (state/nonce/PKCE + sessão por cookie JWT) + RBAC gerenciado no app (papéis no banco, `@Requires`); schema MySQL + migrations Prisma; interceptor global de audit (`@Audit`).
- **Self-service (read-only):** tools `search_shippings`/`get_shipping_trail`/`analyze_shipping_content`/`generate_delivery_report`/`list_providers`/`list_customers`; orquestrador LLM (chat, SSE, tool routing, recusa, `ThinkingSplitter`); mascaramento de PII + reveal auditado; frontend de chat + tool results.
- **Proativo:** detector de anomalias (4 regras + shadow mode); gateway socket.io + push de incidente; ciclo de vida do incidente (`acknowledge`/`resolve`/`comment`) com validação server-side; telas de Regras, Relatórios, Audit, Observabilidade, Admin de usuários.
- **Dado de entrega:** motor `AuditQueryService` (DuckDB sobre o detailed report no S3 + cache `/tmp`).

### Como usar o handoff (referência histórica)

- O protótipo (`prototype/*.jsx`) e os mocks de `prototype/data.jsx` foram a referência de design/contrato. O front de produção usa um **design-system próprio em CSS** (`apps/web/src/styles/design-system`), não styled-components nem o pacote `atena-design-system` externo.
- Os shapes hoje vivem em `@atena/types`; a API serializa em `snake_case`. As telas e tokens de [05-design-reference.md](../../docs/design_handoff_atena/05-design-reference.md) (Plankton `#077E70`, semânticas, Phosphor Icons, sem emoji, PT-BR informal) ainda valem como paridade visual.

## Branching & Releases

- **Branch principal:** `master`. PRs miram `master`. Trunk-based / feature branches curtas.
- **Conventional Commits** obrigatórios. Escopos por módulo: `feat(chat)`, `feat(shippings)`, `feat(incidents)`, `feat(audit)`, `feat(rules)`, `feat(auth)`, `feat(detector)`, `fix(...)`, etc. (ver também [code-style.md](./code-style.md)).
- Ao commitar/abrir PR, só faça quando o usuário pedir; se estiver em `master`, crie uma branch antes.

## Local Development

Comandos reais (monorepo npm + Makefile; ver [tooling.md](./tooling.md)):

- Instalar: `npm install`
- Gerar `.env`: `make env` (cria `apps/api/.env` a partir de `.env.example`)
- Subir tudo no Docker: `make up ENV=local` (ou `make dev` com `AUTH_DEV_BYPASS=true`)
- API no host (watch): `npm run dev` (ou `make api`); front: `make web` (Vite)
- Migrar: `make migrate`; semear: `make seed`
- Testes: `make test` (unit + e2e mock) / `make test-e2e` (MySQL real)
- Lint: `npm run lint`; smoke do health: `make smoke`
- Datadog (opcional): `make datadog`

Em dev, use `LLM_PROVIDER=fake` (sem credencial Bedrock) e `AUTH_DEV_BYPASS=true` (sem login).

## Code Review Expectations

- Conventional Commits respeitados; PR com amostra de output quando o comportamento muda.
- **Princípios não-negociáveis** ([README §5](../../docs/design_handoff_atena/README.md)): o LLM não acessa o banco; nenhum dado estruturado fabricado pelo LLM (sem tool → recusa); `acknowledge`/`resolve` **nunca** como tool, só REST com validação server-side; toda ação auditável escrevendo no audit log; PII mascarada por padrão e reveal logado (`pii:reveal`).
- **Validação dupla**: a UI desabilita o botão, mas o backend revalida (categoria/descrição/escalated_to/transição de estado).
- **Code style** ([code-style.md](./code-style.md)): `snake_case` na borda da API; nomes semânticos; um item por linha; JSDoc; `@todo` para pendências; lint + Sonar limpos.

## Onboarding Tasks

Para quem está começando:

1. Ler, nesta ordem: [project-overview.md](./project-overview.md) → [architecture.md](./architecture.md) → [data-flow.md](./data-flow.md) → [code-style.md](./code-style.md).
2. Rodar local (`make env`, ajustar `apps/api/.env`, `make up` ou `npm run dev` + `make web`); abrir o chat e percorrer busca → tool result → reveal → incidentes.
3. Decorar os 5 princípios não-negociáveis.
4. Conferir o débito residual em [tech-debt.md](./tech-debt.md).
5. Para histórico de design/contrato (telas, shapes originais), consultar o handoff em [docs/design_handoff_atena/](../../docs/design_handoff_atena/).

## Cross-References

- [Architecture Notes](./architecture.md)
- [Data Flow & Integrations](./data-flow.md)
- [Testing Strategy](./testing-strategy.md)
- [Tooling](./tooling.md)
- [Code Style](./code-style.md)
