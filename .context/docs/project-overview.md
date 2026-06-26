---
type: doc
name: project-overview
description: High-level overview of the project, its purpose, and key components
category: overview
generated: 2026-06-10
status: filled
scaffoldVersion: "2.0.0"
---

## Project Overview

**Atena** é o assistente conversacional de IA da plataforma de comunicação. Ele dá a times de suporte autorizados **acesso self-service aos dados de envio de mensagens (SMS)** — busca, trilha completa de entrega, análise de risco de conteúdo e relatórios — e, na Fase 2, **detecta anomalias proativamente**, criando incidentes, notificando em tempo real e registrando de forma estruturada a ação tomada em cada um. O princípio central é que **a IA é intérprete, não executora**: o LLM traduz linguagem natural em chamadas de _tools_ determinísticas; a aplicação executa a query, aplica RBAC e acessa os dados — o LLM nunca toca o banco e nunca fabrica dados.

> ⚠️ **Estado atual do repositório:** este repo contém o **pacote de design handoff** (`design_handoff_atena/`) — especificação, contratos de API, modelo de dados, eventos de WebSocket e um protótipo React de alta fidelidade. **O código de produção (backend NestJS + frontend React) ainda não foi implementado.** A documentação abaixo descreve o sistema pretendido a partir do handoff, sinalizando o que é spec vs. o que já existe.

## Codebase Reference

> **Semantic Snapshot**: Use `context({ action: "getMap", section: "all" })` para o stack gerado, camadas de arquitetura, key files e hotspots de dependência. Hoje o snapshot reflete apenas o protótipo (`(protótipo original, não incluído)*.jsx`), já que é o único código presente.

## Quick Facts

- Root: `~/atena`
- Linguagem primária detectada: JavaScript (protótipo `.jsx`) — stack de produção pretendida: **TypeScript** (Node.js + React)
- Estado: **design handoff** (specs + protótipo); implementação ainda não iniciada
- Fonte da verdade dos requisitos: [spec-assistente-suporte.md](../../docs/design_handoff_atena/spec-assistente-suporte.md)
- Contrato de API / shapes: [01-backend-api-contract.md](../../docs/design_handoff_atena/01-backend-api-contract.md)
- Entry point do protótipo: [app.jsx](../../(protótipo original, não incluído))
- Semantic snapshot: `context({ action: "getMap", section: "all" })`

## Entry Points

- **Protótipo (referência de design, único código existente):** [(protótipo original, não incluído)](../../(protótipo original, não incluído)) — monta o shell imersivo e roteia entre Chat / Incidentes / Relatórios.
- **Backend (pretendido, a implementar):** aplicação NestJS expondo REST + WebSocket gateway (`/ws/support`) conforme [design_handoff_atena/01-backend-api-contract.md](../../docs/design_handoff_atena/01-backend-api-contract.md).
- **Frontend (pretendido, a implementar):** app React + TypeScript sobre `atena-design-system`, recriando as telas do protótipo.

## Key Exports

Ainda não há superfície pública de produção (sem `package.json`, sem `main`/`bin`/`types`). As "exportações" relevantes hoje são conceituais e definidas pelo handoff:

- **Catálogo de tools do LLM** (contrato): `search_shippings`, `get_shipping_trail`, `analyze_shipping_content`, `generate_delivery_report`, `list_providers`, `list_customers` (Fase 1); `list_incidents`, `get_incident`, `generate_incident_report` (Fase 2). Ver [design_handoff_atena/01-backend-api-contract.md](../../docs/design_handoff_atena/01-backend-api-contract.md) §B.
- **Endpoints REST + WebSocket** descritos em [design_handoff_atena/01-backend-api-contract.md](../../docs/design_handoff_atena/01-backend-api-contract.md) e [design_handoff_atena/03-websocket-events.md](../../docs/design_handoff_atena/03-websocket-events.md).
- **Pacote de tipos compartilhados pretendido** (`@atena/types`) entre backend e frontend.

## File Structure & Code Organization

- `design_handoff_atena/` — pacote de handoff (specs + protótipo + design reference). É a fonte da verdade até o código de produção existir.
  - `01-backend-api-contract.md`…`06-pending-decisions.md` — contratos e decisões.
  - `prototype/` — protótipo React standalone (referência de design, **não** copiar para produção).
  - `screenshots/` — 18 capturas das telas/modais/estados de erro.
  - `spec-assistente-suporte.md` — especificação V1 completa.
  - `decisions.md` — decisões de design batidas + pendências.
- `.context/` — base de conhecimento do dotcontext (docs, agents, skills, harness). Determinística entre reruns.
- `AGENTS.md` — guia de contribuição (atenção: hoje é template genérico, ainda não reflete o repo real).

## Technology Stack Summary

A stack **pretendida** (do handoff) unifica em **TypeScript**. **Backend:** NestJS (módulos + DI, WebSocket gateway nativo, guards para auth/RBAC — login social institucional (OIDC, domínio restrito), SSO corporativo completo é débito residual, interceptor global de audit log), **Prisma** sobre **MySQL** como hot store de metadados (retenção 90d), **S3** como origem durável do conteúdo de SMS (PII) e logs originais `json.gz`, um **cache transitório de conteúdo/trilha em arquivos temporários no `/tmp`** (volume Docker numa EC2, hidratado do S3), e o **Amazon Bedrock (modelo Nova Pro via Bedrock, Converse API, streaming + tool use)** para o orquestrador LLM. **Frontend:** React + TypeScript + styled-components + Phosphor Icons sobre `atena-design-system`. **Observabilidade:** OpenTelemetry / Prometheus alimentando a página de Observabilidade. Hoje, no repo, só existe o protótipo `.jsx` standalone — sem build tool, sem test runner, sem package manager configurado.

## Core Framework Stack

- **Backend:** NestJS — escolhido pelo gateway WebSocket nativo (RF-2.2), guards para auth/RBAC (login social institucional via OIDC) e interceptors que viabilizam o audit log automático e global.
- **Dados:** MySQL (hot store de metadados) + S3 (origem durável de conteúdo/PII e logs frios; Athena para janelas além da retenção) + cache transitório de conteúdo/trilha em arquivos temporários no `/tmp` (volume Docker numa EC2). ORM: Prisma com migrations versionadas. Cache transitório (read-through) dos dados brutos: leitura de conteúdo/trilha lê do `/tmp`; faltando o dado, busca no S3 (`s3_log_pointer`/`content_ref`) e popula o `/tmp` (cache efêmero/rebuildável) — para evitar muitas requisições ao S3 num curto período e manter os brutos fora do banco.
- **LLM:** Amazon Bedrock (modelo Nova Pro via Bedrock, Converse API, streaming + tool use) — o orquestrador roda as tools; a IA nunca acessa o banco diretamente.
- **Real-time:** WebSocket gateway do NestJS, atrás de API Gateway WebSocket gerenciado em produção.

## UI & Interaction Libraries

- **`atena-design-system`** — usar os componentes reais (Button, Badge, Card, Table, Dialog, Tabs, Switch). O protótipo reimplementou-os à mão só por rodar standalone.
- **Phosphor Icons** (`@phosphor-icons/react`) — `regular` para chrome, `bold` para glifos grandes. Sem emoji no produto.
- **Tokens de design Acme** — primária `plankton800` (#077E70) + cores semânticas (danger/warning/info/success). Ver [05-design-reference.md](../../docs/design_handoff_atena/05-design-reference.md).
- Idioma do produto: **PT-BR**, registro informal (`você`).

## Development Tools Overview

Ainda não há toolchain configurada no repositório (sem `package.json`/scripts). Quando o código de produção começar, espere os fluxos NestJS (backend) e React/TypeScript (frontend) descritos em [tooling.md](tooling.md) e [development-workflow.md](development-workflow.md). Para inspecionar o estado atual, use o snapshot do dotcontext (`context({ action: "getMap" })`).

## Getting Started Checklist

1. Leia o [README do handoff](../../docs/design_handoff_atena/README.md) e a [spec V1](../../docs/design_handoff_atena/spec-assistente-suporte.md) para entender escopo e princípios.
2. Estude os contratos: [01-backend-api-contract.md](../../docs/design_handoff_atena/01-backend-api-contract.md), [02-data-model.md](../../docs/design_handoff_atena/02-data-model.md), [03-websocket-events.md](../../docs/design_handoff_atena/03-websocket-events.md).
3. Veja como cada tela mapeia para endpoints em [04-screen-to-endpoint-map.md](../../docs/design_handoff_atena/04-screen-to-endpoint-map.md) e abra os `screenshots/`.
4. Revise os 5 princípios de arquitetura não-negociáveis (IA não executa, não fabrica dados, incidente não é tool, tudo auditado, PII mascarada) — ver [architecture.md](architecture.md).
5. Confira as decisões batidas e pendentes em [decisions.md](../../docs/design_handoff_atena/decisions.md) e [06-pending-decisions.md](../../docs/design_handoff_atena/06-pending-decisions.md) antes de codar.
6. Siga a ordem de implementação sugerida (Sprint 0 → 2) do [README do handoff](../../docs/design_handoff_atena/README.md).

## Next Steps

Decisões pendentes destravam a implementação (ver [06-pending-decisions.md](../../docs/design_handoff_atena/06-pending-decisions.md)): política de PII (conteúdo em claro no cache transitório de `/tmp` ou só no S3), top 3 cenários de anomalia (definem thresholds default das regras) e onde mora o audit log. O provider de LLM já foi batido em **Amazon Bedrock** (preferir cliente sem retenção de prompt) e a auth usa **login social institucional (OIDC) + RBAC** — OIDC via Microsoft 365 (Entra ID), atrás de uma abstração de auth para trocar de IdP facilmente (ex.: Google Workspace), restrito ao domínio `@example.com`, sem senha própria (SSO corporativo completo SAML + SCIM é débito residual, ver [tech-debt.md](./tech-debt.md)). Stakeholder: Acme / time de Suporte. Relacionados: [architecture.md](architecture.md), [development-workflow.md](development-workflow.md), [tooling.md](tooling.md).
