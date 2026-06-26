---
type: skill
name: Documentation
description: Generate and update technical documentation. Use when Documenting new features or APIs, Updating docs for code changes, or Creating README or getting started guides
skillSlug: documentation
phases: [P, C]
generated: 2026-06-10
status: filled
scaffoldVersion: "2.0.0"
---
## Workflow

> ESTADO DO REPO: só specs + protótipo + scaffolding `.context/`. A documentação canônica do produto mora em `docs/design_handoff_atena/` (numerada 01–06 + spec + decisions); o contexto para agentes mora em `.context/docs/`. Manter os dois sincronizados é o trabalho. Tom: PT-BR informal (`você`). Seja honesto: produção não existe — descreva como DIREÇÃO, não como fato.

1. Identifique o público: agentes (`.context/docs/`) ou humanos do time/handoff (`docs/design_handoff_atena/`).
2. Determine o que mudou e qual doc é a fonte de verdade daquele tópico:
   - Tools e endpoints → `01-backend-api-contract.md`
   - Schema/tabelas/enums → `02-data-model.md`
   - Eventos WS → `03-websocket-events.md`
   - Mapa tela↔endpoint → `04-screen-to-endpoint-map.md`
   - Design/tokens → `05-design-reference.md`
   - Decisões batidas e pendentes → `decisions.md` / `06-pending-decisions.md`
3. Escreva onde o tópico é canônico; nos outros docs, cross-linke em vez de duplicar.
4. Use exemplos REAIS do Atena: tools (`search_messages`, `get_message_trail`), endpoints (`POST /api/incidents/{id}/resolve`), shapes do `data.jsx`, enums (`action_category`, `final_status`, `severity`).
5. Marque claramente o que é direção vs. implementado. Só `prototype/*.jsx` é código real; backend/frontend não existem.
6. Ao mudar uma decisão locked, atualize `decisions.md` (com rationale) e mova item de `06-pending-decisions.md` quando resolvido.
7. Cross-linke novos scaffolds em `.context/docs/README.md` e `.context/agents/README.md` (AGENTS.md exige).
8. Revise: links resolvem, exemplos batem com o contrato, terminologia consistente com o `glossary.md`.

## Examples

**Documentar uma tool nova (no doc canônico 01):**
```md
### `correlate_incidents` (Fase 1.2 — proposta, NÃO implementada)
| Tool | Endpoint | Input | Output |
|---|---|---|---|
| `correlate_incidents` | `GET /api/incidents/correlate` | `{ dateRange, dimension }` | lista correlacionada |

Espelha o padrão tool↔endpoint. Resposta no envelope `{ rows, page, totalPages, total, latencyMs }`.
Não é mutação — não toca estado de incidente. Ver convenções no topo deste arquivo.
```

**Cross-link em vez de duplicar:**
```md
> O enum `action_category` (provider_recovered, provider_escalated, …) é canônico em
> [`02-data-model.md`](./02-data-model.md). As regras de validação no resolve estão em
> [`01-backend-api-contract.md §D`](./01-backend-api-contract.md). Aqui só referenciamos.
```

**Registrar resolução de decisão pendente (`decisions.md`):**
```md
### Audit log: onde mora? — RESOLVIDO 12/06/2026
Decisão: tabela append-only no mesmo MySQL, particionada por mês, role do app só
INSERT + SELECT. Rationale: simplicidade operacional na v1; revisitar se volume crescer.
(Movido de 06-pending-decisions.md.)
```

## Quality Bar

- PT-BR informal (`você`), consistente com o resto do handoff.
- Documente no doc canônico do tópico; nos demais, cross-linke (01–06 + decisions.md).
- Exemplos reais do Atena: tools, endpoints, shapes do `data.jsx`, enums verdadeiros. Nada de "Users API" genérico.
- Honestidade: marque direção vs. implementado. Único código real é `prototype/*.jsx`.
- Mantenha `.context/docs/` e `docs/design_handoff_atena/` sincronizados; atualize doc na mesma mudança que o conteúdo.
- Decisões mudadas atualizam `decisions.md` com rationale; pendências resolvidas saem de `06-pending-decisions.md`.
- Sem PII em exemplos; telefone mascarado/fictício.
- Cross-linke scaffolds novos em `.context/docs/README.md` e `.context/agents/README.md`.

## Resource Strategy

- A documentação do produto já tem casa: `docs/design_handoff_atena/`. Não crie docs paralelos.
- Adicione `references/` aqui só para um índice de "onde documentar o quê" se ficar grande.
- Não crie `scripts/` (geradores de doc) enquanto não houver código que extrair; hoje a doc é escrita à mão.
- Não toque `prototype/*.jsx` para documentar — leia e cite.
