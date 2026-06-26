/**
 * Utilitários de PII. Mascaramento por padrão (princípio: PII mascarada).
 * NUNCA logar/retornar o valor cru sem passar por um fluxo de reveal auditado.
 */

/**
 * Normaliza um telefone para SÓ DÍGITOS (remove `+`, espaços, parênteses, hífens). Forma canônica
 * usada para igualar o MESMO número gravado em formatos diferentes (ex.: `+5513991884678` vs
 * `5513991884678`). DEVE casar com a normalização aplicada na ingestão (`EV_PROJECTION` no SQL:
 * `regexp_replace(phone, '[^0-9]', '', 'g')`), senão a busca por telefone não encontra.
 *
 * @param {string} raw - Telefone cru (qualquer formato). Aceita vazio/`undefined`.
 * @returns {string} Apenas os dígitos.
 */
export function normalizePhone(raw: string): string {
  return (raw ?? '').replace(
    /\D/g,
    '',
  );
}

/**
 * Mascara um telefone E.164 escondendo o miolo e mantendo só os 4 últimos dígitos,
 * com o DDD entre parênteses. Garante que PII não vaze em respostas/logs.
 *
 * @param {string} e164 - Telefone em formato E.164 (ex.: `+5511987651234`). Aceita vazio/`undefined`.
 * @returns {string} Telefone mascarado: BR móvel como `+55 (11) 9****-1234`; genérico como `****-1234`;
 *          ou `****` quando há menos de 4 dígitos.
 * @example
 * maskPhone('+5511987651234'); // '+55 (11) 9****-1234'
 * maskPhone('12');             // '****'
 */
export function maskPhone(e164: string): string {
  const digits = (e164 ?? '').replace(
    /\D/g,
    '',
  );

  if (digits.length < 4) {
    return '****';
  }

  const last4 = digits.slice(-4);

  // BR com DDI (55 + DDD + 8/9 = 12/13 dígitos) ou SEM (DDD + 8/9 = 10/11 — ex.: SMS Flash grava sem
  // o 55). Extrai o "local" (DDD + número) e mascara mantendo o DDD, p/ casar com o formato do revelado.
  const local = digits.startsWith('55')
    && (digits.length === 12 || digits.length === 13)
    ? digits.slice(2)
    : digits;

  if (local.length === 11) {
    return `+55 (${local.slice(
      0,
      2,
    )}) 9****-${last4}`;
  }

  if (local.length === 10) {
    return `+55 (${local.slice(
      0,
      2,
    )}) ****-${last4}`;
  }

  return `****-${last4}`;
}
