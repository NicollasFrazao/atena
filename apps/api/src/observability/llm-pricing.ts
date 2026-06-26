/** Preço de um modelo, em USD por 1.000 tokens. */
interface ModelPriceInterface {
  inputPer1k: number;
  outputPer1k: number;
}

/**
 * Tabela de preço por id de modelo (USD / 1k tokens). Aproximada — base do `cost` da
 * observabilidade a partir do `usage` persistido nas mensagens.
 *
 * @todo (pricing) revisar contra a tabela oficial do provedor (Bedrock) e versionar por data.
 */
const MODEL_PRICES: Record<string, ModelPriceInterface> = {
  // Amazon Nova (Bedrock, on-demand).
  'amazon.nova-pro-v1:0': {
    inputPer1k: 0.0008,
    outputPer1k: 0.0032,
  },
  'amazon.nova-lite-v1:0': {
    inputPer1k: 0.00006,
    outputPer1k: 0.00024,
  },
  'amazon.nova-micro-v1:0': {
    inputPer1k: 0.000035,
    outputPer1k: 0.00014,
  },
};

/** Remove o prefixo de inference profile (`us.`/`eu.`/`apac.`/`global.`) p/ casar a tabela de preço. */
function baseModelId(modelId: string): string {
  return modelId.replace(
    /^(?:us|eu|apac|global)\./,
    '',
  );
}

/**
 * Custo estimado (USD) para um total de tokens de um modelo; `null` se o modelo não tem preço.
 * Normaliza o prefixo de inference profile (ex.: `us.amazon.nova-pro-v1:0` → `amazon.nova-pro-v1:0`).
 *
 * @param {string | undefined} modelId - Id do modelo (ex.: `BEDROCK_MODEL_ID`, com ou sem profile).
 * @param {number} inputTokens - Total de tokens de entrada.
 * @param {number} outputTokens - Total de tokens de saída.
 *
 * @returns {number | null} Custo em USD (4 casas), ou `null` se o modelo não tem preço.
 */
export function estimateCostUsd(
  modelId: string | undefined,
  inputTokens: number,
  outputTokens: number,
): number | null {
  const price = modelId
    ? MODEL_PRICES[baseModelId(modelId)]
    : undefined;

  if (!price) {
    return null;
  }

  const cost = (inputTokens / 1_000) * price.inputPer1k
    + (outputTokens / 1_000) * price.outputPer1k;

  return Math.round(cost * 10_000) / 10_000;
}
