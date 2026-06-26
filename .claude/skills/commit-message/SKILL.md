---
name: commit-message
description: Generate commit messages that follow conventional commits and repository scope conventions. Use when Creating git commits after code changes, Writing commit messages for staged changes, or Following conventional commit format for the project
---

## Workflow

> CONVENÇÃO (AGENTS.md): Conventional Commits, ex.: `feat(scaffolding): add doc links`. No Atena escrevemos o assunto em PT-BR, imperativo. O repo hoje é só specs + protótipo + scaffolding `.context/`, então escopos como `scaffolding`, `docs` e `design` são os mais frequentes por ora; os escopos de produção (backend, frontend, chat…) valem quando o código existir.

1. Revise o que está staged (`git diff --staged`) e isole uma mudança lógica por commit.
2. Escolha o tipo: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `style`, `perf`.
3. Escolha o escopo do Atena conforme a área tocada:
   - `backend`, `frontend`, `chat`, `tools`, `incidents`, `rules`, `audit`, `ws`, `db` (produção, quando existir)
   - `scaffolding`, `docs`, `design` (estado atual: specs, handoff, `.context/`, protótipo)
4. Escreva o assunto em PT-BR, imperativo, ≤ 50 chars, sem ponto final ("adiciona", não "adicionado"/"adicionando").
5. Use o corpo para o porquê, não o quê (o diff mostra o quê) — especialmente quando a mudança toca um dos 5 princípios ou o contrato de API.
6. Referencie incidente/decisão quando fizer sentido (ex.: "ref decisions.md", "RF-2.4").
7. Feche o trailer de co-autoria exigido pelo harness.

## Examples

**Feature de tool/endpoint:**
```
feat(tools): adiciona search_messages com envelope paginado

Espelha GET /api/messages/search no contrato 01-backend-api-contract.
PhoneFull só sob reveal autorizado; resposta mascarada por padrão.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

**Fix respeitando princípio (LLM não fabrica dados):**
```
fix(chat): impede contagem citada sem tool_result correspondente

A IA citava total fora do envelope retornado. Agora toda contagem
referencia o campo `total` do último tool_result; senão, recusa.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

**Validação server-side de incidente:**
```
feat(incidents): valida resolve no backend (categoria, descrição, escalonamento)

actionDescription >= 20 chars; escalatedTo obrigatório em *_escalated;
transicao apenas de detected/acknowledged/auto_resolved -> resolved.
Grava incident_activity + audit_log. Ref 01-backend-api-contract §D.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

**Tempo real e auditoria:**
```
fix(ws): repreenche incidentes via REST ao reconectar

Backoff exponencial cap 30s; GET /api/incidents?status=detected,acknowledged
no reconnect para não perder eventos durante a queda.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

**Estado atual do repo (docs/scaffolding):**
```
docs(design): registra decisao de banner persistente para incidentes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

## Quality Bar

- Conventional Commits sempre: `tipo(escopo): assunto`.
- Assunto em PT-BR, imperativo, ≤ 50 chars, sem ponto final.
- Escopo da lista do Atena (`backend|frontend|chat|tools|incidents|rules|audit|ws|db|docs|scaffolding|design`); não invente escopo solto.
- Uma mudança lógica por commit.
- Corpo explica o porquê; cite o princípio, RF/RNF ou doc do handoff quando relevante.
- NUNCA inclua PII (telefone real, conteúdo de SMS) na mensagem.
- Termine com o trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- `breaking change` no contrato de API → use `feat!`/`fix!` ou rodapé `BREAKING CHANGE:`.

## Resource Strategy

- A lista de escopos vive aqui; se crescer, mova para `references/scopes.md` e aponte.
- Não crie `scripts/` de commit (hooks de commitlint) enquanto não houver toolchain; quando houver, é candidato.
- Não duplique as convenções do AGENTS.md; cite-o.
