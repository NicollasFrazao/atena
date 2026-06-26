# 06 — Decisões pendentes: recomendações

As 5 decisões que destravam a implementação. Para cada uma: a recomendação, o racional, e o que ainda precisa de você. **As de domínio (#4) exigem sua validação; as técnicas (#1, #2, #3, #5) têm um default seguro que você pode aprovar.**

---

## 1. LLM e provider

**Recomendação:** **Claude (Anthropic)** como provider, com **Zero Data Retention (ZDR)** habilitado no contrato enterprise.

**Racional:**
- Tool use estruturado e streaming são first-class — é exatamente o padrão da Atena (LLM escolhe a tool, a app executa).
- ZDR resolve a preocupação de PII: os prompts (que podem conter telefone/conteúdo) não ficam retidos pelo provider.
- Estratégia de modelo: começar com **um modelo único de boa capacidade** para roteamento + síntese. Medir tokens/custo pela própria tela de **Observabilidade** (já desenhada). Se o custo escalar, separar: modelo **menor/rápido** para tool routing + modelo **maior** só para síntese de respostas longas (relatórios).

**Você decide:** orçamento mensal teto de LLM (a tela de Observabilidade monitora isso) e se o contrato enterprise com ZDR está disponível. Validar com **testes adversariais** antes de subir (spec §4.8): pedido sem tool → recusa; pedido de reenvio → recusa explicando.

---

## 2. SSO — SAML ou OIDC

**Recomendação:** **OIDC** (OpenID Connect).

**Racional:**
- Stack é TS/Node — OIDC é JSON-native, bibliotecas maduras (`openid-client`, `passport`), refresh tokens nativos, integra direto com guards do NestJS.
- IdPs corporativos comuns (Azure AD/Entra, Okta, Google Workspace) suportam OIDC nativamente.
- SAML só se a TI **exigir** (alguns ambientes legados). É mais verboso (XML) e mais trabalhoso em Node.

**Você decide:** qual é o **IdP corporativo** da Acme hoje? (Isso confirma OIDC e o fluxo exato.) Mapear os papéis do IdP → RBAC (`support_analyst`, `support_lead`).

---

## 3. Conteúdo de SMS: hot store em claro vs só S3

**Recomendação:** conteúdo **somente no S3** (não em claro no hot store).

**Racional:**
- Minimiza superfície de PII: o hot store (Postgres) guarda `content_ref` (ponteiro), não o texto.
- Tools que precisam do texto (`analyze_message_content` por `message_id`, reveal de conteúdo) buscam no S3 **sob demanda, com entry no audit log**.
- No hot store, o telefone fica como `phone_e164` (para busca) + `phone_hash`. Considerar: criptografar `phone_e164` em repouso, ou guardar só hash + últimos 4 dígitos se a busca parcial permitir.
- Mascarar por padrão na UI (RNF-1.4); reveal sempre auditado.

**Você decide:** política formal de PII/LGPD da empresa — confirmar que conteúdo pode ficar no S3 com a retenção definida e que o acesso auditado atende compliance.

---

## 4. Top 3 cenários de anomalia (precisa do seu domínio)

**Recomendação de ponto de partida** (as 3 regras já modeladas no protótipo, como default):
1. **Queda de taxa de entrega por fornecedor** (`delivery_rate_drop`) — o cenário de maior impacto-cliente.
2. **Silêncio de webhook por fornecedor** (`webhook_silence`) — pega fornecedor que "sumiu" sem reportar.
3. **Erro consistente do fornecedor** (`consistent_error`) — mesmo código de erro em massa.

**Estratégia de rollout para não gerar ruído (alinhado à spec RF-2.1):**
- Subir as regras em **shadow mode** primeiro: o detector cria o incidente e registra, mas **não notifica** — por ~2 semanas.
- Analisar os `false_positive` registrados e **calibrar thresholds** na tela de Regras.
- Só então ligar a notificação via WebSocket.
- Começar conservador (thresholds altos) e apertar com dados.

**Você decide (workshop com produto/suporte):** quais são os **3 cenários reais que mais doem hoje** e os thresholds iniciais de cada um. Isso é input de negócio que só vocês têm.

---

## 5. Audit log: mesma base ou serviço dedicado

**Recomendação para o MVP:** **mesma base Postgres**, tabela `audit_log` **append-only e particionada por mês**.

**Racional:**
- Simples, transacional com a ação que está sendo auditada (sem risco de "ação gravou, audit falhou").
- Imutabilidade prática: conceder ao role da aplicação apenas **INSERT + SELECT** (sem UPDATE/DELETE). Particionar por mês facilita retenção de 1 ano e arquivamento.
- **Revisitar** um serviço dedicado / armazenamento WORM (write-once) só se **compliance exigir** garantia forte de não-adulteração (ex.: auditoria externa regulatória).

**Você decide:** o nível de exigência de compliance sobre o audit log. Se for "boas práticas internas" → Postgres basta no MVP. Se for "prova regulatória de imutabilidade" → planejar serviço dedicado já.

---

## Resumo: o que aprovar vs o que levar para workshop

| # | Decisão | Status |
|---|---|---|
| 1 | LLM = Claude + ZDR | ✅ aprovar + definir teto de custo |
| 2 | SSO = OIDC | ✅ aprovar + confirmar IdP |
| 3 | Conteúdo só no S3 | ✅ aprovar + validar com LGPD |
| 4 | Top 3 anomalias | 🔴 **workshop produto/suporte** |
| 5 | Audit no Postgres (MVP) | ✅ aprovar + checar nível de compliance |
