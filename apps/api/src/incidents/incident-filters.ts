import type { DimensionType, IncidentSeverityType, IncidentStatusType } from '@atena/types';

/** Valores aceitos de cada filtro (espelham os enums do contrato). */
const VALID_STATUSES: IncidentStatusType[] = [
  'detected',
  'acknowledged',
  'resolved',
  'auto_resolved',
];

const VALID_SEVERITIES: IncidentSeverityType[] = [
  'critical',
  'warning',
  'info',
];

const VALID_DIMENSIONS: DimensionType[] = [
  'provider',
  'customer',
  'route',
  'global',
];

/**
 * "aberto"/"open" NÃO é um status do enum — é o conjunto dos que ainda não fecharam
 * (`detected` + `acknowledged`). É o termo natural do usuário/LLM ("incidentes abertos"),
 * então o traduzimos aqui em vez de deixar vazar pro Prisma (que estouraria com erro de enum).
 */
const STATUS_ALIASES: Record<string, IncidentStatusType[]> = {
  open: [
    'detected',
    'acknowledged',
  ],
  aberto: [
    'detected',
    'acknowledged',
  ],
  abertos: [
    'detected',
    'acknowledged',
  ],
};

/** Quebra um CSV em tokens normalizados (trim + minúsculas, sem vazios). */
function tokens(csv: string): string[] {
  return csv
    .split(',')
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Normaliza o filtro de status: expande aliases (`open`→`detected,acknowledged`), mantém apenas
 * valores válidos do enum e descarta o resto. NUNCA devolve valor inválido — assim o Prisma recebe
 * só enums reais (um valor inválido estouraria com 500). Lista vazia ⇒ o chamador filtra por "nada".
 *
 * @param {string} csv - Valor cru do filtro (1+ valores separados por vírgula).
 * @returns {IncidentStatusType[]} Status válidos, deduplicados.
 */
export function normalizeStatuses(csv: string): IncidentStatusType[] {
  const out = new Set<IncidentStatusType>();

  for (const token of tokens(csv)) {
    const alias = STATUS_ALIASES[token];

    if (alias) {
      alias.forEach((status) => out.add(status));

      continue;
    }

    if ((VALID_STATUSES as string[]).includes(token)) {
      out.add(token as IncidentStatusType);
    }
  }

  return [...out];
}

/**
 * Normaliza o filtro de severidade (CSV) mantendo só valores válidos do enum.
 *
 * @param {string} csv - Valor cru do filtro.
 * @returns {IncidentSeverityType[]} Severidades válidas, deduplicadas.
 */
export function normalizeSeverities(csv: string): IncidentSeverityType[] {
  const out = new Set<IncidentSeverityType>();

  for (const token of tokens(csv)) {
    if ((VALID_SEVERITIES as string[]).includes(token)) {
      out.add(token as IncidentSeverityType);
    }
  }

  return [...out];
}

/**
 * Normaliza o filtro de dimensão (CSV) mantendo só valores válidos do enum.
 *
 * @param {string} csv - Valor cru do filtro.
 * @returns {DimensionType[]} Dimensões válidas, deduplicadas.
 */
export function normalizeDimensions(csv: string): DimensionType[] {
  const out = new Set<DimensionType>();

  for (const token of tokens(csv)) {
    if ((VALID_DIMENSIONS as string[]).includes(token)) {
      out.add(token as DimensionType);
    }
  }

  return [...out];
}
