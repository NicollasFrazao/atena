---
type: skill
name: Security Audit
description: Review code and infrastructure for security weaknesses. Use when Reviewing code for security vulnerabilities, Assessing authentication/authorization, or Checking for OWASP top 10 issues
skillSlug: security-audit
phases: [R, V]
generated: 2026-06-10
status: filled
scaffoldVersion: "2.0.0"
---
## Workflow

Auditoria de segurança do Atena. A superfície de risco do produto é PII de SMS (telefone + conteúdo) e a integridade do registro de incidentes. Antes de auditar, leia `README` §5 (5 princípios) e `02-data-model.md`. Além do OWASP top 10 genérico, rode os controles específicos do Atena abaixo.

1. **PII mascarada por padrão (RNF-1.4):** confirme que telefone (`phoneMasked` por padrão; `phone_e164` nunca exposto sem reveal) e conteúdo de SMS (`contentPreview` oculto) chegam mascarados. Reveal de telefone ou conteúdo SEMPRE escreve no audit (`reveal_phone` / `reveal_content`, severity `pii`). Veja `PhoneCell` / `ContentRevealBox` no protótipo como referência do comportamento — na produção a decisão de revelar é server-side, não client-side.
2. **Conteúdo bruto de SMS só no S3:** verifique que texto sensível não está em coluna do MySQL — `messages.content_ref` é só um ponteiro. Tools que precisam do texto buscam no S3 sob demanda, com log de acesso. Nada de PII em log de aplicação.
3. **`phone_hash` para busca/log:** buscas e logs usam `phone_hash`, não `phone_e164`, para não vazar PII em índices/logs.
4. **Audit log imutável (RNF-1.5):** `audit_log` só aceita INSERT + SELECT (sem UPDATE/DELETE); app role com permissão restrita; retenção 1 ano; idealmente append-only/particionado. Confirme que toda ação sensível gera entry (`tool_call`, `reveal_phone`, `reveal_content`, `incident_created`, `incident_ack`, `incident_resolve`, `session_start`, `export_report`, `rule_update`) via interceptor global NestJS.
5. **RBAC por endpoint:** todo endpoint tem guard. `support_analyst` (chat/busca/trilha/ack/resolve) NÃO acessa relatórios gerenciais, edição de regras nem audit log — esses são só de `support_lead`. Endpoint sem guard, ou checagem de papel só na UI, é achado.
6. **Validação dupla server-side (resolve §D):** a UI desabilita campos, mas o backend SEMPRE revalida — `actionCategory` ∈ enum; `actionDescription` ≥ 20 chars (≥ 10 no `auto_resolved`); `escalatedTo` obrigatório se category ∈ {provider_escalated, internal_escalated}; só transição detected|acknowledged|auto_resolved → resolved; cada mudança escreve `incident_activity` + audit. Garanta também que ack/resolve/comment NÃO são tools do LLM (mudança de estado fora do alcance do modelo — princípio 3).
7. **LLM não fabrica nem executa:** o modelo nunca toca o banco; todo dado estruturado vem de retorno de tool; pedido fora de escopo → recusa explícita. LLM é o Nova Pro via Amazon Bedrock (Converse API), sem retenção de prompt.
8. **Auth / sessão:** auth em todos os endpoints (login social institucional (OIDC, domínio restrito), Bearer token OIDC (login social institucional); WS valida token no handshake). OIDC via Microsoft 365 (Entra ID), atrás de uma abstração de auth para trocar de IdP facilmente (ex.: Google Workspace), restrito ao domínio `@example.com`, sem senha própria; RBAC mapeado após o login. Confirme que o domínio é validado server-side e que tokens de fora do domínio são rejeitados. Sessão expirada → 401 → overlay de re-login (`error-states.jsx`). Token também exigido no upgrade do WS `/ws/support`.
9. **Segredos:** nenhum `.env`/`.pem`/`.key`/`*secret*` no repo — bloqueado por `.context/harness/policy.json`. Sem credenciais hardcoded.
10. **Documente os achados** com severidade e correção (use a escala de severidade do audit_log como referência: info | warning | pii | config).

## Examples

**Relatório de auditoria (achados específicos do Atena):**
```
## Auditoria de Segurança — Atena

### Crítico
1. [PII] Endpoint GET /api/messages/search retorna phoneFull sem reveal nem audit
   - Telefone deve vir mascarado por padrão; só revela com permissão + reveal,
     que escreve audit 'reveal_phone' (severity pii, RNF-1.4).
   - Correção: mascarar no serializer; rota de reveal separada que grava audit.

### Alto
2. [RBAC] PUT /api/rules sem guard de support_lead
   - Qualquer support_analyst edita thresholds das regras de anomalia.
   - Correção: guard de papel no endpoint; rule_update gera audit 'rule_update'.
3. [VALIDAÇÃO §D] POST /api/incidents/{id}/resolve confia na UI
   - Backend não revalida actionDescription ≥ 20 chars nem escalatedTo p/
     provider_escalated; aceita transição resolved→resolved.
   - Correção: validação dupla server-side conforme §D + incident_activity + audit.

### Médio
4. [PII em log] phone_e164 logado na query de busca
   - Correção: logar phone_hash; nunca PII em logs/índices. Conteúdo de SMS só no S3.

### config
5. [Audit] audit_log com permissão de UPDATE concedida ao app role
   - Quebra imutabilidade (RNF-1.5). Correção: revogar UPDATE/DELETE; só INSERT+SELECT.
```

## Quality Bar

- PII mascarada por padrão; reveal de telefone/conteúdo SEMPRE gera audit (`reveal_phone`/`reveal_content`, severity `pii`). Decisão de revelar é server-side.
- Conteúdo bruto de SMS só no S3 (`content_ref` é ponteiro); `phone_hash` em buscas/logs; zero PII em log de aplicação.
- `audit_log` imutável: só INSERT+SELECT, retenção 1 ano; toda ação sensível registrada via interceptor global.
- RBAC por endpoint com guard server-side (`support_analyst` vs `support_lead`) — checagem só na UI não conta. Auth em todos os endpoints (login social institucional (OIDC, domínio restrito) — domínio `@example.com` validado server-side); WS valida token no handshake; 401 → re-login.
- Validação dupla: backend revalida o resolve (§D) inteiro independente da UI. Ack/resolve/comment fora do catálogo de tools do LLM.
- LLM nunca toca o banco; todo dado estruturado vem de tool; fora de escopo → recusa. Nova Pro via Amazon Bedrock (Converse API), sem retenção de prompt.
- Sem segredos no repo (`policy.json` bloqueia `.env`/`.pem`/`.key`/`*secret*`); sem credenciais hardcoded.
- Achados com severidade e correção concreta (arquivo:linha quando houver código). Cobrir também OWASP top 10 (injection, authz quebrada, exposição de dado sensível, deps vulneráveis).

## Resource Strategy

- Sem `scripts/`/`references/`/`assets/` próprios: os controles cabem em `SKILL.md` e o modelo de dados/regras vive em `02-data-model.md` e no `README` §5.
- Referencie §D do `01-backend-api-contract.md` e os enums de `02-data-model.md` (action_category, action do audit_log) em vez de duplicá-los.
- O escopo de segredos é definido por `.context/harness/policy.json` — consulte-o, não recopie a lista.
