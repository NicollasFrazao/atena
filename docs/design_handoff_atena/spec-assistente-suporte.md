# Especificação V1 — Assistente do Time de Suporte (SMS)

**Status:** Draft para revisão
**Versão:** 1.0
**Escopo:** V1 = Fase 1 + Fase 2

---

## 1. Visão geral

### 1.1 Problema
Hoje, quando envios de SMS via API apresentam falha, o time de suporte não tem autonomia para investigar nem agir. Os logs (≈100 GB/mês em `json.gz` no S3) não estão acessíveis fora do time de tecnologia, e o monitoramento atual (Grafana) mostra a taxa de entrega mas não dispara ações nem fornece contexto investigativo. O resultado é dependência constante do time de engenharia para qualquer triagem.

### 1.2 Objetivo da V1
Entregar um assistente conversacional que dá ao time de suporte:
- **Acesso self-service aos dados** de envio (busca, trilha, análise de risco, relatórios).
- **Detecção proativa de anomalias** com notificação em tempo real e registro estruturado da ação tomada para cada incidente.

A V1 é deliberadamente **read-only** no que diz respeito ao sistema de envios — nenhuma ação altera estado externo (reenvios, alteração de rotas, etc.). Essas ações ficam para a Fase 3+.

### 1.3 Métricas de sucesso
- **MTTA (mean time to acknowledge)** de incidentes < 5 min após detecção.
- **% de tickets de suporte que escalam para tecnologia** reduzido em ≥ 50% nos primeiros 60 dias após go-live.
- **Cobertura de incidentes com ação registrada** = 100% (todo incidente fechado tem `action_taken` preenchido).
- **Latência de busca de mensagem** (p95) < 1 s para janela de 24 h.

### 1.4 Fora de escopo da V1
- Reenvio de mensagens, troca de fornecedor de saída, qualquer ação que mude estado em sistemas externos.
- Integração MCP com fornecedores.
- RAG sobre runbooks/base de conhecimento (avaliar em V2).
- Aprovação multi-nível de ações (não há ações que mudam estado nesta fase).

---

## 2. Personas

| Persona | Descrição | Necessidades-chave |
|---|---|---|
| Analista de Suporte N1 | Recebe demandas de clientes, faz triagem inicial. | Buscar mensagem por telefone/ID rapidamente, ver status, explicar pro cliente. |
| Analista de Suporte N2 | Investiga casos mais complexos, lida com incidentes agregados. | Trilha completa, relatórios, registro de incidentes, análise de risco de conteúdo. |
| Líder de Suporte | Acompanha SLA, gera relatórios para gestão. | Relatórios consolidados, histórico de incidentes e ações tomadas. |

---

## 3. Arquitetura geral

```
┌─────────────────────┐
│  Webhooks de        │
│  fornecedores SMS   │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐      ┌──────────────────┐
│  Ingestion service  │─────▶│  S3 (cold)       │
│  (já existe)        │      │  json.gz mensal  │
└──────────┬──────────┘      └──────────────────┘
           │ (novo)
           ▼
┌─────────────────────┐
│  Hot store          │
│  (PostgreSQL)       │  ← índices para busca rápida
│  - messages         │
│  - message_events   │
│  - incidents (F2)   │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────────────────────────────────┐
│  Backend API (FastAPI ou Node)                  │
│  - REST endpoints                               │
│  - WebSocket gateway (F2)                       │
│  - LLM agent orchestrator (tool use)            │
│  - Anomaly detector (F2)                        │
└──────────┬──────────────────────────────────────┘
           │
           ▼
┌─────────────────────┐
│  Frontend (React)   │
│  - Chat UI          │
│  - Incident panel   │
└─────────────────────┘

         Athena ◀── consulta ad-hoc para relatórios históricos profundos
```

### 3.1 Decisões arquiteturais relevantes

- **Hot store em PostgreSQL** indexando metadados de cada envio. Atualizado em tempo real pelo mesmo pipeline que recebe webhooks dos fornecedores. Retém **90 dias** online.
- **Cold store mantido em S3** no formato atual (`json.gz`), com **particionamento por `ano/mês/dia/hora`** para Athena. Não muda o formato existente — apenas garante particionamento se ainda não estiver assim.
- **LLM como orquestrador via tool use.** O LLM nunca extrai dados estruturados de logs brutos — sempre chama ferramentas determinísticas e recebe dados estruturados.
- **WebSocket gerenciado** via API Gateway WebSocket (AWS) ou serviço similar — evita gerenciar conexões persistentes em servidores stateful.

---

## 4. FASE 1 — Read-only

### 4.1 Objetivos
Dar ao suporte autonomia para investigar envios sem precisar de tecnologia, via chat conversacional com IA que orquestra ferramentas determinísticas.

### 4.2 Requisitos funcionais

#### RF-1.1 Chat conversacional
- Interface de chat estilo assistente, com histórico de mensagens da sessão.
- Sessão persistida por usuário (resumir conversa anterior ao retornar).
- Suporte a markdown na resposta da IA (tabelas, listas, links).
- Indicação visual quando a IA está executando uma ferramenta (ex.: "Buscando mensagens...").

#### RF-1.2 Busca de mensagens
A IA deve ser capaz de buscar mensagens a partir de linguagem natural, traduzindo para uma query estruturada via tool `search_messages`. Critérios suportados:
- Telefone do destinatário (parcial ou completo, com ou sem máscara).
- `message_id` interno.
- Janela de tempo (absoluta ou relativa: "ontem", "últimas 2 horas").
- Status final (`delivered`, `failed`, `pending`, `unknown`).
- Fornecedor de saída.
- Cliente / `customer_id`.
- Combinação de filtros (AND).

Resposta: lista paginada com até 50 resultados por página, com campos resumidos (id, telefone mascarado, status, fornecedor, timestamp).

#### RF-1.3 Trilha completa de mensagem
Dado um `message_id`, a IA deve apresentar a trilha completa via tool `get_message_trail`:
- Requisição original via API (timestamp, payload, cliente).
- Roteamento (qual fornecedor foi escolhido e por quê, se houver lógica de roteamento).
- Tentativa(s) de envio (timestamps, request ao fornecedor, resposta).
- Webhooks de status recebidos (cada update de status com timestamp).
- Status final consolidado.

#### RF-1.4 Análise de risco do conteúdo
Integrar com o serviço existente de análise de risco. A IA expõe a tool `analyze_message_content`:
- Input: texto da mensagem (ou `message_id` para puxar o conteúdo da mensagem real).
- Output: score de risco + categorias detectadas + explicação do serviço existente.
- A IA deve apresentar o resultado contextualizado, não como dump bruto.

#### RF-1.5 Geração de relatórios
A IA deve gerar relatórios sob demanda via tool `generate_delivery_report`:
- Janela de tempo (qualquer período até retenção do hot store; períodos maiores caem para Athena).
- Agrupamentos: por fornecedor, por cliente, por status, por hora/dia.
- Métricas: total enviado, taxa de entrega, taxa de falha, tempo médio até entrega, distribuição de erros.
- Saída: tabela renderizada no chat + opção de exportar CSV.

### 4.3 Requisitos não-funcionais

| ID | Requisito |
|---|---|
| RNF-1.1 | Latência p95 de busca em janela de 24h: < 1 s. |
| RNF-1.2 | Latência p95 de relatório agregado em janela de 7d: < 5 s. |
| RNF-1.3 | Disponibilidade do chat: 99,5% em horário comercial estendido (6h-23h BRT). |
| RNF-1.4 | Telefones e conteúdo de SMS são **mascarados por padrão** na UI. Usuário precisa clicar para revelar (com log de acesso). |
| RNF-1.5 | Toda interação do usuário com o assistente (mensagens enviadas, ferramentas chamadas, resultados) é persistida em audit log imutável por 1 ano. |
| RNF-1.6 | Autenticação via SSO existente (presumindo que há um). RBAC com no mínimo dois papéis: `support_analyst` e `support_lead`. |

### 4.4 Modelo de dados (hot store)

```sql
-- Tabela principal de mensagens (uma linha por envio)
CREATE TABLE messages (
    message_id          UUID PRIMARY KEY,
    customer_id         VARCHAR(64) NOT NULL,
    phone_e164          VARCHAR(20) NOT NULL,
    phone_hash          VARCHAR(64) NOT NULL,  -- para busca sem PII em logs
    content_ref         VARCHAR(128),          -- ponteiro pro conteúdo (não armazenar texto aqui em claro se sensível)
    provider            VARCHAR(64),
    final_status        VARCHAR(32) NOT NULL,
    requested_at        TIMESTAMPTZ NOT NULL,
    finalized_at        TIMESTAMPTZ,
    s3_log_pointer      VARCHAR(512),          -- caminho do json.gz original p/ deep dive
    metadata            JSONB
);

CREATE INDEX idx_messages_phone ON messages (phone_e164);
CREATE INDEX idx_messages_customer_time ON messages (customer_id, requested_at DESC);
CREATE INDEX idx_messages_status_time ON messages (final_status, requested_at DESC);
CREATE INDEX idx_messages_provider_time ON messages (provider, requested_at DESC);

-- Eventos da trilha (uma linha por evento: request, attempt, webhook update)
CREATE TABLE message_events (
    event_id        UUID PRIMARY KEY,
    message_id      UUID NOT NULL REFERENCES messages(message_id),
    event_type      VARCHAR(32) NOT NULL,    -- 'api_request', 'provider_attempt', 'webhook_status'
    occurred_at     TIMESTAMPTZ NOT NULL,
    payload         JSONB NOT NULL
);

CREATE INDEX idx_events_message ON message_events (message_id, occurred_at);
```

**Nota:** o conteúdo bruto do SMS pode permanecer apenas no S3 (cold) por questões de PII. A `content_ref` aponta pra ele, e ferramentas que precisam do conteúdo (ex.: `analyze_message_content` por `message_id`) buscam sob demanda com log de acesso.

### 4.5 Catálogo de tools (Fase 1)

| Tool | Descrição | Input | Output |
|---|---|---|---|
| `search_messages` | Busca mensagens por filtros. | `{phone?, message_id?, date_range, status?, provider?, customer_id?, limit, page}` | Lista paginada de mensagens. |
| `get_message_trail` | Retorna trilha completa de uma mensagem. | `{message_id}` | Mensagem + lista ordenada de eventos. |
| `analyze_message_content` | Chama serviço de análise de risco existente. | `{text?, message_id?}` (um dos dois) | Score + categorias + explicação. |
| `generate_delivery_report` | Agrega métricas de entrega. | `{date_range, group_by[], filters?}` | Tabela agregada + link de export CSV. |
| `list_providers` | Enumera fornecedores ativos. | `{}` | Lista de fornecedores. |
| `list_customers` | Enumera clientes (com filtro opcional). | `{search?}` | Lista de clientes. |

**Regra importante:** o LLM só pode produzir dados estruturados (telefones, IDs, status) a partir do retorno de tools. Se o usuário pedir algo que não é coberto por tool, a IA responde explicitamente que não tem essa capacidade — não inventa.

### 4.6 APIs (backend)

```
POST   /api/chat/sessions                    # cria sessão
POST   /api/chat/sessions/{id}/messages      # envia mensagem do usuário
GET    /api/chat/sessions/{id}/messages      # lista histórico
GET    /api/messages/search                  # endpoint de busca (também usado pela tool)
GET    /api/messages/{id}/trail              # trilha
POST   /api/messages/analyze                 # análise de conteúdo
POST   /api/reports/delivery                 # geração de relatório
GET    /api/reports/{id}/export.csv          # download CSV
```

### 4.7 UI/UX

- Layout em duas colunas: chat (esquerda, principal) e painel contextual (direita, mostra detalhes da última mensagem inspecionada, expansível).
- Sugestões de prompts iniciais para usuários novos: "Buscar mensagem por telefone", "Ver status do cliente X nas últimas 2h", "Gerar relatório de ontem".
- Telefones e conteúdo de SMS sempre mascarados por padrão. Toggle "revelar" gera log de acesso.
- Resultados de busca clicáveis → abrem trilha no painel direito sem perder o chat.

### 4.8 Critérios de aceitação da Fase 1

- [ ] Usuário autenticado consegue abrir o chat e ver mensagem de boas-vindas com sugestões.
- [ ] Busca por telefone retorna mensagens em < 1s p95 (24h).
- [ ] Trilha completa renderiza todos os eventos em ordem cronológica.
- [ ] Análise de risco retorna o mesmo resultado que o serviço existente quando consultado diretamente.
- [ ] Relatório agregado bate com o Grafana para a mesma janela (validação cruzada).
- [ ] Telefones aparecem mascarados; toggle de revelar gera entry no audit log.
- [ ] LLM não fabrica dados — testes de adversarial prompts confirmam que pedidos sem tool retornam recusa explícita.

---

## 5. FASE 2 — Notificações proativas + registro de incidentes

### 5.1 Objetivos
Inverter a lógica atual: ao invés do suporte descobrir o problema pelo cliente reclamando, a IA detecta a anomalia e abre a conversa via WebSocket. Toda anomalia detectada vira um **incidente** com ciclo de vida formal, e **toda resolução exige registro estruturado da ação tomada** para alimentar relatórios gerenciais.

### 5.2 Requisitos funcionais

#### RF-2.1 Detecção de anomalias agregadas
Um detector de anomalias monitora continuamente o hot store e dispara incidentes quando regras configuráveis são violadas. **Importante:** a Fase 2 *não* dispara incidente para cada SMS individual que falha — só anomalias agregadas.

Regras suportadas no MVP:
- **Queda de taxa de entrega:** taxa de entrega de um fornecedor / cliente / rota cai abaixo de X% em janela de Y minutos (configurável por regra).
- **Spike de falhas:** volume absoluto de falhas em janela curta excede N desvios-padrão da baseline da mesma hora/dia da semana.
- **Erro consistente do fornecedor:** mesmo código de erro do fornecedor aparece em ≥ Z% das tentativas em janela de Y minutos.
- **Silêncio de webhook:** fornecedor para de enviar webhooks de status por mais de Y minutos quando deveria estar enviando (volume esperado > 0).

Cada regra é configurável por: dimensão (fornecedor/cliente/rota/global), thresholds, janela, severidade (`info`, `warning`, `critical`).

**Recomendação de implementação:** começar reaproveitando os alertas já existentes no Grafana via webhook do Alertmanager → endpoint da nossa API que cria o incidente. Migrar para detector próprio só se o Grafana não der conta.

#### RF-2.2 Notificação via WebSocket
Quando um incidente é criado:
- Todos os usuários do time de suporte conectados recebem push via WebSocket.
- Notificação aparece como nova mensagem da IA no topo do chat (badge + som opcional).
- Conteúdo da mensagem inicial: resumo da anomalia, severidade, dimensões afetadas (qual fornecedor / cliente / rota), janela detectada, link para painel de detalhes.
- Se o usuário não está conectado no momento, incidentes ficam visíveis no painel ao logar (ordenados por severidade e idade).

#### RF-2.3 Ciclo de vida do incidente
Estados possíveis:

```
[detected] ──acknowledge──▶ [acknowledged] ──resolve──▶ [resolved]
     │                            │                          ▲
     │                            │                          │
     └────auto-resolve────────────┴──────auto-resolve────────┘
                  (anomalia volta ao normal sem ação)
```

- **`detected`** — recém-criado pelo detector. Visível para todos.
- **`acknowledged`** — algum analista assumiu o incidente. Fica vinculado a esse usuário (mas outros podem ver).
- **`resolved`** — fechado manualmente com ação registrada (ver RF-2.4).
- **`auto_resolved`** — a anomalia voltou ao normal sem intervenção. Ainda assim exige nota de fechamento (mesmo que seja "fornecedor se recuperou sozinho"), mas com fluxo simplificado.

#### RF-2.4 Registro obrigatório de ação tomada
**Para fechar (`resolve`) um incidente, o analista é obrigado a preencher:**

| Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `action_category` | enum | sim | Ver lista abaixo. |
| `action_description` | texto livre (mín. 20 caracteres) | sim | O que foi feito ou observado, em linguagem natural. |
| `escalated_to` | string | condicional | Obrigatório se `action_category = escalated`. Quem foi acionado (time/pessoa). |
| `related_message_ids` | array de UUID | não | IDs de mensagens-chave investigadas (popula automaticamente do que foi inspecionado no chat, mas editável). |
| `tags` | array de string | não | Etiquetas livres (ex.: `fornecedor-x`, `cliente-acme`, `rota-internacional`). |

**Valores de `action_category`:**
- `provider_recovered` — fornecedor se recuperou sozinho, sem ação.
- `provider_escalated` — escalado para o fornecedor (ticket aberto, contato comercial).
- `internal_escalated` — escalado para outro time interno (tech, infra, comercial).
- `false_positive` — não era de fato um incidente (regra precisa ser ajustada).
- `customer_communicated` — clientes afetados foram comunicados.
- `monitoring_only` — apenas observado, sem ação necessária.
- `other` — outro motivo (exige descrição mais detalhada).

**Validações de UI:**
- Botão "Resolver" só fica habilitado quando os campos obrigatórios estão preenchidos.
- `action_description` mínimo de 20 caracteres para forçar substância (evitar "ok" ou "resolvido").
- Para `auto_resolved` o fluxo é simplificado: campo único de nota (mín. 10 caracteres) + categoria pré-selecionada como `provider_recovered`, editável.

#### RF-2.5 Relatórios de incidentes
Nova tool e nova seção de relatórios:

- **`generate_incident_report(date_range, filters?)`** — agrega:
  - Total de incidentes por severidade.
  - Distribuição por `action_category`.
  - MTTA e MTTR médios.
  - Top fornecedores / clientes / rotas em volume de incidentes.
  - Lista detalhada exportável com: ID, abertura, severidade, dimensão afetada, analista responsável, ação tomada, descrição, duração.

- Filtros: período, fornecedor, cliente, severidade, categoria de ação, analista.
- Acessível via chat ("me dá o relatório de incidentes da última semana") ou via página dedicada "Incidentes" para o líder de suporte.

### 5.3 Modelo de dados (incidentes)

```sql
CREATE TABLE incidents (
    incident_id         UUID PRIMARY KEY,
    rule_id             VARCHAR(64) NOT NULL,        -- qual regra disparou
    severity            VARCHAR(16) NOT NULL,        -- info | warning | critical
    status              VARCHAR(16) NOT NULL,        -- detected | acknowledged | resolved | auto_resolved
    dimension_type      VARCHAR(32) NOT NULL,        -- provider | customer | route | global
    dimension_value     VARCHAR(128),                -- ex.: 'twilio', 'customer_xyz'
    detection_window    TSTZRANGE NOT NULL,          -- janela em que a anomalia foi detectada
    detection_payload   JSONB NOT NULL,              -- métricas que dispararam (taxa, threshold, etc.)
    detected_at         TIMESTAMPTZ NOT NULL,
    acknowledged_at     TIMESTAMPTZ,
    acknowledged_by     VARCHAR(128),
    resolved_at         TIMESTAMPTZ,
    resolved_by         VARCHAR(128),
    -- Ação tomada (RF-2.4) — obrigatórios no fechamento manual
    action_category     VARCHAR(32),
    action_description  TEXT,
    escalated_to        VARCHAR(128),
    related_message_ids UUID[],
    tags                TEXT[]
);

CREATE INDEX idx_incidents_status_time ON incidents (status, detected_at DESC);
CREATE INDEX idx_incidents_dimension ON incidents (dimension_type, dimension_value, detected_at DESC);
CREATE INDEX idx_incidents_severity_time ON incidents (severity, detected_at DESC);

-- Atividade dentro de um incidente (mensagens trocadas, ferramentas executadas no contexto)
CREATE TABLE incident_activity (
    activity_id     UUID PRIMARY KEY,
    incident_id     UUID NOT NULL REFERENCES incidents(incident_id),
    user_id         VARCHAR(128),
    activity_type   VARCHAR(32) NOT NULL,    -- 'comment', 'tool_call', 'status_change'
    occurred_at     TIMESTAMPTZ NOT NULL,
    payload         JSONB NOT NULL
);

CREATE INDEX idx_activity_incident ON incident_activity (incident_id, occurred_at);
```

**Constraint a aplicar (regra de negócio, não DB):**
ao mover `status` para `resolved`, `action_category` e `action_description` (≥ 20 chars) devem estar preenchidos. Se `action_category = 'internal_escalated'` ou `'provider_escalated'`, `escalated_to` é obrigatório. Validar no backend, não confiar só na UI.

### 5.4 Catálogo de tools adicionadas na Fase 2

| Tool | Descrição | Input | Output |
|---|---|---|---|
| `list_incidents` | Lista incidentes com filtros. | `{status?, severity?, date_range?, dimension?, limit, page}` | Lista paginada. |
| `get_incident` | Detalhes de um incidente + atividades. | `{incident_id}` | Incidente completo. |
| `generate_incident_report` | Relatório agregado de incidentes. | `{date_range, filters?}` | Métricas + lista detalhada + link CSV. |

**Importante:** as tools que mudam estado de incidente (`acknowledge_incident`, `resolve_incident`) **não são expostas ao LLM como tool callable diretamente**. Mudança de estado só acontece via interação direta do usuário com a UI (botão), justamente para garantir que o registro estruturado de `action_category` + `action_description` passe pelo formulário e não seja gerado pelo LLM. Isso protege a integridade do dado de relatório.

### 5.5 APIs (backend) — Fase 2

```
WS     /ws/support                            # canal WebSocket por usuário autenticado
GET    /api/incidents                         # lista
GET    /api/incidents/{id}                    # detalhes
POST   /api/incidents/{id}/acknowledge        # ack
POST   /api/incidents/{id}/resolve            # resolve (valida campos obrigatórios)
POST   /api/incidents/{id}/comment            # comentário livre na atividade
POST   /api/reports/incidents                 # geração de relatório
POST   /api/internal/anomaly-webhook          # endpoint para Grafana/Alertmanager disparar
```

### 5.6 UI/UX — Fase 2

- **Painel "Incidentes"** sempre visível no topo da tela, com badge de quantidade de incidentes em `detected` ou `acknowledged`.
- Quando chega um novo incidente via WebSocket: mensagem destacada no chat + notificação visual no painel + (opcional) som.
- Clicar no incidente abre vista lateral com:
  - Resumo da anomalia + métricas que dispararam.
  - Botões: "Acknowledge", "Investigar no chat" (puxa contexto pro chat), "Resolver".
  - Linha do tempo de atividades.
- **Modal de resolução** com formulário dos campos obrigatórios. Não fecha sem validação.
- **Página de incidentes** (acesso `support_lead`) com filtros, exportação e dashboard de métricas.

### 5.7 Critérios de aceitação da Fase 2

- [ ] Anomalia simulada em ambiente de teste gera incidente em < 60s da ocorrência.
- [ ] Usuários conectados recebem notificação via WebSocket em < 5s da criação do incidente.
- [ ] Botão "Resolver" fica desabilitado até `action_category` e `action_description` (≥ 20 chars) estarem preenchidos.
- [ ] Tentativa de fechar incidente via API sem campos obrigatórios retorna 400 com erro claro.
- [ ] Relatório de incidentes mostra distribuição por `action_category` corretamente.
- [ ] Auto-resolve dispara quando a métrica volta ao normal por janela ≥ tempo configurado, e ainda assim exige nota de fechamento.
- [ ] Auditoria registra cada transição de status com usuário e timestamp.

---

## 6. Considerações transversais (Fases 1 e 2)

### 6.1 Segurança e privacidade
- **PII por padrão mascarada** em UI e em prompts enviados ao LLM. Telefones em hash quando usados como referência interna.
- **Conteúdo de SMS** não vai pro contexto do LLM a menos que o usuário peça explicitamente análise de risco — e mesmo aí, só o conteúdo daquela mensagem específica.
- **SSO + RBAC.** Mínimo de dois papéis: `support_analyst` (acesso a chat, busca, incidentes) e `support_lead` (tudo + página de relatórios e configuração de regras).
- **Audit log imutável** para: cada mensagem do chat, cada tool call (com input/output), cada transição de incidente, cada acesso a dado mascarado.
- **Dados sensíveis fora dos logs do LLM provider.** Verificar política de retenção do provedor de LLM escolhido; se necessário, usar cliente que não retém prompts.

### 6.2 Observabilidade do próprio assistente
Métricas a expor (Prometheus/Grafana):
- Latência por tool (p50/p95/p99).
- Taxa de erro por tool.
- Tokens consumidos por sessão e custo agregado.
- Taxa de rejeição da IA (quando se recusa a responder por falta de tool).
- Tempo de detecção → notificação (Fase 2).
- Tempo de notificação → acknowledge (Fase 2).

Logs estruturados em JSON com `session_id`, `user_id`, `tool_name`, `latency_ms`, `success`.

### 6.3 Escolha do LLM
Recomendação: usar um LLM com bom suporte a tool use estruturado e janela de contexto suficiente para histórico de chat. Validar com testes adversariais antes de subir:
- Pedir dados sem tool disponível → deve recusar.
- Pedir reenvio (que é fora de escopo na V1) → deve recusar e explicar.
- Tentar prompt injection via conteúdo de mensagem → não deve executar instruções embutidas.

### 6.4 Estratégia de testes
- **Testes unitários** das tools (busca, trilha, relatório, detector de anomalias).
- **Testes de integração** chat → tool → backend → DB.
- **Testes adversariais do LLM** (suite de prompts que tentam burlar regras).
- **Replay de incidentes históricos:** rodar o detector contra dados passados para validar se ele teria pego incidentes reais sem gerar falso-positivo excessivo.

### 6.5 Riscos e mitigações

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| LLM alucina dados (telefones, IDs). | Média | Alto | LLM nunca produz dados estruturados sem tool. UI mostra origem de cada dado (tool call). |
| Detector de anomalias gera ruído. | Alta | Médio | Começar conservador (thresholds altos), iterar com base em `false_positive` registrados. |
| WebSocket sobrecarrega backend em incidente grande. | Baixa | Médio | Usar serviço gerenciado (API Gateway WS). Throttle de notificações por usuário. |
| Suporte ignora campo obrigatório copiando texto genérico. | Média | Médio | Mínimo de caracteres + análise periódica de qualidade das descrições pelo líder. |
| Custo de LLM escala mal. | Média | Médio | Monitorar tokens/sessão. Definir teto. Considerar modelo menor para tool routing. |
| Hot store cresce demais. | Baixa | Baixo | Retenção de 90 dias com job de purga. Histórico fica em S3/Athena. |

---

## 7. Roadmap sugerido (estimativa grossa)

| Marco | Conteúdo | Estimativa |
|---|---|---|
| M1 | Pipeline de ingestão hot store + endpoints de busca/trilha. | 3-4 sprints |
| M2 | Backend de chat + integração LLM com tools de Fase 1. | 2-3 sprints |
| M3 | Frontend de chat + painel contextual. | 2-3 sprints |
| M4 | **Go-live Fase 1.** Período de observação ≥ 4 semanas. | — |
| M5 | Detector de anomalias + WebSocket + modelo de incidentes. | 3-4 sprints |
| M6 | UI de incidentes + formulário de resolução + relatórios. | 2-3 sprints |
| M7 | **Go-live Fase 2.** | — |

Estimativas assumem 1 squad full-stack (3-4 devs) trabalhando dedicado. Ajustar conforme realidade do time.

---

## 8. Perguntas em aberto para o time

Antes de começar implementação, alinhar:

1. **Qual o LLM e provedor escolhidos?** Impacta custo, latência, política de retenção de prompts.
2. **SSO existente integra com qual padrão?** SAML, OIDC?
3. **O conteúdo do SMS pode ser armazenado em claro no hot store ou só no S3?** Política de PII define.
4. **Quais regras de anomalia são prioritárias?** Listar com produto/suporte os Top 3 cenários reais que mais atrapalham hoje.
5. **Quem define os thresholds das regras?** Fixos no código ou configuráveis por UI?
6. **O serviço de análise de risco existente é síncrono?** Latência aceitável?
7. **Há SLA contratual que exige tempo de resposta a incidentes?** Influencia severidades default.

---

*Fim da spec V1.*

