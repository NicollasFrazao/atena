# 04 — Mapa Tela → Endpoint

Qual chamada de backend alimenta cada tela do protótipo. Use junto com `01-backend-api-contract.md` (shapes) e `prototype/` (visual).

| Tela / componente (arquivo no protótipo) | Endpoint(s) | Notas |
|---|---|---|
| **Login** (`login.jsx`) | SSO (handshake) | SAML/OIDC pendente. Após sucesso → cria sessão de chat. |
| **Chat — envio de mensagem** (`chat.jsx` Composer) | `POST /api/chat/sessions/{id}/messages` (stream) | Resposta em stream: tool_call → tool_result → text_delta → done. |
| **Chat — estado vazio / sugestões** (`chat.jsx` EmptyState) | — | Sugestões são client-side; ao clicar, dispara a mensagem correspondente. |
| **Pill de tool rodando** (`chat.jsx` ToolCallPill) | evento `tool_call` do stream | "Buscando mensagens…" (RF-1.1). |
| **Resultado: busca** (`tool-results.jsx` SearchResults) | `GET /api/messages/search` | Shape §C.1. Linha clicável → abre trilha. |
| **Resultado: trilha** (`tool-results.jsx` TrailTimeline) | `GET /api/messages/{id}/trail` | Shape §C.2. |
| **Reveal de telefone** (`tool-results.jsx` PhoneCell) | retorna `phoneFull` + `POST` audit (`reveal_phone`) | Mascarado por padrão (RNF-1.4). |
| **Reveal de conteúdo** (`tool-results.jsx` ContentRevealBox) | busca conteúdo no S3 via `contentRef` + audit (`reveal_content`) | Confirmação antes de revelar. |
| **Resultado: risco** (`tool-results.jsx` RiskCard) | `POST /api/messages/analyze` | Shape §C.3. |
| **Resultado: relatório** (`tool-results.jsx` ReportCard) | `POST /api/reports/delivery` + `GET /api/reports/{id}/export.csv` | Shape §C.4. |
| **Recusa do LLM** (`chat.jsx` RefusalCard) | evento `refusal` do stream | Pedido fora de escopo (RF: LLM não fabrica). |
| **Lista de incidentes** (`incidents.jsx` IncidentsListPage) | `GET /api/incidents` | Shape §C.5. KPIs agregados. |
| **Detalhe do incidente** (`incidents.jsx` IncidentDetailPanel) | `GET /api/incidents/{id}` | Inclui `incident_activity`. |
| **Banner / push de incidente** (`incidents.jsx` IncidentBanner) | WS `incident.created` | Ver `03-websocket-events.md`. |
| **Acknowledge** (botão) | `POST /api/incidents/{id}/acknowledge` | Emite WS `incident.updated`. |
| **Modal de resolução** (`incidents.jsx` ResolveModal) | `POST /api/incidents/{id}/resolve` | Validação server-side (§D). |
| **Auto-resolve** (`incidents.jsx` AutoResolveModal) | `POST /api/incidents/{id}/resolve` (fluxo simplificado) | Nota ≥ 10 chars, categoria pré-selecionada. |
| **Relatório de incidentes** (`incidents.jsx` IncidentReportsPage) | `POST /api/reports/incidents` | Shape §C.6. MTTA/MTTR, distribuição por ação. |
| **Histórico de conversas** (`history.jsx` HistoryPage) | `GET /api/chat/sessions` | Item shape em §A. Filtros client-side. |
| **Regras de anomalia** (`rules.jsx` RulesPage) | `GET/PUT /api/rules` | Tabela `anomaly_rules`. Editar threshold/dimensão/janela/severidade/enabled. |
| **Audit log** (`audit.jsx` AuditLogPage) | `GET /api/audit` | Tabela `audit_log`. Filtros: período, usuário, tipo, só-PII. |
| **Observabilidade** (`observability.jsx` ObservabilityPage) | `GET /api/observability` | Métricas reais (OTel/Prometheus). |
| **Preferências de notificação** (`shells.jsx` ProfilePopover) | `GET/PUT /api/users/me/preferences` | Som on/off + filtro de severidade. |

## Estados de erro (do protótipo, `error-states.jsx`)
| Estado | Origem | Tratamento |
|---|---|---|
| Tool timeout/falha | tool result com erro | `ToolError` inline no chat + botão "tentar de novo". |
| WebSocket desconectado | queda da conexão WS | Faixa persistente + reconexão com backoff. |
| Sessão expirada | 401 em qualquer chamada | Overlay full-screen → re-login SSO. |
