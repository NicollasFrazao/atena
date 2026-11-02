import { type ShippingStatusType } from '@atena/types';
import { APP_TIMEZONE } from '../../util/time';
import { cssVar } from '../../styles/tokens';

/** Tom semântico de um status, usado para colorir pills/badges. */
export type StatusToneType = 'success' | 'danger' | 'warning' | 'neutral';

/** Par de cores (texto + fundo) de um tom semântico. */
export interface ToneColorsInterface {
  color: string;
  background: string;
}

/** Mapa de tom semântico → tokens de cor (texto + fundo claro). */
export const TONE_COLORS: Record<StatusToneType, ToneColorsInterface> = {
  success: {
    color: cssVar.success300,
    background: cssVar.success50,
  },
  danger: {
    color: cssVar.danger300,
    background: cssVar.danger50,
  },
  warning: {
    color: cssVar.warning300,
    background: cssVar.warning50,
  },
  neutral: {
    color: cssVar.fgMuted,
    background: cssVar.bgSoft,
  },
};

/** Rótulo legível (pt-BR) para cada status de entrega. */
const STATUS_LABELS: Record<ShippingStatusType, string> = {
  delivered: 'Entregue',
  failed: 'Falha',
  blocked: 'Bloqueado',
  pending: 'Pendente',
  unknown: 'Desconhecido',
};

/** Tom semântico de cada status de entrega. `blocked` (controle de entrega) = neutro (não é falha). */
const STATUS_TONES: Record<ShippingStatusType, StatusToneType> = {
  delivered: 'success',
  failed: 'danger',
  blocked: 'neutral',
  pending: 'warning',
  unknown: 'neutral',
};

/**
 * Resolve rótulo (pt-BR) e tom de um status de entrega; cai em "neutral" para
 * valores fora do contrato.
 *
 * @param status - Status bruto vindo do `result`.
 *
 * @returns Rótulo e tom.
 */
export function describeStatus(status: string): {
  label: string;
  tone: StatusToneType
} {
  // The raw status can be any string, so the maps are read through string-indexed partial views.
  const labels: Partial<Record<string, string>> = STATUS_LABELS;
  const tones: Partial<Record<string, StatusToneType>> = STATUS_TONES;

  return {
    label: labels[status] ?? status,
    tone: tones[status] ?? 'neutral',
  };
}

/** Datetime SEM fuso (naive `YYYY-MM-DDTHH:mm[:ss[.sss]]`, sem `Z`/offset): já é o relógio de parede do fuso. */
const NAIVE_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

/**
 * Formata um instante para exibição em pt-BR no fuso do app, com fallback ao valor cru se inválido.
 * Lida com DUAS formas de entrada:
 * - **Absoluta** (`Z`/offset, ex.: `2026-06-22T19:54Z`): convertida para {@link APP_TIMEZONE}.
 * - **Naive** (sem fuso, ex.: `2026-06-22T16:54:06`): JÁ é o relógio de parede do fuso (a borda do
 *   chat entrega os horários da trilha assim) — formatada SEM deslocar (interpretada como UTC e
 *   exibida em UTC dá exatamente os mesmos componentes), o que mantém a exibição correta e
 *   independente do fuso do navegador.
 *
 * @param iso - Instante (ISO absoluto OU naive no fuso).
 * @param options - Campos a exibir (dia/mês/hora/…).
 *
 * @returns Data formatada, ou o valor original se não parseável.
 */
function formatInTz(
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

/** Campos de data/hora (dd/MM HH:mm) reusados por {@link formatDateTime}. */
const DATE_TIME_FIELDS: Intl.DateTimeFormatOptions = {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
};

/**
 * Formata um instante de forma legível em pt-BR (dd/MM HH:mm) no fuso do app; aceita ISO absoluto
 * (`Z`/offset) ou naive (já no fuso). Devolve o valor original se não for parseável.
 *
 * @param iso - Instante (ISO absoluto OU naive no fuso).
 *
 * @returns Data formatada ou o valor original.
 */
export function formatDateTime(iso: string): string {
  return formatInTz(
    iso,
    DATE_TIME_FIELDS,
  );
}

/**
 * Como {@link formatDateTime}, porém com SEGUNDOS (dd/MM HH:mm:ss). Usado na trilha: os eventos do
 * ciclo de vida (queued → sent → delivered) costumam cair no mesmo minuto, então sem os segundos
 * parecem simultâneos e contradizem a duração (ex.: 4 s). Devolve o original se não for parseável.
 *
 * @param iso - Instante (ISO absoluto OU naive no fuso).
 *
 * @returns Data formatada com segundos, ou o valor original.
 */
export function formatDateTimeSeconds(iso: string): string {
  return formatInTz(
    iso,
    {
      ...DATE_TIME_FIELDS,
      second: '2-digit',
    },
  );
}

/** Digits of the Brazilian country code (`55`). */
const COUNTRY_CODE_DIGITS = 2;

/** Digits of a Brazilian landline without the country code: area code + 8. */
const LANDLINE_LOCAL_DIGITS = 10;

/** Digits of a Brazilian mobile number without the country code: area code + 9. */
const MOBILE_LOCAL_DIGITS = 11;

/** Digits of a Brazilian landline with the country code. */
const LANDLINE_FULL_DIGITS = COUNTRY_CODE_DIGITS + LANDLINE_LOCAL_DIGITS;

/** Digits of a Brazilian mobile number with the country code. */
const MOBILE_FULL_DIGITS = COUNTRY_CODE_DIGITS + MOBILE_LOCAL_DIGITS;

/** Digits after the hyphen of a displayed phone number. */
const PHONE_SUFFIX_DIGITS = 4;

/**
 * Formata um telefone para exibição (espelha o `maskPhone` do backend, mas com os dígitos completos):
 * BR móvel `+55 (13) 99188-4678`. Como o telefone é gravado só-dígitos, o valor revelado vem cru
 * (ex.: `5513991884678`) — esta função o deixa legível. Não-BR/curto: prefixa `+` nos dígitos.
 *
 * @param raw - Telefone (dígitos ou qualquer formato). It can be missing when a response breaks
 *   the contract; that yields an empty string.
 *
 * @returns Telefone formatado para leitura.
 */
export function formatPhone(raw: string | null | undefined): string {
  const digits = (raw ?? '').replace(
    /\D/g,
    '',
  );

  // Sistema BR-only: o número pode vir COM DDI (55 + DDD + 8/9 dígitos = 12/13) ou SEM (só DDD + 8/9
  // dígitos = 10/11 — ex.: SMS Flash/zapsms grava sem o 55). Em ambos extrai-se o "local" (DDD + número)
  // e exibe-se +55 (DDD) — sem isso, um BR sem DDI vira "+47..." parecendo número estrangeiro.
  const local = digits.startsWith('55')
    && (digits.length === LANDLINE_FULL_DIGITS || digits.length === MOBILE_FULL_DIGITS)
    ? digits.slice(2)
    : digits;

  if (
    local.length === LANDLINE_LOCAL_DIGITS
    || local.length === MOBILE_LOCAL_DIGITS
  ) {
    const area = local.slice(
      0,
      2,
    );

    const rest = local.slice(2);

    return `+55 (${area}) ${rest.slice(
      0,
      -PHONE_SUFFIX_DIGITS,
    )}-${rest.slice(-PHONE_SUFFIX_DIGITS)}`;
  }

  return digits
    ? `+${digits}`
    : raw ?? '';
}

/**
 * Formata um número inteiro com separadores de milhar em pt-BR.
 *
 * Defensivo com `null`/`undefined` (ex.: relatório antigo persistido, sem um campo novo do contrato)
 * → formata como `0` em vez de estourar (`undefined.toLocaleString`).
 *
 * @param value - Valor a formatar.
 *
 * @returns Número formatado (ex.: `184.320`).
 */
export function formatNumber(value: number | null | undefined): string {
  return (value ?? 0).toLocaleString('pt-BR');
}
