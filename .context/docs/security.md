---
type: doc
name: security
description: Security policies, authentication, secrets management, and compliance requirements
category: security
generated: 2026-06-10
status: filled
scaffoldVersion: "2.0.0"
---

# Security & Compliance Notes

> Estado do repo: **apenas design handoff**. Não existe backend nem frontend de produção — o único código real é o protótipo standalone em [`(protótipo original, não incluído)`](../../(protótipo original, não incluído)) (referência de design, não copiar). Tudo abaixo descreve a **direção de segurança** definida no handoff, não controles já implementados. Fontes: [`README.md` §5 (princípios)](../../design_handoff_atena/README.md), [`02-data-model.md`](../../design_handoff_atena/02-data-model.md), [`01-backend-api-contract.md`](../../design_handoff_atena/01-backend-api-contract.md), e os estados do protótipo em [`prototype/tool-results.jsx`](../../(protótipo original, não incluído)) e [`prototype/error-states.jsx`](../../(protótipo original, não incluído)).

A Atena dá a times de suporte acesso a dados de envio de SMS — que incluem **PII** (telefone e conteúdo de mensagem) e dados de clientes. Por isso a segurança não é um módulo separável: ela está embutida nos 5 princípios de arquitetura não-negociáveis. Os controles centrais são:

1. **PII mascarada por padrão**, revelada só sob ação explícita e auditada.
2. **Audit log imutável (1 ano)** para toda ação sensível.
3. **RBAC** com dois papéis, aplicado por guard em cada endpoint.
4. **Validação dupla** (UI desabilita + backend revalida) para mudanças de estado.
5. **A IA é intérprete, não executora**: o LLM nunca toca o banco e nunca fabrica dados.

## Authentication & Authorization

**Autenticação (Bearer token).** Todo endpoint REST exige `Authorization: Bearer <token>` (ver convenção em [`01-backend-api-contract.md`](../../design_handoff_atena/01-backend-api-contract.md)). O WebSocket `/ws/support` valida o mesmo token no handshake. No MVP a autenticação é **login social institucional (OIDC) + RBAC** — OIDC via Microsoft 365 (Entra ID), atrás de uma abstração de auth para trocar de IdP facilmente (ex.: Google Workspace), **restrito ao domínio `@example.com`**, sem senha própria; o token/sessão OIDC é o Bearer. O RBAC é mapeado após o login. O **SSO corporativo completo (SAML + SCIM) é débito residual** (ver [`tech-debt.md`](./tech-debt.md)); o contrato fixa que o transporte é Bearer token.

**Sessão expirada.** Sessões inativas por mais de ~30 min são encerradas. Um token rejeitado retorna **401 Unauthorized**; o frontend reage com um overlay bloqueante (`SessionExpiredOverlay` em [`prototype/error-states.jsx`](../../(protótipo original, não incluído))) que oferece "Entrar de novo". A conversa em andamento é preservada no Histórico (persistida em `chat_sessions`/`chat_messages`), então o 401 não pode descartar trabalho do usuário.

**Autorização (RBAC — RNF-1.6).** Dois papéis mínimos, aplicados via **guards NestJS por endpoint** (direção da stack):

- **`support_analyst`** — chat, busca de mensagens, trilha de entrega, análise de conteúdo, e acknowledge/resolve de incidentes.
- **`support_lead`** — tudo do analyst **+** relatórios gerenciais (delivery/incident), edição de regras de anomalia, e acesso ao **audit log viewer**.

O guard roda **antes** da tool/handler; permissão é responsabilidade da aplicação, nunca do LLM (princípio 1). Um analyst que peça "gere o relatório de incidentes" em linguagem natural não consegue contornar o RBAC: a tool `generate_incident_report` é executada pela aplicação sob o guard do endpoint, que nega a um analyst.

## Secrets & Sensitive Data

**PII mascarada por padrão (princípio 5 / RNF-1.4).** Os dois campos de PII — telefone e conteúdo do SMS — chegam **mascarados** em qualquer resposta de tool. O valor em claro só aparece após um *reveal* explícito do usuário, que **gera entry no audit log**:

- **Telefone** — a resposta traz `phone` mascarado; `phoneFull` (`+55 11 98765-1234`) só é retornado se o usuário tem permissão e fez o reveal. No protótipo, `PhoneCell` mostra um toggle de olho com o tooltip "Revelar (registra acesso)" → ação de audit `reveal_phone`.
- **Conteúdo do SMS** — `contentPreview` só vem **após** reveal; mascarado por padrão. O `ContentRevealBox` ([`prototype/tool-results.jsx`](../../(protótipo original, não incluído))) exige um passo de **confirmação** antes de revelar, com o aviso explícito: *"Revelar o conteúdo de um SMS é uma ação auditada. Seu nome, IP e timestamp ficam registrados no audit log por 1 ano."* → ação de audit `reveal_content`. Leitura via cache transitório (read-through) dos dados brutos: lê-se primeiro do **`/tmp`**; se o conteúdo não estiver lá, **busca-se no bucket S3** (via `content_ref`/`s3_log_pointer`) sob demanda **com log de acesso**, populando o `/tmp`.

**Separação MySQL vs `/tmp` vs S3.** O MySQL hot store (`messages`) guarda **metadados** (status, provider, timestamps, `customer_id`) — não o texto do SMS. O conteúdo sensível e os logs originais `json.gz` ficam no **S3**; `content_ref` e `s3_log_pointer` em `messages` são apenas ponteiros. A leitura usa um cache transitório (read-through) dos dados brutos: primeiro o `/tmp`, e se não estiver lá, busca-se no bucket S3 por esses ponteiros (populando o `/tmp`) — para evitar muitas requisições ao S3 num curto período e manter os brutos fora do banco. Athena cobre janelas além da retenção. *Se o conteúdo do SMS deve ficar em claro no cache transitório de `/tmp` ou só no S3 é uma decisão pendente de política de PII* ([`06-pending-decisions.md`](../../design_handoff_atena/06-pending-decisions.md)) — o default seguro é "só no S3".

**`phone_hash` — busca sem PII em logs.** `messages` tem `phone_e164` (PII) **e** `phone_hash` (`VARCHAR(64)`). A busca por telefone deve usar o hash, para que telefones em claro não vazem em logs de query, traces ou métricas. Ver [`02-data-model.md`](../../design_handoff_atena/02-data-model.md).

**Audit log imutável (RNF-1.5).** A tabela `audit_log` é **append-only, com retenção de 1 ano**. A role do aplicativo recebe **apenas INSERT + SELECT** — sem UPDATE/DELETE no nível do banco (considerar particionamento por mês). Deve ser preenchida por um **interceptor global NestJS** (princípio 4), não chamada ad-hoc espalhada pelo código. O enum de `action` é fechado: `tool_call`, `reveal_phone`, `reveal_content`, `incident_created`, `incident_ack`, `incident_resolve`, `session_start`, `export_report`, `rule_update`; `severity` ∈ `info | warning | pii | config`. Cada entry registra `user_id` (ou `system` p/ o detector), `resource`, `ip_address` e `metadata`. *Onde o audit log mora — mesmo MySQL ou serviço dedicado — é decisão pendente* ([`decisions.md`](../../design_handoff_atena/decisions.md)).

**Segredos no repo (harness policy).** [`.context/harness/policy.json`](../harness/policy.json) tem `defaultEffect: allow` mas uma regra `deny` (`block-secrets`) que bloqueia qualquer caminho `**/.env*`, `**/*.pem`, `**/*.key`, `**/*secret*`. Em produção, segredos (client secret / credenciais OIDC do login social institucional, credenciais Amazon Bedrock, credenciais S3/MySQL) devem vir de vault / secret manager — nunca commitados. O `.gitignore` deve reforçar o mesmo. Atualmente nenhum `.env` real existe no repo.

## Compliance & Policies

- **RNF-1.4 — PII mascarada por padrão + reveal auditado** (telefone e conteúdo; confirmação antes de revelar conteúdo).
- **RNF-1.5 — Audit log imutável por 1 ano** (append-only, role INSERT+SELECT, interceptor global).
- **RNF-1.6 — RBAC** (`support_analyst` / `support_lead`, guard por endpoint).
- **Princípio 2 — LLM não fabrica dados.** Todo dado estruturado (telefone, ID, status, número) vem do retorno de uma tool determinística rodada pela aplicação. Pedido sem tool aplicável → **recusa explícita** (ver `RefusalCard` no protótipo), nunca um valor inventado. As únicas tools do LLM são as 8 read-only do catálogo (Fase 1: `search_shippings`, `get_shipping_trail`, `analyze_shipping_content`, `generate_delivery_report`, `list_providers`, `list_customers`; Fase 2: `list_incidents`, `get_incident`, `generate_incident_report`).
- **Princípio 3 — Mudança de estado de incidente não é tool do LLM.** `acknowledge`/`resolve`/`comment` só via UI + validação server-side; o LLM não pode disparar nem influenciar essas transições.
- **Retenção** — hot store (mensagens, sessões/mensagens de chat): 90 dias com job de purga → arquivo no S3/Athena. Audit log: 1 ano.

## Incident Response

Aqui "incidente" tem dois sentidos — não confundir:

**1. Incidentes do produto (Fase 2 — anomalias de envio).** O detector de anomalias cria `incidents` e empurra via WebSocket (`incident.created/updated/auto_resolved`, ver [`03-websocket-events.md`](../../design_handoff_atena/03-websocket-events.md)). O ciclo de vida (`detected → acknowledged → resolved | auto_resolved`) é controlado **só pela UI**, com **validação dupla** (RF-2.4):

- A UI desabilita botões/campos conforme o estado, **e** o backend **revalida** todo `POST /api/incidents/{id}/resolve` (ver §D de [`01-backend-api-contract.md`](../../design_handoff_atena/01-backend-api-contract.md)). Regras server-side: `actionCategory` obrigatório; `actionDescription` ≥ 20 chars (≥ 10 no fluxo `auto_resolved`); se `actionCategory` ∈ {`internal_escalated`, `provider_escalated`} → `escalatedTo` obrigatório; só permite transição de `acknowledged`/`detected`/`auto_resolved` → `resolved`. Toda mudança escreve em `incident_activity` (`status_change`) **+** audit log (`incident_ack` / `incident_resolve`). Validação client-side é só UX — a fonte da verdade é o backend.

**2. Resposta a incidente de segurança (operacional).** Não há runbook nem contatos definidos no handoff — é um gap a preencher quando o time/infra existir. Quando definido, o **audit log** é a principal fonte forense (quem revelou qual PII, quando, de qual IP, e quais tools rodaram), e a observabilidade (`GET /api/observability`, OpenTelemetry/Prometheus) cobre o comportamento do próprio assistente (latência por tool, erros, contagem de recusas).

Ver também [`architecture.md`](./architecture.md) para como esses controles se encaixam no fluxo orquestrador → tools → dados.

## Fase 1 — verificação (Sprint 1, fase V)

Checklist de validação do backend da Fase 1 (código + testes automatizados, sem infra):

- **PII mascarada por padrão.** `ShippingsService.search`/`getTrail` devolvem `phone_masked` e omitem `content_preview`; teste garante que o miolo do telefone não vaza (`shippings.service.spec`).
- **Reveal só sob demanda e auditado.** `POST /shippings/:id/reveal-phone` e `/reveal-content` expõem o dado completo apenas na resposta (nunca em log/audit), com `@Audit('reveal_phone'|'reveal_content','pii')`; conteúdo indisponível → 422 (`reveal.service.spec`).
- **LLM não fabrica dados.** O orquestrador só roteia tools do catálogo; sem tool aplicável → evento `refusal` (`orchestrator.service.spec`). Dado estruturado vem sempre do retorno de uma tool determinística.
- **Tudo auditado.** Endpoints de tool com `@Audit('tool_call')` (interceptor global) e cada tool rodada pelo orquestrador grava `tool_call` via `AuditService`. Audit log append-only.
- **RBAC enforçado.** `AuthGuard` + `RolesGuard` globais (`APP_GUARD`); endpoints de tools/chat exigem `@Roles('support_analyst','support_lead')`; `/health` e `/auth/*` são `@Public`. Sessão real OIDC ainda é stub: em dev, `auth.devBypass` resolve um usuário com papéis (prod: `AUTH_DEV_BYPASS=false`). Testes cobrem negação 401/403 (`session.guard.spec`/`roles.guard.spec`).
- **Validação de entrada.** DTOs `class-validator` + `ValidationPipe` global (`whitelist`+`transform`); erros no shape `{ error: { code, message } }` pelo `AllExceptionsFilter`.
- **Observabilidade.** `MetricsInterceptor` global loga latência/erro por requisição (sem PII); o orquestrador loga latência por tool e grava `latency_ms` na metadata do audit.
- **E2e HTTP.** Pipeline completo (prefixo/pipe/guards/interceptors/SSE/filtro): `http.e2e.spec` (Prisma mockado, roda no `make test`) **e** `db.e2e-spec` — **integração contra MySQL real** via `make test-e2e` (sobe o banco, migra, semeia; valida search/trilha/providers/reveal+audit/report/chat-SSE sobre o seed).
- **Cobertura.** 41 testes / 17 suítes (unit + contrato §C + invariantes + guards + e2e mock) no `make test` + 7 e2e de integração (`make test-e2e`); `npm run lint` 0 problemas; build verde.

**Pendências de validação (dependem de infra externa):**
- **Login OIDC real** (token-exchange Entra ID + sessão assinada) — RBAC já está enforçado estruturalmente, mas a resolução da sessão é dev-stub (`@todo OIDC` no `AuthGuard`; ver [tech-debt](./tech-debt.md)).
- Reveal de conteúdo ponta a ponta depende de credenciais S3 (hoje 422 em dev sem bucket).

## Fase 2 — verificação (Sprint 2, fase V)

Checklist de validação da Fase 2 (incidentes + detecção + tempo real + tools/relatório + observabilidade):

- **Princípio 3 — mudança de estado não é tool do LLM.** O lifecycle (`acknowledge`/`resolve`/`comment`) vive **só** em `IncidentLifecycleController` (REST), separado do read; o orquestrador NÃO tem case de ack/resolve/comment no `execute()` — as únicas tools de incidente expostas ao LLM são read-only (`list_incidents`/`get_incident`/`generate_incident_report`). Verificado nos testes (lifecycle service + e2e) e por inspeção do `switch` do orquestrador.
- **Validação dupla server-side (§D).** `IncidentLifecycleService` revalida toda transição: `acknowledge` só de `detected`; `resolve` só de `detected`/`acknowledged`/`auto_resolved` (senão **409**); `action_description` ≥ 20 chars (≥ 10 em `auto_resolved`) e `escalated_to` obrigatório em `*_escalated` (senão **422**). Coberto por `incident-lifecycle.service.spec` + e2e (`409`/`422` reais).
- **RBAC em todos os endpoints novos.** `@Roles('support_analyst','support_lead')` em incidentes (read + lifecycle), regras (`GET/PUT /rules`), relatório de incidentes (`POST /reports/incidents`), detector (`POST /dev/detect`) e observabilidade (`GET /observability`). Guards globais rodam antes do handler.
- **Tudo auditado.** `incident_ack`/`incident_resolve` gravados explicitamente pelo lifecycle (metadata com `incident_id`/`action_category`, sem PII); `rule_update` em toda edição de regra (severity `config`); as 3 tools read-only entram como `tool_call` via orquestrador/endpoint.
- **Sem PII em incidente / WS / observabilidade.** Incidentes agregam por **dimensão** (provider/customer) — `detectionPayload` traz regra/janela/resumo/métricas, nunca telefone/conteúdo. Eventos WS (`incident.created/updated/auto_resolved`, `connection.status`) carregam id/status/métricas, sem PII. `GET /observability` expõe contagens (sessões, uso por tool, reveals, conexões WS), sem PII.
- **WebSocket autenticado.** Handshake do `/ws/support` exige token (query/`auth`/`Authorization`); sem identidade, desconecta. Dev: `auth.devBypass` aceita sem token (igual ao REST), até o OIDC real (`@todo`).
- **Detector não fabrica nem fecha indevidamente.** Só regras com detector real (`delivery_rate_drop`) entram na reconciliação — um stub (detecção vazia) **não** auto-resolve incidentes. Cria incidente sem duplicar dimensão aberta; auto-resolve só quando a anomalia some. `system` é o ator (sem `user_id`) nas atividades automáticas.
- **Cobertura.** 77 testes / 25 suítes no `make test` (unit + contrato + detector + WS + lifecycle + e2e mock) + **15 e2e de integração** (`make test-e2e`, MySQL real: rules/incidents/lifecycle §D/reports-incidents/observability/dev-detect sobre o seed); `npm run lint` 0; build verde.

**Pendências de validação (Fase 2):**
- **Recusas não são persistidas** (sem `AuditAction` dedicada) → `observability.refusals` fica `0`/`@todo`; tokens/custo/MTTA/percentis de latência idem (OpenTelemetry/Prometheus).
- **`POST /api/dev/detect`** é gatilho de DEV (RBAC-guarded); em produção, considerar gatear por `detect.enabled`/ambiente ou removê-lo do build de prod.
- **Ingestão real (v1)** só popula o hot store após o deploy do produtor (`messaging-api`); logs pré-v1 são descartados pelos filtros (`is_canonical`/`channel`).
