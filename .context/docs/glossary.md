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

Terminologia do domínio da Atena — o assistente conversacional de IA da plataforma de comunicação, voltado ao acesso self-service a dados de envio de SMS e à detecção proativa de anomalias. As definições vêm do handoff ([01](../../docs/design_handoff_atena/01-backend-api-contract.md), [02](../../docs/design_handoff_atena/02-data-model.md), [05](../../docs/design_handoff_atena/05-design-reference.md), [decisions.md](../../docs/design_handoff_atena/decisions.md)).

> Nota: não há código de produção ainda. Tipos e enums abaixo são o **contrato** definido no handoff (e exercitado pelos mocks de `prototype/data.jsx`), não símbolos exportados de um codebase de produção.

## Type Definitions

Tipos/shapes de contrato (pretendidos no pacote `@atena/types`; hoje materializados nos mocks do protótipo e em [01 §C](../../docs/design_handoff_atena/01-backend-api-contract.md)):

- **`SearchResultRow`** — linha de busca (§C.1): `id`, `phoneMasked`, `phoneFull?`, `status`, `provider`, `customer`, `requestedAt`, `errorHint`. Envelope: `{ rows, page, totalPages, total, latencyMs }`.
- **`MessageTrail`** — trilha (§C.2): `messageId`, `customer`, `provider`, `phoneMasked`, `finalStatus`, `contentRef`, `contentPreview?`, `events[]`.
- **`MessageEvent`** — item da trilha: `{ type, label, at, detail }`.
- **`RiskAnalysis`** — risco (§C.3): `score`, `verdict`, `categories[]`, `explanation`.
- **`DeliveryReport`** — relatório (§C.4): `window`, `totals`, `byProvider[]`, `hourly[]`, `topErrors[]`, `csvUrl`.
- **`Incident`** — incidente (§C.5): `id`, `rule`, `severity`, `status`, `dimensionType`, `dimensionValue`, `detectedAt`, `window`, `summary`, `metrics`, `relatedShippings`, `assignee`.
- **`AnomalyRule`** — regra (tabela `anomaly_rules`): `rule_id`, `name`, `rule_type`, `dimension`, `enabled`, `severity`, `threshold`, `threshold_unit`, `window_minutes`.
- **`AuditEntry`** — entry de audit: `audit_id`, `occurred_at`, `user_id`, `action`, `resource`, `detail`, `severity`, `ip_address`, `metadata`.
- **Eventos WebSocket**: `incident.created`, `incident.updated`, `incident.auto_resolved`, `connection.status` ([03](../../docs/design_handoff_atena/03-websocket-events.md)).
- **Eventos de stream SSE do chat**: `tool_call`, `tool_result`, `text_delta`, `done`, `refusal` ([01 §A](../../docs/design_handoff_atena/01-backend-api-contract.md)).

## Enumerations

Enums do domínio (de [02-data-model.md](../../docs/design_handoff_atena/02-data-model.md) e [01](../../docs/design_handoff_atena/01-backend-api-contract.md)):

- **`final_status`** (mensagem): `delivered | failed | pending | unknown`.
- **`message_events.event_type`**: `api_request | routing | provider_attempt | webhook_status | final`.
- **`incidents.severity`**: `info | warning | critical`.
- **`incidents.status`**: `detected | acknowledged | resolved | auto_resolved`.
- **`incidents.dimension_type`** / **`anomaly_rules.dimension`**: `provider | customer | route | global`.
- **`action_category`** (resolve): `provider_recovered | provider_escalated | internal_escalated | false_positive | customer_communicated | monitoring_only | other`.
- **`anomaly_rules.rule_type`**: `delivery_rate_drop | failure_spike | consistent_error | webhook_silence` (imutável na UI).
- **`anomaly_rules.threshold_unit`**: `% | σ | min`.
- **`audit_log.action`**: `tool_call | reveal_phone | reveal_content | incident_created | incident_ack | incident_resolve | session_start | export_report | rule_update`.
- **`audit_log.severity`**: `info | warning | pii | config`.
- **`chat_messages.role`**: `user | assistant`.
- **`risk.verdict`**: `low | medium | high`.
- **Papéis RBAC**: `support_analyst | support_lead`.

## Core Terms

- **Tool** — função determinística que o LLM pode invocar (única superfície de ação dele). Fase 1: `search_shippings`, `get_shipping_trail`, `analyze_shipping_content`, `generate_delivery_report`, `list_providers`, `list_customers`. Fase 2: `list_incidents`, `get_incident`, `generate_incident_report`. Cada uma tem endpoint REST espelhado. **Não são tools:** `acknowledge`/`resolve`/`comment` de incidente.
- **Orquestrador** — componente que roda o loop de tool use via Amazon Bedrock (modelo Nova Pro via Bedrock, Converse API, streaming + tool use): interpreta NL → escolhe tool, a aplicação executa, o resultado volta ao LLM, que gera o texto. O orquestrador (a aplicação) acessa dados; **o LLM nunca toca o banco**.
- **Recusa (refusal)** — quando não há tool aplicável, o stream emite `refusal` em vez de `tool_call`. Garante que o LLM **não fabrique dados**. UI: `RefusalCard` ([`prototype/chat.jsx`](../../(protótipo original, não incluído))).
- **Trilha (trail)** — linha do tempo completa de um envio (`get_shipping_trail`), composta por `message_events` em ordem cronológica. UI: `TrailTimeline`.
- **message_events e seus tipos** — eventos do ciclo de vida de um envio: `api_request` (requisição recebida), `routing` (escolha do fornecedor), `provider_attempt` (tentativa no fornecedor), `webhook_status` (status reportado por webhook), `final` (status final).
- **Incidente** — registro de uma anomalia detectada (tabela `incidents`), criado pelo detector.
- **Ciclo do incidente** — `detected` (recém-criado pelo detector) → `acknowledged` (analista reconheceu) → `resolved` (resolvido com ação registrada) ou `auto_resolved` (métrica voltou à baseline sem intervenção). Transições só de `detected`/`acknowledged`/`auto_resolved` → `resolved`.
- **Severidade (severity)** — gravidade do incidente: `info`, `warning`, `critical`. Mapeada em cores semânticas (info `#0052CC`, warning `#E0A500`, critical = danger `#C12722`).
- **Dimensão (dimension)** — eixo onde a anomalia ocorre: `provider`, `customer`, `route`, `global`. Tem `dimensionType` + `dimensionValue` (ex.: provider / "Twilio").
- **action_category** — categoria obrigatória ao resolver um incidente: `provider_recovered`, `provider_escalated`, `internal_escalated`, `false_positive`, `customer_communicated`, `monitoring_only`, `other`. Alimenta o relatório gerencial.
- **anomaly_rule e rule_types** — regra de detecção (tabela `anomaly_rules`), editável na tela de Regras (threshold/dimensão/janela/severidade/enabled). Tipos: `delivery_rate_drop` (queda de taxa de entrega), `failure_spike` (pico de falhas), `consistent_error` (erro recorrente), `webhook_silence` (silêncio de webhook). `rule_type` é imutável na UI.
- **MTTA / MTTR** — Mean Time To Acknowledge / Mean Time To Resolve. Métricas-chave dos relatórios de incidente e da observabilidade; meta de design MTTA < 5 min (endereçada pelo banner persistente).
- **Reveal de PII** — ação de revelar telefone (`reveal_phone`) ou conteúdo (`reveal_content`) que por padrão chegam mascarados. Conteúdo exige confirmação; é lido primeiro do cache transitório (read-through) dos dados brutos (`/tmp`, volume Docker numa EC2) e, se não estiver lá, buscado no S3 via `s3_log_pointer`/`contentRef` (populando o `/tmp`). Todo reveal gera audit (severity `pii`).
- **phone_e164** — telefone no formato E.164 (ex.: `+5511987651234`); armazenado no hot store mas exibido mascarado por padrão.
- **phone_hash** — hash do telefone, usado para busca sem expor PII em logs.
- **content_ref** — ponteiro para o conteúdo bruto do SMS no S3 (ex.: `s3://at-msg-content/2026/05/28/4f3a2b1c-1111.txt`). O texto sensível nunca fica em claro no hot store. Também referenciado como `s3_log_pointer` para hidratar o hot store.
- **Hot store (metadados)** — MySQL com metadados estruturados de envio/incidentes (retenção 90d; audit log 1 ano). Guarda os metadados duráveis; o conteúdo/trilha volumoso **não** mora aqui.
- **Cache transitório de conteúdo/trilha (`/tmp`)** — cache transitório (read-through) dos dados brutos volumosos derivados dos logs (conteúdo/trilha), materializado como **arquivos temporários no `/tmp`** do host, montado como **volume de um container Docker** (deploy pretendido: imagem Docker numa EC2, volume → `/tmp` da máquina). Lê do `/tmp` e, se o dado não estiver lá, **busca no S3** (`s3_log_pointer`/`content_ref`) populando o `/tmp`. Propósito: (a) evitar muitas requisições ao S3 num curto período e (b) manter os dados brutos fora do banco (não onerar o MySQL). Cache **efêmero/rebuildável** — nada que precise sobreviver a restart/redeploy mora só aqui (audit/metadados em MySQL, origem do conteúdo em S3). As três camadas: (a) `/tmp` = cache efêmero/rebuildável; (b) **S3** = origem durável dos brutos; (c) **MySQL** = metadados estruturados + `audit_log` (durável). Conteúdo/PII durável fica no S3, com Athena além da retenção.
- **Audit log** — registro imutável (tabela `audit_log`, retenção 1 ano, só INSERT + SELECT) de toda ação auditável; alimentado por interceptor global NestJS.
- **RBAC (support_analyst / support_lead)** — `support_analyst`: chat, busca, trilha, ack/resolve. `support_lead`: tudo + relatórios gerenciais + editar regras + ver audit log. Aplicado via guards por endpoint.
- **Auth (MVP)** — mecanismo de autenticação do MVP: **login social institucional (OIDC) + RBAC** — OIDC via Microsoft 365 (Entra ID), atrás de uma abstração de auth para trocar de IdP facilmente (ex.: Google Workspace), **restrito ao domínio `@example.com`**, sem senha própria. O token/sessão OIDC vai no Bearer de todos os endpoints REST e é validado no handshake WS. RBAC (`support_analyst`/`support_lead`) é mapeado após o login. O SSO corporativo completo (SAML + SCIM) é débito residual, ver [tech-debt.md](./tech-debt.md).
- **SSO** — Single Sign-On corporativo completo da Acme (SAML + SCIM); **débito residual** (o MVP já usa login social institucional via OIDC). Ver [tech-debt.md](./tech-debt.md).
- **Plankton** — cor primária de marca do assistente (`plankton800 #077E70`, teal). Thanos (roxo) fica fora do MVP; a paleta é Plankton + cores semânticas.
- **Banner de incidente** — faixa persistente vermelha no topo do chat, estilo escolhido para push de incidente (vs. toast ou painel auto-aberto): alta visibilidade sem interromper o que o analista está fazendo.

## Acronyms & Abbreviations

- **PII** — Personally Identifiable Information (telefone, conteúdo de SMS). Mascarada por padrão.
- **MTTA / MTTR** — Mean Time To Acknowledge / Resolve.
- **RBAC** — Role-Based Access Control.
- **SSO** — Single Sign-On corporativo completo (Acme, SAML + SCIM). Débito residual (ver [tech-debt.md](./tech-debt.md)); o MVP já usa login social institucional via OIDC.
- **SAML / OIDC** — OIDC é o protocolo do login social institucional do MVP; SAML (SSO corporativo completo) é débito residual.
- **SSE** — Server-Sent Events (stream da resposta do chat).
- **WS** — WebSocket (`/ws/support`, push de incidentes Fase 2).
- **LLM** — Large Language Model (modelo Nova Pro via Amazon Bedrock, Converse API).
- **RF / RNF** — Requisito Funcional / Não-Funcional (em `spec-assistente-suporte.md`).
- **E.164** — formato internacional de número de telefone (`phone_e164`).
- **ORM** — Object-Relational Mapper (Prisma, sobre MySQL).
- **OTel** — OpenTelemetry (observabilidade).
- **DI** — Dependency Injection (módulos NestJS).
- **CSV** — formato de export de relatório (`csvUrl`).

## Personas / Actors

- **support_analyst (analista de suporte)** — usuário primário do chat. Investiga reclamações de clientes, busca envios, abre trilhas, analisa risco de conteúdo, reconhece (ack) e resolve incidentes. Fica horas no chat (motivo da densidade "comfortable"). Dor endereçada: hoje depende de outros times para consultar dados de envio.
- **support_lead (líder de suporte)** — faz tudo do analista + gera relatórios gerenciais (MTTA/MTTR, distribuição por ação), edita regras de anomalia e visualiza o audit log. Quer integridade dos dados de resolução (por isso ack/resolve passam por formulário validado, nunca pelo LLM).
- **Detector de anomalias (ator de sistema, Fase 2)** — cria incidentes automaticamente (começa via webhook do Grafana Alertmanager), dispara `incident.created` e `incident.auto_resolved`. Aparece no audit log como `user_id = 'system'`.

## Domain Rules & Invariants

Regras de negócio não-negociáveis (de [README §5](../../docs/design_handoff_atena/README.md), [01 §D](../../docs/design_handoff_atena/01-backend-api-contract.md), [02](../../docs/design_handoff_atena/02-data-model.md)):

- **LLM não acessa o banco** e **não fabrica dados**: todo dado estruturado vem do retorno de uma tool; sem tool aplicável → recusa.
- **Mudança de estado de incidente nunca é tool do LLM**: `acknowledge`/`resolve`/`comment` só via REST/UI com validação server-side.
- **Validação de resolve (server-side):** `actionCategory` ∈ enum; `actionDescription` ≥ 20 chars (≥ 10 no fluxo `auto_resolved`); se `actionCategory ∈ {provider_escalated, internal_escalated}` → `escalatedTo` obrigatório; só transição de `detected`/`acknowledged`/`auto_resolved` → `resolved`; toda mudança escreve em `incident_activity` + audit log.
- **`rule_type` imutável na UI** (só threshold/dimensão/janela/severidade/enabled são editáveis); toda alteração gera audit `rule_update`.
- **PII mascarada por padrão**; reveal exige (no caso de conteúdo) confirmação e sempre gera audit (severity `pii`). Conteúdo bruto só no S3.
- **Audit log imutável**: sem UPDATE/DELETE; app role só INSERT + SELECT; retenção 1 ano.
- **Retenção do hot store: 90 dias** (job de purga); histórico antigo vai para S3/Athena.
- **Convenção de dados:** snake_case no DB, camelCase na API; datas ISO 8601 UTC; erros no formato `{ error: { code, message } }`.
- **Localização:** PT-BR informal (`você`), sem emoji no produto.

## Cross-References

- [Project Overview](./project-overview.md)
- [Architecture Notes](./architecture.md)
- [Data Flow & Integrations](./data-flow.md)
- Handoff: [01 — API Contract](../../docs/design_handoff_atena/01-backend-api-contract.md) · [02 — Data Model](../../docs/design_handoff_atena/02-data-model.md) · [05 — Design Reference](../../docs/design_handoff_atena/05-design-reference.md)
