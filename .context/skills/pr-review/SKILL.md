---
type: skill
name: Pr Review
description: Review pull requests against team standards and best practices. Use when Reviewing a pull request before merge, Providing feedback on proposed changes, or Validating PR meets project standards
skillSlug: pr-review
phases: [R, V]
generated: 2026-06-10
status: filled
scaffoldVersion: "2.0.0"
---
## Workflow

Revisão de PR no Atena (backend NestJS/Prisma + frontend React/`atena-design-system`). Os 5 princípios não-negociáveis do `docs/design_handoff_atena/README.md` §5 são o eixo da revisão. Feedback em PT-BR informal.

1. **Entenda o objetivo do PR** e situe-o na sprint (Fundação / Fase 1 self-service / Fase 2 proativo).
2. **Rode o checklist dos 5 princípios** sobre o diff (ver Quality Bar). Qualquer violação = request changes, não sugestão.
3. **Backend (NestJS/Prisma):**
   - O LLM nunca toca o banco — quem roda query/RBAC/dados é a app (princípio 1). Cheque que tools só montam input e a execução é server-side.
   - Tool nova/alterada escreve audit `tool_call`; reveal escreve `reveal_phone`/`reveal_content` (princípio 4/5).
   - `acknowledge`/`resolve`/`comment` são endpoints REST com guard + validação server-side, NUNCA expostos como tool do LLM (princípio 3).
   - Resolve revalida tudo server-side (§D): `actionCategory` ∈ enum; `actionDescription` ≥ 20 chars (≥ 10 no `auto_resolved`); `escalatedTo` obrigatório se category ∈ {provider_escalated, internal_escalated}; só transição de detected|acknowledged|auto_resolved → resolved; escreve `incident_activity` (status_change) + audit.
   - Guard de RBAC por endpoint: `support_analyst` (chat/busca/trilha/ack/resolve) vs `support_lead` (+ relatórios, editar regras, audit log). Endpoint sem guard = bloqueio.
   - Prisma: snake_case no DB, camelCase na API — o mapeamento mora no ORM. Migration não quebra imutabilidade do `audit_log` (só INSERT+SELECT).
4. **Frontend (React/design-system):**
   - Usa componentes reais do `atena-design-system` (Button, Badge, Card, Table, Dialog, Tabs, Switch) — não reimplementa à mão como o protótipo, não copia JSX de `prototype/`.
   - PII mascarada por padrão (`phoneMasked`, `contentPreview` oculto); reveal exige confirmação e dispara audit (princípio 5).
   - UI desabilita campo inválido MAS não é fonte de verdade — a validação real é server-side (validação dupla).
   - Estados de erro do `error-states.jsx`: ToolError inline + "tentar de novo", faixa de WS desconectado, overlay de sessão expirada (401 → re-login via login social institucional (OIDC)).
5. **Shapes batem com o contrato:** todo response/payload confere com `prototype/data.jsx` e §C de `01-backend-api-contract.md` (ex.: `SearchResults` = §C.1 `MOCK.searchResults[]`).
6. **Segredos:** nenhum `.env`/`.pem`/`.key`/`*secret*` no diff (bloqueado por `.context/harness/policy.json`); conteúdo bruto de SMS só no S3 via `contentRef`, nunca em coluna de texto nem em log; usar `phone_hash` para busca sem PII em logs.
7. **Commits:** Conventional Commits (`AGENTS.md`).
8. **Veredito:** approve, request changes ou comment, separando obrigatório de sugestão.

## Examples

**Request changes (violação de princípio):**
```
Boa direção, mas tem bloqueio antes do merge:

1. [PRINCÍPIO 3] incidents.service.ts:88 — `resolve_incident` foi registrada como tool
   do LLM. Ack/resolve NÃO são tools: têm que ser POST /api/incidents/{id}/resolve com
   validação server-side (§D). Remover do catálogo de tools.
2. [PRINCÍPIO 5] PhoneCell renderiza `phoneFull` direto do payload. Telefone é mascarado
   por padrão; só revela com permissão + confirmação, e o reveal escreve audit
   'reveal_phone' (RNF-1.4). Hoje não escreve nada no audit.
3. [VALIDAÇÃO §D] o endpoint resolve confia no `disabled` do botão. Revalide server-side:
   actionDescription ≥ 20 chars e escalatedTo obrigatório p/ provider_escalated.

Sugestão (não-bloqueante): extrair o mapeamento snake_case→camelCase pra um mapper.
```

**Approve:**
```
Aprovado. search_messages roda 100% server-side (LLM só monta o input), shape bate com
§C.1 / MOCK.searchResults[], guard RBAC no endpoint, audit 'tool_call' gravado, e a UI usa
Table do atena-design-system. PII mascarada por padrão. 👍
```

## Quality Bar

- **Checklist dos 5 princípios em todo PR relevante:** (1) app roda query/RBAC/dados, LLM nunca toca o banco; (2) dado estruturado só vem de tool, senão recusa explícita (`RefusalCard`); (3) ack/resolve/comment via UI + validação server-side, jamais como tool; (4) tool call / reveal / mudança de incidente escreve audit log imutável; (5) PII mascarada por padrão, reveal gera audit.
- Validação dupla: a UI desabilitar não basta — o backend SEMPRE revalida. Resolve cobre §D inteiro (enum, ≥20/≥10 chars, escalated_to, transições válidas, incident_activity + audit).
- Shapes batem com `data.jsx`/§C — divergência de campo ou de nome (camelCase) é request changes.
- Nenhum segredo no diff; conteúdo de SMS só no S3 (`contentRef`); `phone_hash` em buscas/logs; sem PII em log.
- Frontend usa `atena-design-system` (não reimplementa componentes, não cola JSX do protótipo); estados de erro do `error-states.jsx` cobertos; strings em PT-BR informal.
- `audit_log` permanece append-only (sem UPDATE/DELETE); migrations não afrouxam isso.
- Conventional Commits. Feedback separa bloqueio de sugestão e aponta arquivo:linha.

## Resource Strategy

- Sem `scripts/`/`references/`/`assets/` próprios: o checklist cabe em `SKILL.md` e os contratos vivem em `docs/design_handoff_atena/`.
- Para shapes, referencie §C de `01-backend-api-contract.md` e os mocks de `prototype/data.jsx` por nome — não duplique JSON aqui.
- Para regras de validação do resolve, aponte para §D do contrato e §5.3 de `02-data-model.md` em vez de recopiar o enum.
