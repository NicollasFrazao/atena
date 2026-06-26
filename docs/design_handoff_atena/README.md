# Handoff: Atena — Assistente Conversacional de Envios

> Pacote de handoff para implementação. Serve tanto para um **desenvolvedor humano** quanto para o **Claude Code**.
> Gerado a partir do protótipo (HTML/React) + da especificação V1 (`spec-assistente-suporte.md`).

---

## 1. O que é a Atena

Assistente conversacional de IA para a plataforma de comunicação. Dá a qualquer time autorizado **acesso self-service aos dados de envio** (SMS) — busca, trilha completa, análise de risco, relatórios — e **detecta anomalias proativamente**, notificando em tempo real e registrando a ação tomada em cada incidente.

Duas fases:
- **Fase 1 — Self-service (read-only):** chat que orquestra tools determinísticas sobre os dados de envio.
- **Fase 2 — Proativo:** detector de anomalias cria incidentes, push via WebSocket, ciclo de vida do incidente com registro estruturado de resolução.

---

## 2. Sobre os arquivos deste pacote

⚠️ **Os arquivos `.html` / `.jsx` em `prototype/` são REFERÊNCIAS DE DESIGN** — protótipos feitos em HTML/React que mostram o visual e o comportamento pretendidos. **Não são código de produção para copiar e colar.**

A tarefa é **recriar esses designs no ambiente real do produto** (o frontend da Acme é React + TypeScript + styled-components + Phosphor Icons, sobre o `atena-design-system`) usando os padrões e a biblioteca de componentes já estabelecidos lá — e **implementar o backend** descrito nos documentos `01`–`04`.

Os **dados em `prototype/data.jsx` são mock**, mas o **formato** deles é o contrato: o backend deve responder no shape que o protótipo consome. Use-os como fonte da verdade dos response shapes.

---

## 3. Fidelidade

**Alta fidelidade (hifi).** O protótipo usa cores, tipografia, espaçamento e interações finais do Atena Design System. Recrie a UI fielmente usando os componentes reais do `atena-design-system` (Button, Badge, Card, Table, Dialog, Tabs, Switch, etc.) — o protótipo reimplementou esses componentes à mão só porque rodava standalone; no codebase real, use os do pacote.

---

## 4. Stack recomendada (backend)

| Peça | Escolha | Racional |
|---|---|---|
| Linguagem | **TypeScript (Node.js)** | Mesma do frontend → tipos compartilhados (pacote `@atena/types`), um time, menos atrito. |
| Framework | **NestJS** | Módulos + DI, **WebSocket gateway nativo** (RF-2.2), guards p/ SSO/RBAC, interceptors p/ audit log automático. |
| ORM | **Prisma** (ou Drizzle) | Migrations versionadas; o schema da spec §4.4/§5.3 mapeia direto. |
| Banco | **PostgreSQL** | Hot store de metadados (retenção 90d). Conteúdo de SMS fica no **S3** (PII). |
| LLM | **SDK Anthropic (TS)** | Tool use estruturado + streaming first-class. O orquestrador roda as tools; **a IA nunca toca o banco**. |
| Real-time | **WS gateway NestJS** | Em produção, atrás de API Gateway WebSocket gerenciado (escala). |
| Storage | **S3** (+ Athena p/ janelas > retenção) | Logs originais `json.gz` (~100 GB/mês). |

**Quando reconsiderar:** se a detecção de anomalia virar ML pesado (não thresholds), isolar o detector num serviço **Python/FastAPI** e manter o resto em Node. No MVP, as regras são por threshold → Node dá conta de tudo.

---

## 5. Princípios de arquitetura (não-negociáveis)

1. **A IA é intérprete, não executora.** O LLM traduz linguagem natural → chamada de tool. **A aplicação** roda a query, aplica permissões (RBAC) e acessa os dados. O LLM recebe de volta só o resultado estruturado.
2. **O LLM não fabrica dados.** Qualquer dado estruturado (telefone, ID, status, número) vem do retorno de uma tool. Pedido sem tool → **recusa explícita** (ver protótipo: `RefusalCard`).
3. **Mudança de estado de incidente NÃO é tool do LLM.** `acknowledge` e `resolve` só acontecem via UI (botão + formulário), garantindo que `action_category` + `action_description` passem pela validação. Protege a integridade do relatório gerencial.
4. **Tudo é auditado.** Toda mensagem, tool call, reveal de PII e mudança de incidente → audit log imutável (1 ano). Implementar como interceptor global no NestJS.
5. **PII mascarada por padrão.** Telefone e conteúdo de SMS chegam mascarados; revelar gera entry no audit log (RNF-1.4).

---

## 6. Documentos deste pacote

| Arquivo | Conteúdo |
|---|---|
| `README.md` | Este documento — visão geral, stack, princípios |
| `01-backend-api-contract.md` | Endpoints REST + WebSocket, catálogo de tools, request/response shapes |
| `02-data-model.md` | Schema Postgres consolidado (mensagens, incidentes, regras, sessões, audit) |
| `03-websocket-events.md` | Formato dos eventos de WebSocket (push de incidente, status) |
| `04-screen-to-endpoint-map.md` | Mapa de cada tela do protótipo → endpoint(s) que a alimenta |
| `05-design-reference.md` | Tokens de design, telas, componentes, estados, interações |
| `06-pending-decisions.md` | Recomendação para cada uma das 5 decisões pendentes |
| `screenshots/` | 18 capturas das telas + modais + estados de erro (referência visual) |
| `prototype/` | Os arquivos do protótipo (referência de design) |
| `spec-assistente-suporte.md` | A especificação V1 completa (fonte da verdade de requisitos) |
| `decisions.md` | Decisões de design batidas + pendências |

---

## 7. Ordem sugerida de implementação

**Sprint 0 — Fundação**
1. Auth/SSO (SAML ou OIDC — *decisão pendente*, ver `decisions.md`) + RBAC (`support_analyst`, `support_lead`).
2. Schema Postgres + migrations (`02-data-model.md`).
3. Interceptor de audit log global.

**Sprint 1 — Fase 1 (self-service)**
4. Tools determinísticas: `search_messages`, `get_message_trail`, `analyze_message_content`, `generate_delivery_report`, `list_providers`, `list_customers`.
5. Orquestrador LLM (sessão de chat, streaming, tool routing) + recusa explícita.
6. Mascaramento de PII + reveal com log.
7. Frontend do chat + tool results (recriar do protótipo).

**Sprint 2 — Fase 2 (proativo)**
8. Detector de anomalias (começar via webhook do Grafana Alertmanager → cria incidente; ver RF-2.1).
9. WebSocket gateway + push de incidente (`03-websocket-events.md`).
10. Ciclo de vida do incidente + endpoints `acknowledge`/`resolve` com validação server-side (RF-2.4).
11. Tela de Regras, Relatórios de incidente, Audit log viewer, Observabilidade.

---

## 8. Decisões pendentes (destravam implementação)

Ver `decisions.md` para a lista completa. As críticas:
1. **LLM e provider** — afeta latência, custo e política de retenção (preferir cliente sem retenção de prompt).
2. **SSO** — SAML ou OIDC?
3. **Conteúdo de SMS em claro no hot store ou só no S3?** (política de PII)
4. **Top 3 cenários de anomalia** prioritários → define thresholds default das regras.
5. **Audit log: onde mora?** Tabela no mesmo Postgres ou serviço dedicado.
