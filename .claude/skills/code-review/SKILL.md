---
name: code-review
description: Review code quality, patterns, and best practices. Use when Reviewing code changes for quality, Checking adherence to coding standards, or Identifying potential bugs or issues
---

## Workflow

> ESTADO DO REPO: ainda não há código de produção — só specs e o protótipo de design. Este checklist é a DIREÇÃO de revisão para quando o backend NestJS e o frontend React começarem. O protótipo (`prototype/*.jsx`) é referência de design, NÃO deve ser copiado como código de produção.

1. Entenda o que a mudança toca: chat/stream, tool/endpoint, incidente, regra, audit, WS, ou UI. Cada área tem invariantes próprias (abaixo).
2. Verifique os 5 princípios não-negociáveis primeiro — são bloqueantes:
   - IA é intérprete: o app roda query/RBAC/dados; o LLM nunca toca o banco.
   - LLM não fabrica dados: todo número/fato vem de tool_result; senão, recusa explícita.
   - Estado de incidente não é tool: ack/resolve/comment só via UI + validação server-side.
   - Tudo auditado: ações sensíveis gravam `audit_log` via interceptor global.
   - PII mascarada por padrão: reveal de telefone/conteúdo gera audit.
3. Cheque RBAC por endpoint: guard NestJS aplicado; relatórios gerenciais, editar regras e ver audit são `support_lead`.
4. Cheque o contrato de API: camelCase na resposta, snake_case no DB mapeado no ORM, ISO 8601 UTC, envelope `{ rows, page, totalPages, total, latencyMs }`, erro `{ error: { code, message } }`.
5. Cheque shapes contra `prototype/data.jsx` — o frontend e o backend devem bater com os mocks que viraram contrato.
6. Frontend: usa `atena-design-system` (não recria Button/Badge/Card); ícones Phosphor; cores Plankton + semânticas (Thanos fora da v1); PT-BR informal (`você`).
7. Validação de mutação de incidente: confirme que o backend revalida (não confia na UI) — categoria no enum, `actionDescription` ≥ 20 chars, `escalatedTo` se `*_escalated`, transição de status permitida.
8. Aponte os achados mais impactantes primeiro; explique o porquê citando o princípio ou o doc do handoff; elogie padrões corretos.

## Examples

**Achado bloqueante — PII vazando sem reveal/audit:**
```ts
// PROBLEMA (viola Princípio 5 + 4):
return rows.map(m => ({ id: m.message_id, phoneFull: m.phone_e164, status: m.final_status }));

// CORREÇÃO: mascarar por padrão; phoneFull só sob reveal autorizado, gravando audit.
return rows.map(m => ({ id: m.messageId, phoneMasked: mask(m.phoneE164), status: m.finalStatus }));
// reveal → endpoint dedicado + auditLog({ action: 'reveal_phone', resource: `msg/${id}`, severity: 'pii' })
```

**Achado bloqueante — ack/resolve exposto como tool:**
```ts
// PROBLEMA (viola Princípio 3): resolver incidente não pode ser tool do LLM.
tools.register('resolve_incident', resolveIncidentHandler);

// CORREÇÃO: remover do catálogo de tools. Resolve só por REST + UI:
// POST /api/incidents/{id}/resolve  com validação server-side (§D do contrato).
```

**Achado — contrato de API fora do padrão:**
```ts
// PROBLEMA: envelope errado e snake_case vazando.
return { data: rows, meta: { page } };           // ❌

// CORREÇÃO:
return { rows, page, totalPages, total, latencyMs };  // ✅ envelope canônico, camelCase
```

**Elogio + nota leve — frontend reusa o design system:**
```tsx
// BOM: usa StatusPill/SeverityBadge do design system em vez de recriar.
<SeverityBadge severity="critical" />   // só confirme PT-BR informal na microcopy
```

## Quality Bar

- Os 5 princípios são bloqueantes; qualquer violação trava a aprovação.
- PII mascarada por padrão; reveal sempre gera audit (`reveal_phone`/`reveal_content`, severity `pii`).
- Toda ação sensível grava `audit_log` (`tool_call`, `incident_*`, `export_report`, `rule_update`, `session_start`).
- Estado de incidente nunca é tool; ack/resolve/comment só por REST + UI com validação dupla server-side.
- LLM nunca toca o banco; o app é quem roda query/RBAC. Nenhum número na resposta da IA sem `tool_result`.
- RBAC por endpoint via guard; checar papel correto (`support_analyst` vs `support_lead`).
- Contrato: camelCase API / snake_case DB no ORM, ISO 8601 UTC, envelope paginado, `{ error: { code, message } }`.
- Shapes batem com `prototype/data.jsx`; divergência é defeito de contrato.
- Frontend usa `atena-design-system` e Phosphor; não recriar componentes; paleta Plankton + semânticas; PT-BR informal.
- `policy.json` bloqueia `.env`/`.pem`/`.key`/`*secret*` — nenhum segredo no diff.

## Resource Strategy

- O checklist canônico de segurança/PII vive em `.context/docs/security.md` e na `security-audit` skill; cite-os em vez de duplicar.
- Adicione `references/` só se um checklist por área (chat, incidents, ws) crescer demais para caber aqui.
- Não crie `scripts/` de lint enquanto não houver código; quando houver, regras de ESLint/guard de PII seriam candidatas.
- Não revise o protótipo como se fosse produção — ele é referência de design.
