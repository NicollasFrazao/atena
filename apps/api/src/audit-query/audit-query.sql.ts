import type { AuditWindowInterface } from './audit-query.types';

/** Milissegundos em uma hora. */
const HOUR_MS = 3_600_000;

/** Milissegundos em um dia. */
const DAY_MS = 24 * HOUR_MS;

/** Acima desta janela (em horas), as partições são por dia (não por hora) para limitar a lista. */
const HOURLY_GRAIN_MAX_HOURS = 72;

/** Nome da TEMP TABLE (por conexão) com o agregado por destinatário (desfecho resolvido). */
export const RECORDS_TABLE = 'atena_records';

/** Nome da TEMP TABLE (por conexão) com os EVENTOS crus (status + envio) — base de records e da trilha. */
export const EV_TABLE = 'atena_ev';

/**
 * Colunas dos eventos `ev` (um por registro do detailed report) — MESMA ORDEM na projeção e no
 * Parquet de cache (`SELECT ${EV_COLUMNS} FROM read_parquet`).
 */
export const EV_COLUMNS = 'campaign_id, phone, customer, provider, campaign_type, '
  + 'status, provider_code, error_text, sent_at, processed_at, message, app_id';

/**
 * Schema EXPLÍCITO lido de cada registro do **detailed report** (`s3://example-sms-delivery-reports`, Firehose
 * `SMS_STATUS_TOTAL_FIREHOSE_STREAM`). Flat, um registro por transição de status (queued/sent/
 * delivered/bounce/request_error/...). `message` (PII) é omitido — não é necessário para contagem.
 * `error` é objeto (`BaseError.toJSON()`); `provider_name`/`provider_code`/`error` só existem a partir
 * do contrato enriquecido (nulos no histórico). Declarar as colunas evita a inferência do `read_json_auto`.
 */
const SOURCE_COLUMNS = `{
  campaign_id: 'VARCHAR',
  campaign_type: 'VARCHAR',
  client_id: 'VARCHAR',
  app_id: 'VARCHAR',
  source: 'VARCHAR',
  status: 'VARCHAR',
  phone: 'VARCHAR',
  message: 'VARCHAR',
  sent_at: 'VARCHAR',
  processed_at: 'VARCHAR',
  provider_name: 'VARCHAR',
  provider_code: 'VARCHAR',
  error: 'JSON'
}`;

/**
 * Projeção de um registro do detailed report → evento `ev`. Colunas na ordem de {@link EV_COLUMNS}.
 * `error_text` extrai a mensagem do objeto `error` (cai pro `provider_code` quando ausente).
 * `phone` é normalizado para SÓ DÍGITOS na ingestão (mesmo número em formatos diferentes — ex.:
 * `+5513991884678` vs `5513991884678` — vira a MESMA chave), pois o grão por destinatário agrupa por
 * (campaign_id, phone); sem isso o mesmo número se divide em destinatários falsos. DEVE casar com
 * `normalizePhone` (filtro de busca). Bump de `EV_CACHE_VERSION` ao mudar esta normalização.
 */
const EV_PROJECTION = `
  campaign_id AS campaign_id,
  regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') AS phone,
  client_id AS customer,
  provider_name AS provider,
  campaign_type AS campaign_type,
  status AS status,
  provider_code AS provider_code,
  coalesce(json_extract_string(error, '$.message'), provider_code) AS error_text,
  -- sent_at/processed_at vêm em BRT (America/Sao_Paulo, UTC-3 fixo — sem DST desde 2019);
  -- normaliza pra UTC para casar com as janelas (que são UTC) e com as partições Hive (UTC).
  try_cast(sent_at AS TIMESTAMP) + INTERVAL 3 HOUR AS sent_at,
  try_cast(processed_at AS TIMESTAMP) + INTERVAL 3 HOUR AS processed_at,
  -- texto bruto do SMS (PII) — só sai mascarado/sob reveal auditado na borda; nunca em log de app.
  message AS message,
  -- aplicação que originou o envio (atribuição); UUID no detailed report, lido como texto.
  app_id AS app_id`;

/**
 * Filtro de canal — o bucket é multi-canal. Cobrimos **SMS Short** (`campaign_type='sms'`, ex.: sinch)
 * **e SMS Flash** (`'sms_flash'`, ex.: zapsms) — decisão revista 2026-06-25 (antes era só SMS Short).
 * Demais canais (voz/RCS) ficam de fora. O `channel` (= `campaign_type`) é exposto nos fluxos para
 * o operador distinguir. Para incluir/remover um canal, edite a lista do IN.
 */
const CHANNEL_FILTER = `campaign_type IN ('sms', 'sms_flash') AND campaign_id IS NOT NULL`;

/** Status que NÃO são desfecho (intermediários); o restante é falha (terminal). */
const NON_OUTCOME_STATUSES = `('queued', 'sent', 'in_progress')`;

/** Pad numérico para 2 dígitos (mês/dia/hora das partições Hive). */
function pad2(value: number): string {
  return String(value).padStart(
    2,
    '0',
  );
}

/** Glob de uma partição-hora: `.../year=YYYY/month=MM/day=DD/hour=HH/*`. */
function hourGlob(
  root: string,
  date: Date,
): string {
  const year = date.getUTCFullYear();
  const month = pad2(date.getUTCMonth() + 1);
  const day = pad2(date.getUTCDate());
  const hour = pad2(date.getUTCHours());

  return `${root}/year=${year}/month=${month}/day=${day}/hour=${hour}/*`;
}

/** Glob de uma partição-dia (todas as horas): `.../year=YYYY/month=MM/day=DD/hour=*​/*`. */
function dayGlob(
  root: string,
  date: Date,
): string {
  const year = date.getUTCFullYear();
  const month = pad2(date.getUTCMonth() + 1);
  const day = pad2(date.getUTCDate());

  return `${root}/year=${year}/month=${month}/day=${day}/hour=*/*`;
}

/**
 * Uma partição candidata da janela: o glob dos objetos, a chave de cache e o instante em que a
 * partição se ENCERRA (para decidir se já está "settled" — fechada e cacheável).
 *
 * @property {string} glob - Glob dos objetos da partição.
 * @property {string} cacheKey - Chave estável da partição (compõe o nome do Parquet de cache).
 * @property {Date | null} endsAt - Fim do intervalo da partição; `null` = partição aberta (nunca cacheável).
 */
export interface PartitionDescriptorInterface {
  glob: string;
  cacheKey: string;
  endsAt: Date | null;
}

/**
 * Descreve as partições que cobrem a janela (hora a hora se ≤ 72h; senão dia a dia). Sem `from`,
 * devolve uma partição ampla e não-cacheável (todo o período).
 *
 * @param {string} sourceRoot - Raiz dos dados (`s3://bucket` ou diretório local).
 * @param {AuditWindowInterface} window - Janela `[from, to)`.
 * @param {Date} now - Instante de referência para `to` ausente.
 * @returns {PartitionDescriptorInterface[]} Partições candidatas (sem duplicatas).
 */
export function partitionDescriptors(
  sourceRoot: string,
  window: AuditWindowInterface,
  now: Date,
): PartitionDescriptorInterface[] {
  let root = sourceRoot;

  while (root.endsWith('/')) {
    root = root.slice(
      0,
      -1,
    );
  }

  if (!window.from) {
    return [{
      glob: `${root}/year=*/month=*/day=*/hour=*/*`,
      cacheKey: 'all',
      endsAt: null,
    }];
  }

  const from = window.from;
  const to = window.to ?? now;
  const end = to.getTime();

  const startHour = Date.UTC(
    from.getUTCFullYear(),
    from.getUTCMonth(),
    from.getUTCDate(),
    from.getUTCHours(),
  );

  const spanHours = Math.max(
    1,
    Math.ceil((end - startHour) / HOUR_MS),
  );

  const byKey = new Map<string, PartitionDescriptorInterface>();

  if (spanHours <= HOURLY_GRAIN_MAX_HOURS) {
    for (let cursor = startHour; cursor <= end; cursor += HOUR_MS) {
      const date = new Date(cursor);

      const key = `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}`
        + `-${pad2(date.getUTCDate())}-${pad2(date.getUTCHours())}`;

      byKey.set(
        key,
        {
          glob: hourGlob(
            root,
            date,
          ),
          cacheKey: key,
          endsAt: new Date(cursor + HOUR_MS),
        },
      );
    }
  }
  else {
    const startDay = Date.UTC(
      from.getUTCFullYear(),
      from.getUTCMonth(),
      from.getUTCDate(),
    );

    for (let cursor = startDay; cursor <= end; cursor += DAY_MS) {
      const date = new Date(cursor);
      const key = `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;

      byKey.set(
        key,
        {
          glob: dayGlob(
            root,
            date,
          ),
          cacheKey: key,
          endsAt: new Date(cursor + DAY_MS),
        },
      );
    }
  }

  return [...byKey.values()];
}

/** Literal de lista SQL com aspas simples escapadas (para `read_json`/`read_parquet([...])`). */
function pathListLiteral(paths: string[]): string {
  return paths
    .map((path) => `'${path.replaceAll(
      "'",
      "''",
    )}'`)
    .join(', ');
}

/** `SELECT file FROM glob('pattern')` — expande os objetos existentes de uma partição (tolera vazio). */
export function globSql(pattern: string): string {
  return `SELECT file FROM glob('${pattern.replaceAll(
    "'",
    "''",
  )}')`;
}

/** Leitura JSON.gz com schema explícito (cobre status + envio). */
function readJson(files: string[]): string {
  return `read_json(
    [${pathListLiteral(files)}],
    format => 'newline_delimited',
    compression => 'gzip',
    hive_partitioning => true,
    columns => ${SOURCE_COLUMNS}
  )`;
}

/** Eventos `ev` (registros do detailed report) de uma lista de objetos JSON.gz, filtrados por canal. */
function evSelect(files: string[]): string {
  return `SELECT ${EV_PROJECTION}
    FROM ${readJson(files)}
    WHERE ${CHANNEL_FILTER}`;
}

/**
 * `COPY (<eventos do detailed report>) TO '<parquet>' (FORMAT PARQUET)` — grava o cache de eventos
 * de uma partição. Lê os objetos da partição uma vez.
 *
 * @param {string[]} files - Objetos da partição.
 * @param {string} parquetPath - Destino do Parquet de cache.
 * @returns {string} Comando `COPY`.
 */
export function evCopyToParquetSql(
  files: string[],
  parquetPath: string,
): string {
  return `COPY (
    ${evSelect(files)}
  ) TO '${parquetPath.replaceAll(
    "'",
    "''",
  )}' (FORMAT PARQUET)`;
}

/**
 * DDL que materializa, numa TEMP TABLE, os eventos `ev` da janela — unindo o cache Parquet (settled)
 * e os objetos JSON live (não-settled). Um registro por transição de status (queued/delivered/...).
 *
 * @param {string[]} parquetFiles - Parquets de cache (já no formato `ev`); podem ser vazios.
 * @param {string[]} jsonFiles - Objetos JSON.gz live; podem ser vazios.
 * @returns {string} `CREATE OR REPLACE TEMP TABLE ... AS SELECT ...`.
 */
function evSourcesUnion(
  parquetFiles: string[],
  jsonFiles: string[],
): string {
  const sources: string[] = [];

  if (parquetFiles.length > 0) {
    sources.push(`SELECT ${EV_COLUMNS} FROM read_parquet([${pathListLiteral(parquetFiles)}])`);
  }

  if (jsonFiles.length > 0) {
    sources.push(evSelect(jsonFiles));
  }

  return sources.join('\n  UNION ALL\n  ');
}

/** Shipping_id = `md5(campaign_id||phone)` = 32 hex. Guarda contra injeção ao interpolar no filtro. */
const SHIPPING_ID_HEX = /^[0-9a-f]{32}$/i;

/**
 * DDL do `atena_ev`. Com `recipientId` (trilha), filtra para UM destinatário JÁ na materialização
 * (`md5(campaign_id||phone) = id`) → a TEMP TABLE fica com ~os eventos daquele envio, não com os
 * milhões da janela; o `records` derivado tem 1 linha (sem o dedup sobre 271k+ destinatários). O scan
 * dos objetos é o mesmo (o filtro roda na leitura), mas o build despenca. `recipientId` é md5 (32 hex)
 * validado → seguro interpolar (DDL não aceita bind no CREATE … AS).
 *
 * @param {string[]} parquetFiles - Parquets de cache (formato `ev`); podem ser vazios.
 * @param {string[]} jsonFiles - Objetos JSON.gz live; podem ser vazios.
 * @param {string} [recipientId] - Shipping_id (md5) p/ filtrar o `ev` a um destinatário (trilha).
 * @returns {string} `CREATE OR REPLACE TEMP TABLE atena_ev AS ...`.
 */
export function evDdlFromSources(
  parquetFiles: string[],
  jsonFiles: string[],
  recipientId?: string,
): string {
  const union = evSourcesUnion(
    parquetFiles,
    jsonFiles,
  );

  const body = recipientId && SHIPPING_ID_HEX.test(recipientId)
    ? `SELECT * FROM (\n${union}\n) AS ev\n  `
      + `WHERE md5(campaign_id || '|' || coalesce(phone, '')) = '${recipientId.toLowerCase()}'`
    : union;

  return `CREATE OR REPLACE TEMP TABLE ${EV_TABLE} AS\n${body}`;
}

/** DDL de uma `atena_ev` vazia (mesmo schema) — quando a janela não casa nenhum objeto. */
export const EMPTY_EV_DDL = `CREATE OR REPLACE TEMP TABLE ${EV_TABLE} (`
  + 'campaign_id VARCHAR, phone VARCHAR, customer VARCHAR, provider VARCHAR, campaign_type VARCHAR, '
  + 'status VARCHAR, provider_code VARCHAR, error_text VARCHAR, sent_at TIMESTAMP, processed_at TIMESTAMP, '
  + 'message VARCHAR, app_id VARCHAR)';

/**
 * DDL do agregado por destinatário (`atena_records`), lendo de `atena_ev` (GROUP BY `campaign_id`,
 * `phone` — 1 linha por DESTINATÁRIO, pois um lote de `campaign_id` pode ter vários telefones).
 * Resolução terminal do desfecho: `delivered` vence; senão, o último
 * status de desfecho (não-intermediário) vira `failed`; senão `pending` (só queued/sent/in_progress).
 * `requested_at` = `processed_at` do **evento `queued`** (o envio real) — NÃO `min` sobre tudo (que
 * colapsaria pro desfecho se o `queued` não fosse lido); `NULL` se o `queued` não estiver na fonte.
 * `finalized_at` = `processed_at` do **próprio desfecho** (o `delivered`, ou a última falha terminal);
 * `NULL` enquanto `pending`. `error_hint` = a categoria de falha terminal (`bounce`/`request_error`/...).
 * `id = md5(campaign_id || '|' || phone)` (chave do destinatário; casa a trilha em {@link trailEventsSql}).
 *
 * @returns {string} `CREATE OR REPLACE TEMP TABLE atena_records AS ...`.
 */
export function recordsDdl(fromSource: string = EV_TABLE): string {
  return `
CREATE OR REPLACE TEMP TABLE ${RECORDS_TABLE} AS
WITH grouped AS (
  SELECT
    md5(campaign_id || '|' || coalesce(phone, '')) AS id,
    any_value(campaign_id) AS correlation_id,
    any_value(phone) AS phone,
    any_value(customer) AS customer,
    any_value(message) AS message,
    any_value(campaign_type) AS channel,
    any_value(app_id) AS app_id,
    max(provider) AS provider,
    -- requested_at = instante do ENVIO real (evento queued); NULL se o queued não foi lido (não
    -- colapsa pro desfecho como faria min(processed_at) sobre todos os eventos).
    min(processed_at) FILTER (WHERE status = 'queued') AS requested_at,
    -- instante do delivered (o 1º) — registrado só do status certo.
    min(processed_at) FILTER (WHERE status = 'delivered') AS delivered_at,
    bool_or(status = 'delivered') AS has_delivered,
    arg_max(status, processed_at)
      FILTER (WHERE status NOT IN ${NON_OUTCOME_STATUSES}) AS terminal_status,
    max(processed_at)
      FILTER (WHERE status NOT IN ${NON_OUTCOME_STATUSES}) AS terminal_ts
  FROM ${fromSource}
  GROUP BY campaign_id, phone
)
SELECT
  id, correlation_id, phone, customer, message, channel, app_id, provider, requested_at,
  -- finalized_at = instante do PRÓPRIO desfecho: o delivered (se entregue) ou a última falha terminal.
  CASE
    WHEN has_delivered THEN delivered_at
    WHEN terminal_status IS NOT NULL THEN terminal_ts
  END AS finalized_at,
  CASE
    WHEN has_delivered THEN 'delivered'
    WHEN terminal_status IS NOT NULL THEN 'failed'
    ELSE 'pending'
  END AS final_status,
  CASE
    WHEN has_delivered THEN NULL
    WHEN terminal_status IS NOT NULL THEN terminal_status
  END AS error_hint
FROM grouped`;
}

/**
 * Igual ao {@link recordsDdl}, mas agrega DIRETO da união das fontes (Parquet de cache ∪ JSON live)
 * — SEM materializar a TEMP TABLE `atena_ev` intermediária (todos os eventos crus). Para os fluxos
 * que só leem `atena_records` (busca/relatório/catálogo/reveal), evita materializar ~1 evento por
 * transição de status (potencialmente ~milhões de linhas) só pra agregar em seguida. A trilha, que
 * precisa dos eventos crus, continua usando `recordsDdl()` sobre `atena_ev`.
 *
 * @param {string[]} parquetFiles - Parquets de cache (formato `ev`); podem ser vazios.
 * @param {string[]} jsonFiles - Objetos JSON.gz live; podem ser vazios.
 * @returns {string} `CREATE OR REPLACE TEMP TABLE atena_records AS ...` agregando da fonte.
 */
export function recordsDdlFromSources(
  parquetFiles: string[],
  jsonFiles: string[],
): string {
  return recordsDdl(`(\n${evSourcesUnion(
    parquetFiles,
    jsonFiles,
  )}\n) AS src`);
}

/**
 * Sub-select FROM-able da UNIÃO das fontes (Parquet de cache ∪ JSON live), já filtrada por canal — a
 * MESMA base de {@link recordsDdlFromSources}, mas exposta para consultas que NÃO precisam do dedup
 * por destinatário (`atena_records`): o catálogo (`DISTINCT provider`/`customer`). Um DISTINCT não
 * precisa do grão por destinatário, então evita materializar records (271k+ destinatários via
 * `arg_max`/`any_value`) só para listar provedores/clientes. Ambas as listas vazias → string vazia
 * (a janela não casou objetos): o chamador deve curto-circuitar (a união seria SQL inválido). Use
 * como `FROM ${sourcesSubquery(parquet, json)}`.
 *
 * @param {string[]} parquetFiles - Parquets de cache (formato `ev`); podem ser vazios.
 * @param {string[]} jsonFiles - Objetos JSON.gz live; podem ser vazios.
 * @returns {string} `(\n<união>\n) AS src` — ou `''` se ambas as listas estão vazias.
 */
export function sourcesSubquery(
  parquetFiles: string[],
  jsonFiles: string[],
): string {
  const union = evSourcesUnion(
    parquetFiles,
    jsonFiles,
  );

  return union === ''
    ? ''
    : `(\n${union}\n) AS src`;
}

/**
 * Eventos crus de um destinatário (`md5(campaign_id || '|' || phone) = $1`), em ordem cronológica —
 * base da trilha. A chave casa o grão por destinatário (campanha + telefone) de {@link recordsDdl}.
 *
 * @returns {string} SELECT dos eventos de `atena_ev` para o id dado (bind `$1`).
 */
export function trailEventsSql(): string {
  return `SELECT status, provider, provider_code, error_text, sent_at, processed_at
    FROM ${EV_TABLE} WHERE md5(campaign_id || '|' || coalesce(phone, '')) = $1 ORDER BY processed_at`;
}
