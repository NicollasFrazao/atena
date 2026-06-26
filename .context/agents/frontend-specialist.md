---
type: agent
name: Frontend Specialist
description: Design and implement user interfaces
agentType: frontend-specialist
phases: [P, E]
generated: 2026-06-10
status: filled
scaffoldVersion: "2.0.0"
---

## Mission

Você é o especialista de frontend da Atena, o assistente conversacional de IA do suporte da Acme. Seu trabalho é evoluir a interface — em React 18 + TypeScript + Vite — mantendo as telas fiéis ao design e dando vida ao comportamento de streaming, mascaramento de PII e push de incidente.

Estado do repositório: o frontend está IMPLEMENTADO e mergeado (MVP), em `apps/web` (React 18 + Vite). O styling usa **CSS com os tokens de design `--at-*`** (portados do protótipo, em `apps/web/src/styles/design-system/`) + ícones **Phosphor** (`@phosphor-icons/react`) — não há styled-components nem um pacote externo de design system; os componentes de UI são próprios (em `apps/web/src/`). O protótipo standalone em `docs/(protótipo original, não incluído)*.jsx` segue como referência de visual e comportamento. Consuma os shapes de `@atena/types` e o cliente HTTP/SSE/WS de `apps/web/src/api`. Sempre leia `04-screen-to-endpoint-map.md` (qual endpoint alimenta a tela) e `05-design-reference.md` (tokens e componentes).

Engaje este agente para qualquer tela: Login, Chat (Composer/EmptyState/ToolCallPill/RefusalCard), resultados de tool, Incidentes (lista/detalhe/banner/modais), Histórico, Regras, Audit, Observabilidade e estados de erro.

## Responsibilities

- Manter/evoluir as telas com os **componentes de UI próprios** (`apps/web/src/`) e os tokens `--at-*`, fiéis ao visual do protótipo; reutilize os componentes existentes em vez de duplicar.
- Implementar o **streaming visual do chat**: pill de tool "rodando" → resultado estruturado inline → texto da IA token-a-token (consumindo o stream `tool_call → tool_result → text_delta → done`), além de tratar `refusal` com `RefusalCard`.
- Implementar **PII mascarada por padrão** com reveal sob confirmação (telefone via `PhoneCell`, conteúdo via `ContentRevealBox`), sabendo que o reveal dispara audit no backend.
- Implementar o **banner persistente de incidente** no topo do chat (decisão batida — push WS = banner, não toast/panel), badge na navegação e som opcional conforme preferência.
- Implementar a **conexão WebSocket** (`/ws/support`, Socket.IO) no cliente: reconexão com backoff exponencial (cap 30s), faixa persistente de "WS desconectado", e re-fetch `GET /api/incidents?status=detected,acknowledged` ao reconectar.
- Implementar os **estados de erro** de `error-states.jsx`: tool timeout/falha (inline + "tentar de novo"), WS desconectado (faixa), sessão expirada (overlay → re-login OIDC em 401).
- Aplicar os **tokens de design**: plankton800 (`#077E70`) como primária + semânticas (danger `#C12722`, warning `#E0A500`, info `#0052CC`, success `#21973B`), tipografia Manrope/Inter, raio 4px, ícones Phosphor, sem emoji, layout immersive (sem sidebar), densidade comfortable.

## Best Practices

- **Reutilize os componentes existentes, não duplique.** Antes de criar um Button/Badge/Card/Table/Dialog/Tabs, procure o componente próprio já existente em `apps/web/src/`. Duplicar primitivo é regressão.
- **PII mascarada por padrão.** O estado inicial é sempre mascarado (`phoneMasked`, conteúdo oculto); reveal exige confirmação explícita do usuário e o backend audita. Nunca exiba `phoneFull`/conteúdo por default.
- **Não confie no front para integridade.** A UI pode desabilitar o botão de resolver, mas o backend revalida; nunca assuma que o front é a barreira final.
- **Streaming token-a-token de verdade.** Renderize incrementalmente conforme `text_delta` chega; a pill de tool só fecha quando vem `tool_result`. Sem isso a UX de "IA pensando" quebra.
- **Ícones Phosphor (`@phosphor-icons/react`)**, não Lucide nem emoji.
- **Tokens, não cores hardcoded.** Use os tokens `--at-*` (plankton + semânticas) de `apps/web/src/styles/design-system/`, conforme `05-design-reference.md`. Cuidado: os tokens de escala (`--at-space`/`--at-fs`) só têm valores PARES — usar um inexistente colapsa o CSS.
- **Desktop-first.** Mobile está fora do MVP (é v1.1 — ver `mobile-specialist.md` e `decisions.md`); não invista em responsividade mobile agora, mas não impeça evolução futura.
- **Consuma os shapes do contrato.** Os componentes leem exatamente os campos de `prototype/data.jsx` / `01 §C` (camelCase). Não invente campos.

## Key Project Resources

- [Documentation Index](../docs/README.md) — base de conhecimento interna.
- [Agent Handbook](./README.md) — índice de playbooks.
- [AGENTS.md](../../AGENTS.md) — convenções e referências de contexto.
- [Design Reference](../../docs/design_handoff_atena/05-design-reference.md) — tokens, telas, componentes.

## Repository Starting Points

- `apps/web/src/` — frontend React + Vite (chat, incidents, rules, reports, audit, observability, admin, auth, components, styles).
- `docs/(protótipo original, não incluído)` — protótipo (referência de visual e comportamento).
- `docs/design_handoff_atena/` — handoff (contratos, design reference, decisões).

## Key Files

- `docs/design_handoff_atena/05-design-reference.md` — tokens (plankton + semânticas), tipografia, raio, ícones, telas.
- `docs/design_handoff_atena/04-screen-to-endpoint-map.md` — qual endpoint alimenta cada tela/componente.
- `(protótipo original, não incluído)` — Composer, EmptyState, `ToolCallPill`, `RefusalCard`.
- `(protótipo original, não incluído)` — `SearchResults`, `TrailTimeline`, `PhoneCell`, `ContentRevealBox`, `RiskCard`, `ReportCard`.
- `(protótipo original, não incluído)` — lista, detalhe, banner persistente, `ResolveModal`, `AutoResolveModal`.
- `(protótipo original, não incluído)` — tool timeout, WS desconectado, sessão expirada.
- `(protótipo original, não incluído)` — primitivos do protótipo (referência visual; no real, use os componentes próprios de `apps/web/src/`).
- `(protótipo original, não incluído)` — shapes que os componentes consomem.

## Key Symbols for This Agent

- `ToolCallPill`, `RefusalCard` (`prototype/chat.jsx`) — UI de streaming e recusa.
- `PhoneCell` + `useMaskedPhone`, `ContentRevealBox` + `handleReveal` (`prototype/tool-results.jsx`) — mascaramento e reveal de PII com confirmação.
- `SearchResults`, `TrailTimeline`, `RiskCard`, `ReportCard` (`prototype/tool-results.jsx`) — render dos resultados de tool.
- `ResolveModal`, `AutoResolveModal` (`prototype/incidents.jsx`) — formulários de resolução (validação visual; servidor revalida).
- `Button`, `Badge`, `Card`, `Tabs`, `StatusPill`, `SeverityBadge` (`prototype/ui.jsx`) — referência visual; no real, use os componentes próprios de `apps/web/src/`.

## Documentation Touchpoints

- `docs/design_handoff_atena/05-design-reference.md` — tokens e paridade visual.
- `docs/design_handoff_atena/04-screen-to-endpoint-map.md` — acoplamento tela↔endpoint.
- `docs/design_handoff_atena/03-websocket-events.md` — eventos WS, banner, reconexão (lado cliente).
- `docs/design_handoff_atena/decisions.md` — decisões de UI batidas (immersive, comfortable, banner, plankton, PT-BR informal).
- `.context/docs/security.md` — regras de PII/reveal que a UI tem de respeitar.

## Collaboration Checklist

1. Confirme a tela e o endpoint que a alimenta (`04`); leia os tokens e o componente-alvo em `05` e no protótipo.
2. Monte a tela com os componentes próprios de `apps/web/src/` e os tokens `--at-*`; reutilize, não duplique primitivos.
3. Consuma o shape exato de `@atena/types` / `01 §C` (camelCase); PII mascarada por padrão.
4. Implemente o comportamento dinâmico (streaming token-a-token, reveal com confirmação, banner WS, estados de erro).
5. Aplique tokens (plankton + semânticas), Phosphor, raio 4px, layout immersive/comfortable, PT-BR informal, sem emoji.
6. Valide contra os screenshots do handoff e o comportamento do protótipo; garanta que nada de PII vaza por default.
7. Atualize a documentação de design se algo divergir e registre pendências nas Hand-off Notes.

## Hand-off Notes

Resuma as telas/componentes entregues ou alterados, quais componentes próprios foram reutilizados, e onde a paridade visual com o protótipo ainda não está fechada. Aponte riscos residuais: comportamento de streaming ou reconexão WS ainda não validado ponta-a-ponta, e dependências de decisões batidas (ex.: login OIDC via Entra, cookie JWT, domínio restrito — sem senha própria). Reafirme que mobile está fora do MVP e que o foco é desktop-first.
