import type {
  RiskAnalysisInterface,
  RiskCategoryInterface,
  RiskVerdictType,
} from '@atena/types';

/**
 * Sinal de risco heurístico: nome da categoria, peso e padrão que o detecta.
 *
 * @property {string} name - Nome da categoria de risco exibida no resultado.
 * @property {number} strength - Peso/intensidade do sinal em `[0, 1]`.
 * @property {RegExp} pattern - Padrão (case-insensitive) que dispara o sinal no texto.
 */
interface RiskSignalInterface {
  name: string;
  strength: number;
  pattern: RegExp;
}

/**
 * Catálogo determinístico de sinais de risco da Fase 1.
 *
 * @remarks Stand-in de um modelo de risco real (tech-debt): sem ML nem serviço
 * externo, apenas heurística por padrões textuais. Ver `.context/docs/tech-debt.md`.
 */
const RISK_SIGNALS: readonly RiskSignalInterface[] = [
  {
    name: 'Solicitação de dados sensíveis',
    strength: 0.86,
    pattern: /\b(senha|c[óo]digo de seguran|cvv|cart[ãa]o de cr[ée]dito|cpf|confirme seus dados|pix)\b/i,
  },
  {
    name: 'Urgência financeira',
    strength: 0.81,
    pattern: /\b(fatura|vence|vencimento|d[ée]bito|d[ií]vida|regularize|pagamento pendente|saldo|cobran[çc]a)\b/i,
  },
  {
    name: 'Link encurtado',
    strength: 0.68,
    pattern: /\b[a-z0-9-]+\.(?:app|ly|gl|me|link|short|cc|xyz)\/[a-z0-9/_-]+/i,
  },
  {
    name: 'Pedido de ação imediata',
    strength: 0.55,
    pattern: /\b(agora|imediat|urgent|hoje mesmo|amanh[ãa]|[úu]ltima chance|evitar (?:restri|bloqueio|suspens))/i,
  },
];

/**
 * Deriva o veredito de risco a partir do score, por faixas: `>= 0.7` → `high`,
 * `[0.4, 0.7)` → `medium`, `< 0.4` → `low`.
 *
 * @param {number} score - Maior intensidade entre os sinais detectados (`[0, 1]`).
 * @returns {RiskVerdictType} Veredito de risco.
 */
function verdictFromScore(score: number): RiskVerdictType {
  if (score >= 0.7) {
    return 'high';
  }

  if (score >= 0.4) {
    return 'medium';
  }

  return 'low';
}

/**
 * Analisa o risco de um texto de envio de forma determinística
 * (tool `analyze_shipping_content`, §C.3).
 *
 * Cruza o texto com {@link RISK_SIGNALS}; cada sinal casado vira uma categoria.
 * O `score` é o maior `strength` entre os sinais detectados (0 se nenhum), e o
 * `verdict` é derivado por faixas: `< 0.4` → `low`, `[0.4, 0.7)` → `medium`,
 * `>= 0.7` → `high`. Não chama LLM nem serviço externo (princípio: não fabricar dados).
 *
 * @param {string} text - Texto do envio a analisar.
 * @returns {RiskAnalysisInterface} Score, veredito, categorias (ordenadas por `strength` desc) e explicação.
 */
export function analyzeRisk(text: string): RiskAnalysisInterface {
  const categories: RiskCategoryInterface[] = RISK_SIGNALS
    .filter((signal) => signal.pattern.test(text))
    .map((signal) => ({
      name: signal.name,
      strength: signal.strength,
    }))
    .sort((
      left,
      right,
    ) => right.strength - left.strength);

  const top = categories[0];

  const score = top
    ? top.strength
    : 0;

  const verdict = verdictFromScore(score);

  const explanation = categories.length
    ? `Análise determinística (Fase 1): sinais detectados — ${categories.map((category) => category.name.toLowerCase()).join(', ')}. Veredito "${verdict}" derivado da maior intensidade (${score}).`
    : 'Análise determinística (Fase 1): nenhum sinal de risco relevante detectado no conteúdo.';

  return {
    score,
    verdict,
    categories,
    explanation,
  };
}
