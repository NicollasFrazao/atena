/**
 * Conversão de fuso na BORDA (edge) — o fuso de **exibição/janela** do operador, parametrizável.
 *
 * O motor de auditoria é canônico em **UTC** (partições Hive UTC; `sent_at`/`processed_at` da fonte
 * já normalizados para UTC). Este módulo NÃO mexe nisso: ele só traduz, na entrada da API, as datas
 * que o usuário escolhe (dias nomeados / presets) — pensadas no fuso do operador — para os instantes
 * UTC que o motor espera. A saída (exibição) é formatada no fuso no front.
 *
 * Distinção importante: o fuso da **FONTE** (o detailed report emite em BRT, e o motor soma +3h para
 * UTC) é propriedade do produtor e **não** é este parâmetro. Este é o fuso de **EXIBIÇÃO/JANELA**.
 *
 * Tudo via `Intl` (resolve offset e horário de verão por instante), então trocar `APP_TIMEZONE` para
 * outro fuso IANA passa a funcionar corretamente sem mudar a lógica.
 */

/** Fuso de exibição/janela padrão (IANA). BRT não tem DST desde 2019 — bate com o `+3h` do motor. */
export const DEFAULT_APP_TIMEZONE = 'America/Sao_Paulo';

/** Milissegundos em um minuto / dia. */
const MINUTE_MS = 60_000;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Fuso de exibição/janela do app (IANA), parâmetro único lido do ambiente (`APP_TIMEZONE`).
 * Default {@link DEFAULT_APP_TIMEZONE}. Fonte de verdade reusada por toda a resolução de janela.
 *
 * @returns {string} Identificador IANA do fuso (ex.: `America/Sao_Paulo`).
 */
export function appTimeZone(): string {
  return process.env.APP_TIMEZONE || DEFAULT_APP_TIMEZONE;
}

/** Partes (ano/mês/dia/hora/min/seg) de um instante lidas NO fuso. */
interface TzParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/**
 * Lê as partes de calendário de um instante interpretado NO fuso (via `Intl`).
 *
 * @param {Date} instant - Instante (UTC interno).
 * @param {string} timeZone - Fuso IANA.
 * @returns {TzParts} Ano/mês/dia/hora/min/seg do relógio de parede no fuso.
 */
function partsInTz(
  instant: Date,
  timeZone: string,
): TzParts {
  const formatter = new Intl.DateTimeFormat(
    'en-US',
    {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    },
  );

  const lookup: Record<string, number> = {};

  for (const part of formatter.formatToParts(instant)) {
    if (part.type !== 'literal') {
      lookup[part.type] = Number(part.value);
    }
  }

  // Em alguns runtimes a meia-noite no fuso sai como hora '24'; normaliza para 0.
  const hour = lookup.hour === 24
    ? 0
    : lookup.hour;

  return {
    year: lookup.year,
    month: lookup.month,
    day: lookup.day,
    hour,
    minute: lookup.minute,
    second: lookup.second,
  };
}

/**
 * Offset do fuso (em minutos, relógio-de-parede − UTC) NAQUELE instante — resolve DST via `Intl`.
 * Ex.: BRT devolve `-180`.
 *
 * @param {Date} instant - Instante de referência.
 * @param {string} timeZone - Fuso IANA.
 * @returns {number} Offset em minutos (negativo a oeste de Greenwich).
 */
export function tzOffsetMinutes(
  instant: Date,
  timeZone: string,
): number {
  const parts = partsInTz(
    instant,
    timeZone,
  );

  const asIfUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );

  return Math.round((asIfUtc - instant.getTime()) / MINUTE_MS);
}

/**
 * Instante UTC do início (00:00) do dia-calendário (`year`/`month`/`day`) NO fuso. Refina uma vez
 * para cobrir bordas de horário de verão (quando o offset do instante ingênuo difere do real).
 *
 * @param {number} year - Ano (ex.: 2026).
 * @param {number} month - Mês 1–12.
 * @param {number} day - Dia 1–31.
 * @param {string} timeZone - Fuso IANA.
 * @returns {Date} Instante UTC correspondente a 00:00 daquele dia no fuso.
 */
export function startOfDayInTz(
  year: number,
  month: number,
  day: number,
  timeZone: string,
): Date {
  return wallClockToUtc(
    year,
    month,
    day,
    0,
    0,
    0,
    timeZone,
  );
}

/**
 * Converte um relógio-de-parede (ano/mês/dia hora:min:seg) DO FUSO no instante UTC correspondente.
 * Refina uma vez para cobrir bordas de DST (offset do instante ingênuo ≠ offset real). Base de
 * {@link startOfDayInTz} e da interpretação de datetimes sem fuso (naive) na borda.
 *
 * @param {number} year - Ano (ex.: 2026).
 * @param {number} month - Mês 1–12.
 * @param {number} day - Dia 1–31.
 * @param {number} hour - Hora 0–23 (no fuso).
 * @param {number} minute - Minuto 0–59 (no fuso).
 * @param {number} second - Segundo 0–59 (no fuso).
 * @param {string} timeZone - Fuso IANA.
 * @returns {Date} Instante UTC correspondente ao relógio-de-parede no fuso.
 */
export function wallClockToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): Date {
  const naiveUtc = Date.UTC(
    year,
    month - 1,
    day,
    hour,
    minute,
    second,
  );

  const offset1 = tzOffsetMinutes(
    new Date(naiveUtc),
    timeZone,
  );

  let utcMs = naiveUtc - offset1 * MINUTE_MS;

  const offset2 = tzOffsetMinutes(
    new Date(utcMs),
    timeZone,
  );

  if (offset2 !== offset1) {
    utcMs = naiveUtc - offset2 * MINUTE_MS;
  }

  return new Date(utcMs);
}

/** Zero-pad de um número para 2 dígitos (`9` → `'09'`). Compartilhado pelos formatadores de data. */
function pad2(value: number): string {
  return String(value).padStart(
    2,
    '0',
  );
}

/**
 * Formata um instante (ISO/Date) como `DD/MM/AAAA às HH:MM` **no fuso do operador** (via `Intl`).
 * Para exibir limites que são instantes UTC reais (ex.: `minQueryDate`) já convertidos para o fuso.
 *
 * @param {string | Date} instant - Instante (ISO 8601 ou Date).
 * @param {string} timeZone - Fuso IANA.
 * @returns {string} `DD/MM/AAAA às HH:MM` no fuso (ou o valor cru se não parseável).
 */
export function formatInstantInTz(
  instant: string | Date,
  timeZone: string,
): string {
  const date = instant instanceof Date
    ? instant
    : new Date(instant);

  if (Number.isNaN(date.getTime())) {
    return String(instant);
  }

  const parts = partsInTz(
    date,
    timeZone,
  );

  return `${pad2(parts.day)}/${pad2(parts.month)}/${parts.year} às ${pad2(parts.hour)}:${pad2(parts.minute)}`;
}

/**
 * Formata um instante (ISO/Date) como datetime SEM fuso (naive `YYYY-MM-DDTHH:mm:ss`) no relógio de
 * parede DO FUSO. É o inverso de {@link resolveBoundInTz} para naive: passar a saída daqui como
 * `date_from`/`date_to` reconstrói o MESMO instante UTC. Use para entregar limites ao LLM já no fuso
 * do operador (ele cita e repassa às tools sem reconverter), mantendo a API/o banco em UTC.
 *
 * @param {string | Date} instant - Instante (ISO 8601 ou Date).
 * @param {string} timeZone - Fuso IANA.
 * @returns {string} `YYYY-MM-DDTHH:mm:ss` no fuso (relógio de parede), sem `Z`; ou o valor cru se inválido.
 */
export function toNaiveDatetimeInTz(
  instant: string | Date,
  timeZone: string,
): string {
  const date = instant instanceof Date
    ? instant
    : new Date(instant);

  if (Number.isNaN(date.getTime())) {
    return String(instant);
  }

  const parts = partsInTz(
    date,
    timeZone,
  );

  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}T${pad2(parts.hour)}:${pad2(parts.minute)}:${pad2(parts.second)}`;
}

/** Reconhece uma data só-dia (`YYYY-MM-DD`, sem hora) — interpretada no fuso, não em UTC. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Reconhece um datetime SEM designador de fuso (naive, ex.: `2026-06-19T13:00` / `...T13:00:00`):
 * sem `Z` e sem `±hh:mm`. É interpretado no fuso do operador (não em UTC nem no fuso do servidor).
 */
const NAIVE_DATETIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * Início (00:00 no fuso, em UTC) do dia de uma string `YYYY-MM-DD`.
 *
 * @param {string} dateOnly - Data só-dia (`YYYY-MM-DD`).
 * @param {string} timeZone - Fuso IANA.
 * @returns {Date} Instante UTC de 00:00 daquele dia no fuso.
 */
export function startOfNamedDayInTz(
  dateOnly: string,
  timeZone: string,
): Date {
  const [
    year,
    month,
    day,
  ] = dateOnly.split('-').map(Number);

  return startOfDayInTz(
    year,
    month,
    day,
    timeZone,
  );
}

/**
 * Resolve um limite de janela vindo da borda: se for só-dia (`YYYY-MM-DD`), interpreta no fuso
 * (não em UTC); se tiver hora (ISO completo), é um instante absoluto e passa direto.
 *
 * @param {string} value - `date_from`/`date_to` da requisição.
 * @param {string} timeZone - Fuso IANA.
 * @param {boolean} endExclusive - Quando `true` e for só-dia, devolve o INÍCIO do dia seguinte
 *   (fim exclusivo) — "até 19/06" cobre o dia 19 inteiro.
 * @returns {Date} Instante UTC do limite.
 */
export function resolveBoundInTz(
  value: string,
  timeZone: string,
  endExclusive: boolean,
): Date {
  // Dia só-data (`YYYY-MM-DD`): início do dia no fuso; `date_to` cobre o dia inteiro (fim exclusivo).
  if (DATE_ONLY.test(value)) {
    const start = startOfNamedDayInTz(
      value,
      timeZone,
    );

    return endExclusive
      ? new Date(start.getTime() + DAY_MS)
      : start;
  }

  // Datetime sem fuso (naive): relógio-de-parede no fuso do operador → instante UTC.
  const naive = NAIVE_DATETIME.exec(value);

  if (naive) {
    return wallClockToUtc(
      Number(naive[1]),
      Number(naive[2]),
      Number(naive[3]),
      Number(naive[4]),
      Number(naive[5]),
      Number(naive[6] ?? '0'),
      timeZone,
    );
  }

  // Tem `Z` ou offset explícito (±hh:mm): instante absoluto, passa direto.
  return new Date(value);
}

/**
 * Início (00:00 no fuso, em UTC) do dia `n` dias-calendário atrás, contado a partir de `reference`.
 * Usado por presets de "últimos N dias": `startOfRecentDays(6, …)` cobre hoje + 6 dias anteriores
 * (7 dias-calendário) a partir do começo do dia mais antigo. Calendário ancorado no fuso.
 *
 * @param {number} daysAgo - Quantos dias-calendário voltar (0 = hoje no fuso).
 * @param {string} timeZone - Fuso IANA.
 * @param {Date} reference - Instante "agora".
 * @returns {Date} Instante UTC de 00:00 (no fuso) do dia alvo.
 */
export function startOfRecentDays(
  daysAgo: number,
  timeZone: string,
  reference: Date,
): Date {
  const today = partsInTz(
    reference,
    timeZone,
  );

  // Aritmética de calendário segura via UTC do dia no fuso, recuando `daysAgo` dias.
  const anchor = new Date(Date.UTC(
    today.year,
    today.month - 1,
    today.day,
  ) - daysAgo * DAY_MS);

  return startOfDayInTz(
    anchor.getUTCFullYear(),
    anchor.getUTCMonth() + 1,
    anchor.getUTCDate(),
    timeZone,
  );
}
