import { Inject, Injectable } from '@nestjs/common';
import type {
  ObservabilityInterface,
  ToolUsageStatInterface,
} from '@atena/types';
import { AUDIT_QUERY, type AuditQueryServiceInterface } from '../audit-query/audit-query.interface';
import {
  DAYS_PER_WEEK,
  HOURS_PER_DAY,
  HUNDRED_PERCENT,
  MS_PER_HOUR,
  MS_PER_SECOND,
  SECONDS_PER_HOUR,
  SECONDS_PER_MINUTE,
} from '../common/units';
import { LLM_PROVIDER, type LlmProviderInterface } from '../llm/llm-provider.interface';
import { PrismaService } from '../prisma/prisma.service';
import { SupportGateway } from '../realtime/support.gateway';
import { estimateCostUsd } from './llm-pricing';

/** Prefixo do `resource` de auditoria das tools executadas pelo orquestrador. */
const TOOL_RESOURCE_PREFIX = 'orchestrator:';

/** Days of the `30d` window — also the scan-stats window of `all` (persisted retention ceiling). */
const MONTH_WINDOW_DAYS = 30;

/** Hours of the `30d` window. */
const MONTH_WINDOW_HOURS = HOURS_PER_DAY * MONTH_WINDOW_DAYS;

/** Percentiles reported per tool latency (p50/p95/p99). */
const PERCENTILE_50 = 50;
const PERCENTILE_95 = 95;
const PERCENTILE_99 = 99;

/**
 * Janelas temporais da tela de observabilidade: horas (`null` = acumulado/sem recorte) + rótulo
 * exibido em `period`. As métricas DB são recortadas pela janela; o WebSocket é sempre ao vivo.
 */
const OBSERVABILITY_WINDOWS: Record<string, {
  hours: number | null;
  label: string
}> = {
  '24h': {
    hours: HOURS_PER_DAY,
    label: 'Últimas 24h',
  },
  '7d': {
    hours: HOURS_PER_DAY * DAYS_PER_WEEK,
    label: 'Últimos 7 dias',
  },
  '30d': {
    hours: MONTH_WINDOW_HOURS,
    label: 'Últimos 30 dias',
  },
  all: {
    hours: null,
    label: 'Acumulado',
  },
};

/** Acumulado por tool durante a agregação. */
interface ToolAccInterface {
  calls: number;
  errors: number;
  latencies: number[];
}

/** Linha de audit log de tool relevante para a agregação. */
interface ToolAuditRowInterface {
  resource: string;
  detail: string | null;
  metadata: unknown;
}

/** Incidente recortado para o cálculo de MTTA. */
interface AckIncidentRowInterface {
  detectedAt: Date;
  acknowledgedAt: Date | null;
}

/** Mensagem de chat recortada (`content` + `createdAt`) para recusas, tokens e buckets por hora. */
interface ChatContentRowInterface {
  content: unknown;
  createdAt?: Date;
}

/** Resumo de recusas: total e quebra por motivo. */
interface RefusalsSummaryInterface {
  total: number;
  by_reason: {
    reason: string;
    count: number
  }[];
}

/** Formata uma duração (ms) como `Xh Ym` / `Xm Ys` / `Xs` legível. */
function formatDurationMs(durationMs: number): string {
  const totalSeconds = Math.round(durationMs / MS_PER_SECOND);
  const hours = Math.floor(totalSeconds / SECONDS_PER_HOUR);
  const minutes = Math.floor((totalSeconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const seconds = totalSeconds % SECONDS_PER_MINUTE;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

/**
 * Observabilidade básica do assistente (Fase 2, task 2.8): `GET /api/observability`.
 *
 * Reusa o que já é persistido — `audit_log` (tools/reveals) e `chat_sessions` —
 * e a contagem de conexões do {@link SupportGateway}. Custo/tokens/MTTA e percentis
 * de latência ficam `@todo` (OpenTelemetry/Prometheus) e saem como `null`/vazios.
 *
 * @see PrismaService - leitura do audit log e das sessões.
 * @see SupportGateway - conexões ativas do WebSocket.
 */
@Injectable()
export class ObservabilityService {
  /**
   * @param prisma - Acesso ao audit log e às sessões de chat.
   * @param realtime - Gateway WS (conexões ativas).
   * @param audit - Motor de auditoria (custo de leitura do S3).
   * @param llm - Provider LLM ativo (rótulo provider/modelo).
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: SupportGateway,
    @Inject(AUDIT_QUERY) private readonly audit: AuditQueryServiceInterface,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProviderInterface,
  ) {}

  /**
   * Monta o snapshot de métricas básicas do assistente, recortado por uma JANELA temporal.
   *
   * @param [window] - Janela (`24h`/`7d`/`30d`/`all`; default `all` = acumulado).
   *
   * @returns Métricas agregadas (snake_case) da janela.
   */
  async snapshot(window = 'all'): Promise<ObservabilityInterface> {
    const resolved = OBSERVABILITY_WINDOWS[window] ?? OBSERVABILITY_WINDOWS.all;

    const since = resolved.hours === null
      ? null
      : new Date(Date.now() - resolved.hours * MS_PER_HOUR);

    // Recorte temporal por campo de data de cada fonte; `undefined` (sem janela) = acumulado.
    const occurredGte = since
      ? { occurredAt: { gte: since } }
      : {};

    const startedGte = since
      ? { startedAt: { gte: since } }
      : {};

    const createdGte = since
      ? { createdAt: { gte: since } }
      : {};

    const [
      sessionRows,
      reveals,
      toolRows,
      ackIncidents,
      assistantMessages,
    ] = await Promise.all([
      this.prisma.chatSession.findMany({
        where: startedGte,
        select: {
          startedAt: true,
          lastActivity: true,
        },
      }),
      this.prisma.auditLog.count({
        where: {
          action: {
            in: [
              'reveal_phone',
              'reveal_content',
            ] as never,
          },
          ...occurredGte,
        },
      }),
      this.prisma.auditLog.findMany({
        where: {
          action: 'tool_call' as never,
          ...occurredGte,
        },
        select: {
          resource: true,
          detail: true,
          metadata: true,
        },
      }),
      this.prisma.incident.findMany({
        where: {
          acknowledgedAt: since
            ? { gte: since }
            : { not: null },
        },
        select: {
          detectedAt: true,
          acknowledgedAt: true,
        },
      }),
      this.prisma.chatMessage.findMany({
        where: {
          role: 'assistant' as never,
          ...createdGte,
        },
        select: {
          content: true,
          createdAt: true,
        },
      }),
    ]);

    const usage = this.aggregateTokens(assistantMessages);
    // Janela do scan: 'all' usa 30d (teto da retenção persistida).
    const auditScan = await this.audit.scanStats(resolved.hours ?? MONTH_WINDOW_HOURS);

    return {
      period: resolved.label,
      overview: {
        sessions: sessionRows.length,
        reveals,
        tokens: usage.tokens,
        cost: usage.cost,
        mtta: this.meanTimeToAck(ackIncidents),
        avg_session_ms: this.avgSessionMs(sessionRows),
      },
      tokens_hourly: this.tokensHourly(assistantMessages),
      tools: this.aggregateTools(toolRows),
      refusals: this.aggregateRefusals(assistantMessages),
      websocket: {
        connected: this.realtime.connectionCount(),
        peak: this.realtime.peakConnections(),
      },
      llm: this.llm.describe(),
      audit_scan: auditScan,
    };
  }

  /**
   * Agrega o audit log de tools por nome: chamadas, erros e latência média.
   *
   * @param rows - Linhas de `tool_call` do audit log.
   *
   * @returns Uso por tool, ordenado por chamadas (desc).
   */
  private aggregateTools(rows: ToolAuditRowInterface[]): ToolUsageStatInterface[] {
    const byTool = new Map<string, ToolAccInterface>();

    for (const row of rows) {
      // Só as tools do ASSISTENTE (prefixo do orquestrador, que registra latência); rotas HTTP
      // auditadas como `tool_call` (ex.: GET /api/incidents do polling) ficam de fora do painel.
      if (!row.resource.startsWith(TOOL_RESOURCE_PREFIX)) {
        continue;
      }

      const name = row.resource.slice(TOOL_RESOURCE_PREFIX.length);

      const acc = byTool.get(name) ?? {
        calls: 0,
        errors: 0,
        latencies: [],
      };

      acc.calls++;

      if (row.detail === 'tool_error') {
        acc.errors++;
      }

      const latency = (row.metadata as { latency_ms?: number } | null)?.latency_ms;

      if (typeof latency === 'number') {
        acc.latencies.push(latency);
      }

      byTool.set(
        name,
        acc,
      );
    }

    return [...byTool.entries()]
      .map(([
        name,
        acc,
      ]) => ({
        name,
        calls: acc.calls,
        errors: acc.errors,
        avg_latency_ms: this.average(acc.latencies),
        p50_ms: this.percentile(
          acc.latencies,
          PERCENTILE_50,
        ),
        p95_ms: this.percentile(
          acc.latencies,
          PERCENTILE_95,
        ),
        p99_ms: this.percentile(
          acc.latencies,
          PERCENTILE_99,
        ),
      }))
      .sort((
        left,
        right,
      ) => right.calls - left.calls);
  }

  /** Média inteira de latências, ou `null` se não houver amostra. */
  private average(values: number[]): number | null {
    if (values.length === 0) {
      return null;
    }

    const sum = values.reduce(
      (
        acc,
        value,
      ) => acc + value,
      0,
    );

    return Math.round(sum / values.length);
  }

  /**
   * Percentil `pct` (0–100) inteiro de uma lista de latências (nearest-rank), ou `null` se vazia.
   *
   * @param values - Latências (ms).
   * @param pct - Percentil desejado (ex.: 95).
   *
   * @returns Valor do percentil (ms), ou `null`.
   */
  private percentile(
    values: number[],
    pct: number,
  ): number | null {
    if (values.length === 0) {
      return null;
    }

    const sorted = [...values].sort((
      left,
      right,
    ) => left - right);

    const rank = Math.ceil((pct / HUNDRED_PERCENT) * sorted.length) - 1;

    const index = Math.min(
      sorted.length - 1,
      Math.max(
        0,
        rank,
      ),
    );

    return Math.round(sorted[index]);
  }

  /**
   * MTTA: tempo médio detecção→reconhecimento sobre incidentes já reconhecidos.
   *
   * @param incidents - Incidentes com `acknowledgedAt` preenchido.
   *
   * @returns Duração média legível, ou `null` se nenhum foi reconhecido.
   */
  private meanTimeToAck(incidents: AckIncidentRowInterface[]): string | null {
    const deltas = incidents
      .flatMap((incident) => (incident.acknowledgedAt == null
        ? []
        : [incident.acknowledgedAt.getTime() - incident.detectedAt.getTime()]))
      .filter((deltaMs) => deltaMs >= 0);

    if (deltas.length === 0) {
      return null;
    }

    const totalMs = deltas.reduce(
      (
        acc,
        deltaMs,
      ) => acc + deltaMs,
      0,
    );

    return formatDurationMs(totalMs / deltas.length);
  }

  /**
   * Conta recusas a partir de `chat_messages.content.refusal` (persistido pelo orquestrador),
   * agrupando por `reason` (desc). Sem PII — só motivo e contagem.
   *
   * @param messages - Mensagens `assistant` (só `content`).
   *
   * @returns Total de recusas e quebra por motivo.
   */
  private aggregateRefusals(messages: ChatContentRowInterface[]): RefusalsSummaryInterface {
    const byReason = new Map<string, number>();
    let total = 0;

    for (const message of messages) {
      const content = (message.content ?? {}) as { refusal?: { reason?: string } | null };
      const refusal = content.refusal;

      if (!refusal) {
        continue;
      }

      total++;

      const reason = (refusal.reason ?? '').trim() || 'desconhecido';

      byReason.set(
        reason,
        (byReason.get(reason) ?? 0) + 1,
      );
    }

    const byReasonList = [...byReason.entries()]
      .map(([
        reason,
        count,
      ]) => ({
        reason,
        count,
      }))
      .sort((
        left,
        right,
      ) => right.count - left.count);

    return {
      total,
      by_reason: byReasonList,
    };
  }

  /**
   * Duração média de sessão (ms) — média de `lastActivity − startedAt` das sessões da janela.
   *
   * @param rows - Sessões da janela.
   *
   * @returns Duração média (ms), ou `null` se sem sessão.
   */
  private avgSessionMs(rows: {
    startedAt: Date;
    lastActivity: Date
  }[]): number | null {
    if (rows.length === 0) {
      return null;
    }

    const total = rows.reduce(
      (
        acc,
        row,
      ) => acc + Math.max(
        0,
        row.lastActivity.getTime() - row.startedAt.getTime(),
      ),
      0,
    );

    return Math.round(total / rows.length);
  }

  /**
   * Tokens consumidos por hora (buckets cronológicos UTC) na janela — base do gráfico de consumo.
   * Soma `usage` (input+output) das mensagens do assistente, agrupando pelo início da hora de `createdAt`.
   *
   * @param messages - Mensagens `assistant` (`content` + `createdAt`).
   *
   * @returns Buckets horários (ISO UTC), ordenados.
   */
  private tokensHourly(messages: ChatContentRowInterface[]): {
    at: string;
    tokens: number
  }[] {
    const byHour = new Map<string, number>();

    for (const message of messages) {
      const content = (message.content ?? {}) as {
        usage?: {
          input_tokens?: number;
          output_tokens?: number
        };
      };

      const usage = content.usage;

      if (
        !usage
        || !message.createdAt
      ) {
        continue;
      }

      const tokens = (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0);

      if (tokens === 0) {
        continue;
      }

      const at = new Date(Date.UTC(
        message.createdAt.getUTCFullYear(),
        message.createdAt.getUTCMonth(),
        message.createdAt.getUTCDate(),
        message.createdAt.getUTCHours(),
      )).toISOString();

      byHour.set(
        at,
        (byHour.get(at) ?? 0) + tokens,
      );
    }

    return [...byHour.entries()]
      .map(([
        at,
        tokens,
      ]) => ({
        at,
        tokens,
      }))
      .sort((
        left,
        right,
      ) => left.at.localeCompare(right.at));
  }

  /**
   * Soma o `usage` (tokens) das mensagens do assistente e estima o custo via {@link estimateCostUsd}.
   * `tokens`/`cost` são `null` enquanto nenhuma mensagem reporta `usage` (ex.: provider sem usage);
   * `cost` é `null` se o modelo (`BEDROCK_MODEL_ID`) não tem preço na tabela. Sem PII — só contagens.
   *
   * @param messages - Mensagens `assistant` (só `content`).
   *
   * @returns Total de tokens e custo estimado (USD).
   */
  private aggregateTokens(messages: ChatContentRowInterface[]): {
    tokens: number | null;
    cost: number | null
  } {
    let inputTokens = 0;
    let outputTokens = 0;
    let hasUsage = false;

    for (const message of messages) {
      const content = (message.content ?? {}) as {
        usage?: {
          input_tokens?: number;
          output_tokens?: number
        };
      };

      const usage = content.usage;

      if (!usage) {
        continue;
      }

      hasUsage = true;
      inputTokens += usage.input_tokens ?? 0;
      outputTokens += usage.output_tokens ?? 0;
    }

    if (!hasUsage) {
      return {
        tokens: null,
        cost: null,
      };
    }

    return {
      tokens: inputTokens + outputTokens,
      cost: estimateCostUsd(
        process.env.BEDROCK_MODEL_ID,
        inputTokens,
        outputTokens,
      ),
    };
  }
}
