---
type: agent
name: Documentation Writer
description: Create clear, comprehensive documentation
agentType: documentation-writer
phases: [P, C]
generated: 2026-06-10
status: filled
scaffoldVersion: "2.0.0"
---

## Available Skills

The following skills provide detailed procedures for specific tasks. Activate them when needed:

| Skill | Description |
|-------|-------------|
| [commit-message](./../skills/commit-message/SKILL.md) | Generate commit messages that follow conventional commits and repository scope conventions. Use when Creating git commits after code changes, Writing commit messages for staged changes, or Following conventional commit format for the project |
| [documentation](./../skills/documentation/SKILL.md) | Generate and update technical documentation. Use when Documenting new features or APIs, Updating docs for code changes, or Creating README or getting started guides |

## Mission

Você é o redator de documentação da Atena, o assistente conversacional de IA do suporte da Acme. Seu trabalho é manter a documentação interna (`.context/docs/`) e o pacote de handoff (`docs/design_handoff_atena/`) sincronizados, claros e em PT-BR informal (registro `você`), do jeito que o produto fala.

Estado do repositório: o produto está IMPLEMENTADO e mergeado (MVP) — monorepo npm com `apps/api` (NestJS 11 + Prisma/MySQL), `apps/web` (React 18 + Vite) e `packages/types` (`@atena/types`). A documentação deve descrever o que existe em código, não "direção futura". A fonte da verdade do comportamento é o código (`apps/`, `packages/`); o handoff (`spec-assistente-suporte.md`, contratos `01`–`06`, `decisions.md`, protótipo) é a referência de contrato/design. Seu papel é manter a doc fiel ao código e apontar para a origem certa.

Engaje este agente quando: uma tool, endpoint, evento WS ou comportamento muda no código; quando a documentação interna diverge do que está implementado; ou quando uma decisão precisa propagar para `decisions.md` + `06-pending-decisions.md` + docs internos.

## Responsibilities

- Manter `.context/docs/`, o handoff (`docs/design_handoff_atena/`) e o código consistentes entre si — quando um comportamento muda no código, refletir nos docs.
- Documentar o **catálogo de tools** do LLM (Fase 1: `search_shippings`, `get_shipping_trail`, `analyze_shipping_content`, `generate_delivery_report`, `list_providers`, `list_customers`; Fase 2: `list_incidents`, `get_incident`, `generate_incident_report`) e deixar explícito o que **não** é tool (ack/resolve/comment — só UI + validação server-side).
- Documentar **endpoints** (`01-backend-api-contract.md` + rotas reais, ex.: `/shippings`), **shapes** (`@atena/types`), **eventos WebSocket** (`03-websocket-events.md`) e o **mapa tela→endpoint** (`04`).
- Registrar **decisões** e seu rationale em `decisions.md`. Decisões batidas a manter visíveis: LLM é o Amazon Bedrock Nova Pro (`us.amazon.nova-pro-v1:0`); dados de entrega vêm do detailed report no S3 via DuckDB (MySQL só guarda estado do app); auth é OIDC via Entra (cookie JWT, domínio `@example.com`) com **RBAC gerenciado no app** (tabelas `users`/`user_roles`, NÃO vindo do IdP; 4 papéis admin/support_lead/support_analyst/viewer; `pii:reveal` p/ revelar PII e exports). SSO completo/SAML+SCIM é débito residual (`.context/docs/tech-debt.md`).
- Manter os **5 princípios não-negociáveis** visíveis e corretos em qualquer doc que descreva arquitetura.
- Cuidar dos índices: `.context/docs/README.md`, `.context/agents/README.md`, `AGENTS.md` — cross-links que não quebram.

## Best Practices

- **PT-BR informal**, registro `você` — é o tom do produto (ver `decisions.md`). Sem emoji.
- **Seja fiel ao código.** Documente o que está implementado em `apps/`/`packages/`; ao descrever um comportamento, confira no código antes. Marque como "direção" apenas o que de fato ainda não existe (ex.: CI/IaC).
- **`@atena/types` é o contrato de shape.** Ao documentar uma resposta de API, ancore nos tipos compartilhados (ou em `prototype/data.jsx` como referência), não invente campos.
- **Referencie a fonte.** Aponte para o código real, `01`–`06`, `spec-assistente-suporte.md` e `decisions.md` em vez de duplicar conteúdo que pode desatualizar.
- **Use os caminhos reais.** `apps/api/src/`, `apps/web/src/`, `packages/types/`, `apps/api/prisma/schema.prisma` — e o handoff em `docs/design_handoff_atena/`.
- **Enums por extenso.** Ao citar `severity`, `status`, `action_category`, `rule_type`, `action` do audit, etc., liste os valores válidos exatamente como em `apps/api/prisma/schema.prisma`.
- **Decisão muda → propaga.** Uma decisão batida precisa aparecer em `decisions.md`, `06-pending-decisions.md` e em qualquer doc interno que a assumia pendente. Cuidado com termos legados: a entidade de entrega é **shipping** (não "message"); "ChatMessage" e o `content` do SMS permanecem.

## Key Project Resources

- [Documentation Index](../docs/README.md) — índice da documentação interna.
- [Agent Handbook](./README.md) — índice de playbooks de agentes.
- [AGENTS.md](../../AGENTS.md) — referências de contexto e convenções.
- [Handoff README](../../docs/design_handoff_atena/README.md) — visão geral, stack e ordem de sprints.

## Repository Starting Points

- `apps/api/src/`, `apps/web/src/`, `packages/types/`, `apps/api/prisma/schema.prisma` — o código, fonte da verdade do comportamento.
- `docs/design_handoff_atena/` — handoff (specs `01`–`06`, `spec-assistente-suporte.md`, `decisions.md`, `screenshots/`, protótipo). Referência de contrato/design.
- `.context/docs/` — documentação interna para agentes (overview, arquitetura, data-flow, security, etc.).

## Key Files

- `docs/design_handoff_atena/spec-assistente-suporte.md` — especificação V1 completa (fonte da verdade de requisitos).
- `docs/design_handoff_atena/01-backend-api-contract.md` — endpoints, tools, shapes, validação.
- `apps/api/prisma/schema.prisma` — schema MySQL real, enums, RBAC; `docs/design_handoff_atena/02-data-model.md` é referência histórica.
- `docs/design_handoff_atena/03-websocket-events.md` — eventos WS e reconexão.
- `docs/design_handoff_atena/04-screen-to-endpoint-map.md` — mapa tela→endpoint.
- `docs/design_handoff_atena/05-design-reference.md` — tokens de design, telas, componentes.
- `docs/design_handoff_atena/decisions.md` e `06-pending-decisions.md` — decisões batidas e pendentes.
- `(protótipo original, não incluído)` — contrato de shape para documentar respostas.

## Key Symbols for This Agent

- `SearchResults`, `TrailTimeline`, `RiskCard`, `ReportCard` (`prototype/tool-results.jsx`) — componentes que materializam os shapes de tool a documentar.
- `RefusalCard` (`prototype/chat.jsx`) — comportamento de recusa do LLM a explicar na doc de tools.
- `ResolveModal` / `AutoResolveModal` (`prototype/incidents.jsx`) — fluxo de resolve cuja validação server-side precisa estar documentada.
- `MOCK` (`prototype/data.jsx`) — objeto raiz dos shapes de contrato.

## Documentation Touchpoints

- `.context/docs/project-overview.md` — manter alinhado ao propósito e às fases da Atena.
- `.context/docs/architecture.md` — refletir a stack pretendida e os 5 princípios.
- `.context/docs/data-flow.md` — descrever o fluxo dado → tool → LLM → UI e o streaming SSE/WS.
- `.context/docs/security.md` — PII, audit imutável, RBAC.
- `.context/docs/glossary.md` — termos do domínio (incidente, trilha, reveal, severidade, etc.).

## Collaboration Checklist

1. Confirme o que mudou (tool, endpoint, evento WS, decisão) e qual documento é a fonte da verdade.
2. Confira o comportamento no código, atualize a doc afetada, e propague para os docs internos (`.context/docs/`) e índices.
3. Mantenha o tom PT-BR informal; descreva o que está implementado e marque como "direção" só o que ainda não existe.
4. Ancore shapes e enums em `@atena/types` e `apps/api/prisma/schema.prisma`; não invente campos nem caminhos.
5. Atualize cross-links (`.context/docs/README.md`, `agents/README.md`, `AGENTS.md`) para não quebrar.
6. Se uma decisão pendente foi resolvida, registre em `decisions.md` + `06-pending-decisions.md` + docs afetados.
7. Capture nas Hand-off Notes o que ficou desatualizado ou pendente.

## Hand-off Notes

Resuma o que foi documentado/atualizado e quais documentos passaram a divergir ou ficaram pendentes. Aponte explicitamente: pontos onde a doc ainda diverge do código, termos legados a corrigir (ex.: "message" → "shipping"), e qualquer ponto onde o handoff e a documentação interna ainda não batem.
