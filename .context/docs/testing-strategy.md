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

> **Estado atual: há suíte de testes implementada.** Backend com **Jest** (`apps/api`, `*.spec.ts` + e2e), frontend com **Vitest** (`apps/web`). `make test` roda unit + e2e mockado; `make test-e2e` roda integração contra MySQL real. **Não há CI** (`.github/workflows`) ainda. A prioridade dos testes não é "cobrir tudo" — é blindar os invariantes dos 5 princípios.

A Atena é um sistema onde a corretude tem implicação de segurança e de confiança: ela lida com PII, registra audit logs imutáveis e deve **recusar** em vez de inventar dados. Prioridades, nesta ordem:

1. **Contratos de shape** — a resposta de cada endpoint deve bater com `@atena/types` (serializados em `snake_case` na borda). Teste de contrato evita drift entre frontend e backend.
2. **Tools determinísticas** — as tools read-only (`search_shippings`, `get_shipping_trail`, `analyze_shipping_content`, `generate_delivery_report`, `list_providers`, `list_customers`, `list_incidents`, `get_incident`, `generate_incident_report`) devem ser determinísticas: mesma entrada → mesma saída. Testar sem o LLM no loop.
3. **Validação server-side do resolve de incidente** (§D, RF-2.4) — `action_category` obrigatório; `action_description` ≥ 20 chars (≥ 10 no `auto_resolved`); `escalated_to` obrigatório quando category ∈ {`internal_escalated`, `provider_escalated`}; só transições `detected`/`acknowledged`/`auto_resolved` → `resolved` (senão 409/422). Testar que o backend **rejeita** mesmo quando a UI deixaria passar (validação dupla).
4. **Mascaramento de PII + audit no reveal** (RNF-1.4) — toda resposta de tool sai mascarada; reveal exige `pii:reveal` e **escreve** `reveal_phone`/`reveal_content`. Testar que não há caminho que devolva PII sem registro.
5. **Recusa explícita do LLM (princípio 2)** — pedido sem tool aplicável → recusa estruturada, nunca um dado fabricado. Testar com prompts adversariais.
6. **RBAC guards** — papel sem a permissão é negado (401 sem sessão, 403 sem permissão); guard `@Requires(perm)`.
7. **Eventos socket.io + reconexão** — formato de `incident.created/updated/auto_resolved`; handshake rejeitado sem sessão.
8. **Estados de erro** — tool timeout/failure (com retry), socket desconectado, sessão expirada (401 → overlay sem perder a conversa salva), idle timeout do stream Bedrock.
9. **Motor de auditoria** — `DuckDbAuditQueryService` sobre fixtures locais do detailed report: grão `(campaign_id, phone)`, janela por envio, scan simétrico, canal `sms`/`sms_flash`.

## Test Types

Stack de testes em uso:

- **Unit (backend)** — **Jest** (`apps/api/jest.config.js`, ts-jest), arquivos `*.spec.ts` (~45 suítes). Alvos: validadores do resolve, mascaramento de PII, tools determinísticas, detector, regras, motor de auditoria, orquestrador, guards.
- **Unit (frontend)** — **Vitest** (`apps/web`), `*.spec.ts`/`*.spec.tsx` (~10 arquivos): auth, chat (useChat/SSE/reveal), realtime (banner), util (tempo/usuário), tool-cards.
- **Integration / E2E (backend)** — `apps/api/src/http.e2e.spec.ts` (pipeline completo, Prisma mockado, roda no `make test`) e `apps/api/src/db.e2e-spec.ts` (**MySQL real** via `make test-e2e`: sobe banco, migra, semeia; valida search/trilha/providers/reveal+audit/report/chat-SSE, rules/incidents/lifecycle/observability/dev-detect sobre o seed).
- **Contract** — shapes comparados contra `@atena/types` (compile-time + asserts nos specs).

## Running Tests

Comandos reais:

- Tudo (unit + e2e mock): `make test` (ou `npm test`).
- Backend só: `npm test --workspace @atena/api`.
- Frontend só: `npm run test --workspace @atena/web` (Vitest).
- E2E de integração (MySQL real): `make test-e2e`.
- Lint: `npm run lint`.

## Quality Gates

- **Invariantes de segurança sem exceção:** os testes de mascaramento de PII, audit no reveal, validação do resolve e recusa do LLM são tratados como **bloqueantes**.
- **Lint/tipos antes do merge** — `npm run lint` sem erros nem avisos (flat config; também resolver SonarLint); `tsc` strict sem erros.
- **CI** — pipeline ainda **não** configurado (`.github/workflows` ausente); a suíte é rodada localmente via `make test`/`make test-e2e`.

## Troubleshooting

Pontos de fragilidade:

- **Não testar o LLM de forma não-determinística.** Use o `FakeLlmProvider`; teste o orquestrador, o tool routing e a recusa — não a saída livre do modelo. Isolar a IA dos testes de contrato evita flakiness.
- **Socket.io e timers** — testes de reconexão/idle timeout precisam de fake timers; sockets reais geram flakiness.
- **Audit log append-only** — em integration, a role de teste deve replicar INSERT+SELECT apenas; testar que UPDATE/DELETE falham é parte do gate de imutabilidade.
- **Fuso/relativos** — UI mostra tempos relativos e janelas em BRT (`APP_TIMEZONE`); fixe o relógio nos testes que comparam esses valores.
- **Motor de auditoria** — usar fixtures locais (diretório) em vez do S3 real; `ATENA_AUDIT_SOURCE_ROOT` aponta para um diretório nos testes.

Ver [`development-workflow.md`](./development-workflow.md) para onde os testes encaixam no fluxo de contribuição.
