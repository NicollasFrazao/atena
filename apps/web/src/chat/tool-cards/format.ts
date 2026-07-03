import { type ShippingStatusType } from '@atena/types';
import { APP_TIMEZONE } from '../../util/time';

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
    color: 'var(--at-success-300)',
    background: 'var(--at-success-50)',
  },
  danger: {
    color: 'var(--at-danger-300)',
    background: 'var(--at-danger-50)',
  },
  warning: {
    color: 'var(--at-warning-300)',
    background: 'var(--at-warning-50)',
  },
  neutral: {
    color: 'var(--at-fg-muted)',
    background: 'var(--at-bg-soft)',
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
 * @param {string} status - Status bruto vindo do `result`.
 * @returns {{ label: string; tone: StatusToneType }} Rótulo e tom.
 */
export function describeStatus(status: string): {
  label: string;
  tone: StatusToneType
} {
  const known = status as ShippingStatusType;

  return {
    label: STATUS_LABELS[known] ?? status,
    tone: STATUS_TONES[known] ?? 'neutral',
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
 * @param {string} iso - Instante (ISO absoluto OU naive no fuso).
 * @param {Intl.DateTimeFormatOptions} options - Campos a exibir (dia/mês/hora/…).
 * @returns {string} Data formatada, ou o valor original se não parseável.
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
 * @param {string} iso - Instante (ISO absoluto OU naive no fuso).
 * @returns {string} Data formatada ou o valor original.
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
 * @param {string} iso - Instante (ISO absoluto OU naive no fuso).
 * @returns {string} Data formatada com segundos, ou o valor original.
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

/**
 * Formata um telefone para exibição (espelha o `maskPhone` do backend, mas com os dígitos completos):
 * BR móvel `+55 (13) 99188-4678`. Como o telefone é gravado só-dígitos, o valor revelado vem cru
 * (ex.: `5513991884678`) — esta função o deixa legível. Não-BR/curto: prefixa `+` nos dígitos.
 *
 * @param {string} raw - Telefone (dígitos ou qualquer formato).
 * @returns {string} Telefone formatado para leitura.
 */
export function formatPhone(raw: string): string {
  const digits = (raw ?? '').replace(
    /\D/g,
    '',
  );

  // Sistema BR-only: o número pode vir COM DDI (55 + DDD + 8/9 dígitos = 12/13) ou SEM (só DDD + 8/9
  // dígitos = 10/11 — ex.: SMS Flash/zapsms grava sem o 55). Em ambos extrai-se o "local" (DDD + número)
  // e exibe-se +55 (DDD) — sem isso, um BR sem DDI vira "+47..." parecendo número estrangeiro.
  const local = digits.startsWith('55')
    && (digits.length === 12 || digits.length === 13)
    ? digits.slice(2)
    : digits;

  if (
    local.length === 10
    || local.length === 11
  ) {
    const area = local.slice(
      0,
      2,
    );

    const rest = local.slice(2);

    return `+55 (${area}) ${rest.slice(
      0,
      -4,
    )}-${rest.slice(-4)}`;
  }

  return digits
    ? `+${digits}`
    : raw;
}

/**
 * Formata um número inteiro com separadores de milhar em pt-BR.
 *
 * Defensivo com `null`/`undefined` (ex.: relatório antigo persistido, sem um campo novo do contrato)
 * → formata como `0` em vez de estourar (`undefined.toLocaleString`).
 *
 * @param {number | null | undefined} value - Valor a formatar.
 * @returns {string} Número formatado (ex.: `184.320`).
 */
export function formatNumber(value: number | null | undefined): string {
  return (value ?? 0).toLocaleString('pt-BR');
}
