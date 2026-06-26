---
type: doc
name: testing-strategy
description: Test frameworks, patterns, coverage requirements, and quality gates
category: testing
generated: 2026-06-10
status: filled
scaffoldVersion: "2.0.0"
---

# Testing Strategy

> **Estado atual: NÃO há testes nem test runner neste repositório.** Sem `package.json`, sem Jest, sem Vitest, sem CI de testes. O único código real é o protótipo standalone em [`(protótipo original, não incluído)`](../../(protótipo original, não incluído)) (referência de design, sem suíte de testes). Este documento descreve a **estratégia pretendida** para quando o código de produção (backend NestJS + frontend React) começar a existir — não afirma cobertura existente.

A Atena é um sistema onde a corretude tem implicação de segurança e de confiança: ela lida com PII, registra audit logs imutáveis e deve **recusar** em vez de inventar dados. Por isso a prioridade dos testes não é "cobrir tudo" — é blindar os invariantes que sustentam os 5 princípios de arquitetura ([`README.md` §5](../../design_handoff_atena/README.md)). Quando começarem os testes, priorize, nesta ordem:

1. **Contratos de shape** — a resposta de cada endpoint do backend deve bater **exatamente** com o shape que o protótipo consome. Os mocks em [`prototype/data.jsx`](../../(protótipo original, não incluído)) (campos camelCase) são a fonte da verdade do response shape (ver [`README.md` §2](../../design_handoff_atena/README.md) e [`01-backend-api-contract.md`](../../design_handoff_atena/01-backend-api-contract.md)). Teste de contrato evita drift entre frontend e backend.
2. **Tools determinísticas** — as 8 tools read-only (`search_shippings`, `get_shipping_trail`, `analyze_shipping_content`, `generate_delivery_report`, `list_providers`, `list_customers`, `list_incidents`, `get_incident`, `generate_incident_report`) devem ser puramente determinísticas: mesma entrada → mesma saída. Testar sem o LLM no loop.
3. **Validação server-side do resolve de incidente** (§D de [`01-backend-api-contract.md`](../../design_handoff_atena/01-backend-api-contract.md), RF-2.4) — o caso de teste mais crítico de regra de negócio: `actionCategory` obrigatório; `actionDescription` ≥ 20 chars (≥ 10 no `auto_resolved`); `escalatedTo` obrigatório quando category ∈ {`internal_escalated`, `provider_escalated`}; só transições `detected`/`acknowledged`/`auto_resolved` → `resolved`. Testar que o backend **rejeita** mesmo quando a UI deixaria passar (validação dupla).
4. **Mascaramento de PII + audit no reveal** (RNF-1.4) — toda resposta de tool sai com telefone e conteúdo mascarados; `phoneFull`/`contentPreview` só após reveal autorizado; cada reveal **escreve** `reveal_phone`/`reveal_content` no audit log. Testar que não há caminho que devolva PII sem registro.
5. **Recusa explícita do LLM (princípio 2)** — pedido sem tool aplicável → recusa estruturada (`RefusalCard`), nunca um dado fabricado. Testar com prompts adversariais ("qual o telefone do cliente X?" sem busca prévia).
6. **RBAC guards** — `support_analyst` é negado em endpoints só de `support_lead` (relatórios gerenciais, edição de regras, audit log viewer); 401 sem token, 403 com papel errado.
7. **Eventos WS + reconexão** — formato de `incident.created/updated/auto_resolved` ([`03-websocket-events.md`](../../design_handoff_atena/03-websocket-events.md)); token rejeitado no handshake; reconexão com backoff (cap 30s).
8. **Estados de erro** ([`prototype/error-states.jsx`](../../(protótipo original, não incluído))) — tool timeout/failure (`ToolError`, com retry), WS desconectado (`WebSocketStatusStrip`), sessão expirada (`SessionExpiredOverlay`, 401 → overlay sem perder a conversa salva).

## Test Types

Stack provável quando os testes existirem (direção, não instalado):

- **Unit** — **Jest** rodando no Node/NestJS, arquivos `*.spec.ts` (convenção NestJS) ou `*.test.ts`. Alvos: validadores do resolve de incidente, mascaramento de PII, lógica das tools determinísticas, montagem de filtros de busca por `phone_hash`. Frontend (React) provavelmente **Jest + Testing Library** (ou Vitest, a decidir junto com a config de build).
- **Integration** — testes de módulo NestJS com banco de teste (MySQL efêmero via Testcontainers/Docker) e Prisma: guards de RBAC sobre endpoints reais, interceptor de audit log gravando entries corretos, constraint server-side do `/resolve`, retorno de PII só após reveal autorizado.
- **Contract** — comparar respostas dos endpoints contra os shapes de [`prototype/data.jsx`](../../(protótipo original, não incluído)). Idealmente tipos compartilhados via pacote `@atena/types` para que a divergência apareça em compile-time, complementado por snapshot/contract tests.
- **E2E** — Playwright (ou Cypress) cobrindo fluxos críticos: login social institucional (OIDC, domínio restrito) → chat → tool result com PII mascarada → reveal com confirmação → audit registrado; e o ciclo de incidente (push WS → acknowledge → resolve com formulário válido/inválido).

Sugestão de pirâmide: maioria unit (tools, validadores, masking), uma camada sólida de integration (RBAC, audit, contratos), e poucos E2E nos fluxos de maior risco (reveal de PII, resolve de incidente).

## Running Tests

> **Nenhum destes comandos existe hoje** — não há `package.json`. São o que se espera definir quando o projeto for inicializado (alinhado à convenção NestJS/Jest). Não os invoque até existirem.

- Rodar tudo (pretendido): `npm test`
- Watch (pretendido): `npm test -- --watch`
- Cobertura (pretendido): `npm test -- --coverage`
- E2E (pretendido): `npm run test:e2e`

Quando a config existir, atualize esta seção com os scripts reais do `package.json`.

## Quality Gates

> Metas a definir quando os testes existirem — abaixo é a direção recomendada, não um gate ativo.

- **Invariantes de segurança sem exceção:** os testes de mascaramento de PII, audit no reveal, validação do resolve e recusa do LLM tratados como **bloqueantes** (não é "cobertura percentual", é "esses caminhos têm que estar verdes para merge").
- **Cobertura** — alvo inicial sugerido ~80% de linhas/branches nos módulos de tools, validação e audit; o resto à medida que estabiliza.
- **Lint/format antes do merge** — ESLint + Prettier (ver [`tooling.md`](./tooling.md)) passando; `tsc` sem erros (tipagem é parte do gate, sobretudo nos shapes compartilhados).
- **CI** — toda essa suíte deve rodar no pipeline antes de merge na `master`. Pipeline ainda não configurado.

## Troubleshooting

Pontos de fragilidade a antecipar quando a suíte existir:

- **Não testar o LLM de forma não-determinística.** Mocke o Amazon Bedrock (modelo Nova Pro via Bedrock, Converse API); teste o orquestrador, o tool routing e a recusa — não a saída livre do modelo. Isolar a IA dos testes de contrato evita flakiness.
- **WebSocket e timers** — testes de reconexão/backoff (cap 30s) precisam de fake timers; sockets reais geram flakiness.
- **Audit log append-only** — em integration, a role de teste deve replicar INSERT+SELECT apenas; testar que UPDATE/DELETE falham é parte do gate de imutabilidade.
- **Fuso/relativos** — o protótipo mostra tempos relativos ("há 4h"); fixe o relógio nos testes que comparam esses valores.

Ver [`development-workflow.md`](./development-workflow.md) para onde os testes encaixam no fluxo de contribuição.
