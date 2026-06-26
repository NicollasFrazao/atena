---
type: skill
name: Refactoring
description: Refactor code safely with a step-by-step approach. Use when Improving code structure without changing behavior, Reducing code duplication, or Simplifying complex logic
skillSlug: refactoring
phases: [E]
generated: 2026-06-10
status: filled
scaffoldVersion: "2.0.0"
---
## Workflow

Contexto: hoje só existe o protótipo de referência em `docs/(protótipo original, não incluído)*.jsx`. O caso de refatoração mais comum no Atena é **migrar do protótipo para produção** (NestJS no backend, React + `atena-design-system` no frontend) sem copiar JSX e sem quebrar os 5 princípios nem os shapes de contrato. Quando houver código de produção, valem também as refatorações internas normais.

1. **Defina o invariante a preservar.** No Atena isso é mais que "comportamento igual": é manter (a) os 5 princípios (README §5), (b) os shapes de contrato (§C de `01-backend-api-contract.md` / `prototype/data.jsx`), (c) `camelCase` na API ↔ `snake_case` no DB.
2. **Garanta uma rede de segurança.** Se já há testes (provável Jest, quando o runner existir), rode-os antes/depois. Sem testes, valide contra o shape do mock e contra os requisitos da spec; não refatore às cegas tocando audit/PII/validação.
3. **Migração protótipo → produção (não copiar JSX):** leia o componente em `prototype/*.jsx` só como referência de comportamento e layout; reescreva usando os componentes reais do `atena-design-system` (Button, Badge, Card, Table, Dialog, Tabs, Switch) e Phosphor. O protótipo reimplementou esses à mão por rodar standalone — descarte essa reimplementação. Ex.: `SearchResults` (`tool-results.jsx:72`) vira uma Table do design-system consumindo o shape §C.1.
4. **Extraia tipos compartilhados em `@atena/types`.** Tipos derivados dos shapes do contrato (SearchRow §C.1, Trail §C.2, Incident §C.5, etc.) vão para o pacote `@atena/types`, importado por backend e frontend — uma única fonte da verdade. Não duplique a forma em dois lugares.
5. **Uma mudança por vez, commits frequentes** (Conventional Commits, ver `AGENTS.md`).
6. **Revalide os invariantes:** PII continua mascarada por padrão e reveal ainda gera audit; tool continua server-side (LLM não toca o banco); ack/resolve continuam fora do catálogo de tools; validação server-side do resolve (§D) intacta; shape de resposta inalterado.

## Examples

**Extrair tipo compartilhado para `@atena/types` (em vez de duplicar o shape):**
```typescript
// Antes: shape do incidente redefinido no backend e copiado no frontend (divergem com o tempo).

// Depois: @atena/types/incident.ts — fonte única, derivada de §C.5
export type IncidentSeverity = 'info' | 'warning' | 'critical';
export type IncidentStatus  = 'detected' | 'acknowledged' | 'resolved' | 'auto_resolved';
export type DimensionType   = 'provider' | 'customer' | 'route' | 'global';

export interface Incident {
  id: string;                 // camelCase na API (DB: incident_id, snake_case)
  rule: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  dimensionType: DimensionType;
  dimensionValue: string | null;
  detectedAt: string;         // ISO 8601 UTC
  // ...resto conforme §C.5 / MOCK.incidents[]
}
// Backend (NestJS) e frontend (React) importam o MESMO tipo. O mapeamento
// snake_case→camelCase mora no mapper do Prisma, não vaza pra UI.
```

**Migrar componente do protótipo p/ produção sem copiar JSX:**
```
PhoneCell (prototype/tool-results.jsx:53, useMaskedPhone) reimplementa máscara/reveal à mão.
Na produção: reescrever usando o design-system, preservando o invariante de PII —
  phoneMasked por padrão; reveal só com permissão + confirmação; reveal chama o backend
  que retorna phoneFull E escreve audit 'reveal_phone' (princípio 5).
NÃO portar a lógica de máscara client-side como verdade: a app decide o que revelar.
```

## Quality Bar

- Refatoração preserva os 5 princípios — se a mudança permite o LLM tocar o banco, expõe ack/resolve como tool, remove audit de um reveal, ou desmascara PII por padrão, NÃO é refatoração, é regressão de segurança.
- Shapes de contrato imutáveis: depois da mudança, o response/payload ainda bate com `prototype/data.jsx` / §C. Renomear campo de API é quebra de contrato, não refactor.
- `camelCase` na API ↔ `snake_case` no DB sempre preservado; o mapeamento fica no ORM.
- Migrar do protótipo = reescrever com `atena-design-system`, nunca colar JSX de `prototype/`. A reimplementação manual de componentes no protótipo é descartável.
- Tipos compartilhados vão para `@atena/types`; nada de duplicar a mesma forma em backend e frontend.
- Validação server-side do resolve (§D) e a imutabilidade do `audit_log` (só INSERT+SELECT) não são afrouxadas por "limpeza".
- Sem testes/rede de segurança, não refatore caminhos sensíveis (audit, PII, validação, RBAC). Commits pequenos, Conventional Commits.

## Resource Strategy

- Sem `scripts/`/`references/`/`assets/` próprios: a referência de comportamento é o `prototype/` e os shapes vivem em `docs/design_handoff_atena/`.
- Para o destino dos tipos, aponte para o pacote `@atena/types` (direção do handoff) em vez de inventar caminhos de produção que ainda não existem.
- Referencie §C do contrato e §5.3 de `02-data-model.md` para shapes/enum em vez de recopiá-los aqui.
