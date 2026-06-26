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

> Estado do repo: **MVP implementado**. Os controles abaixo refletem o **código atual** (`apps/api/src`), com referência histórica de design no handoff ([`README.md` §5 (princípios)](../../design_handoff_atena/README.md), [`01`](../../design_handoff_atena/01-backend-api-contract.md), [`02`](../../design_handoff_atena/02-data-model.md)). Nota: a API serializa em `snake_case` na borda (revisão do handoff).

A Atena dá a times de suporte acesso a dados de envio de SMS — que incluem **PII** (telefone e conteúdo de mensagem) e dados de clientes. Por isso a segurança não é um módulo separável: ela está embutida nos 5 princípios de arquitetura não-negociáveis. Os controles centrais são:

1. **PII mascarada por padrão**, revelada só sob ação explícita e auditada.
2. **Audit log imutável (1 ano)** para toda ação sensível.
3. **RBAC** com dois papéis, aplicado por guard em cada endpoint.
4. **Validação dupla** (UI desabilita + backend revalida) para mudanças de estado.
5. **A IA é intérprete, não executora**: o LLM nunca toca o banco e nunca fabrica dados.

## Authentication & Authorization

**Autenticação (OIDC + sessão por cookie JWT).** A auth é **OIDC Microsoft Entra** (state/nonce/PKCE), atrás de `IdentityProviderInterface` (trocável de IdP), **restrita ao domínio `@example.com`**, sem senha própria. A troca de `code` por token gera uma **sessão stateless por cookie JWT** (`atena_session`, `SameSite=None; Secure; HttpOnly`, TTL 8h); o mesmo cookie autentica os endpoints REST e o handshake socket.io de `/ws/support`. Endpoints: `/api/auth/login|callback|me|logout`. Em dev, `AUTH_DEV_BYPASS` resolve um usuário stub — **fail-closed**: só vale com `=true` **e** `NODE_ENV != production`. O **SSO corporativo completo (SAML + SCIM) é débito residual** (ver [`tech-debt.md`](./tech-debt.md)).

**Sessão expirada.** Cookie rejeitado/expirado retorna **401 Unauthorized**; o frontend reage com um overlay bloqueante que oferece re-login. A conversa em andamento é preservada no Histórico (`chat_sessions`/`chat_messages`), então o 401 não descarta trabalho. Sem revogação central do cookie antes do `exp` 8h (débito residual); a revogação de **papéis** é imediata (cache curto + lookup no banco).

**Autorização (RBAC gerenciado no app).** Papéis no banco (`users`/`user_roles`), **atribuídos por admin — NÃO vêm do IdP**. Catálogo: `admin`, `support_lead`, `support_analyst`, `viewer`. Modelo **papéis→permissões** (mapa em código `auth/rbac/permissions.ts`); guard **`@Requires(perm)`** (AND das permissões) rodando antes da tool/handler. Papéis lidos do banco por requisição (cache ~30s). Gate de acesso: sem papel → `access_pending`; `disabled` → `access_disabled`. Bootstrap de admins por `AUTH_ADMIN_EMAILS`. Permissões-chave: `pii:reveal` (revelar telefone/conteúdo **e** os exports CSV com PII), `incidents:ack`/`resolve`/`comment`, `rules:edit`, `users:manage`.

Permissão é responsabilidade da aplicação, nunca do LLM (princípio 1): quem peça uma ação restrita em linguagem natural não contorna o RBAC — a tool é executada pela aplicação sob o guard do endpoint, que nega sem a permissão.

## Secrets & Sensitive Data

**PII mascarada por padrão (princípio 5 / RNF-1.4).** Os dois campos de PII — telefone e conteúdo do SMS — chegam **mascarados** em qualquer resposta de tool. O valor em claro só aparece após um *reveal* explícito do usuário, que **gera entry no audit log**:

- **Telefone** — a resposta traz `phone` mascarado; o telefone em claro só é retornado por `POST /shippings/:id/reveal-phone` quando o usuário tem a permissão `pii:reveal` → ação de audit `reveal_phone`.
- **Conteúdo do SMS** — `content_preview` só vem **após** reveal (`POST /shippings/:id/reveal-content`); mascarado por padrão. O front exige um passo de **confirmação** antes de revelar, com aviso explícito de que a ação é auditada → ação de audit `reveal_content`. Leitura via cache transitório (read-through) dos dados brutos: lê-se primeiro do **`/tmp`**; se o conteúdo não estiver lá, **busca-se no S3** (via `content_ref`) sob demanda **com log de acesso**, populando o `/tmp`.

**Separação dado-da-app (MySQL) vs `/tmp` vs S3.** O dado de **ENTREGA não fica no MySQL** — vem do **detailed report no S3** (`s3://example-sms-delivery-reports`), consultado por DuckDB. O MySQL guarda só dado da aplicação (chat, incidentes, regras, audit log, usuários/papéis). O conteúdo sensível/PII fica no **S3**; a leitura usa um cache transitório (read-through): primeiro o `/tmp`, e se não estiver lá, busca-se no S3 (via `content_ref`), populando o `/tmp` — para evitar muitas requisições ao S3 num curto período e manter os brutos fora do banco. O `/tmp` é cache efêmero/rebuildável; o conteúdo bruto durável vive no S3 (default seguro).

**Telefone sem PII em logs.** No grão da auditoria o telefone é normalizado para só-dígitos e usado na composição do id (`md5(campaign_id||'|'||phone)`); a regra de código é **nunca logar PII** — logs usam IDs/`phone_hash`, e apenas `method + path` (sem query string). Ver [code-style.md](./code-style.md).

**Audit log imutável (RNF-1.5).** A tabela `audit_log` é **append-only**. A role do aplicativo recebe **apenas INSERT + SELECT** — sem UPDATE/DELETE no nível do banco. É preenchida por um **interceptor global NestJS** (`@Audit`, princípio 4), não por chamadas ad-hoc. O enum de `action` inclui: `tool_call`, `reveal_phone`, `reveal_content`, `incident_created`, `incident_ack`, `incident_resolve`, `session_start`, `export_report`, `rule_update`, `user_role_update`, `user_status_update`; `severity` ∈ `info | warning | pii | config`. Cada entry registra `user_id` (ou `system` p/ o detector), `resource`, `ip_address` e `metadata`.

**Segredos no repo (harness policy).** [`.context/harness/policy.json`](../harness/policy.json) tem `defaultEffect: allow` mas uma regra `deny` (`block-secrets`) que bloqueia qualquer caminho `**/.env*`, `**/*.pem`, `**/*.key`, `**/*secret*`. Em produção, segredos (client secret / credenciais OIDC do login social institucional, credenciais Amazon Bedrock, credenciais S3/MySQL) devem vir de vault / secret manager — nunca commitados. O `.gitignore` deve reforçar o mesmo. Atualmente nenhum `.env` real existe no repo.

## Compliance & Policies

- **RNF-1.4 — PII mascarada por padrão + reveal auditado** (telefone e conteúdo; confirmação antes de revelar conteúdo; permissão `pii:reveal`).
- **RNF-1.5 — Audit log imutável** (append-only, role INSERT+SELECT, interceptor global `@Audit`).
- **RNF-1.6 — RBAC gerenciado no app** (papéis `admin`/`support_lead`/`support_analyst`/`viewer` no banco, guard `@Requires(perm)` por endpoint).
- **Princípio 2 — LLM não fabrica dados.** Todo dado estruturado (telefone, ID, status, número) vem do retorno de uma tool determinística rodada pela aplicação. Pedido sem tool aplicável → **recusa explícita** (`RefusalCard`), nunca um valor inventado. As tools read-only do catálogo são `search_shippings`, `get_shipping_trail`, `analyze_shipping_content`, `generate_delivery_report`, `list_providers`, `list_customers`, `list_incidents`, `get_incident`, `generate_incident_report`.
- **Princípio 3 — Mudança de estado de incidente não é tool do LLM.** `acknowledge`/`resolve`/`comment` só via UI + validação server-side; o LLM não pode disparar nem influenciar essas transições.
- **Retenção** — chat (sessões/mensagens): job diário configurável (`CHAT_RETENTION_DAYS`, default 90). O dado de entrega vem do detailed report no S3 (não há purga local). Audit log: append-only.

## Incident Response

Aqui "incidente" tem dois sentidos — não confundir:

**1. Incidentes do produto (anomalias de envio).** O detector de anomalias cria `incidents` e empurra via **socket.io** (`incident.created/updated/auto_resolved`). O ciclo de vida (`detected → acknowledged → resolved | auto_resolved`) é controlado **só pela UI**, com **validação dupla** (RF-2.4):

- A UI desabilita botões/campos conforme o estado, **e** o backend **revalida** todo `POST /api/incidents/:id/resolve`. Regras server-side: `action_category` obrigatório; `action_description` ≥ 20 chars (≥ 10 no fluxo `auto_resolved`); se `action_category` ∈ {`internal_escalated`, `provider_escalated`} → `escalated_to` obrigatório; só permite transição de `acknowledged`/`detected`/`auto_resolved` → `resolved`. Toda mudança escreve em `incident_activity` (`status_change`) **+** audit log (`incident_ack` / `incident_resolve`). Validação client-side é só UX — a fonte da verdade é o backend.

**2. Resposta a incidente de segurança (operacional).** Não há runbook nem contatos formalizados — gap a preencher conforme o time/infra. O **audit log** é a principal fonte forense (quem revelou qual PII, quando, de qual IP, e quais tools rodaram), e a observabilidade (`GET /api/observability`, Datadog opcional) cobre o comportamento do próprio assistente (uso/latência por tool, erros, recusas).

Ver também [`architecture.md`](./architecture.md) para como esses controles se encaixam no fluxo orquestrador → tools → dados.

## Fase 1 — verificação (Sprint 1, fase V)

Checklist de validação do backend da Fase 1 (código + testes automatizados, sem infra):

- **PII mascarada por padrão.** `ShippingsService.search`/`getTrail` devolvem `phone_masked` e omitem `content_preview`; teste garante que o miolo do telefone não vaza (`shippings.service.spec`).
- **Reveal só sob demanda e auditado.** `POST /shippings/:id/reveal-phone` e `/reveal-content` expõem o dado completo apenas na resposta (nunca em log/audit), com `@Audit('reveal_phone'|'reveal_content','pii')`; conteúdo indisponível → 422 (`reveal.service.spec`).
- **LLM não fabrica dados.** O orquestrador só roteia tools do catálogo; sem tool aplicável → evento `refusal` (`orchestrator.service.spec`). Dado estruturado vem sempre do retorno de uma tool determinística.
- **Tudo auditado.** Endpoints de tool com `@Audit('tool_call')` (interceptor global) e cada tool rodada pelo orquestrador grava `tool_call` via `AuditService`. Audit log append-only.
- **RBAC enforçado.** `AuthGuard` + guard de permissões globais (`APP_GUARD`); endpoints exigem `@Requires(perm)`; `/health` e `/auth/*` são `@Public`. **Login OIDC real ligado e validado** (state/nonce/PKCE + sessão por cookie JWT); em dev, `auth.devBypass` resolve um usuário stub `admin` (fail-closed: `=true` E `NODE_ENV != production`). Testes cobrem negação 401/403.
- **Validação de entrada.** DTOs `class-validator` + `ValidationPipe` global (`whitelist`+`transform`); erros no shape `{ error: { code, message } }` pelo `AllExceptionsFilter`.
- **Observabilidade.** `MetricsInterceptor` global loga latência/erro por requisição (sem PII); o orquestrador loga latência por tool e grava `latency_ms` na metadata do audit. Métricas via DogStatsD/Datadog (opcional).
- **E2e HTTP.** Pipeline completo (prefixo/pipe/guards/interceptors/SSE/filtro): `http.e2e.spec` (Prisma mockado, roda no `make test`) **e** `db.e2e-spec` — **integração contra MySQL real** via `make test-e2e` (sobe o banco, migra, semeia; valida search/trilha/providers/reveal+audit/report/chat-SSE sobre o seed).

**Notas:**
- Reveal de conteúdo ponta a ponta depende de credenciais/bucket S3 (conteúdo indisponível → 422).

## Fase 2 — verificação (Sprint 2, fase V)

Checklist de validação da Fase 2 (incidentes + detecção + tempo real + tools/relatório + observabilidade):

- **Princípio 3 — mudança de estado não é tool do LLM.** O lifecycle (`acknowledge`/`resolve`/`comment`) vive **só** em `IncidentLifecycleController` (REST), separado do read; o orquestrador NÃO tem case de ack/resolve/comment no `execute()` — as únicas tools de incidente expostas ao LLM são read-only (`list_incidents`/`get_incident`/`generate_incident_report`). Verificado nos testes (lifecycle service + e2e) e por inspeção do `switch` do orquestrador.
- **Validação dupla server-side (§D).** `IncidentLifecycleService` revalida toda transição: `acknowledge` só de `detected`; `resolve` só de `detected`/`acknowledged`/`auto_resolved` (senão **409**); `action_description` ≥ 20 chars (≥ 10 em `auto_resolved`) e `escalated_to` obrigatório em `*_escalated` (senão **422**). Coberto por `incident-lifecycle.service.spec` + e2e (`409`/`422` reais).
- **RBAC em todos os endpoints.** `@Requires(perm)` em incidentes (read + lifecycle), regras (`GET/PUT /rules`), relatório de incidentes (`POST /reports/incidents`), detector (`POST /dev/detect`), observabilidade (`GET /observability`) e admin de usuários. Guards globais rodam antes do handler.
- **Tudo auditado.** `incident_ack`/`incident_resolve` gravados explicitamente pelo lifecycle (metadata com `incident_id`/`action_category`, sem PII); `rule_update` em toda edição de regra (severity `config`); `user_role_update`/`user_status_update` em mudanças de admin; as tools read-only entram como `tool_call`.
- **Sem PII em incidente / WS / observabilidade.** Incidentes agregam por **dimensão** (provider/customer) — `detectionPayload` traz regra/janela/resumo/métricas, nunca telefone/conteúdo. Eventos socket.io (`incident.created/updated/auto_resolved`, `connection.status`) carregam id/status/métricas, sem PII. `GET /observability` expõe contagens (sessões, uso por tool, reveals, conexões WS), sem PII.
- **Socket.io autenticado.** Handshake do `/ws/support` exige a sessão por cookie JWT; sem identidade, desconecta. Dev: `auth.devBypass` aceita sem cookie (igual ao REST).
- **Detector não fabrica nem fecha indevidamente.** Cria incidente sem duplicar dimensão aberta; auto-resolve só quando a anomalia some. Regra em **shadow mode** registra mas não notifica. `system` é o ator (sem `user_id`) nas atividades automáticas.

**Notas (Fase 2):**
- **`POST /api/dev/detect`** é gatilho de DEV (RBAC-guarded); o scan agendado liga por `DETECT_ENABLED`. Em produção, considerar gatear/remover o gatilho dev.
- A fonte da entrega é o **detailed report no S3** (`example-sms-delivery-reports`); o canal coberto é `sms`/`sms_flash` (voz/RCS fora).
