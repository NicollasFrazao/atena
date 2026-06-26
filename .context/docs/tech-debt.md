# Débito técnico — Atena

> Itens conscientemente adiados ou simplificados no MVP, para revisitar depois. Criado em 12/06/2026. Decisões relacionadas em [decisions.md](../../docs/design_handoff_atena/decisions.md).

## 0. Já resolvido (resumo)
- **Auth OIDC Microsoft Entra** ligada e validada (state/nonce/PKCE + sessão por cookie JWT). Ver item 1.
- **RBAC gerenciado no app** (papéis no banco, `@Requires`), supera o antigo débito de App Roles do Entra. Ver item 1.
- **LLM real:** Amazon Nova Pro (`us.amazon.nova-pro-v1:0`) via Bedrock Converse; provider fake sem credencial.
- **Fonte de entrega = detailed report no S3** (`s3://example-sms-delivery-reports`), via DuckDB + cache `/tmp`; `messages`/`message_events` dropados. O contrato de logs gerais do `messaging-api` foi **abandonado** (docs `handoff-at-api-log-contract.md`/`ticket-messaging-api-logs.md` marcados como obsoletos).
- **Rename message→shipping concluído** (tools `search_shippings`/`get_shipping_trail`, `shipping_id`, rotas `/shippings/*`, incidentes com `related_shipping_ids`). "campaign" permanece.
- **Top-3 cenários de anomalia** definidos (item 3) e detectores implementados (4 regras + shadow mode).

## 1. Autenticação: login social institucional (OIDC via Microsoft 365) no MVP
- **Decisão:** o MVP autentica via **login social do email institucional** — OIDC pelo **Microsoft 365 (Entra ID)**, restrito ao domínio `@example.com`. Sem senha própria. RBAC (`support_analyst` / `support_lead`) mapeado após o login.
- **Trocabilidade:** o provedor fica atrás de uma **abstração de auth** (interface OIDC) para trocar de IdP facilmente (ex.: Google Workspace) sem reescrever o resto. É um requisito da decisão, não débito.
- **Estado (2026-06-21):** login OIDC ligado **ponta-a-ponta** (plano `auth-oidc-entra`): state/nonce/PKCE, troca real de `code` por token, **sessão stateless por cookie JWT** (`atena_session`, `SameSite=None; Secure`), `GET /auth/me`, `logout` e tela de login no front. `AUTH_DEV_BYPASS` segue como **fallback de dev** (cookie tem precedência); **produção deve setar `AUTH_DEV_BYPASS=false`**.
- **RBAC gerenciado no app (2026-06-21, plano `rbac-users-permissions`):** os papéis **deixaram de vir do IdP** — `mapRoles` foi removido. Agora há tabelas `users`/`user_roles`; o usuário é **persistido no login** (upsert) e os papéis são **atribuídos por um admin** (`/admin/usuarios`). Modelo **papéis→permissões** (mapa em código `auth/rbac/permissions.ts`; guard `@Requires(perm)`); papéis lidos do banco **por requisição** (cache ~30s, invalidado nas mutações). Estados: sem papel → `access_pending` (gate no front); `disabled` → `access_disabled`. Bootstrap por `AUTH_ADMIN_EMAILS`. devBypass de dev = `admin`. Catálogo inicial: `admin`/`support_lead`/`support_analyst`/`viewer`. **Isto supera o antigo débito do `support_lead`/App Roles do Entra.**
- **Débitos residuais:**
  - **Sem revogação central de sessão** (JWT stateless): não dá para invalidar o cookie antes do `exp` (8h). A **revogação de papéis** já é imediata (cache curto + lookup no banco); só o cookie em si não é revogável. Se necessário, sessão server-side ou refresh curto + denylist.
  - **CSRF token ausente** — `SameSite=None` abre mão da proteção do cookie; hoje coberto por state/nonce/PKCE (login). Mutações sensíveis (admin, lifecycle) já exigem permissão + são auditadas; ao expor mutação cross-site mais ampla, adicionar double-submit/CSRF token.
  - **Mapa papel→permissões em código** (não editável pelo admin no banco). Suficiente p/ o MVP; se precisar de papéis/permissões custom em runtime, promover para tabelas `roles`/`permissions`/`role_permissions`.
  - **Sem FK** das tabelas existentes (`chat_sessions.user_id` etc.) para `users` (evita choque com `dev-user`/legado). Adicionar quando o legado for migrado.
  - SSO corporativo completo / **SAML + SCIM**, caso seja preciso mais que o login social.
- **Quando:** revogação de cookie/CSRF/FK se/quando o produto exigir; SAML/SCIM idem (não bloqueia o MVP).
- **Validação pendente (humana):** o round-trip real com a Microsoft (login interativo no navegador) precisa ser validado por um operador — exige a app registrada no Entra com o `redirect_uri` (`/api/auth/callback`) e credencial corporativa. Fluxo/sessão/domínio + **RBAC inteiro** cobertos por testes + smoke estrutural (cookies forjados).

## 2. Banco: adaptação do schema PostgreSQL → MySQL
O modelo em [02-data-model.md](../../docs/design_handoff_atena/02-data-model.md) foi escrito para PostgreSQL. Itens a adaptar para **MySQL**:
- `UUID` PK → `CHAR(36)` ou `BINARY(16)` (geração no app ou `UUID()`).
- `TIMESTAMPTZ` → `DATETIME` em UTC (ou `TIMESTAMP`).
- `JSONB` → `JSON`.
- `TSTZRANGE` (`incidents.detection_window`) → duas colunas `DATETIME` (`detection_window_start` / `_end`).
- `UUID[]` (`related_shipping_ids`) e `TEXT[]` (`tags`) → coluna `JSON` ou tabela de junção.
- `INET` (`audit_log.ip_address`) → `VARCHAR(45)`.
- Particionamento de `audit_log` por mês → partição `RANGE` por coluna de tempo no MySQL.
- Índices: sem GIN; usar índices comuns / funcionais (JSON) quando necessário.
- **Imutabilidade do audit_log:** garantir via permissão do app role (só INSERT + SELECT).

## 3. (resolvido) Top-3 cenários de anomalia
- Definidos a partir dos logs de produção (`at-api-logs-prod`) — ver [anomaly-scenarios.md](anomaly-scenarios.md). Pendências residuais: validar com produto a definição de sucesso (`delivered` vs `delivered+sent`); recalcular baselines com 7–30 dias + dedupe por mensagem (status final, não evento); avaliar colunas extras em `anomaly_rules` (guarda de volume mínimo, baseline por hora-do-dia).

## 4. (resolvido) Sincronização da base de contexto (.context)
- Passe concluído em 12/06/2026: docs (`.context/docs/*`), playbooks (`.context/agents/*`), skills (`.context/skills/*`) e o plano `.context/plans/atena-mvp.md` atualizados para **MySQL** + **Amazon Bedrock**, com a estratégia de dados (S3 = origem durável dos brutos; `/tmp` = cache transitório read-through; MySQL = metadados + audit) e login social institucional (OIDC via Microsoft 365). Manter sincronizado conforme surgirem novas decisões.

## 5. Cache transitório em `/tmp` — dimensionamento e durabilidade
- O `/tmp` (volume Docker no EC2) é **cache transitório** dos dados brutos (decisão #8): reduz requisições repetidas ao S3 num curto período e mantém os brutos fora do MySQL. É **efêmero/rebuildável** — perde-se em restart/redeploy; ok porque a origem é o S3.
- **Invariantes:** nada durável mora só no `/tmp` — `audit_log` (imutável, 1 ano) e metadados em **MySQL**; origem dos brutos no **S3**.
- **A decidir (infra):** ~~TTL/eviction e limite de disco do `/tmp`~~ (eviction por idade+tamanho + limpeza de dirs de versão órfãos implementado no motor de auditoria — `ATENA_AUDIT_CACHE_MAX_MB`/`_MAX_AGE_HOURS`); EBS vs instance-store; **aquecimento (pré-popular) após redeploy** (pre-warming — ainda pendente); tamanho do cache vs volume de dados brutos.

## 6. Auditoria: saídas de fluxo pré-`queued` não rastreadas (médio prazo)
- **Contexto:** a Atena conta a partir do **detailed report** (`example-sms-delivery-reports`), cujo primeiro registro de uma campanha é o `queued`. Falhas no produtor **antes** do `dispatchStatus('queued')` (parse / `calculateCreditByMessage` / `validatePayload` / `resolveSmsHashId`) **não geram registro** no detailed report → a Atena não as enxerga (só viram log de erro nos logs gerais).
- **Decisão (MVP):** aceitar a lacuna — essas falhas são raras (a mensagem já passou pelo main-api). Canal: cobrimos **SMS Short + SMS Flash** (`campaign_type IN ('sms','sms_flash')`, decisão revista 2026-06-25; antes era só SMS Short). Voz/RCS seguem fora.
- **Médio prazo:** **medir o volume** (erros pré-`queued` no dia vs nº de campanhas no detailed report) e decidir se vale mexer no produtor. Se relevante: o produtor emite um status de falha cedo (o detailed report não usa `hashId`, então dá pra emitir antes do `resolveSmsHashId`); o parse-falho (sem `campaign_id`) fica só no log. Alternativa barata no consumidor: reconciliar o intake (`[Action] enqueued`, agregado) vs as campanhas do detailed report. Detalhes em [`docs/reconciliacao-enviado-detailed-report.md`](../../docs/reconciliacao-enviado-detailed-report.md) §7.

## 7. Catálogo (`list_customers`/`list_providers`): scan e tamanho de resultado
- **Contexto:** as tools de catálogo varrem o S3 para `DISTINCT` de clientes/provedores. Numa validação live o `list_customers` levou >2min (cold scan sobre a janela default, larga).
- **(resolvido) scan amplo:** ~~clampar à janela/data-mínima~~ — as tools agora são **por janela** (`date_from`/`date_to`/`date_range`) e recortam à `ATENA_AUDIT_MIN_QUERY_DATE` (commit `c4cc0ac`); sem janela viram `[minQueryDate, agora]`. Validado live: "clientes nas últimas 24h" caiu de >2min para **~6s**. A seleção indevida pelo LLM também já foi mitigada (descrições + system prompt).
- **Residual:** (a) **cache** do catálogo (clientes/provedores mudam devagar) com TTL, para chamadas repetidas sem outra query aquecer as partições; (b) **tamanho do resultado** — uma janela movimentada pode ter MUITOS clientes distintos, e despejar a lista inteira no LLM fica lento/caro na geração. Considerar `limit` + contagem (ex.: "N clientes; aqui os top/most recentes") em vez da lista completa.

## 8. Bedrock: turno pós-tool às vezes pendura (stream sem chunks)
- **Contexto:** no loop do orquestrador, o turno que gera o TEXTO final após um `tool_result` às vezes abre o stream do Bedrock (`ConverseStreamCommand`) e **não emite nenhum chunk** — observado ~minutos, sem erro. Reproduzido várias vezes em `list_customers`→texto; o relatório completou em outras. É intermitente.
- **(mitigado) hang infinito:** `withIdleTimeout` (60s) no consumo do stream (commit `6055790`) transforma o hang em `event: error` gracioso (o frontend trata e reabilita o composer). Mas o usuário recebe ERRO em vez de resposta nessas queries.
- **A investigar (causa raiz):** por que o Bedrock não responde no turno pós-tool? Hipóteses: (a) shape do `tool_result`/conversa remontada para o turno seguinte (`buildConverseInput`) que faz o modelo travar; (b) throttling/limite da conta; (c) auth Bearer (`AWS_BEARER_TOKEN_BEDROCK`)/região/inference profile. Próximo passo: logar request/latência do Converse por turno e inspeccionar metadata/erros do SDK; testar o mesmo prompt+tool_result fora do app.

## 9. Credenciais AWS: S3 via IAM Role (feito no app) · Bedrock via Bearer (por design)
- **S3 (detailed report):** o DuckDB usa `CREATE SECRET … PROVIDER credential_chain` → resolve sozinho **chaves estáticas/STS** (`AWS_ACCESS_KEY_ID`/`SECRET`/`SESSION_TOKEN`) no dev local OU a **IAM Role da instância** (EC2/ECS) em produção, sem chaves no `.env`. Nada a fazer no app — basta a EC2 ter a role com `s3:GetObject`/`s3:ListBucket` no bucket do detailed report.
- **Bedrock (LLM):** autentica por `AWS_BEARER_TOKEN_BEDROCK` (Bearer), **OBRIGATÓRIO** quando `LLM_PROVIDER=bedrock` (o `LlmModule` falha-rápido sem ele). NÃO usa a IAM Role — por decisão de design.
- **Resta (infra/AWS, fora do app):** anexar a IAM Role à EC2 e prover o Bearer do Bedrock por segredo (SSM/Secrets Manager) em produção. O `.env.example` já reflete os valores reais (`ATENA_SMS_STATUS_BUCKET=example-sms-delivery-reports`, `BEDROCK_MODEL_ID=us.amazon.nova-pro-v1:0`).

## 10. Sem CI
- **Contexto:** não há `.github/workflows`. Lint/tsc/testes rodam localmente (`make test`/`make test-e2e`, `npm run lint`).
- **Débito:** pipeline de CI rodando lint + build + testes antes do merge na `master`.

## 11. SSO corporativo completo (SAML + SCIM)
- O MVP usa OIDC (Microsoft Entra) com papéis gerenciados no app. SSO corporativo completo (SAML + provisionamento via SCIM) segue como **débito residual** — não bloqueia o MVP. Ver item 1.
