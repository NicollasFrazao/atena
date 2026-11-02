/**
 * Seed de DEV — popula o dado da APLICAÇÃO (regras de anomalia + incidentes ativos/resolvidos).
 * O dado de ENTREGA (mensagens) NÃO é mais semeado: vem do S3 sob demanda via AuditQueryService.
 * NÃO usar em produção. Rode com: `npm run seed` (ou `prisma db seed`).
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Rule ids referenced by the rules and by the seeded incidents.
const RULE_DELIVERY_DROP_CUSTOMER = 'r-delivery-drop-customer';
const RULE_POLICY_BLOCK_SPIKE = 'r-policy-block-spike';
const RULE_FAILURE_SPIKE = 'r-failure-spike';

// Fase 2 — regras de anomalia (defaults de .context/docs/anomaly-scenarios.md).
const RULES = [
  {
    id: RULE_DELIVERY_DROP_CUSTOMER,
    name: 'Queda de entrega por cliente',
    ruleType: 'delivery_rate_drop',
    dimension: 'customer',
    severity: 'critical',
    threshold: 3,
    thresholdUnit: 'σ',
    windowMinutes: 15,
    category: undefined as string | undefined,
  },
  // delivery_rate_drop também por PROVEDOR (degradação provider-wide; o detector agrupa pela dimensão).
  {
    id: 'r-delivery-drop-provider',
    name: 'Queda de entrega por provedor',
    ruleType: 'delivery_rate_drop',
    dimension: 'provider',
    severity: 'critical',
    threshold: 4,
    thresholdUnit: 'σ',
    windowMinutes: 15,
    category: undefined as string | undefined,
  },
  // consistent_error escopado por CATEGORIA (mede a categoria-alvo, não a dominante).
  {
    id: RULE_POLICY_BLOCK_SPIKE,
    name: 'Spike de bloqueio por política',
    ruleType: 'consistent_error',
    dimension: 'customer',
    severity: 'warning',
    threshold: 30,
    thresholdUnit: '%',
    windowMinutes: 15,
    category: 'policy_block',
  },
  {
    id: 'r-invalid-number-spike',
    name: 'Spike de número inválido',
    ruleType: 'consistent_error',
    dimension: 'customer',
    severity: 'warning',
    threshold: 25,
    thresholdUnit: '%',
    windowMinutes: 30,
    category: 'invalid_number',
  },
  // créditos insuficientes (conta sem saldo) concentrados num cliente — halt de entrega por billing.
  {
    id: 'r-insufficient-credits-spike',
    name: 'Spike de créditos insuficientes',
    ruleType: 'consistent_error',
    dimension: 'customer',
    severity: 'critical',
    threshold: 30,
    thresholdUnit: '%',
    windowMinutes: 15,
    category: 'insufficient_credits',
  },
  // failure_spike agora é BASELINE-RELATIVO (σ vs. histórico do cliente), não piso absoluto em %.
  {
    id: RULE_FAILURE_SPIKE,
    name: 'Pico de falha (vs baseline)',
    ruleType: 'failure_spike',
    dimension: 'customer',
    severity: 'critical',
    threshold: 4,
    thresholdUnit: 'σ',
    windowMinutes: 15,
    category: undefined as string | undefined,
  },
  // webhook_silence já é provider-agnostic (avalia cada provedor das amostras); nome genérico.
  {
    id: 'r-webhook-silence-provider',
    name: 'Silêncio de callbacks (por provedor)',
    ruleType: 'webhook_silence',
    dimension: 'provider',
    severity: 'critical',
    threshold: 15,
    thresholdUnit: 'min',
    windowMinutes: 15,
    category: undefined as string | undefined,
  },
];

// Incidentes ativos (espelham MOCK.incidents do protótipo). detectionPayload guarda o display (rule/window/summary/metrics/relatedShippings).
const ACTIVE_INCIDENTS = [
  {
    id: 'INC-2401',
    ruleId: RULE_DELIVERY_DROP_CUSTOMER,
    severity: 'critical',
    status: 'detected',
    dimensionType: 'provider',
    dimensionValue: 'Twilio',
    detectedAt: '2026-05-28T14:02:00Z',
    acknowledgedBy: null,
    payload: {
      rule: 'Queda de taxa de entrega — Twilio',
      window: '14:02 → agora (4 min)',
      summary: 'Taxa de entrega do fornecedor Twilio caiu de 97% (baseline) para 87% nos últimos 4 minutos. Picos de erro INSUFFICIENT_BALANCE coincidem com o início da janela.',
      metrics: {
        baseline: '97.0%',
        current: '87.1%',
        threshold: '< 95%',
        sample: '2.4k tentativas',
      },
      relatedShippings: 184,
    },
  },
  {
    id: 'INC-2400',
    ruleId: 'r-webhook-silence-provider',
    severity: 'warning',
    status: 'acknowledged',
    dimensionType: 'provider',
    dimensionValue: 'Sinch',
    detectedAt: '2026-05-28T13:44:00Z',
    acknowledgedBy: 'Rafael S.',
    payload: {
      rule: 'Silêncio de webhook — Sinch',
      window: '13:44 → agora (22 min)',
      summary: 'Nenhum webhook de status recebido da Sinch há 22 minutos enquanto o volume esperado nesta janela é > 0.',
      metrics: {
        baseline: '~140/min',
        current: '0/min',
        threshold: '> 5 min',
        sample: 'janela 22 min',
      },
      relatedShippings: 47,
    },
  },
  {
    id: 'INC-2398',
    ruleId: RULE_POLICY_BLOCK_SPIKE,
    severity: 'info',
    status: 'acknowledged',
    dimensionType: 'provider',
    dimensionValue: 'Twilio',
    detectedAt: '2026-05-28T12:54:00Z',
    acknowledgedBy: 'Joana M.',
    payload: {
      rule: 'Erro consistente do fornecedor — CARRIER_REJECTED',
      window: '12:54 → 13:30 (36 min)',
      summary: 'CARRIER_REJECTED em 8% das tentativas da rota Vivo-MG. Volume baixo, sem impacto cliente identificado ainda.',
      metrics: {
        baseline: '< 1%',
        current: '8.0%',
        threshold: '> 5%',
        sample: '912 tentativas',
      },
      relatedShippings: 73,
    },
  },
];

// Incidentes resolvidos (para o relatório §C.6). detectionPayload guarda rule/duration.
const RESOLVED_INCIDENTS = [
  {
    id: 'INC-2395',
    ruleId: RULE_FAILURE_SPIKE,
    severity: 'warning',
    dimensionType: 'customer',
    dimensionValue: 'CreditBank',
    detectedAt: '2026-05-28T09:30:00Z',
    resolvedAt: '2026-05-28T10:08:00Z',
    resolvedBy: 'Joana M.',
    actionCategory: 'provider_escalated',
    escalatedTo: 'Twilio (suporte) — ticket #91188',
    payload: {
      rule: 'Spike de falhas — CreditBank',
      duration: '38m',
    },
  },
  {
    id: 'INC-2391',
    ruleId: RULE_DELIVERY_DROP_CUSTOMER,
    severity: 'critical',
    dimensionType: 'provider',
    dimensionValue: 'Zenvia',
    detectedAt: '2026-05-28T07:00:00Z',
    resolvedAt: '2026-05-28T07:12:00Z',
    resolvedBy: 'Rafael S.',
    actionCategory: 'provider_recovered',
    escalatedTo: null,
    payload: {
      rule: 'Queda de taxa — Zenvia',
      duration: '12m',
    },
  },
  {
    id: 'INC-2386',
    ruleId: RULE_POLICY_BLOCK_SPIKE,
    severity: 'info',
    dimensionType: 'provider',
    dimensionValue: 'Plivo',
    detectedAt: '2026-05-28T02:00:00Z',
    resolvedAt: '2026-05-28T02:06:00Z',
    resolvedBy: 'Joana M.',
    actionCategory: 'false_positive',
    escalatedTo: null,
    payload: {
      rule: 'Erro consistente — Plivo',
      duration: '6m',
    },
  },
];

async function main(): Promise<void> {
  await prisma.incidentActivity.deleteMany();
  await prisma.incident.deleteMany();
  await prisma.anomalyRule.deleteMany();

  await prisma.anomalyRule.createMany({
    data: RULES.map((rule) => ({
      id: rule.id,
      name: rule.name,
      ruleType: rule.ruleType as never,
      dimension: rule.dimension as never,
      severity: rule.severity as never,
      threshold: rule.threshold,
      thresholdUnit: rule.thresholdUnit,
      windowMinutes: rule.windowMinutes,
      category: rule.category ?? null,
      // `r-failure-spike` nasce DESATIVADA: é redundante com `delivery_rate_drop` (cliente) — como
      // ambas usam só terminais no denominador, taxa_falha = 1 − taxa_entrega, então o pico de falha
      // dispara EXATAMENTE junto com a queda de entrega (mesmo valor/σ/threshold), duplicando o
      // incidente. Mantida no catálogo (re-ativável via /admin), mas desligada por padrão.
      enabled: rule.id !== RULE_FAILURE_SPIKE,
    })),
  });

  for (const inc of ACTIVE_INCIDENTS) {
    const at = new Date(inc.detectedAt);

    await prisma.incident.create({
      data: {
        id: inc.id,
        ruleId: inc.ruleId,
        severity: inc.severity as never,
        status: inc.status as never,
        dimensionType: inc.dimensionType as never,
        dimensionValue: inc.dimensionValue,
        detectionWindowStart: at,
        detectionWindowEnd: at,
        detectionPayload: inc.payload,
        detectedAt: at,
        acknowledgedAt: inc.acknowledgedBy
          ? at
          : null,
        acknowledgedBy: inc.acknowledgedBy,
      },
    });
  }

  for (const inc of RESOLVED_INCIDENTS) {
    await prisma.incident.create({
      data: {
        id: inc.id,
        ruleId: inc.ruleId,
        severity: inc.severity as never,
        status: 'resolved' as never,
        dimensionType: inc.dimensionType as never,
        dimensionValue: inc.dimensionValue,
        detectionWindowStart: new Date(inc.detectedAt),
        detectionWindowEnd: new Date(inc.resolvedAt),
        detectionPayload: inc.payload,
        detectedAt: new Date(inc.detectedAt),
        resolvedAt: new Date(inc.resolvedAt),
        resolvedBy: inc.resolvedBy,
        actionCategory: inc.actionCategory as never,
        actionDescription: `Resolvido (${inc.payload.duration}): ${inc.payload.rule}`,
        escalatedTo: inc.escalatedTo,
      },
    });
  }

  const incidents = await prisma.incident.count();
  console.log(`[seed] ${RULES.length} regras + ${incidents} incidentes inseridos (mensagens vêm do S3).`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err: unknown) => {
    console.error(
      '[seed] erro:',
      err,
    );

    await prisma.$disconnect();
    process.exit(1);
  });
