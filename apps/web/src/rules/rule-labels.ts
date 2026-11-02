import type {
  AnomalyRuleInterface,
  DimensionType,
  RuleType,
} from '@atena/types';

/** Rótulo PT-BR por dimensão de agregação. */
export const DIMENSION_LABEL: Record<DimensionType, string> = {
  provider: 'Por fornecedor',
  customer: 'Por cliente',
  route: 'Por rota',
  global: 'Global',
};

/** Rótulo PT-BR por tipo de regra (imutável na edição). */
export const RULE_TYPE_LABEL: Record<RuleType, string> = {
  delivery_rate_drop: 'Queda de taxa de entrega',
  failure_spike: 'Spike de falhas',
  consistent_error: 'Erro consistente do fornecedor',
  webhook_silence: 'Silêncio de webhook',
};

/** Descrição PT-BR do que cada tipo de regra detecta (mecanismo); o nome da regra dá o alvo específico. */
const RULE_TYPE_DESCRIPTION: Record<RuleType, string> = {
  delivery_rate_drop: 'Dispara quando a taxa de entrega da dimensão cai vários desvios-padrão (σ) abaixo do baseline histórico dela.',
  failure_spike: 'Dispara quando a taxa de falha sobe vários desvios-padrão (σ) acima do baseline histórico (pico de falha vs. histórico).',
  consistent_error: 'Dispara quando a fração de um tipo de erro entre as falhas ultrapassa o limiar (%) na janela.',
  webhook_silence: 'Dispara quando um provedor para de enviar callbacks de status por mais que o limiar (min), apesar de volume esperado.',
};

/**
 * Rótulo PT-BR canônico das categorias de erro/status (o `failure_reason`/`SmsStatusField` do
 * detailed report). FONTE ÚNICA — usado nas descrições de regra E no `top_errors` do relatório,
 * para os nomes ficarem padronizados em toda a UI. Fallback: o próprio valor cru.
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
 * @param category - Categoria crua (`error_hint`/`SmsStatusField`, ex.: `insufficient_credits`).
 *
 * @returns Rótulo legível (ex.: `créditos insuficientes`).
 */
export function categoryLabel(category: string): string {
  return CATEGORY_LABEL[category] ?? category;
}

/**
 * Descrição da regra para exibição: para `consistent_error`, inclui a CATEGORIA-alvo usada como
 * parâmetro (ex.: "número inválido"); para os demais tipos, a descrição do tipo.
 *
 * @param rule - Regra (tipo + categoria).
 *
 * @returns Descrição legível.
 */
export function ruleDescription(rule: AnomalyRuleInterface): string {
  if (
    rule.rule_type === 'consistent_error'
    && rule.category
  ) {
    return `Dispara quando a fração de '${categoryLabel(rule.category)}' entre as falhas ultrapassa o limiar (${formatThreshold(rule)}) na janela.`;
  }

  return RULE_TYPE_DESCRIPTION[rule.rule_type];
}

/** Dimensões selecionáveis (ordem de exibição). */
export const DIMENSIONS: DimensionType[] = [
  'provider',
  'customer',
  'route',
  'global',
];

/**
 * Formata o limiar com sua unidade: `95%`, `3σ`, `15 min`.
 *
 * @param rule - Regra (valor + unidade do limiar).
 *
 * @returns Limiar formatado.
 */
export function formatThreshold(rule: AnomalyRuleInterface): string {
  return rule.threshold_unit === 'min'
    ? `${rule.threshold} min`
    : `${rule.threshold}${rule.threshold_unit}`;
}
