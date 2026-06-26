---
type: doc
name: glossary
description: Project terminology, type definitions, domain entities, and business rules
category: glossary
generated: 2026-06-10
status: filled
scaffoldVersion: "2.0.0"
---

## Glossary & Domain Concepts

Terminologia do domínio da Atena — o assistente conversacional de IA da plataforma de comunicação, voltado ao acesso self-service a dados de envio de SMS e à detecção proativa de anomalias. As definições refletem o **código atual** (MVP implementado); o handoff ([01](../../docs/design_handoff_atena/01-backend-api-contract.md), [02](../../docs/design_handoff_atena/02-data-model.md), [05](../../docs/design_handoff_atena/05-design-reference.md)) é referência histórica de design/contrato.

> Nota: os tipos/shapes são exportados de **`@atena/types`** (`packages/types/src/index.ts`), consumidos por back e front. A API serializa em **`snake_case`** na borda (revisão do handoff). A entidade de entrega chama-se **"shipping"** (UI = "Envio").

## Type Definitions

Tipos/shapes de contrato (em `@atena/types`):

- **`SearchResultRowInterface`** — linha de busca: `shipping_id`, `phone` (mascarado), `status`, `provider`, `customer`, `channel`, `app_id`, `requested_at`, `finalized_at`, `error_hint`. Envelope paginado: `{ rows, page, total_pages, total, latency_ms }`.
- **`ShippingTrailInterface`** — trilha de um envio: `shipping_id`, `customer`, `provider`, `phone` (mascarado), `final_status`, `content_ref`, `content_preview?`, `events[]`.
- **`ShippingTrailEvent`** — item da trilha: `{ type, label, at, detail }`.
- **`RiskAnalysisInterface`** — risco: `score`, `verdict`, `categories[]`, `explanation`.
- **`DeliveryReportInterface`** — relatório de entregabilidade: `window`, `totals`, `by_provider[]`, `hourly[]`, `top_errors[]`, `csv_url`.
- **`IncidentInterface`** — incidente: `id`, `rule`, `severity`, `status`, `dimension_type`, `dimension_value`, `detected_at`, `window`, `summary`, `metrics`, `related_shipping_ids`, `assignee`.
- **`AnomalyRuleInterface`** — regra (tabela `anomaly_rules`): `id`, `name`, `rule_type`, `dimension`, `enabled`, `severity`, `threshold`, `threshold_unit`, `window_minutes`, `shadow_mode`.
- **`AuditLogEntryInterface`** — entry de audit: `id`, `occurred_at`, `user_id`, `action`, `resource`, `detail`, `severity`, `ip_address`, `metadata`.
- **RBAC**: `RoleType`, `PermissionType`, `UserStatusType`; `SessionUserInterface`, `AdminUserInterface`.
- **Eventos WebSocket** (`WsServerEvent`, socket.io): `incident.created`, `incident.updated`, `incident.auto_resolved`, `connection.status`.
- **Eventos de stream SSE do chat** (`ChatStreamEvent`): `tool_call`, `tool_result`, `text_delta`, `done`, `refusal`.

## Enumerations

Enums do domínio (de [02-data-model.md](../../docs/design_handoff_atena/02-data-model.md) e [01](../../docs/design_handoff_atena/01-backend-api-contract.md)):

- **`final_status`** (envio): `delivered | failed | pending | unknown`.
- **tipos de evento da trilha**: `api_request | routing | provider_attempt | webhook_status | final` (derivados do detailed report; não há mais tabela `message_events`).
- **`incidents.severity`**: `info | warning | critical`.
- **`incidents.status`**: `detected | acknowledged | resolved | auto_resolved`.
- **`incidents.dimension_type`** / **`anomaly_rules.dimension`**: `provider | customer | route | global`.
- **`action_category`** (resolve): `provider_recovered | provider_escalated | internal_escalated | false_positive | customer_communicated | monitoring_only | other`.
- **`anomaly_rules.rule_type`**: `delivery_rate_drop | failure_spike | consistent_error | webhook_silence` (imutável na UI).
- **`anomaly_rules.threshold_unit`**: `% | σ | min`.
- **`audit_log.action`**: `tool_call | reveal_phone | reveal_content | incident_created | incident_ack | incident_resolve | session_start | export_report | rule_update | user_role_update | user_status_update`.
- **`audit_log.severity`**: `info | warning | pii | config`.
- **`chat_messages.role`**: `user | assistant`.
- **`risk.verdict`**: `low | medium | high`.
- **Canal (`channel`)**: `sms | sms_flash` (Short + Flash; voz/RCS fora).
- **Papéis RBAC** (`RoleType`): `admin | support_lead | support_analyst | viewer`.
- **`UserStatusType`**: `active | disabled`.

## Core Terms

- **Tool** — função determinística que o LLM pode invocar (única superfície de ação dele): `search_shippings`, `get_shipping_trail`, `analyze_shipping_content`, `generate_delivery_report`, `list_providers`, `list_customers`, `list_incidents`, `get_incident`, `generate_incident_report`. Cada uma tem endpoint REST espelhado. **Não são tools:** `acknowledge`/`resolve`/`comment` de incidente.
- **Orquestrador** — componente (`chat/orchestrator.service.ts`) que roda o loop de tool use via Amazon Bedrock (Amazon Nova Pro `us.amazon.nova-pro-v1:0`, Converse API, streaming + tool use): interpreta NL → escolhe tool, a aplicação executa, o resultado volta ao LLM, que gera o texto. O orquestrador (a aplicação) acessa dados; **o LLM nunca toca o banco**. Sem credencial Bedrock, um **provider fake** determinístico assume.
- **ThinkingSplitter** — utilitário (`chat/thinking-splitter.ts`) que separa as tags `<thinking>…</thinking>` que o Nova emite inline no stream, isolando o raciocínio do texto final.
- **Recusa (refusal)** — quando não há tool aplicável, o stream emite `refusal` em vez de `tool_call`. Garante que o LLM **não fabrique dados**. UI: `RefusalCard`.
- **Trilha (trail)** — linha do tempo completa de um envio (`get_shipping_trail`), composta pelos eventos do detailed report em ordem cronológica. UI: `TrailTimeline`.
- **tipos de evento da trilha** — eventos do ciclo de vida de um envio: `api_request` (requisição recebida), `routing` (escolha do fornecedor), `provider_attempt` (tentativa no fornecedor), `webhook_status` (status reportado por webhook), `final` (status final).
- **Incidente** — registro de uma anomalia detectada (tabela `incidents`), criado pelo detector; guarda os IDs dos envios impactados em `related_shipping_ids`.
- **Shadow mode** — regra de anomalia em observação silenciosa: detecta e **registra** o incidente (marcado `shadow=true`), mas **não notifica**. Serve para calibrar thresholds sem ruído.
- **Ciclo do incidente** — `detected` (recém-criado pelo detector) → `acknowledged` (analista reconheceu) → `resolved` (resolvido com ação registrada) ou `auto_resolved` (métrica voltou à baseline sem intervenção). Transições só de `detected`/`acknowledged`/`auto_resolved` → `resolved`.
- **Severidade (severity)** — gravidade do incidente: `info`, `warning`, `critical`. Mapeada em cores semânticas (info `#0052CC`, warning `#E0A500`, critical = danger `#C12722`).
- **Dimensão (dimension)** — eixo onde a anomalia ocorre: `provider`, `customer`, `route`, `global`. Tem `dimensionType` + `dimensionValue` (ex.: provider / "Twilio").
- **action_category** — categoria obrigatória ao resolver um incidente: `provider_recovered`, `provider_escalated`, `internal_escalated`, `false_positive`, `customer_communicated`, `monitoring_only`, `other`. Alimenta o relatório gerencial.
- **anomaly_rule e rule_types** — regra de detecção (tabela `anomaly_rules`), editável na tela de Regras (threshold/dimensão/janela/severidade/enabled). Tipos: `delivery_rate_drop` (queda de taxa de entrega), `failure_spike` (pico de falhas), `consistent_error` (erro recorrente), `webhook_silence` (silêncio de webhook). `rule_type` é imutável na UI.
- **MTTA / MTTR** — Mean Time To Acknowledge / Mean Time To Resolve. Métricas-chave dos relatórios de incidente e da observabilidade; meta de design MTTA < 5 min (endereçada pelo banner persistente).
- **Reveal de PII** — ação de revelar telefone (`reveal_phone`) ou conteúdo (`reveal_content`) que por padrão chegam mascarados. Exige a permissão **`pii:reveal`**; conteúdo é lido primeiro do cache transitório (read-through) dos dados brutos (`/tmp`) e, se não estiver lá, buscado no S3 via `content_ref` (populando o `/tmp`). Todo reveal gera audit (severity `pii`). Endpoints: `POST /shippings/:id/reveal-phone`/`reveal-content`. A mesma permissão libera os **exports CSV com PII**.
- **phone (E.164)** — telefone no formato E.164 (ex.: `+5511987651234`); exibido mascarado por padrão. No grão da auditoria, normalizado para **só dígitos**.
- **content_ref** — ponteiro para o conteúdo bruto do SMS no S3. O texto sensível nunca fica em claro no MySQL (o dado de entrega não fica no MySQL).
- **Grão por destinatário (`campaign_id`, `phone`)** — a auditoria agrupa por `campaign_id` + `phone`, com `id = md5(campaign_id||'|'||phone)`; `phone` normalizado só-dígitos na ingestão.
- **`requested_at` / `finalized_at`** — instante do **envio** (`queued`) e instante do **desfecho**. A janela de busca/relatório é por **envio** (`requested_at`); o detector de regras de taxa olha o desfecho. O scan das partições é **simétrico** (±`lateStatusBuffer`, default ~48–72h).
- **Cache transitório (`/tmp`)** — cache read-through dos dados brutos derivados do detailed report, materializado como arquivos parquet no `/tmp` (volume Docker numa EC2 em prod). Lê do `/tmp`; se faltar, **busca no S3** populando o `/tmp`. **Efêmero/rebuildável** — nada durável mora só aqui. Eviction por idade+tamanho (`ATENA_AUDIT_CACHE_MAX_MB`/`_MAX_AGE_HOURS`). Três camadas: (a) `/tmp` = cache efêmero; (b) **S3** = origem durável dos brutos e do conteúdo; (c) **MySQL** = dado da aplicação + `audit_log` (durável).
- **Audit log** — registro imutável (tabela `audit_log`, só INSERT + SELECT) de toda ação auditável; alimentado por interceptor global NestJS (`@Audit`).
- **RBAC (papéis→permissões)** — papéis `admin`/`support_lead`/`support_analyst`/`viewer` no banco (`users`/`user_roles`), **atribuídos por admin** (não vêm do IdP). Mapa papéis→permissões em código (`auth/rbac/permissions.ts`); guard `@Requires(perm)` (AND das permissões). Ex.: `pii:reveal`, `incidents:*`, `rules:edit`, `users:manage`. Papéis lidos do banco por requisição (cache ~30s).
- **Auth (MVP)** — **OIDC Microsoft Entra** (state/nonce/PKCE), atrás de `IdentityProviderInterface` (trocável de IdP), **restrito ao domínio `@example.com`**, sem senha própria. Sessão **stateless por cookie JWT** (`atena_session`, `SameSite=None; Secure; HttpOnly`), validada nos endpoints REST e no handshake socket.io. Usuário persistido no login (upsert); papéis lidos do banco. Em dev, `AUTH_DEV_BYPASS` (fail-closed: só vale com `=true` **e** `NODE_ENV != production`) resolve um usuário stub com papel `admin`. Bootstrap de admins por `AUTH_ADMIN_EMAILS`.
- **SSO** — Single Sign-On corporativo completo da Acme (SAML + SCIM); **débito residual** (o MVP já usa OIDC). Ver [tech-debt.md](./tech-debt.md).
- **Plankton** — cor primária de marca do assistente (`plankton800 #077E70`, teal). Thanos (roxo) fica fora do MVP; a paleta é Plankton + cores semânticas.
- **Banner de incidente** — faixa persistente vermelha no topo do chat, estilo escolhido para push de incidente (vs. toast ou painel auto-aberto): alta visibilidade sem interromper o que o analista está fazendo.

## Acronyms & Abbreviations

- **PII** — Personally Identifiable Information (telefone, conteúdo de SMS). Mascarada por padrão.
- **MTTA / MTTR** — Mean Time To Acknowledge / Resolve.
- **RBAC** — Role-Based Access Control.
- **SSO** — Single Sign-On corporativo completo (Acme, SAML + SCIM). Débito residual (ver [tech-debt.md](./tech-debt.md)); o MVP já usa OIDC.
- **SAML / OIDC** — OIDC (Microsoft Entra) é o protocolo de auth do MVP; SAML (SSO corporativo completo) é débito residual.
- **SSE** — Server-Sent Events (stream da resposta do chat).
- **WS** — WebSocket (socket.io em `/ws/support`, push de incidentes).
- **LLM** — Large Language Model (Amazon Nova Pro `us.amazon.nova-pro-v1:0` via Amazon Bedrock Converse; provider fake sem credencial).
- **RF / RNF** — Requisito Funcional / Não-Funcional (em `spec-assistente-suporte.md`).
- **E.164** — formato internacional de número de telefone.
- **ORM** — Object-Relational Mapper (Prisma, sobre MySQL).
- **DI** — Dependency Injection (módulos NestJS).
- **CSV** — formato de export de relatório/busca (`csv_url`; export com PII exige `pii:reveal`).
- **APM / DogStatsD** — observabilidade via Datadog (dd-trace + hot-shots); opcional/opt-in.

## Personas / Actors

- **support_analyst (analista de suporte)** — usuário do chat. Investiga reclamações de clientes, busca envios, abre trilhas, analisa risco de conteúdo, reconhece (ack) e resolve incidentes.
- **support_lead (líder de suporte)** — faz tudo do analista + gera relatórios gerenciais (MTTA/MTTR, distribuição por ação), edita regras de anomalia e visualiza o audit log.
- **admin** — gerencia usuários e papéis (`/admin/usuarios`), além do que o lead faz.
- **viewer** — acesso somente-leitura (papel mais restrito).
- **Detector de anomalias (ator de sistema)** — cria incidentes automaticamente, dispara `incident.created` e `incident.auto_resolved`. Aparece no audit log como `system`.

## Domain Rules & Invariants

Regras de negócio não-negociáveis (de [README §5](../../docs/design_handoff_atena/README.md), [01 §D](../../docs/design_handoff_atena/01-backend-api-contract.md), [02](../../docs/design_handoff_atena/02-data-model.md)):

- **LLM não acessa o banco** e **não fabrica dados**: todo dado estruturado vem do retorno de uma tool; sem tool aplicável → recusa.
- **Mudança de estado de incidente nunca é tool do LLM**: `acknowledge`/`resolve`/`comment` só via REST/UI com validação server-side.
- **Validação de resolve (server-side):** `actionCategory` ∈ enum; `actionDescription` ≥ 20 chars (≥ 10 no fluxo `auto_resolved`); se `actionCategory ∈ {provider_escalated, internal_escalated}` → `escalatedTo` obrigatório; só transição de `detected`/`acknowledged`/`auto_resolved` → `resolved`; toda mudança escreve em `incident_activity` + audit log.
- **`rule_type` imutável na UI** (só threshold/dimensão/janela/severidade/enabled são editáveis); toda alteração gera audit `rule_update`.
- **PII mascarada por padrão**; reveal exige permissão `pii:reveal` (e, no conteúdo, confirmação) e sempre gera audit (severity `pii`). Conteúdo bruto só no S3 (não no MySQL).
- **Audit log imutável**: sem UPDATE/DELETE; app role só INSERT + SELECT.
- **Dado de entrega fora do MySQL:** vem do detailed report no S3 via DuckDB; retenção do chat configurável (default 90d, módulo `retention`).
- **Convenção de dados:** snake_case no DB **e na borda da API** (revisão do handoff, que era camelCase); datas ISO 8601 UTC; erros no formato `{ error: { code, message } }`.
- **Localização:** PT-BR informal (`você`), sem emoji no produto.

## Cross-References

- [Project Overview](./project-overview.md)
- [Architecture Notes](./architecture.md)
- [Data Flow & Integrations](./data-flow.md)
- Handoff: [01 — API Contract](../../docs/design_handoff_atena/01-backend-api-contract.md) · [02 — Data Model](../../docs/design_handoff_atena/02-data-model.md) · [05 — Design Reference](../../docs/design_handoff_atena/05-design-reference.md)
