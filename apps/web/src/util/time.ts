/**
 * Fuso de exibição do app (IANA) — edge de SAÍDA. Toda data absoluta mostrada na UI é formatada
 * neste fuso (o backend devolve sempre UTC). Parametrizável via `VITE_APP_TIMEZONE`; default BRT.
 * Trocar o parâmetro passa a exibir em outro fuso sem mudar a lógica (Intl resolve offset/DST).
 */
export const APP_TIMEZONE = (import.meta.env.VITE_APP_TIMEZONE as string | undefined)
  || 'America/Sao_Paulo';

/**
 * Rótulo curto do fuso (ex.: `GMT-3`) para anotar eixos/colunas de tempo — deriva do
 * {@link APP_TIMEZONE} via `Intl`, então acompanha o parâmetro. Cai no próprio id se o `Intl` falhar.
 */
export const APP_TZ_LABEL = ((): string => {
  try {
    const parts = new Intl.DateTimeFormat(
      'pt-BR',
      {
        timeZone: APP_TIMEZONE,
        timeZoneName: 'shortOffset',
      },
    ).formatToParts(new Date(0));

    return parts.find((part) => part.type === 'timeZoneName')?.value ?? APP_TIMEZONE;
  } catch {
    return APP_TIMEZONE;
  }
})();

/** Limiares de unidade para o tempo relativo (em segundos). */
const MINUTE = 60;
const HOUR = 3600;
const DAY = 86_400;

/** Datetime SEM fuso (naive `YYYY-MM-DDTHH:mm[:ss[.sss]]`, sem `Z`/offset): já é o relógio de parede do fuso. */
const NAIVE_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

/**
 * Núcleo dos formatadores: formata `iso` em pt-BR, tratando DUAS formas — **absoluta** (`Z`/offset)
 * convertida para {@link APP_TIMEZONE}; e **naive** (sem fuso, ex.: a borda do chat entrega os horários
 * assim), que JÁ é o relógio de parede do fuso → formatada SEM deslocar (interpretada como UTC e exibida
 * em UTC reproduz os mesmos componentes, independente do fuso do navegador). Fallback: o valor cru.
 *
 * @param {string} iso - Instante (ISO absoluto OU naive no fuso).
 * @param {Intl.DateTimeFormatOptions} options - Campos a exibir.
 * @returns {string} Texto formatado, ou o valor original se não parseável.
 */
function formatInAppTz(
  iso: string,
  options: Intl.DateTimeFormatOptions,
): string {
  const naive = NAIVE_ISO.test(iso);

  const date = new Date(naive
    ? `${iso}Z`
    : iso);

  if (Number.isNaN(date.getTime())) {
    return iso;
  }

  return new Intl.DateTimeFormat(
    'pt-BR',
    {
      timeZone: naive
        ? 'UTC'
        : APP_TIMEZONE,
      ...options,
    },
  ).format(date);
}

/**
 * Formata um instante ISO (UTC) como data+hora PT-BR **no fuso do app** (dd/MM HH:mm[:ss]).
 * Devolve o valor original se não for parseável.
 *
 * @param {string} iso - Instante em ISO 8601 (UTC).
 * @param {boolean} [withSeconds] - Inclui segundos (dd/MM HH:mm:ss).
 * @returns {string} Data+hora no fuso de exibição, ou o valor original.
 */
export function formatDateTime(
  iso: string,
  withSeconds = false,
): string {
  return formatInAppTz(
    iso,
    {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      ...(withSeconds
        ? { second: '2-digit' }
        : {}),
    },
  );
}

/**
 * Formata só a DATA (dd/MM) de um instante ISO **no fuso do app**.
 *
 * @param {string} iso - Instante em ISO 8601 (UTC).
 * @returns {string} Data (dd/MM) no fuso, ou o valor original.
 */
export function formatDate(iso: string): string {
  return formatInAppTz(
    iso,
    {
      day: '2-digit',
      month: '2-digit',
    },
  );
}

/**
 * Formata só a HORA (HH:mm[:ss]) de um instante ISO **no fuso do app**.
 *
 * @param {string} iso - Instante em ISO 8601 (UTC).
 * @param {boolean} [withSeconds] - Inclui segundos.
 * @returns {string} Hora no fuso, ou o valor original.
 */
export function formatTime(
  iso: string,
  withSeconds = false,
): string {
  return formatInAppTz(
    iso,
    {
      hour: '2-digit',
      minute: '2-digit',
      ...(withSeconds
        ? { second: '2-digit' }
        : {}),
    },
  );
}

/**
 * Chave de dia (`YYYY-MM-DD`) de um instante ISO **no fuso do app** — base para agrupar/comparar por
 * dia (Hoje/Ontem) sem vazar o fuso do navegador.
 *
 * @param {string} iso - Instante em ISO 8601 (UTC).
 * @returns {string} `YYYY-MM-DD` no fuso, ou o valor original.
 */
export function dayKeyInTz(iso: string): string {
  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    return iso;
  }

  // `en-CA` formata como `YYYY-MM-DD`.
  return new Intl.DateTimeFormat(
    'en-CA',
    {
      timeZone: APP_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    },
  ).format(date);
}

/**
 * Formata um instante ISO como tempo relativo curto em PT-BR ("há 4 min", "há 3 h", "há 5 dias").
 * Futuro ou inválido cai em "agora".
 *
 * @param {string} iso - Instante em ISO 8601.
 * @returns {string} Tempo relativo legível.
 */
export function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();

  if (Number.isNaN(then)) {
    return '—';
  }

  const seconds = Math.floor((Date.now() - then) / 1000);

  if (seconds < MINUTE) {
    return 'agora';
  }

  if (seconds < HOUR) {
    return `há ${Math.floor(seconds / MINUTE)} min`;
  }

  if (seconds < DAY) {
    return `há ${Math.floor(seconds / HOUR)} h`;
  }

  const days = Math.floor(seconds / DAY);

  return days === 1
    ? 'há 1 dia'
    : `há ${days} dias`;
}
