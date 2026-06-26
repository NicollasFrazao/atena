# 05 — Referência de design

Tokens, telas e componentes. O protótipo segue o **Atena Design System**. No codebase real, use os componentes do `atena-design-system` em vez de recriar — esta seção é para garantir paridade visual.

---

## Design tokens (Acme)

### Cor
| Papel | Token | Valor |
|---|---|---|
| Primária (marca) | plankton800 | `#077E70` |
| Primária escura | plankton1000 | hover de botões sólidos (~12% mais escuro) |
| Primária clara | plankton50/200 | fundos de destaque suave |
| Secundária | thanos800 | `#6D1BCC` — **não usada no MVP** (decisão: paleta = Plankton + semânticas) |
| Texto forte | neutral1000 | `#313135` |
| Texto secundário | neutral800 | `#68686E` |
| Canvas | neutral100 | `#FAFBFC` |
| Card / superfície | white | `#FFFFFF` |
| Borda | neutral300 | `#DFDFE0` (1px resting) |
| **Danger** | — | `#C12722` (falha, severidade critical, incidentes) |
| **Warning** | — | `#E0A500` (severidade warning) |
| **Info** | — | `#0052CC` (severidade info, acknowledged) |
| **Success** | — | `#21973B` (delivered, dentro do SLA) |

> Os nomes de variável CSS completos estão em `prototype/design-system/colors_and_type.css` (prefixo `--at-*`).

### Tipografia
- **Corpo:** Manrope (400/500/600).
- **Títulos:** Inter (500/600/700).
- Escala: 10 / 12 / 14 / 16 / 18 / 20 / 24 / 32 px. Letter-spacing **zero**.

### Forma & elevação
- **Raio padrão: 4px** (botões, inputs, cards). Badges/chips: `radius-full`.
- Borda 1px `neutral300`. Foco: ring neutro 3px `rgba(163,163,163,0.5)`.
- Sombras sutis ("folha de papel"). Sem gradiente, sem blur, sem textura.

### Movimento
- Transições 300ms (botões), 500ms (dialog/toast). Ease `cubic-bezier(.2,0,0,1)`. Fades dominam; nada de bounce.

### Ícones
- **Phosphor Icons** (`@phosphor-icons/react`) — `regular` p/ chrome, `bold` p/ glifos grandes. (O protótipo usou SVGs estilo Lucide por rodar standalone; trocar por Phosphor no codebase.)
- **Sem emoji** no produto.

---

## Telas (resumo — detalhe visual em `prototype/`)

1. **Login** — SSO Acme. Hero "Atena" + tagline. Acesso restrito + nota de audit log.
2. **Chat (principal)** — layout imersivo: topbar fina, chat largo, painel desliza por cima quando necessário. Estado vazio com sugestões de prompt. Densidade comfortable.
3. **Tool results** (inline no chat): busca (tabela), trilha (timeline), risco (gauge + categorias), relatório (KPIs + sparkline + top erros). Todos com PII mascarada.
4. **Incidentes** — lista de cards com KPIs; detalhe em painel lateral; banner de push no topo.
5. **Resolução de incidente** — modal com categoria (obrigatória), descrição (≥20 chars), escalated_to (condicional), tags, aviso de audit log.
6. **Relatórios de incidente** — visão do líder: MTTA/MTTR, distribuição por ação, top dimensões, tabela exportável.
7. **Histórico** — sessões passadas agrupadas por dia, filtros, busca.
8. **Regras de anomalia** — tabela editável (threshold/dimensão/janela/severidade/enabled) + drawer de edição.
9. **Audit log** — tabela imutável com filtros (período, usuário, tipo, só-PII) + drill-down.
10. **Observabilidade** — saúde do assistente (latência por tool, tokens, custo, recusas, WS).
11. **Estados de erro** — tool timeout (inline), WS desconectado (faixa), sessão expirada (overlay).

---

## Decisões de design batidas (ver `decisions.md`)
- **Layout:** Immersive (sem sidebar de produto).
- **Densidade:** Comfortable.
- **Tom de marca:** Plankton (teal). Thanos fora do MVP.
- **Push de incidente:** Banner persistente no topo do chat.
- **Idioma:** PT-BR, registro informal (`você`).

---

## Comportamentos-chave a preservar
- **Streaming visual:** pill de tool "rodando" → resultado → texto da IA token-a-token.
- **PII mascarada por padrão**, reveal com confirmação + audit.
- **LLM recusa explicitamente** pedidos fora de escopo (não inventa dados).
- **Resolver incidente exige formulário** — nunca via LLM.
- **Validação dupla:** UI desabilita botão, mas backend revalida.
