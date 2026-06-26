# Atena

Assistente conversacional de IA da plataforma de comunicação. Dá a times de suporte autorizados **acesso self-service aos dados de envio de SMS** (busca, trilha de entrega, análise de risco, relatórios) e, na Fase 2, **detecta anomalias proativamente** (incidentes com push em tempo real e resolução estruturada).

> **Princípio central:** a IA é **intérprete, não executora** — o LLM traduz linguagem natural em chamadas de _tools_ determinísticas; é a **aplicação** que executa a query, aplica RBAC e acessa os dados. O LLM nunca toca o banco e nunca fabrica dados.

---

## Estado atual

| | |
|---|---|
| **Fase de design** | Handoff completo em [`docs/design_handoff_atena/`](docs/design_handoff_atena/) (specs, contratos, protótipo, screenshots). |
| **Sprint 0 — Fundação** | ✅ **concluído e verificado** (build `tsc` strict, `prisma migrate`, smoke `GET /health`). Monorepo NestJS + Prisma/MySQL + abstrações de auth/LLM/audit/cache. |
| **Próximo** | Sprint 1 — tools determinísticas + orquestrador LLM (ainda não iniciado). |

O backend de produção vive em [`apps/api`](apps/api/); os tipos compartilhados em [`packages/types`](packages/types/). Frontend e as tools ainda não foram implementados.

---

## Princípios não-negociáveis

1. **A IA é intérprete, não executora** — a aplicação roda a query, aplica RBAC e acessa os dados; o LLM só recebe o resultado estruturado.
2. **O LLM não fabrica dados** — todo dado estruturado vem do retorno de uma tool; sem tool aplicável → recusa explícita.
3. **Mudança de estado de incidente não é tool** — `acknowledge`/`resolve` só via UI + validação server-side.
4. **Tudo é auditado** — mensagens, tool calls, reveals de PII e mudanças de incidente → audit log imutável (1 ano), via interceptor global.
5. **PII mascarada por padrão** — telefone e conteúdo de SMS chegam mascarados; revelar gera entry no audit log.

---

## Stack

- **Backend:** TypeScript + **NestJS** (módulos/DI, guards, interceptors, WebSocket gateway).
- **Banco:** **MySQL** (hot store de metadados + `audit_log`), via **Prisma**.
- **LLM:** **Amazon Bedrock** (Claude via Bedrock, Converse API: streaming + tool use) — atrás de uma abstração trocável.
- **Auth:** login social institucional **OIDC** (Microsoft 365 / Entra ID, restrito ao domínio) — provider plugável; RBAC (`support_analyst` / `support_lead`).
- **Conteúdo bruto / logs:** **S3** (origem durável); **`/tmp`** é só **cache transitório** read-through (reduz idas ao S3 e mantém dados brutos fora do banco).
- **Deploy:** imagem **Docker** numa **EC2** (volume → `/tmp` do host).
- **Observabilidade (pretendida):** OpenTelemetry / Prometheus.

Decisões registradas em [`docs/design_handoff_atena/decisions.md`](docs/design_handoff_atena/decisions.md) e débitos em [`.context/docs/tech-debt.md`](.context/docs/tech-debt.md).

---

## Estrutura do repositório

```
apps/api/              # Backend NestJS (orquestrador + tools + REST/WS)
  prisma/schema.prisma # Schema MySQL (8 modelos) + migrations/
  src/                 # config, prisma, auth (OIDC+RBAC), audit, llm (Bedrock), cache (/tmp↔S3)
  Dockerfile           # imagem multi-stage
packages/types/        # @atena/types — contrato de shapes compartilhado
docs/design_handoff_atena/  # specs, contratos, protótipo, screenshots (fonte da verdade do design)
.context/              # base de conhecimento (dotcontext): docs, agents, skills, planos
docker-compose.yml     # profiles local | production
Makefile               # entrypoint de tarefas
```

---

## Como rodar (local)

**Pré-requisitos:** Node ≥ 20, Docker + Docker Compose.

```bash
# 1. variáveis de ambiente — gera o .env (NUNCA versionado) a partir do template
make env            # cria .env a partir de .env.example; preencha os valores

# 2. dependências
make install

# 3. sobe o stack local (API + MySQL via Docker)
make up ENV=local

# 4. migrações do banco
make migrate

# 5. healthcheck
curl localhost:3000/health   # -> {"status":"ok","service":"atena-api"}
```

Sem Docker, dá para rodar a API direto com `npm run dev` (precisa de um MySQL acessível em `DATABASE_URL`).

Veja todos os alvos com `make help`.

### Variáveis de ambiente

O app lê **sempre um único `.env`**, **gerado em runtime** e **nunca versionado** (em produção a partir de **SSM / Secrets Manager**; em local via `make env`). O único arquivo de env no git é o template [`.env.example`](.env.example).

---

## Banco de dados

- Schema em [`apps/api/prisma/schema.prisma`](apps/api/prisma/schema.prisma) (MySQL). Migrations versionadas em `apps/api/prisma/migrations/`.
- `make migrate` (dev) / `prisma migrate deploy` (produção, roda no entrypoint do container).
- O `audit_log` é **append-only** — o role de app deve ter só INSERT + SELECT.

---

## Documentação

- **Design handoff:** [README](docs/design_handoff_atena/README.md) · [spec V1](docs/design_handoff_atena/spec-assistente-suporte.md) · [01 — API](docs/design_handoff_atena/01-backend-api-contract.md) · [02 — Data Model](docs/design_handoff_atena/02-data-model.md) · [03 — WebSocket](docs/design_handoff_atena/03-websocket-events.md) · [04 — Telas→Endpoints](docs/design_handoff_atena/04-screen-to-endpoint-map.md)
- **Base de contexto (`.context/docs/`):** [arquitetura](.context/docs/architecture.md) · [fluxo de dados](.context/docs/data-flow.md) · [segurança](.context/docs/security.md) · [tooling](.context/docs/tooling.md) · [cenários de anomalia](.context/docs/anomaly-scenarios.md) · [débito técnico](.context/docs/tech-debt.md)
- **Planos:** [Sprint 0 — Fundação](.context/plans/sprint-0-fundacao.md)

---

## Roadmap

- **Sprint 0 — Fundação** ✅ — monorepo, NestJS, Prisma/MySQL, abstrações de auth/LLM/audit/cache, deploy.
- **Sprint 1 — Fase 1 (self-service)** — tools determinísticas (`search_messages`, `get_message_trail`, …), orquestrador LLM (stream SSE), mascaramento de PII, frontend do chat.
- **Sprint 2 — Fase 2 (proativo)** — detector de anomalias, WebSocket gateway, ciclo de vida do incidente, telas de regras/relatórios/audit/observabilidade.

---

## Convenções

- **Commits:** [Conventional Commits](https://www.conventionalcommits.org/) (ex.: `feat(api): ...`, `chore(db): ...`).
- **Segredos:** nunca no git — `.env` é gerado em runtime e está no `.gitignore`.
- **PII:** nunca logar em claro; usar `phone_hash`/IDs e `severity: pii` no audit.
