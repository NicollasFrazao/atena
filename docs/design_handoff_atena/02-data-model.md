# 02 — Modelo de dados (PostgreSQL)

Schema consolidado. As tabelas de `messages`, `message_events`, `incidents` e `incident_activity` vêm da spec (§4.4, §5.3). As tabelas de **regras**, **sessões de chat** e **audit log** estão detalhadas aqui porque o protótipo as exercita mas a spec só as menciona.

> Mapear para Prisma/Drizzle. Manter snake_case no DB; expor camelCase na API.

---

## Hot store — mensagens (spec §4.4)

```sql
CREATE TABLE messages (
    message_id      UUID PRIMARY KEY,
    customer_id     VARCHAR(64) NOT NULL,
    phone_e164      VARCHAR(20) NOT NULL,
    phone_hash      VARCHAR(64) NOT NULL,   -- busca sem PII em logs
    content_ref     VARCHAR(128),           -- ponteiro p/ conteúdo (não armazenar texto sensível aqui)
    provider        VARCHAR(64),
    final_status    VARCHAR(32) NOT NULL,   -- delivered | failed | pending | unknown
    requested_at    TIMESTAMPTZ NOT NULL,
    finalized_at    TIMESTAMPTZ,
    s3_log_pointer  VARCHAR(512),           -- json.gz original p/ deep dive
    metadata        JSONB
);
CREATE INDEX idx_messages_phone         ON messages (phone_e164);
CREATE INDEX idx_messages_customer_time ON messages (customer_id, requested_at DESC);
CREATE INDEX idx_messages_status_time   ON messages (final_status, requested_at DESC);
CREATE INDEX idx_messages_provider_time ON messages (provider, requested_at DESC);

CREATE TABLE message_events (
    event_id    UUID PRIMARY KEY,
    message_id  UUID NOT NULL REFERENCES messages(message_id),
    event_type  VARCHAR(32) NOT NULL,   -- api_request | routing | provider_attempt | webhook_status | final
    occurred_at TIMESTAMPTZ NOT NULL,
    payload     JSONB NOT NULL
);
CREATE INDEX idx_events_message ON message_events (message_id, occurred_at);
```
Conteúdo bruto do SMS fica no **S3** (PII). `content_ref` aponta pra ele; tools que precisam do texto buscam sob demanda **com log de acesso**.

---

## Incidentes (spec §5.3)

```sql
CREATE TABLE incidents (
    incident_id         UUID PRIMARY KEY,
    rule_id             VARCHAR(64) NOT NULL REFERENCES anomaly_rules(rule_id),
    severity            VARCHAR(16) NOT NULL,   -- info | warning | critical
    status              VARCHAR(16) NOT NULL,   -- detected | acknowledged | resolved | auto_resolved
    dimension_type      VARCHAR(32) NOT NULL,   -- provider | customer | route | global
    dimension_value     VARCHAR(128),
    detection_window    TSTZRANGE NOT NULL,
    detection_payload   JSONB NOT NULL,         -- métricas que dispararam
    detected_at         TIMESTAMPTZ NOT NULL,
    acknowledged_at     TIMESTAMPTZ,
    acknowledged_by     VARCHAR(128),
    resolved_at         TIMESTAMPTZ,
    resolved_by         VARCHAR(128),
    action_category     VARCHAR(32),            -- enum abaixo (obrigatório no resolve)
    action_description  TEXT,                   -- ≥ 20 chars (≥ 10 no auto_resolved)
    escalated_to        VARCHAR(128),           -- obrigatório se category é *_escalated
    related_message_ids UUID[],
    tags                TEXT[]
);
CREATE INDEX idx_incidents_status_time ON incidents (status, detected_at DESC);
CREATE INDEX idx_incidents_dimension   ON incidents (dimension_type, dimension_value, detected_at DESC);
CREATE INDEX idx_incidents_severity_time ON incidents (severity, detected_at DESC);

CREATE TABLE incident_activity (
    activity_id   UUID PRIMARY KEY,
    incident_id   UUID NOT NULL REFERENCES incidents(incident_id),
    user_id       VARCHAR(128),
    activity_type VARCHAR(32) NOT NULL,   -- comment | tool_call | status_change
    occurred_at   TIMESTAMPTZ NOT NULL,
    payload       JSONB NOT NULL
);
CREATE INDEX idx_activity_incident ON incident_activity (incident_id, occurred_at);
```

**`action_category` enum** (RF-2.4): `provider_recovered`, `provider_escalated`, `internal_escalated`, `false_positive`, `customer_communicated`, `monitoring_only`, `other`.

**Constraint de negócio (validar no backend):** ao mover `status` → `resolved`, `action_category` e `action_description` (≥ 20 chars) obrigatórios; se category ∈ {`internal_escalated`, `provider_escalated`} → `escalated_to` obrigatório.

---

## Regras de anomalia (exercitado pela tela de Regras — `MOCK.rules`)

```sql
CREATE TABLE anomaly_rules (
    rule_id         VARCHAR(64) PRIMARY KEY,    -- ex.: 'r-delivery-rate-drop'
    name            VARCHAR(160) NOT NULL,
    rule_type       VARCHAR(32) NOT NULL,       -- delivery_rate_drop | failure_spike | consistent_error | webhook_silence
    dimension       VARCHAR(32) NOT NULL,       -- provider | customer | route | global
    enabled         BOOLEAN NOT NULL DEFAULT true,
    severity        VARCHAR(16) NOT NULL,       -- info | warning | critical
    threshold       NUMERIC NOT NULL,           -- valor numérico
    threshold_unit  VARCHAR(8) NOT NULL,        -- '%' | 'σ' | 'min'
    window_minutes  INT NOT NULL,
    updated_by      VARCHAR(128),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```
A tela de Regras lê/edita `threshold`, `dimension`, `window_minutes`, `severity`, `enabled`. `rule_type` é imutável na UI. Toda alteração → audit log (`action: 'rule_update'`).

---

## Sessões de chat (RF-1.1 — persistência por usuário)

```sql
CREATE TABLE chat_sessions (
    session_id    UUID PRIMARY KEY,
    user_id       VARCHAR(128) NOT NULL,
    title         VARCHAR(200),               -- auto-gerado do 1º turno
    started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_activity TIMESTAMPTZ NOT NULL DEFAULT now(),
    pinned        BOOLEAN NOT NULL DEFAULT false,
    tags          TEXT[],
    incident_id   UUID REFERENCES incidents(incident_id)  -- se a sessão nasceu de um incidente
);
CREATE INDEX idx_sessions_user_time ON chat_sessions (user_id, last_activity DESC);

CREATE TABLE chat_messages (
    message_id  UUID PRIMARY KEY,
    session_id  UUID NOT NULL REFERENCES chat_sessions(session_id),
    role        VARCHAR(16) NOT NULL,       -- user | assistant
    content     JSONB NOT NULL,             -- texto + tool calls + tool results + refusal
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_chatmsg_session ON chat_messages (session_id, created_at);
```
Retenção do hot store: **90 dias** (job de purga). Histórico antigo vai p/ S3/Athena.

---

## Audit log (RNF-1.5 — imutável, 1 ano)

```sql
CREATE TABLE audit_log (
    audit_id    UUID PRIMARY KEY,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    user_id     VARCHAR(128),               -- ou 'system' para eventos do detector
    action      VARCHAR(48) NOT NULL,       -- enum abaixo
    resource    VARCHAR(256) NOT NULL,      -- ex.: 'msg/4f3a2b1c-1111', 'tool/search_messages'
    detail      TEXT,
    severity    VARCHAR(16) NOT NULL,       -- info | warning | pii | config
    ip_address  INET,
    metadata    JSONB
);
CREATE INDEX idx_audit_time   ON audit_log (occurred_at DESC);
CREATE INDEX idx_audit_user   ON audit_log (user_id, occurred_at DESC);
CREATE INDEX idx_audit_action ON audit_log (action, occurred_at DESC);
```
**`action` enum** (do protótipo): `tool_call`, `reveal_phone`, `reveal_content`, `incident_created`, `incident_ack`, `incident_resolve`, `session_start`, `export_report`, `rule_update`.

**Imutabilidade:** sem UPDATE/DELETE. Conceder ao app role apenas INSERT + SELECT. Considerar tabela append-only / particionada por mês. *(Decisão pendente: tabela no mesmo Postgres vs serviço dedicado — ver `decisions.md`.)*

---

## RBAC (RNF-1.6)
Mínimo dois papéis: **`support_analyst`** (chat, busca, trilha, ack/resolve incidentes) e **`support_lead`** (tudo + relatórios gerenciais + editar regras + ver audit log). Aplicar via guards no NestJS por endpoint.
