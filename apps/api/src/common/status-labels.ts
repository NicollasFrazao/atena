/**
 * Rótulo PT-BR canônico das categorias de erro/status (o `error_hint`/`SmsStatusField` do detailed
 * report). ESPELHA o mapa do front (`apps/web/src/rules/rule-labels.ts`) — mantê-los iguais é o que
 * padroniza os nomes em toda a UI. Usado na borda do chat para o LLM CITAR nomes legíveis (ex.:
 * "erro genérico") em vez do código cru ("generic_error"). Fallback: o próprio valor cru.
 */
const CATEGORY_LABEL: Record<string, string> = {
  delivered: 'entregue',
  invalid_number: 'número inválido',
  policy_block: 'bloqueio por política',
  carrier_rejected: 'rejeição do operador',
  generic_error: 'erro genérico',
  unreachable: 'inalcançável',
  bounce: 'bounce',
  opt_out: 'opt-out',
  insufficient_credits: 'créditos insuficientes',
  unknown_error: 'erro desconhecido',
  config_error: 'erro de configuração',
  request_error: 'erro de requisição',
};

/**
 * Rótulo PT-BR padronizado de uma categoria de erro/status; cai no valor cru se não mapeada.
 *
 * @param {string} category - Categoria crua (`error_hint`/`SmsStatusField`, ex.: `generic_error`).
 * @returns {string} Rótulo legível (ex.: `erro genérico`).
 */
export function categoryLabel(category: string): string {
  return CATEGORY_LABEL[category] ?? category;
}

/** Rótulo PT-BR dos status de CICLO DE VIDA (não-terminais); os terminais usam {@link categoryLabel}. */
const LIFECYCLE_LABEL: Record<string, string> = {
  queued: 'enfileirado',
  // `sent` = o FORNECEDOR despachou a mensagem adiante (à operadora) — o status já É do fornecedor,
  // então NÃO é "enviado ao fornecedor" (direção invertida); é o fornecedor enviando à operadora.
  sent: 'enviado à operadora',
  in_progress: 'em trânsito',
};

/**
 * Rótulo PT-BR de qualquer status de mensagem para EXIBIÇÃO (trilha): ciclo de vida
 * (`queued`/`sent`/`in_progress`) tem rótulo próprio; o resto cai no {@link categoryLabel}
 * (`delivered` → "entregue", `generic_error` → "erro genérico", …). Fallback: o valor cru.
 *
 * @param {string} status - Status cru do detailed report (ex.: `queued`, `generic_error`).
 * @returns {string} Rótulo legível (ex.: `enfileirado`, `erro genérico`).
 */
export function statusDisplayLabel(status: string): string {
  return LIFECYCLE_LABEL[status] ?? categoryLabel(status);
}
