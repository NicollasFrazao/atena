---
type: doc
name: project-overview
description: High-level overview of the project, its purpose, and key components
category: overview
generated: 2026-06-10
status: filled
scaffoldVersion: "2.0.0"
---

## Project Overview

**Atena** é o assistente conversacional de IA da plataforma de comunicação. Ele dá a times de suporte autorizados **acesso self-service aos dados de envio de SMS** — busca de envios, trilha completa de entrega, análise de risco de conteúdo e relatórios de entregabilidade — e **detecta anomalias proativamente**, criando incidentes, notificando em tempo real (socket.io) e registrando de forma estruturada a ação tomada em cada um. O princípio central é que **a IA é intérprete, não executora**: o LLM traduz linguagem natural em chamadas de _tools_ determinísticas; a aplicação executa a query, aplica RBAC e acessa os dados — o LLM nunca toca o banco e nunca fabrica dados.

> **Estado atual do repositório (MVP implementado):** o produto **está construído**. É um **monorepo npm** com `apps/api` (NestJS 11 + Prisma/MySQL), `apps/web` (React 18 + Vite) e `packages/types` (`@atena/types`). Auth OIDC Microsoft Entra ligada e validada; RBAC gerenciado no app; tools determinísticas, orquestrador LLM (Amazon Nova Pro via Bedrock, com fallback fake), busca/trilha/relatórios de envio sobre o **detailed report no S3** (via DuckDB), incidentes + detector + push realtime, regras (CRUD + shadow mode), reveal de PII auditado, admin de usuários/papéis, audit log e observabilidade — tudo presente. O pacote de design handoff (`docs/design_handoff_atena/`) permanece como **referência histórica de design/contrato**, não como fonte da verdade do que existe.

## Codebase Reference

> **Semantic Snapshot**: Use `context({ action: "getMap", section: "all" })` para o stack gerado, camadas de arquitetura, key files e hotspots de dependência.

## Quick Facts

- Root: `~/atena`
- Linguagem primária: **TypeScript** fim a fim (Node.js/NestJS no back, React no front).
- Estado: **MVP implementado** (Fases 1 e 2 entregues; mergeadas na `master`).
- Estrutura: **monorepo npm workspaces** — `apps/api`, `apps/web`, `packages/types`.
- Referência de design/contrato (histórica): [spec-assistente-suporte.md](../../docs/design_handoff_atena/spec-assistente-suporte.md), [01-backend-api-contract.md](../../docs/design_handoff_atena/01-backend-api-contract.md).
- Convenção de I/O da API: **`snake_case`** na borda (revisão do handoff, que era camelCase). Ver [code-style.md](./code-style.md).
- Semantic snapshot: `context({ action: "getMap", section: "all" })`

## Entry Points

- **Backend:** `apps/api/src/main.ts` — app NestJS expondo REST sob prefixo `/api`, stream SSE no chat e gateway **socket.io** em `/ws/support`.
- **Frontend:** `apps/web/src/main.tsx` / `App.tsx` — app React + Vite, roteando entre Chat, Incidentes, Relatórios, Regras, Audit, Observabilidade, Admin de usuários e Login.
- **Tipos compartilhados:** `packages/types/src/index.ts` (`@atena/types`) — shapes de envio, tools, eventos WS/SSE, RBAC, etc.

## Key Exports

- **Catálogo de tools do LLM:** `search_shippings`, `get_shipping_trail`, `analyze_shipping_content`, `generate_delivery_report`, `list_providers`, `list_customers` (self-service); `list_incidents`, `get_incident`, `generate_incident_report` (incidentes). Implementadas no orquestrador (`apps/api/src/chat/orchestrator.service.ts`) com endpoint REST espelhado.
- **Endpoints REST + WebSocket:** controllers em `apps/api/src/*` (rotas sob `/api`, ex.: `/shippings/*`, `/incidents/*`, `/rules`, `/reports/*`, `/observability`, `/audit`, `/admin/*`, `/auth/*`) e gateway socket.io `/ws/support`.
- **Pacote de tipos compartilhados** `@atena/types` (`packages/types`) — consumido por back e front.

## File Structure & Code Organization

- `apps/api/` — backend NestJS 11. Módulos por feature em `src/`: `auth` (OIDC + RBAC), `admin`/`users`, `chat` (orquestrador + ThinkingSplitter), `llm` (bedrock + fake), `shippings` (busca/trilha/reveal/análise), `audit-query` (motor DuckDB sobre S3), `catalog`, `reports`, `incidents`, `detector`, `rules`, `realtime` (socket.io), `observability`, `audit`, `retention`, `cache`, `config`, `prisma`, `common`. Schema em `prisma/schema.prisma`.
- `apps/web/` — frontend React 18 + Vite. Features em `src/`: `chat`, `incidents`, `reports`, `rules`, `audit`, `observability`, `admin`, `auth`, `history`, `realtime`, `user`, `components`, `styles` (design-system em CSS + tokens), `api`, `util`.
- `packages/types/` — `@atena/types`, contrato compartilhado.
- `docs/design_handoff_atena/` — pacote de handoff (specs `01`–`06`, `decisions.md`, `spec-assistente-suporte.md`, `screenshots/`, `prototype/`). **Referência histórica** de design/contrato.
- `.context/` — base de conhecimento do dotcontext (docs, agents, skills, harness).
- `Makefile`, `docker-compose.yml`, `.env.example` — tooling local (ver [tooling.md](tooling.md)).

## Technology Stack Summary

Stack TypeScript fim a fim. **Backend:** NestJS 11 (módulos + DI, guards de auth/RBAC, interceptor global de audit log, gateway **socket.io**), **Prisma** sobre **MySQL** como store **apenas da aplicação** (chat, incidentes, regras, audit log, usuários/papéis) — o dado de **ENTREGA não fica no MySQL**. **Amazon Nova Pro** (`us.amazon.nova-pro-v1:0`) via **Amazon Bedrock Converse** (streaming + tool use) para o orquestrador, com **provider fake** quando não há credencial. **Frontend:** React 18 + Vite + Phosphor Icons + CSS (design-system com tokens), PT-BR informal. **Observabilidade:** Datadog APM (dd-trace) + métricas via DogStatsD (hot-shots), **opcional** (opt-in).

## Core Framework Stack

- **Backend:** NestJS 11 — módulos + DI, guards de auth/RBAC, interceptors (audit/metrics), gateway socket.io.
- **Dados de entrega (fonte da verdade):** **detailed report no S3** (`s3://example-sms-delivery-reports`, do `example-sms-delivery-reports`/webhook-dispatcher), consultado **sob demanda** pelo motor `AuditQueryService` (DuckDB embarcado + cache transitório no `/tmp`). Grão por destinatário `(campaign_id, phone)`, `id = md5(campaign_id||'|'||phone)`.
- **Dados da aplicação:** MySQL via Prisma (chat, incidentes, regras, audit log, usuários/papéis). Migrations versionadas. **Conteúdo bruto/PII** vive no S3; o `/tmp` é cache efêmero/rebuildável (read-through do S3).
- **LLM:** Amazon Nova Pro via Amazon Bedrock Converse (streaming + tool use); fallback fake determinístico. A IA nunca acessa o banco diretamente.
- **Real-time:** gateway **socket.io** (`/ws/support`), autenticado pela mesma sessão (cookie JWT).

## UI & Interaction Libraries

- **Design-system Acme em CSS** — componentes e tokens próprios (`apps/web/src/styles/design-system`); o frontend **não** usa styled-components nem o pacote `atena-design-system` externo (o protótipo só reimplementou à mão por rodar standalone).
- **Phosphor Icons** (`@phosphor-icons/react`) — sem emoji no produto.
- **Tokens de design Acme** — primária `plankton800` (#077E70) + cores semânticas (danger/warning/info/success). Ver [05-design-reference.md](../../docs/design_handoff_atena/05-design-reference.md).
- Outras libs do front: `react-router-dom`, `@tanstack/react-query`, `react-markdown`, `socket.io-client`.
- Idioma do produto: **PT-BR**, registro informal (`você`). A entidade de entrega é exibida como **"Envio"**.

## Development Tools Overview

O monorepo é dirigido por npm workspaces + um `Makefile`. Fluxos: `make env` (gera `apps/api/.env`), `make up`/`make dev` (Docker), `make migrate`, `make seed`, `npm run dev` (API no host), `make web` (Vite), `make test`/`make test-e2e`, `npm run lint`. Detalhes em [tooling.md](tooling.md) e [development-workflow.md](development-workflow.md).

## Getting Started Checklist

1. Leia este overview, [architecture.md](architecture.md) e [data-flow.md](./data-flow.md) para o estado atual.
2. Rode local: `make env`, ajuste `apps/api/.env` (em dev `AUTH_DEV_BYPASS=true`, `LLM_PROVIDER=fake`), `make up` (ou `npm run dev` + `make web`).
3. Revise os 5 princípios não-negociáveis (IA não executa, não fabrica dados, incidente não é tool, tudo auditado, PII mascarada) — ver [architecture.md](architecture.md).
4. Para histórico de design/contrato (shapes, telas), consulte o handoff em [docs/design_handoff_atena/](../../docs/design_handoff_atena/) — lembrando que a API hoje serializa em `snake_case` ([code-style.md](./code-style.md)).
5. Confira o débito técnico residual em [tech-debt.md](./tech-debt.md).

## Next Steps

O MVP está entregue. Frentes residuais (ver [tech-debt.md](./tech-debt.md)): SSO corporativo completo (SAML + SCIM); IAM Role da EC2 para o S3 (hoje credenciais de leitura); pré-aquecimento do cache `/tmp` pós-redeploy; cache do catálogo (`list_customers`/`list_providers`); investigar o hang intermitente do turno pós-tool no Bedrock; medir o volume de falhas pré-`queued` não rastreadas. Stakeholder: Acme / time de Suporte. Relacionados: [architecture.md](architecture.md), [development-workflow.md](development-workflow.md), [tooling.md](tooling.md).
