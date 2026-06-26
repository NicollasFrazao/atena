---
type: doc
name: tooling
description: Scripts, IDE settings, automation, and developer productivity tips
category: tooling
generated: 2026-06-10
status: filled
scaffoldVersion: "2.0.0"
---

# Tooling & Productivity Guide

> **Estado atual: MVP implementado.** Monorepo npm — `apps/api` (NestJS 11), `apps/web` (React 18 + Vite), `packages/types` (`@atena/types`). Prisma/MySQL, Docker/compose com profiles (`local`/`production`/`observability`), Jest (back) + Vitest (front), ESLint flat config, dd-trace + DogStatsD (opcional). **Não há CI** (`.github/workflows`) ainda. O handoff em [`design_handoff_atena/`](../../design_handoff_atena/) é referência histórica de design. O scaffolding de contexto/harness vive em [`.context/`](../), dirigido pelo MCP **dotcontext**.

## Comandos {#comandos-sprint-0}

Monorepo npm + Makefile (rode da raiz salvo indicação):

| Comando | O que faz |
|---|---|
| `npm install` | instala as dependências do monorepo |
| `make env` | cria `apps/api/.env` a partir do `.env.example` |
| `make up ENV=local` | sobe API + MySQL no Docker (profile `local`) |
| `make dev` | sobe no Docker com `AUTH_DEV_BYPASS=true` |
| `make down` | derruba o stack |
| `make api` / `make web` | API (watch) / front (Vite) **no host**, sem Docker |
| `make migrate` (ou `npm run prisma:migrate`) | aplica migrações (dev) |
| `make seed` | semeia o banco (no container) |
| `npm run build` | build de `@atena/types` + `@atena/api` + `@atena/web` |
| `npm run dev` | API em watch no host (lê `apps/api/.env`) |
| `make test` / `make test-e2e` | testes (unit + e2e mock) / integração MySQL real |
| `npm run lint` | ESLint em todos os workspaces |
| `make smoke` | smoke do health + endpoints principais |
| `make datadog` | sobe o agente Datadog (profile `observability`, opt-in) |

> O `.env` vive em **`apps/api/.env`** (nunca versionado; gerado em runtime via `make env`; em prod via SSM/Secrets Manager). Host do `DATABASE_URL`: **`mysql`** rodando no Docker (`make up`), **`127.0.0.1`** rodando no host (`npm run dev`). O front lê `VITE_APP_TIMEZONE` em build-time.

## Required Tooling

### Em uso

- **Node.js ≥ 20 + TypeScript** — mesma linguagem back/front; tipos compartilhados em `@atena/types` (`packages/types`).
- **NestJS 11** (`apps/api`) — módulos/controllers/guards/interceptors; gateway **socket.io** (`@nestjs/platform-socket.io`); guards de auth/RBAC (`@Requires`).
- **Prisma CLI** (`prisma`) — migrations versionadas + client tipado; schema em `apps/api/prisma/schema.prisma` (snake_case no DB via `@map`). MySQL guarda **só dado da aplicação**; o dado de entrega vem do **detailed report no S3** via DuckDB + cache `/tmp`.
- **DuckDB** (`@duckdb/node-api` ou equivalente) — motor de consulta embarcado sobre o S3 (módulo `audit-query`).
- **Amazon Bedrock** (`@aws-sdk/client-bedrock-runtime`) — orquestrador LLM com Amazon Nova Pro (`us.amazon.nova-pro-v1:0`, Converse API). Sem credencial → `FakeLlmProvider`.
- **Jest** (back) + **Vitest** (front) — test runners (ver [`testing-strategy.md`](./testing-strategy.md)).
- **ESLint flat config** + regras locais (`apps/api/eslint-rules/*`, `@stylistic`) — lint/format antes do merge (ver [code-style.md](./code-style.md)).
- **Vite 5** (`apps/web`) — build/dev server do front; libs: `react`, `react-router-dom`, `@tanstack/react-query`, `@phosphor-icons/react`, `socket.io-client`, `react-markdown`.
- **Design-system próprio em CSS** (`apps/web/src/styles/design-system`) — tokens + componentes; **sem** styled-components nem `atena-design-system` externo.
- **Datadog (opcional)** — APM via `dd-trace` (`apps/api/src/tracing.ts`, importado primeiro) + métricas via `hot-shots` (DogStatsD) no módulo `observability`; alimenta `GET /api/observability`. **Não** usa OpenTelemetry/Prometheus.
- **Docker / docker-compose** — profiles `local` (com MySQL), `production` (sem MySQL, RDS externo) e `observability` (agente Datadog). Deploy pretendido: imagem numa **EC2** com volume → `/tmp` (cache transitório read-through do S3, efêmero/rebuildável).

## Recommended Automation

**Hoje — fluxo de contexto via dotcontext:**

- Mapa do codebase: chamar a tool de contexto com `context({ action: "getMap" })` para um snapshot auto-atualizado (stack, estrutura, key files). Útil ao orientar um agente sobre o estado do repo.
- Preenchimento de scaffolding: `context({ action: "listToFill" })` lista docs/agents/skills pendentes; `fillSingle` preenche um arquivo por vez (frontmatter preservado, `status: unfilled → filled`).

**Hoje — harness (guardrails locais):**

- [`.context/harness/policy.json`](../harness/policy.json) — política de acesso a arquivos. `defaultEffect: allow` com uma regra `deny` (`block-secrets`) que bloqueia `**/.env*`, `**/*.pem`, `**/*.key`, `**/*secret*`. É o guard que impede ferramentas/agentes de ler segredos.
- [`.context/harness/sensors.json`](../harness/sensors.json) — snapshot da stack detectada; deve refletir a stack TS/NestJS + React atual.

**Automação de qualidade em uso:**

- Geração de tipos: `prisma generate` após migrations; build de `@atena/types` consumido por back e front.
- Audit log como **interceptor global NestJS** (`@Audit`, não chamadas espalhadas) — automação de compliance, não opcional.
- `dd-trace` importado primeiro em `main.ts` (via `tracing.ts`); métricas best-effort via DogStatsD.

**Ainda pendente:**

- **CI** (`.github/workflows`) rodando lint + `tsc` + testes antes do merge na `master`.
- Pre-commit hooks (ex.: Husky + lint-staged), se desejado.

## IDE / Editor Setup

- **TypeScript/ESLint** integrados ao editor (format-on-save, lint inline). VSCode com `editor.rulers: [80, 120]`, `tabSize: 2`, `insertSpaces`, `files.insertFinalNewline` (alinha ao code style).
- **Prisma** (syntax highlight + autocomplete do schema).
- **SonarLint** — o code style pede resolver também os avisos do Sonar.

## Productivity Tips

- **Tipos vêm de `@atena/types`.** Antes de implementar/alterar um endpoint, ajuste o shape em `packages/types` (serializado em `snake_case` na borda) — back e front compartilham. Build do pacote antes do gate.
- **Dado de entrega = detailed report no S3.** Para mexer em busca/trilha/relatório, o motor é `audit-query` (DuckDB sobre o S3 + cache `/tmp`); nos testes, aponte `ATENA_AUDIT_SOURCE_ROOT` para um diretório fixture.
- **LLM em dev:** `LLM_PROVIDER=fake` evita custo/credencial; o `FakeLlmProvider` é determinístico.
- **Handoff é histórico.** O protótipo `*.jsx` e os mocks `prototype/data.jsx` foram a referência de design/contrato; o front real usa o design-system próprio em CSS.

Ver [`development-workflow.md`](./development-workflow.md) para o fluxo de contribuição, [`testing-strategy.md`](./testing-strategy.md) para os test runners e [`code-style.md`](./code-style.md) para as convenções.
