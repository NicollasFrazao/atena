# Decisões de design — Assistente do Suporte (v1)

> Última atualização: 12/06/2026 · status: aprovado · inclui decisões de implementação batidas com o dono

Documento curto registrando as escolhas que foram batidas pra v1 do Assistente do Suporte (Acme), com o rationale de cada uma. Mudanças futuras nessas decisões devem atualizar este arquivo.

---

## Resumo das decisões

| Eixo | Decisão | Locked em |
|---|---|---|
| Layout / shell | **Immersive** — topbar fina, sem sidebar, chat largo | `app.jsx :: LOCKED.direction` |
| Densidade | **Comfortable** | `app.jsx :: LOCKED.density` |
| Tom de marca | **Plankton** (teal) como cor primária do assistente | `app.jsx :: LOCKED.accent` |
| Cor secundária / Thanos | **Não usado em v1** — Plankton cobre toda UI de marca; cores semânticas (danger/warning/info/success) seguem o design system | — |
| Estilo de notificação de incidente | **Banner persistente** acima do chat | `app.jsx :: LOCKED.incidentStyle` |
| Idioma | **PT-BR**, registro informal (`você`) | global |
| Ícones | Lucide-style stroke (dev: trocar por `@phosphor-icons/react`) | `ui.jsx :: ICON_PATHS` |

---

## Rationale

### Por que Immersive (e não Console com sidebar)?

Foram explorados 3 layouts:

- **Console clássico** — sidebar do Acme + chat + painel lateral. Familiar pra quem já usa o produto, mas a sidebar de produto polui a tarefa do analista (que é foco-no-chat) e disputa espaço com o painel de incidente.
- **Cockpit ops** — 3 colunas (feed + chat + detalhe). Excelente densidade para um operador 24/7, mas exagerado para a v1 (onde o volume de incidentes ainda não justifica feed permanente).
- **Immersive** — topbar mínima + chat largo + painel desliza sob demanda. **Escolhido**: o chat é a interface primária; tudo o mais é dependência dele. Topbar fina ainda permite navegação por aba (Assistente / Incidentes / Relatórios). Mantém a porta aberta pra evoluir pra Cockpit quando o volume de incidentes crescer.

### Por que Comfortable como padrão?

Analistas de suporte ficam horas nesse chat. Comfortable mantém alvos de clique generosos (32-36px) e respiro entre mensagens, reduzindo fadiga visual. O modo compact existe no código mas não foi exposto na v1 — decisão consciente para não dar opção desnecessária; se o líder de suporte pedir uma visão mais densa pra revisão de muitos casos, abrimos como toggle em iteração futura.

### Por que Plankton como primário (e não Thanos)?

O `spa` theme do Acme já define `primary = plankton800`. A escolha mantém **coerência com o resto do produto** — quem entra no Assistente vindo do dashboard não sente quebra.

**Thanos ficou fora da v1.** A intenção inicial era usar roxo para sinalizar incidentes, mas na prática isso competia visualmente com as cores semânticas (vermelho/amarelo/azul) que já carregam significado de severidade. Conclusão: a paleta da v1 é **Plankton + cores semânticas funcionais**. Thanos continua disponível no design system para evoluções futuras (campanhas, marketing, easter-eggs) — só não está no produto agora.

A paleta final em uso:
- **Plankton** (teal): tudo de marca — botões, ícones do assistente, accents, links, focos
- **Danger** (vermelho `#C12722`): falhas, severidade `critical`, banner de incidente, contagem de incidentes no topbar
- **Warning** (amarelo `#E0A500`): severidade `warning`, anotações de queda em gráfico
- **Info** (azul `#0052CC`): severidade `info`, status `acknowledged`, dimensão `internal_escalated`
- **Success** (verde `#21973B`): status `delivered`, métricas dentro do SLA, `monitoring_only`
- **Neutral** (escala de cinzas): chrome, bordas, textos secundários

### Por que Banner como estilo de notificação?

Foram comparados:

- **Toast** (canto superior, auto-dismiss 6s) — bom para anúncios de baixa prioridade, mas **risco de o analista perder o incidente** se estiver focado em outra coisa quando aparece. Não cabe pra incidente crítico.
- **Panel** (auto-abre o painel lateral com o detalhe) — passa direto pra fase de investigação, ótima latência para resposta. Mas **interrompe demais** o que o analista está fazendo no chat (especialmente se ele já está investigando outro caso).
- **Banner** (faixa vermelha persistente no topo do chat) — **escolhido**. Alta visibilidade, exige uma ação explícita (acknowledge ou dismiss), não interrompe o que está em curso. Métrica de MTTA < 5 min (RNF) é diretamente endereçada por banner: o analista vê assim que olhar para o chat de novo.

Toast e Panel ficam disponíveis no código para reuso (por exemplo: severidade `info` poderia virar toast, severidade `critical` continua banner) — não foram removidos.

---

## O que está fora de escopo da v1

Confirmado com a spec:

- Reenvio de mensagens, troca de fornecedor, qualquer ação que mude estado externo
- RAG sobre runbooks (Fase 3+)
- Aprovação multi-nível
- Telas: login/SSO, configuração de regras de anomalia, audit log viewer — **stubs aceitáveis** pra v1, refinamento depois

---

## Decisões de implementação (batidas em 12/06/2026)

Resolvem as pendências da v1 (com o dono do produto). Substituem o que antes estava em aberto.

1. **LLM e provider → Amazon Bedrock.** O modelo (família Claude) roda via **AWS Bedrock**, não pelo SDK Anthropic direto. Racional: já estamos no ecossistema AWS (S3/logs), billing e governança unificados, e o Bedrock não retém prompts para treino (atende à preferência por não-retenção). Implicação: usar `@aws-sdk/client-bedrock-runtime` (Converse API) com streaming + tool use, **atrás de uma interface de orquestração** para trocar de provider sem reescrever o resto.

2. **Auth → login social com email institucional (OIDC).** O MVP autentica via **login social do email institucional** — OIDC pelo **Microsoft 365 (Entra ID)**, **restrito ao domínio `@example.com`**, sem senha própria, **atrás de uma abstração de auth para trocar de IdP facilmente** (ex.: Google Workspace). RBAC (`support_analyst` / `support_lead`) é mapeado após o login. Isso já entrega o valor de SSO (sem senhas, identidade corporativa). Débito residual (SAML/SCIM) em [tech-debt.md](../../.context/docs/tech-debt.md).

3. **Conteúdo de SMS pode ficar no hot store.** Liberado manter o conteúdo no store de fácil acesso (não precisa ficar **só** no S3). Combina com a estratégia de fonte de verdade (item 7). A API continua **mascarando PII por padrão** e o reveal continua gerando audit.

4. **Top-3 cenários de anomalia → DEFINIDOS** por análise dos logs de produção (`at-api-logs-prod`): (1) **queda de taxa de entrega por cliente** (`delivery_rate_drop`); (2) **spike de categoria de falha** — `policy_block`/`invalid_number`/`generic_error` (`consistent_error`/`failure_spike`); (3) **silêncio de callbacks de status** (`webhook_silence`). Metodologia, achados e thresholds default em [anomaly-scenarios.md](../../.context/docs/anomaly-scenarios.md). Residual: validar com produto a definição de sucesso (`delivered` vs `delivered+sent`).

5. **Audit log → tabela no mesmo banco.** Sem serviço dedicado: tabela `audit_log` no banco principal, imutabilidade por permissão (só INSERT+SELECT) + particionamento por mês.

6. **Banco de dados → MySQL** (mudança em relação ao handoff, que assumia PostgreSQL). O schema de [02-data-model.md](02-data-model.md) precisa de adaptação MySQL (TSTZRANGE → 2× DATETIME, JSONB → JSON, arrays → JSON/junção, TIMESTAMPTZ → DATETIME UTC, INET → VARCHAR(45), UUID → CHAR(36)/BINARY(16)). Prisma suporta MySQL. Lista completa em [tech-debt.md](../../.context/docs/tech-debt.md).

7. **Fonte de verdade (read-through / hidratação):** sempre ler primeiro de um **local de fácil acesso** (hot store); se o conteúdo não estiver lá, **hidratar** a partir dos logs originais no **bucket S3** (`s3_log_pointer` / `content_ref`) e popular o hot store. Define o padrão de acesso a conteúdo/trilha e o papel do S3 como camada fria/origem.

8. **Cache transitório em arquivos temporários (`/tmp`) + deploy EC2/Docker.** O `/tmp` do host (montado como **volume do container Docker**; deploy pretendido: imagem Docker numa **EC2**, volume → `/tmp` da máquina) é um **cache transitório** dos dados brutos de log/conteúdo — **não** é a fonte de verdade. Propósito: (a) **evitar muitas requisições ao S3** num curto período; (b) **manter os dados brutos fora do banco** (não onerar o MySQL). Read-through: lê do `/tmp`; se faltar, busca no **S3** (origem durável) e popula o `/tmp`. **Camadas:** (a) `/tmp` = cache operacional **efêmero/rebuildável**; (b) **S3** = origem durável; (c) **MySQL** = metadados estruturados + `audit_log` (durável, imutável). ⚠️ Por ser efêmero, o `/tmp` **não** guarda nada que precise sobreviver a restart/redeploy — audit e origem ficam em MySQL/S3. Durabilidade/infra em [tech-debt.md](../../.context/docs/tech-debt.md).

9. **Code style: API em `snake_case`.** Os objetos de **entrada e saída da API** usam `snake_case` (revisão: a convenção do handoff dizia camelCase). O banco já é snake_case; mapeia-se na borda da API. Regras completas em [code-style.md](../../.context/docs/code-style.md) — estabelecidas/alinhadas na fase P do planejamento.

---

## Como mexer nessas decisões

**Para iterar visualmente** (sem mexer no código): abra o Tweaks panel no canto inferior direito do protótipo. Só restam os botões de demo (simular incidente, resetar conversa).

**Para mudar uma decisão locked**: edite `app.jsx :: LOCKED` no topo do arquivo. Os caminhos alternativos (toast/panel para notificação) ainda funcionam — só não estão expostos no UI.

**Para mudar tons / tipografia**: edite os tokens em `design-system/colors_and_type.css` (mas isso é mudança de design system, não do Assistente).

---

## Próximas ondas

Roadmap proposto para iteração pós-v1:

1. **v1.1** — refinar microcopy, estados de loading/erro, mobile (até hoje: focado em desktop), telas de SSO + configuração de regras.
2. **v1.2** — RAG sobre base de conhecimento (runbooks), tools adicionais (`compare_periods`, `correlate_incidents`).
3. **v2** — ações que mudam estado (reenvio, troca de rota) com aprovação multi-nível.
