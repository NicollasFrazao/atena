# Custo operacional — consulta fria do S3 (motor de auditoria)

> Data: 2026-06-18 · Escopo: custo de **S3** das consultas do motor de auditoria da Atena
> (DuckDB lendo `s3://at-api-logs-prod` sob demanda, com cache `/tmp`).

## TL;DR

- O custo frio do S3 tem **dois drivers**, ambos lineares no volume: **GET** (nº de objetos lidos) e
  **egress** (bytes transferidos). LIST, PUT e armazenamento são desprezíveis ou zero.
- **Em produção na mesma região do bucket (us-east-1), o egress é zero** → sobra só GET:
  **~$0,40–1,20 por 1 milhão de objetos** varridos a frio. Praticamente nulo.
- **Fora da região (ex.: a box de dev/WSL)**, o egress domina: **~$0,09/GB** comprimido.
- O **cache `/tmp` amortiza**: cada partição-dia *settled* é lida a frio **uma única vez**; repetições
  da mesma janela custam **$0**.
- O custo real do "frio" é **tempo/compute** (segundos de CPU/IO baixando+parseando), **não** dólar de
  S3. Só vira dinheiro relevante se a app rodar **fora** da região do bucket.

---

## 1. Premissas (medidas em 2026-06-18)

| Item | Valor | Origem |
|---|---|---|
| Bucket | `at-api-logs-prod`, região **us-east-1** | `aws s3api get-bucket-location` → `null` (= us-east-1) |
| Região da app | **us-east-1** | `AWS_REGION` (`apps/api/.env`) |
| Formato | JSON Lines + gzip (`.json.gz`), partições Hive `year=/month=/day=/hour=` | — |
| **Amostra de 1 dia** (dia 15/06) | **1.944 objetos**, **~145 MB** comprimidos (144.557.181 bytes) | `aws s3 ls --recursive --summarize` |
| Custo de varredura fria de 1 dia | **277 s** (`latency_ms: 277012`) | medição real de uma consulta |
| Preços | S3 Standard, us-east-1 (2026) | tabela pública AWS |

> ⚠️ **O nº de objetos/dia varia com o tráfego** (quantas requisições de SMS por dia). O dia 15 é só
> uma amostra. Por isso o modelo abaixo é expresso em **custo unitário**, que vale pra qualquer volume.

---

## 2. Drivers de custo e preços unitários

| Driver | O que escala | Preço unitário (us-east-1) |
|---|---|---|
| **GET** (ler objetos) | nº de objetos da janela (~1–3 GET por objeto) | $0,0004 / 1.000 GET |
| **Egress same-region** | — | **$0,00** (S3 → compute na mesma região é grátis) |
| **Egress cross-region** | GB transferidos | ~$0,02 / GB |
| **Egress internet** (dev/WSL) | GB transferidos | ~$0,09 / GB |
| **LIST** (glob de partições) | nº de **partições-hora** (≤ 24/dia), **não** escala com objetos | $0,005 / 1.000 LIST |
| **PUT / armazenamento** | — | **$0,00** — a Atena **nunca escreve** no bucket (cache é `/tmp` local) |

**Fórmula geral:**

```
custo_frio ≈ (N_objetos × 1..3 × $0,0004/1000)        # GET
           + (GB_comprimidos × tarifa_egress)          # $0 same-region | $0,02 cross | $0,09 internet
           + (N_partições_hora × $0,005/1000)          # LIST, desprezível
```

---

## 3. Custo por dia-frio (faixas de volume)

Cada dia é varrido a frio **uma vez** (depois fica quente no cache). GET modelado a ~1,5/objeto.

| Perfil do dia | Objetos | ~MB | **Prod (us-east-1)** | **Dev (egress internet)** |
|---|---|---|---|---|
| Leve | ~500 | ~40 | ~$0,0003 | ~$0,004 |
| Medido (dia 15) | ~1.944 | ~145 | **~$0,0017** | **~$0,015** |
| Pesado | ~5.000 | ~400 | ~$0,003 | ~$0,04 |

Em prod, o número é **requests-only** (< 0,3 centavo/dia). Em dev, a transferência domina (~1–4 centavos/dia).

---

## 4. Projeção mensal (exemplos)

Depende de **quantas partições-dia distintas** são varridas a frio no mês (não do nº de consultas — o
cache torna a repetição gratuita).

| Cenário | Objetos frios/mês | **Prod (us-east-1)** | **Dev (egress internet)** |
|---|---|---|---|
| 30 dias varridos 1× (dia médio ~2k obj / ~145 MB) | ~58.000 (~4,35 GB) | **~$0,05** (GET) | **~$0,44** (egress) |
| Uso intenso, ~10 M objetos frios | 10.000.000 (~750 GB) | **~$4–12** (GET) | **~$68** (egress) |

> Mesmo um mês pesado em prod same-region fica na casa de **poucos dólares** — o egress zerado é o que
> mantém o custo trivial.

---

## 5. Amortização pelo cache `/tmp`

- O cache grava um **Parquet por partição-dia *settled*** (fechada há mais de `cacheSettleMinutes`,
  default 60 min) em volume Docker nomeado (`atena-tmp`).
- 1ª varredura de um dia: **fria** (custo da seção 3). Toda repetição da mesma janela: **quente → $0 no S3**
  (lê do disco local; medido ~13 ms vs ~277 s a frio).
- Logo, **o custo frio é limitado pelo nº de dias distintos já consultados**, não pelo nº de consultas.

---

## 6. Ressalvas

- **Cauda viva (não-cacheada):** as partições dos últimos ~60 min (`cacheSettleMinutes`) são **relidas a
  cada consulta** (ainda não *settled*). É fração de uma hora de dado (~12–25 MB) → ~$0,001–0,002 de egress
  por consulta no pior caso. Desprezível, mas **recorrente** (não amortiza).
- **Crescimento do cache:** não há TTL/eviction — o volume `atena-tmp` cresce com cada partição-dia
  distinta varrida (e dirs de versões antigas do cache ficam órfãos após bump de `EV_CACHE_VERSION`).
  É **custo de disco local**, não de S3. (Follow-up: eviction por tamanho/idade.)
- **Compute ≠ S3:** os ~277 s/dia-frio são CPU/IO do container (download + parse + escrita do Parquet).
  **É aqui que mora o "custo" percebido do frio**, não no S3. Quanto custa:

  | Modelo de execução | Custo de 1 scan frio (277 s) | Observação |
  |---|---|---|
  | **Instância sempre-ligada** (deploy atual) | **~$0 marginal** | CPU já provisionada; "paga-se" em **latência + 1 core ocupado ~4,6 min** |
  | Fargate metrado (~1,5 vCPU / 3 GB) | ~$0,0057 | $0,04048/vCPU-h + $0,004445/GB-h × 0,077 h |
  | Fargate metrado (2 vCPU / 4 GB) | ~$0,0076 | idem, alocação maior |
  | EC2 m5.large atribuída (2 vCPU) | ~$0,0074 | $0,096/h × 0,077 h |

  Ou seja, **sub-centavo por scan** se metrado; **$0 marginal** numa instância fixa. Mesmo 30 dias frios
  distintos no mês = **~$0,21** metrado (ou $0 marginal). O verdadeiro preço do frio é **tempo de espera**
  e **ocupação de CPU** — exatamente o que o **cache** (frio só 1×/dia) e a nova **UI de progresso**
  (percepção) endereçam. RAM é bounded (DuckDB faz streaming; pico de algumas centenas de MB a ~1–2 GB),
  só dimensiona a instância, não é item de fatura à parte.

---

## 7. Recomendações

1. **Rodar a Atena na mesma região do bucket (us-east-1).** É a maior alavanca: zera o egress e derruba o
   custo frio para **sub-centavo por dia** (só GET). Fora da região, paga-se ~$0,09/GB.
2. **Aproveitar o cache nas consultas encadeadas** (ex.: `get_message_trail` repassando a janela do
   `search_messages`) para não disparar varreduras frias redundantes.
3. **(Follow-up) Eviction do cache** por tamanho/idade — controla disco local, sem impacto no custo de S3.
4. **Para um número mensal certeiro**, medir o **volume médio real de objetos/dia** e aplicar a fórmula
   da seção 2.

---

## Referências de preço (S3 Standard, us-east-1, 2026)

- GET/SELECT: **$0,0004 / 1.000 requests**
- PUT/COPY/POST/LIST: **$0,005 / 1.000 requests**
- Transferência S3 → mesma região: **$0,00**
- Transferência S3 → internet: **~$0,09 / GB** (após a franquia mensal gratuita)
- Transferência S3 → outra região AWS: **~$0,02 / GB**
