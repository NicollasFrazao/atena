# Atena

Assistente conversacional de IA para plataformas de comunicação. Dá a times de suporte autorizados **acesso self-service aos dados de envio de SMS** (busca, trilha de entrega, análise de risco, relatórios) e **detecta anomalias proativamente** (incidentes com push em tempo real e resolução estruturada).

> **Princípio central:** a IA é **intérprete, não executora** — o LLM traduz linguagem natural em chamadas de _tools_ determinísticas; é a **aplicação** que executa a query, aplica RBAC e acessa os dados. O LLM nunca toca a fonte de dados e nunca fabrica dados.

---

## Estado atual

MVP **implementado** — backend NestJS + frontend React, ponta a ponta. Chat com orquestrador LLM e tools determinísticas, detector de anomalias com push em tempo real, ciclo de vida de incidentes, relatórios, regras, auditoria, observabilidade, login OIDC (Microsoft Entra) e administração de papéis (RBAC).

- **Backend:** [`apps/api`](apps/api/) — NestJS 11.
- **Frontend:** [`apps/web`](apps/web/) — React 18 + Vite.
- **Contrato compartilhado:** [`packages/types`](packages/types/) — `@atena/types`.

O contrato HTTP vigente está em [`docs/openapi.yaml`](docs/openapi.yaml). O design original (handoff de entrada) está em [`docs/design_handoff_atena/`](docs/design_handoff_atena/) — é **histórico** e diverge do estado atual em vários pontos (ver o aviso no topo daquele README).

---

## Princípios não-negociáveis

1. **A IA é intérprete, não executora** — a aplicação roda a query, aplica RBAC e acessa os dados; o LLM só recebe o resultado estruturado.
2. **O LLM não fabrica dados** — todo dado estruturado vem do retorno de uma tool; sem tool aplicável → recusa explícita.
3. **Mudança de estado de incidente não é tool** — `acknowledge`/`resolve` só via UI + validação server-side.
4. **Tudo é auditado** — mensagens, tool calls, reveals de PII, exports e mudanças de incidente → audit log imutável (append-only), via interceptor global.
5. **PII mascarada por padrão** — telefone e conteúdo de SMS chegam mascarados; revelar (ou exportar em claro) exige `pii:reveal` e gera entry no audit log.

---

## Stack

- **Backend:** TypeScript + **NestJS 11** (módulos/DI, guards, interceptors, WebSocket gateway via Socket.IO).
- **Banco (app):** **MySQL** via **Prisma** — guarda só o estado da **aplicação** (incidentes, regras, sessões/mensagens de chat, usuários/papéis, `audit_log`). **Não** guarda os dados de envio.
- **Fonte dos dados de envio:** o **detailed report** no **S3** é a fonte da verdade, consultada via **DuckDB** com cache transitório read-through em `/tmp` (reduz idas ao S3). MySQL não tem tabela de mensagens.
- **LLM:** **Amazon Bedrock** (**Amazon Nova Pro**, Converse API: streaming + tool use) — atrás de uma abstração trocável (`LLM_PROVIDER`). Sem credencial (`AWS_BEARER_TOKEN_BEDROCK`), cai num provider _fake_ determinístico (dev/local/testes).
- **Auth:** login social institucional **OIDC** (Microsoft 365 / Entra ID), restrito ao domínio — sessão por cookie JWT (`SameSite=None; Secure`). Provider plugável.
- **RBAC gerenciado no app:** papéis no banco (atribuídos por admin), **não** vêm do IdP. 4 papéis (`admin` / `support_lead` / `support_analyst` / `viewer`) → permissões (mapa em código, `@Requires`). O JWT carrega só identidade.
- **Frontend:** **React 18** + **Vite**, React Router, TanStack Query, Socket.IO client, Phosphor Icons.
- **Deploy:** imagem **Docker** numa **EC2**; volume do host → `/tmp` (cache do DuckDB).
- **Observabilidade:** APM via **Datadog** (dd-trace, opt-in) + métricas básicas do assistente a partir do audit log.

---

## Estrutura do repositório

```
apps/api/              # Backend NestJS (orquestrador LLM + tools + REST/WS)
  prisma/schema.prisma # Schema MySQL (estado do app) + migrations/
  src/                 # config, prisma, auth (OIDC+RBAC), audit, llm (Bedrock/Nova),
                       #   audit-query (S3↔DuckDB), shippings, incidents, reports,
                       #   rules, catalog, chat, detector, observability, admin, retention
  Dockerfile           # imagem multi-stage
apps/web/              # Frontend React + Vite (chat, incidentes, relatórios, regras,
                       #   histórico, auditoria, admin/usuários, observabilidade)
packages/types/        # @atena/types — contrato de shapes compartilhado API↔web
docs/openapi.yaml      # contrato HTTP VIGENTE
docs/design_handoff_atena/  # handoff de design ORIGINAL (entrada do projeto; histórico)
.context/              # base de conhecimento (dotcontext): docs, agents, skills, planos
docker-compose.yml     # profiles local | production
Makefile               # entrypoint de tarefas
```

---

## Como rodar (local)

**Pré-requisitos:** Node ≥ 20, Docker + Docker Compose.

```bash
# 1. variáveis de ambiente — gera o apps/api/.env (NUNCA versionado) a partir do template
make env            # cria .env a partir de .env.example; preencha os valores

# 2. dependências
make install

# 3. sobe o stack local (API + MySQL via Docker)
make up ENV=local
#   ou: make dev   → sobe com AUTH_DEV_BYPASS=true (login dispensado; APENAS dev)

# 4. migrações do banco
make migrate

# 5. healthcheck
curl localhost:3000/health   # -> {"status":"ok","service":"atena-api"}
```

- API só (host, watch, iteração rápida): `make api`.
- Frontend (Vite, host): `make web`.
- Smoke test dos endpoints principais: `make smoke`.

Veja todos os alvos com `make help`.

### Variáveis de ambiente

O app lê **sempre um único `.env`** (`apps/api/.env`), **gerado em runtime** e **nunca versionado** (em produção a partir de **SSM / Secrets Manager**; em local via `make env`). O único arquivo de env no git é o template [`.env.example`](.env.example). Chaves relevantes: `DATABASE_URL`, `LLM_PROVIDER`/`BEDROCK_MODEL_ID`/`AWS_BEARER_TOKEN_BEDROCK`, S3 (fonte do detailed report), OIDC (`AUTH_*`), `AUTH_ADMIN_EMAILS` (bootstrap de admin), `APP_TIMEZONE` (default BRT), `AUTH_DEV_BYPASS` (off em produção).

---

## API e contrato

- Todos os endpoints ficam sob o prefixo **`/api`**, exceto `GET /health` (sonda de infra, na raiz).
- Respostas em `snake_case`; erros no shape `{ "error": { "code": "...", "message": "..." } }`; listas paginadas no envelope `{ rows, page, total_pages, total, latency_ms }`.
- Entidade de entrega = **shipping** (rotas `/shippings/*`; antes era `message`).
- Chat e relatórios respondem em **stream SSE**; incidentes têm push via **WebSocket** (Socket.IO).
- Contrato completo em [`docs/openapi.yaml`](docs/openapi.yaml).

### Janela de entrega (send-based)

Envios e taxas são sempre medidos **sobre o instante de envio** (`requested_at`) dentro da janela — não sobre a finalização. A trilha de um envio alarga para trás para mostrar os eventos terminais. O motor opera em UTC e converte só nas bordas para o fuso de exibição (`APP_TIMEZONE`, default UTC-3/BRT).

---

## Banco de dados

- Schema em [`apps/api/prisma/schema.prisma`](apps/api/prisma/schema.prisma) (MySQL — **só estado do app**). Migrations versionadas em `apps/api/prisma/migrations/`.
- `make migrate` (dev) / `prisma migrate deploy` (produção, no entrypoint do container).
- O `audit_log` é **append-only** — o role de app deve ter só INSERT + SELECT.
- Os **dados de envio não ficam no banco**: vêm do detailed report no S3, consultados via DuckDB.

---

## RBAC

| Papel | Resumo |
|---|---|
| `viewer` | Somente leitura (busca, trilha, relatórios, incidentes, regras, auditoria, observabilidade). |
| `support_analyst` | Viewer + operação de incidentes (comentar/reconhecer/resolver). |
| `support_lead` | Analyst + ações sensíveis: revelar PII (`pii:reveal`), editar regras, disparar rotinas de ops. |
| `admin` | Tudo + gestão de usuários e papéis (`/admin`). |

Papéis são atribuídos por admin na tela `/admin/usuarios` e persistidos no banco. `pii:reveal` é exigido tanto para os reveals (`reveal-phone`/`reveal-content`) quanto para os exports CSV com telefone em claro.

---

## Documentação

- **Contrato HTTP vigente:** [`docs/openapi.yaml`](docs/openapi.yaml).
- **Base de contexto (`.context/docs/`):** [arquitetura](.context/docs/architecture.md) · [fluxo de dados](.context/docs/data-flow.md) · [segurança](.context/docs/security.md) · [tooling](.context/docs/tooling.md) · [cenários de anomalia](.context/docs/anomaly-scenarios.md) · [débito técnico](.context/docs/tech-debt.md)
- **Handoff de design (original / histórico):** [README](docs/design_handoff_atena/README.md).

---

## Convenções

- **Commits:** [Conventional Commits](https://www.conventionalcommits.org/) (ex.: `feat(api): ...`, `chore(db): ...`).
- **Segredos:** nunca no git — `.env` é gerado em runtime e está no `.gitignore`.
- **PII:** nunca logar em claro; usar telefone mascarado/IDs e `severity: pii` no audit.
