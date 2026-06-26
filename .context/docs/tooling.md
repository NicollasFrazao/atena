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

> **Estado atual (Sprint 0 concluído):** a fundação de produção **já existe** — monorepo npm (`apps/api` NestJS + `packages/types`), Prisma/MySQL com migração inicial, Docker/compose com profiles, e **build (tsc strict) / lint (ESLint) / testes (Jest) / `npm audit` todos verdes** (ver [Comandos (Sprint 0+)](#comandos-sprint-0)). Ainda **não** existem (Sprint 1+): as tools determinísticas, o orquestrador LLM, o frontend, CI e observabilidade. Além do código de produção, o repo também tem: (1) o protótipo standalone em [`(protótipo original, não incluído)`](../../(protótipo original, não incluído)) — arquivos `.jsx` que rodam sem build (React + Babel via `<script>` no `Assistente Suporte.html`, componentes reimplementados à mão), que é **referência de design** e não código de produção; e (2) o scaffolding de contexto/harness em [`.context/`](../) dirigido pelo MCP **dotcontext**. As "ferramentas pretendidas" abaixo são a **direção** do handoff para quando o código real começar — não invente que já estão instaladas.

O propósito desta página é dar a um contribuidor (humano ou agente) o mapa do que opera hoje e do que será montado. Hoje, a única automação ativa é a do contexto: o dotcontext MCP e o harness de policy/sensors.

## Comandos (Sprint 0+) {#comandos-sprint-0}

Já funcionam (monorepo npm; rode da raiz salvo indicação):

| Comando | O que faz |
|---|---|
| `npm install` | instala as dependências do monorepo |
| `make env` | cria `apps/api/.env` a partir do `.env.example` |
| `make up ENV=local` | sobe API + MySQL no Docker (profile `local`) |
| `make down` | derruba o stack |
| `make migrate` (ou `npm run prisma:migrate --workspace @atena/api`) | aplica migrações (dev) |
| `npm run build` | build do `@atena/types` + `@atena/api` |
| `npm run dev` | API em watch no host (lê `apps/api/.env`) |
| `npm test --workspace @atena/api` | testes Jest |
| `npm run lint --workspace @atena/api` | ESLint |
| `curl localhost:3000/health` | smoke do health → `{"status":"ok"}` |

> O `.env` vive em **`apps/api/.env`** (nunca versionado; gerado em runtime). Host do `DATABASE_URL`: **`mysql`** rodando no Docker (`make up`), **`127.0.0.1`** rodando no host (`npm run dev`).

## Required Tooling

### Operante hoje

- **dotcontext MCP** — declarado em [`.mcp.json`](../../.mcp.json) como server stdio que roda via `npx -y @dotcontext/mcp@latest`. É o que preenche e consulta o scaffolding em `.context/` (docs, agents, skills, harness). Requer **Node.js + npx** disponíveis na máquina.
- **Protótipo standalone** — `(protótipo original, não incluído)*.jsx` + `Assistente Suporte.html`. Abre no navegador sem build (Babel standalone transpila os `.jsx` no cliente). Útil como referência viva de UI/UX; os dados são mock ([`prototype/data.jsx`](../../(protótipo original, não incluído))) cujo **shape é o contrato** do backend.

### Pretendido (direção do handoff — ainda não no repo)

Quando o produto for inicializado, a stack alvo ([`README.md` §4](../../design_handoff_atena/README.md)):

- **Node.js + TypeScript** — mesma linguagem no back e no front, com tipos compartilhados num pacote `@atena/types`.
- **NestJS CLI** (`@nestjs/cli`) — scaffolding de módulos/controllers/guards/interceptors; o gateway WebSocket nativo e os guards de auth/RBAC vêm daqui (login social institucional (OIDC, domínio restrito); SSO corporativo completo é débito residual).
- **Prisma CLI** (`prisma`) — migrations versionadas e client tipado a partir do schema de [`02-data-model.md`](../../design_handoff_atena/02-data-model.md) (snake_case no DB, camelCase na API; Drizzle é alternativa). MySQL como hot store de **metadados** + S3 (origem durável de conteúdo/logs) + cache transitório de conteúdo/trilha em **arquivos temporários no `/tmp`** (volume Docker numa EC2, hidratado do S3).
- **Jest** — test runner (ver [`testing-strategy.md`](./testing-strategy.md)).
- **ESLint + Prettier** — lint e formatação; padrão de qualidade antes do merge.
- **Amazon Bedrock (modelo Nova Pro via Bedrock, Converse API, streaming + tool use)** — para o orquestrador LLM. A IA nunca acessa o banco.
- **`atena-design-system`** — biblioteca de componentes React (Button, Badge, Card, Table, Dialog, Tabs, Switch…) + Phosphor Icons, sobre styled-components. O frontend de produção **usa os componentes do pacote**; o protótipo só os reimplementou à mão por rodar standalone.
- **Observabilidade** — OpenTelemetry / Prometheus, alimentando `GET /api/observability`.
- **Docker** — deploy pretendido: imagem Docker numa **EC2**, com um **volume apontando para o `/tmp` do host**. Esse `/tmp` é o cache transitório (read-through) dos dados brutos de conteúdo/trilha (efêmero/rebuildável, hidratado do S3) — serve para evitar muitas requisições ao S3 num curto período e manter os brutos fora do banco; audit e metadados duráveis ficam em MySQL e a origem do conteúdo em S3, então nada que precise sobreviver a restart/redeploy mora só no `/tmp`.

> Decisões batidas que afetam tooling: banco MySQL (ORM Prisma) para metadados, cache transitório de conteúdo/trilha em arquivos temporários no `/tmp` (volume Docker numa EC2, hidratado do S3), LLM via Amazon Bedrock (modelo Nova Pro), login social institucional (OIDC, domínio restrito) (SSO corporativo completo é débito residual). Pendente (não fixar ainda): ORM Prisma vs Drizzle. Ver [`06-pending-decisions.md`](../../design_handoff_atena/06-pending-decisions.md) e [`decisions.md`](../../design_handoff_atena/decisions.md).

## Recommended Automation

**Hoje — fluxo de contexto via dotcontext:**

- Mapa do codebase: chamar a tool de contexto com `context({ action: "getMap" })` para um snapshot auto-atualizado (stack, estrutura, key files). Útil ao orientar um agente sobre o estado do repo.
- Preenchimento de scaffolding: `context({ action: "listToFill" })` lista docs/agents/skills pendentes; `fillSingle` preenche um arquivo por vez (frontmatter preservado, `status: unfilled → filled`).

**Hoje — harness (guardrails locais):**

- [`.context/harness/policy.json`](../harness/policy.json) — política de acesso a arquivos. `defaultEffect: allow` com uma regra `deny` (`block-secrets`) que bloqueia `**/.env*`, `**/*.pem`, `**/*.key`, `**/*secret*`. É o guard que impede ferramentas/agentes de ler segredos.
- [`.context/harness/sensors.json`](../harness/sensors.json) — snapshot da stack detectada. Hoje reflete o estado real: `primaryLanguage: javascript`, **sem** frameworks, build tools, test frameworks ou package manager (`packageManager: null`). Deve ser atualizado quando a stack TS/NestJS entrar.

**Pretendido — automação de qualidade (quando o código existir):**

- Pre-commit hooks (ex.: Husky + lint-staged) rodando ESLint/Prettier nos arquivos staged.
- Geração de tipos: `prisma generate` após migrations; build do pacote `@atena/types` consumido por back e front.
- Audit log como **interceptor global NestJS** (não chamadas espalhadas) — automação de compliance, não opcional.
- CI rodando lint + `tsc` + testes antes do merge na `master`.

> Não documente comandos `npm run …` como se existissem — eles serão definidos no `package.json` quando o projeto nascer; até lá, são direção.

## IDE / Editor Setup

Recomendado para quando o código TS existir:

- **TypeScript/ESLint/Prettier** integrados ao editor (format-on-save, lint inline).
- **Prisma** (syntax highlight + autocomplete do schema).
- **EditorConfig** para consistência de indentação/EOL entre contribuidores.
- Para navegar o protótipo agora, qualquer editor com realce de JSX serve; nenhuma extensão é obrigatória porque não há build.

## Productivity Tips

- **O protótipo é referência, não base de código.** Para entender uma tela, abra o `.jsx` correspondente em [`(protótipo original, não incluído)`](../../(protótipo original, não incluído)) (ex.: `chat.jsx`, `incidents.jsx`, `tool-results.jsx`, `error-states.jsx`) e cruze com [`04-screen-to-endpoint-map.md`](../../design_handoff_atena/04-screen-to-endpoint-map.md) para ver qual endpoint a alimenta. Recrie com componentes reais do `atena-design-system`, não copie o `.jsx`.
- **Contrato de dados vem do mock.** Antes de implementar um endpoint, leia o objeto correspondente em [`prototype/data.jsx`](../../(protótipo original, não incluído)) — o backend deve responder nesse shape (camelCase), mapeando do snake_case do banco no ORM.
- **Comece pela fundação** ([`README.md` §7](../../design_handoff_atena/README.md)): login social institucional (OIDC) + RBAC (SSO corporativo completo é débito residual), schema/migrations MySQL, e o interceptor de audit log — antes das tools e da UI.

Ver [`development-workflow.md`](./development-workflow.md) para o fluxo de contribuição e [`testing-strategy.md`](./testing-strategy.md) para o test runner pretendido.
