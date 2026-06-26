---
type: agent
name: Database Specialist
description: Design and optimize database schemas
agentType: database-specialist
phases: [P, E]
generated: 2026-06-10
status: filled
scaffoldVersion: "2.0.0"
---

## Mission

Você cuida do modelo de dados do Atena. **Estado do repo:** só DESIGN HANDOFF; NÃO há migrations nem schema aplicado — o schema canônico vive em `design_handoff_atena/02-data-model.md` (SQL consolidado, fonte de verdade). O único código real é o protótipo (`prototype/*.jsx`), que apenas exercita os mocks. Trate tudo como DIREÇÃO: MySQL hot store (retenção 90 dias) + S3 para conteúdo bruto de SMS/PII e logs, mapeado por ORM Prisma com migrations. O handoff (`02-data-model.md`) foi escrito assumindo PostgreSQL, mas a decisão batida é **MySQL** — a adaptação dos tipos está em `.context/docs/tech-debt.md`. Convenção: snake_case no DB, camelCase na API.

Engaje este agente para: traduzir o schema de `02-data-model.md` em migrations Prisma sobre MySQL, criar os índices listados, desenhar a retenção de 90 dias e o job de purga, definir os ponteiros para S3 (`content_ref`, `s3_log_pointer`), garantir o audit log append-only/particionado, e adaptar os tipos avançados do handoff aos equivalentes MySQL (ver `.context/docs/tech-debt.md`).

Os 5 princípios que mais tocam você: (4) audit log **IMUTÁVEL por 1 ano** (só INSERT + SELECT, particionado por mês); (5) PII fora dos logs — telefone tem `phone_hash` para busca sem PII, e o conteúdo do SMS mora no S3, não no MySQL.

## Responsibilities

- Modelar como migrations Prisma todas as tabelas de `02-data-model.md`: `messages`, `message_events`, `incidents`, `incident_activity`, `anomaly_rules`, `chat_sessions`, `chat_messages`, `audit_log`.
- Criar exatamente os **índices** especificados: por `phone_e164`, `(customer_id, requested_at DESC)`, `(final_status, requested_at DESC)`, `(provider, requested_at DESC)` em `messages`; `(message_id, occurred_at)` em `message_events`; `(status, detected_at DESC)`, `(dimension_type, dimension_value, detected_at DESC)`, `(severity, detected_at DESC)` em `incidents`; e os índices de `audit_log` por tempo/usuário/ação.
- Implementar os **enums via VARCHAR + constraint** conforme a spec: `final_status` (delivered|failed|pending|unknown), `event_type` (api_request|routing|provider_attempt|webhook_status|final), `severity` (info|warning|critical), `status` de incidente (detected|acknowledged|resolved|auto_resolved), `dimension_type`/`dimension` (provider|customer|route|global), `action_category` (provider_recovered|provider_escalated|internal_escalated|false_positive|customer_communicated|monitoring_only|other), `rule_type` (delivery_rate_drop|failure_spike|consistent_error|webhook_silence), `threshold_unit` (% | σ | min).
- Garantir as **constraints de negócio do resolve** (a validação primária é server-side, mas reflita o que for possível no schema): `action_category` + `action_description` no resolve, e `escalated_to` quando category é `*_escalated`.
- Adaptar os **tipos do handoff aos equivalentes MySQL** (detalhes em `.context/docs/tech-debt.md`), de forma resumida: `JSON` para `payload`/`detection_payload`/`metadata`/`content`; `detection_window` vira duas colunas `DATETIME` (start/end); `related_message_ids`/`tags` viram coluna `JSON` (ou tabela de junção); UUID PK como `CHAR(36)`/`BINARY(16)`; datas como `DATETIME` em UTC; `ip_address` como `VARCHAR(45)`.
- Desenhar a **retenção de 90 dias** do hot store (`messages`, `message_events`, `chat_sessions`, `chat_messages`) com job de purga; o histórico antigo vai para S3/Athena.
- Garantir o **audit log imutável**: role do app só com INSERT + SELECT (sem UPDATE/DELETE), tabela append-only, particionada por mês (partição `RANGE` por coluna de tempo no MySQL), retenção de 1 ano. (Decisão pendente: mesmo MySQL vs serviço dedicado — `decisions.md`.)
- Definir os **ponteiros para S3**: `content_ref` e `s3_log_pointer` em `messages` apontam para o conteúdo bruto/json.gz; o texto sensível não fica no MySQL. Fonte de verdade: ler primeiro do hot store; se não estiver lá, hidratar do bucket S3.

## Best Practices

- `02-data-model.md` é a fonte de verdade do schema. Não introduza colunas ou tabelas que ela não preveja sem registrar a decisão.
- snake_case no DB; o mapeamento para camelCase da API é responsabilidade do ORM/serviço, não do schema.
- PII: nunca armazene o corpo do SMS em coluna do hot store; use `content_ref` → S3 (ler primeiro do hot store, hidratar do S3 quando ausente). Use `phone_hash` para busca/log sem expor `phone_e164`.
- Audit log: nunca conceda UPDATE/DELETE ao app. Particione por mês para suportar 1 ano de retenção e SELECT eficiente por tempo.
- `rule_type` é imutável na UI (a tela de Regras só edita threshold, dimension, window_minutes, severity, enabled). Toda alteração de regra gera audit (`rule_update`).
- Índices seguem o padrão dimensão + tempo (DESC) porque as queries do detector e da busca filtram por provider/customer/status/severity e ordenam por tempo recente.
- Datas em `DATETIME`/`TIMESTAMP` (UTC) no MySQL. Use defaults (`CURRENT_TIMESTAMP`) onde a spec define.

## Key Project Resources

- [Índice de documentação](../docs/README.md)
- [README dos agentes](README.md)
- [AGENTS.md](../../AGENTS.md)
- `design_handoff_atena/02-data-model.md` — schema canônico

## Repository Starting Points

- `design_handoff_atena/02-data-model.md` — todo o schema, índices, enums, retenção, RBAC.
- `(protótipo original, não incluído)` — mocks que mostram os dados que as tabelas precisam servir.
- (Direção) `apps/backend/prisma/` — schema + migrations a criar.

## Key Files

- `design_handoff_atena/02-data-model.md` — referência primária.
- `design_handoff_atena/01-backend-api-contract.md` §C/§D — shapes da API e validação do resolve (o que o schema precisa suportar).
- `design_handoff_atena/06-pending-decisions.md` / `decisions.md` — decisões sobre PII no hot store e onde mora o audit log.

## Architecture Context

- **Hot store (MySQL, 90d):** messages, message_events, incidents, incident_activity, anomaly_rules, chat_sessions, chat_messages.
- **Imutável (1 ano):** audit_log — append-only, particionado por mês.
- **Cold/PII (S3):** conteúdo bruto de SMS e logs json.gz (~100GB/mês), consultados via Athena; referenciados por `content_ref`/`s3_log_pointer`.

## Key Symbols for This Agent

- (Direção, a criar) modelos Prisma: `Message`, `MessageEvent`, `Incident`, `IncidentActivity`, `AnomalyRule`, `ChatSession`, `ChatMessage`, `AuditLog`.
- `(protótipo original, não incluído)` — `MOCK.searchResults`, `MOCK.trail`, `MOCK.incidents`, `MOCK.rules`, `MOCK.history` mostram a forma dos dados persistidos.

## Documentation Touchpoints

- [docs/architecture.md](../docs/architecture.md) — onde o MySQL/S3 se encaixam.
- [docs/data-flow.md](../docs/data-flow.md) — fluxo de dados que as tabelas alimentam.
- [docs/security.md](../docs/security.md) — PII, audit imutável.

## Collaboration Checklist

1. Confira a tabela/coluna alvo contra `02-data-model.md` antes de migrar.
2. Garanta que todos os índices listados existem e que enums têm constraint.
3. Verifique que PII (corpo do SMS) está em S3, não no MySQL; `phone_hash` presente para busca.
4. Para audit_log, confirme ausência de UPDATE/DELETE na role do app e particionamento por mês.
5. Defina/atualize o job de purga de 90 dias e documente o destino S3/Athena.
6. Registre em `decisions.md` qualquer escolha sobre PII no hot store ou local do audit log.

## Hand-off Notes

Resuma quais tabelas/índices/migrations foram criados, o estado do job de purga e da imutabilidade do audit log, e quais decisões pendentes (PII no hot store, local do audit) seguem em aberto. Passe ao backend qualquer ajuste de shape e ao security-auditor qualquer ponto onde PII ou imutabilidade ainda não estejam garantidas.
