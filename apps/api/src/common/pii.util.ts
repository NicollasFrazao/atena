/**
 * Utilitários de PII. Mascaramento por padrão (princípio: PII mascarada).
 * NUNCA logar/retornar o valor cru sem passar por um fluxo de reveal auditado.
 */

/** Trailing digits a masked phone keeps visible. */
const VISIBLE_TAIL_DIGITS = 4;

/** Brazilian landline without the country code: DDD (2) + 8 digits. */
const BR_LANDLINE_DIGITS = 10;

/** Brazilian mobile without the country code: DDD (2) + 9 digits. */
const BR_MOBILE_DIGITS = 11;

/** Brazilian landline with the `55` country code. */
const BR_LANDLINE_WITH_DDI_DIGITS = 12;

/** Brazilian mobile with the `55` country code. */
const BR_MOBILE_WITH_DDI_DIGITS = 13;

/**
 * Normaliza um telefone para SÓ DÍGITOS (remove `+`, espaços, parênteses, hífens). Forma canônica
 * usada para igualar o MESMO número gravado em formatos diferentes (ex.: `+5513991884678` vs
 * `5513991884678`). DEVE casar com a normalização aplicada na ingestão (`EV_PROJECTION` no SQL:
 * `regexp_replace(phone, '[^0-9]', '', 'g')`), senão a busca por telefone não encontra.
 *
 * @param raw - Telefone cru (qualquer formato). Aceita vazio/`undefined`.
 *
 * @returns Apenas os dígitos.
 */
export function normalizePhone(raw: string | null | undefined): string {
  return (raw ?? '').replace(
    /\D/g,
    '',
  );
}

/**
 * Mascara um telefone E.164 escondendo o miolo e mantendo só os 4 últimos dígitos,
 * com o DDD entre parênteses. Garante que PII não vaze em respostas/logs.
 *
 * @param e164 - Telefone em formato E.164 (ex.: `+5511987651234`). Aceita vazio/`undefined`.
 *
 * @returns Telefone mascarado: BR móvel como `+55 (11) 9****-1234`; genérico como `****-1234`;
 *          ou `****` quando há menos de 4 dígitos.
 *
 * @example
 * maskPhone('+5511987651234'); // '+55 (11) 9****-1234'
 * maskPhone('12');             // '****'
 */
export function maskPhone(e164: string | null | undefined): string {
  const digits = (e164 ?? '').replace(
    /\D/g,
    '',
  );

  if (digits.length < VISIBLE_TAIL_DIGITS) {
    return '****';
  }

  const last4 = digits.slice(-VISIBLE_TAIL_DIGITS);

  // BR com DDI (55 + DDD + 8/9 = 12/13 dígitos) ou SEM (DDD + 8/9 = 10/11 — ex.: SMS Flash grava sem
  // o 55). Extrai o "local" (DDD + número) e mascara mantendo o DDD, p/ casar com o formato do revelado.
  const local = digits.startsWith('55')
    && (digits.length === BR_LANDLINE_WITH_DDI_DIGITS || digits.length === BR_MOBILE_WITH_DDI_DIGITS)
    ? digits.slice(2)
    : digits;

  if (local.length === BR_MOBILE_DIGITS) {
    return `+55 (${local.slice(
      0,
      2,
    )}) 9****-${last4}`;
  }

  if (local.length === BR_LANDLINE_DIGITS) {
    return `+55 (${local.slice(
      0,
      2,
    )}) ****-${last4}`;
  }

  return `****-${last4}`;
}
