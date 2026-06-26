---
type: doc
name: anomaly-scenarios
description: Top-3 cenários de anomalia priorizados + thresholds default das anomaly_rules, derivados da análise dos logs de produção
category: analysis
generated: 2026-06-12
status: filled
---

# Cenários de anomalia (Fase 2) — análise dos logs de produção

> Resolve a decisão pendente #4 ([decisions.md](../../docs/design_handoff_atena/decisions.md)). Define os **top-3 cenários** e os **thresholds default** das `anomaly_rules` ([02-data-model.md](../../docs/design_handoff_atena/02-data-model.md)), a partir dos logs reais em `s3://at-api-logs-prod`.

## Metodologia
- **Fonte:** `at-api-logs-prod` (JSON Lines gzip via firehose; schema = `LogInterface`: `timestamp`, `level`, `service`, `message`, `context.payload` com `status`, e `status_code`/`response_time`/`error`).
- **Amostra:** últimos 150 objetos → **761.630 registros**, janela **2026-06-12T22:51 → 2026-06-13T00:45 UTC** (~2h, madrugada).
- Classificação de status: sucesso (`delivered`); falha terminal (`undelivered`, `failed`, `invalid_number`, `policy_block`, `expired`, `unreachable`, `generic_error`); em-trânsito (`queued`, `dispatched`, `sent`).

### ⚠️ Caveats (ler antes de cravar thresholds)
1. **Evento ≠ mensagem.** Contei *eventos* de status, não mensagens únicas. Cada mensagem emite vários eventos (queued→dispatched→sent→delivered/undelivered). A taxa real **por mensagem** exige dedupe pelo identificador (`internal_identifier`/`hash`/`correlation_id`) pegando o **status final**. Os percentuais abaixo são proxy evento-nível.
2. **`delivered` é subnotificado.** Muitos carriers/campanhas não devolvem DLR; o sucesso real fica como `sent` (38.544 no recorte). Alinhar com o time se `sent` conta como sucesso muda drasticamente a taxa.
3. **Janela curta e noturna.** Baselines precisam ser **sensíveis à hora do dia** e calibrados com 7–30 dias. Os números abaixo são ponto de partida.

## Achados
- **Serviços:** `process-messages-sms` 411.745 · `status-webhook-receiver` 291.231 · `webhook-dispatcher` 57.098 · voice 1.350.
- **Níveis:** info 734.238 · warn 27.368 · **error 24** → anomalias **não** vêm do nível de log; vêm da distribuição de status de entrega.
- **Taxa de entrega (proxy) por cliente:**

  | Cliente | Eventos terminais | Entrega | Top falhas |
  |---|---:|---:|---|
  | `1001` (apostas) | 178.723 | **4,6%** | undelivered 66k, invalid_number 35k, failed 33k, **policy_block 31k** |
  | `?` (callbacks s/ user_id) | 111.527 | 7,8% | undelivered 67k, failed 34k |
  | `1002` | 4.423 | **63,0%** | invalid_number, undelivered |
  | `8349` | 2.362 | **68,0%** | undelivered, invalid_number |
  | `8200` | 306 | **0,0%** | **generic_error 153**, failed 153 |
  | `7746` | 67 | 0,0% | invalid_number 56 |

- **Volatilidade:** entrega oscila de **1,1%** (blasts de 80k–105k eventos) a **64%** entre janelas de 10 min — picos coincidem com campanhas em massa do `1001`.
- **Provider de SMS:** só **Sinch** aparece (115k tags `[SinchSmsStatus]`). Voice usa VoiceCarrier. → dimensão `provider` é fraca p/ SMS hoje; priorizar `customer` e `global`.
- **Warn dominante:** "Phone number … is marked as bounced and cannot receive messages" (27.192).

## Top-3 cenários priorizados

### 1. Queda de taxa de entrega por cliente — `delivery_rate_drop`, dim. `customer` (critical)
O sinal mais acionável: a entrega varia de 4,6% a 68% **por cliente** e cada um tem baseline próprio. Um alarme **global** seria ruidoso (dominado pelo `1001`). Detectar quando a taxa de um cliente cai abaixo do seu próprio baseline, com **guarda de volume** (ex.: ≥ 500 eventos terminais na janela) para não disparar em clientes minúsculos.

### 2. Spike de uma categoria de falha — `consistent_error` / `failure_spike`, dim. `customer` (warning→critical)
As falhas são distintas e diagnósticas:
- `policy_block` em alta → conteúdo barrado por política/carrier (típico de apostas).
- `invalid_number` em alta → lista de contatos velha/suja.
- `generic_error` sustentado → **integração quebrada** (ex.: `8200` a 100% generic_error e 0% entrega).

### 3. Silêncio de callbacks de status — `webhook_silence`, dim. `provider`/`global` (critical)
`status-webhook-receiver` processa um fluxo alto e constante (~291k/2h). Se os callbacks (Sinch) **param** por X min, ou ficamos cegos quanto à entrega (provider fora / nosso receiver caído). Caso correlato per-cliente: "No webhook URL configured for the given app ID" (153) = cliente não recebe os próprios callbacks.

## Thresholds default propostos (`anomaly_rules`)

| rule_id | name | rule_type | dimension | severity | threshold | unit | window_min |
|---|---|---|---|---|---:|---|---:|
| `r-delivery-drop-customer` | Queda de entrega por cliente | `delivery_rate_drop` | `customer` | `critical` | 3 | `σ` | 15 |
| `r-policy-block-spike` | Spike de bloqueio por política | `consistent_error` | `customer` | `warning` | 30 | `%` | 15 |
| `r-invalid-number-spike` | Spike de número inválido | `consistent_error` | `customer` | `warning` | 25 | `%` | 30 |
| `r-integration-error` | Erro de integração (generic_error) | `failure_spike` | `customer` | `critical` | 5 | `%` | 10 |
| `r-webhook-silence-sinch` | Silêncio de callbacks (Sinch) | `webhook_silence` | `provider` | `critical` | 15 | `min` | 15 |

**Notas de calibração**
- `delivery_rate_drop`: usar **σ vs baseline rolante por cliente** (não piso absoluto — baselines variam de 4,6% a 68%). Alternativa: queda relativa ≥ 20 p.p. Guarda de volume mínima ≥ 500 eventos terminais.
- `consistent_error`: threshold = % do volume terminal do cliente naquela categoria, na janela.
  **Implementado** (2026-06) como **categoria dominante** — a regra dispara na maior categoria de
  `error_hint` que cruza o threshold, sem coluna de categoria-alvo (decisão D1 do plano
  `detectores-consistent-error-webhook-silence`). `webhook_silence`: `threshold` em **minutos** = gap
  máximo sem status (`finalized_at`) apesar de envios na janela, dim. `provider`.
- `r-integration-error`: `generic_error` é raro no geral, mas 100% para clientes quebrados → threshold baixo + severidade crítica.
- A guarda de volume mínimo e o baseline por hora-do-dia **não** têm coluna na tabela `anomaly_rules` atual → tratar como parâmetro do detector ou estender o schema (item para o backend).

## Próximos passos
- Validar com produto/suporte a **definição de sucesso** (`delivered` vs `delivered+sent`) — muda todos os thresholds.
- Recalcular baselines com 7–30 dias e dedupe por mensagem (status final), não evento.
- Semear estas linhas como defaults da tela de Regras ([04](../../docs/design_handoff_atena/04-screen-to-endpoint-map.md)).
