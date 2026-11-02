import { useState, type JSX } from 'react';
import type {
  ObservabilityInterface,
  ToolUsageStatInterface,
} from '@atena/types';
import { useObservability } from '../api/observability';
import { HourlyChart } from '../chat/tool-cards/HourlyChart';
import { cssValue, cssVar, FONT_WEIGHT } from '../styles/tokens';
import {
  MS_PER_SECOND,
  PERCENT_SCALE,
  SECONDS_PER_HOUR,
  SECONDS_PER_MINUTE,
} from '../util/units';

/** Limiares de taxa de erro (%) para a saúde geral do assistente. */
const HEALTH_WARN = 2;
const HEALTH_DEGRADED = 5;

/** Janelas temporais selecionáveis na tela (valor enviado à API + rótulo). */
const WINDOW_OPTIONS: {
  value: string;
  label: string
}[] = [
  {
    value: '24h',
    label: '24h',
  },
  {
    value: '7d',
    label: '7 dias',
  },
  {
    value: '30d',
    label: '30 dias',
  },
  {
    value: 'all',
    label: 'Tudo',
  },
];

/** Values from one million on are shown in millions (`1.2M`). */
const ONE_MILLION = 1_000_000;

/** Values from one thousand on are shown in thousands (`850.9k`). */
const ONE_THOUSAND = 1000;

/** Formata um inteiro grande de forma compacta: `1.2M`, `850.9k`, `42`. */
function compact(value: number | null): string {
  if (value === null) {
    return '—';
  }

  if (value >= ONE_MILLION) {
    return `${(value / ONE_MILLION).toFixed(1)}M`;
  }

  if (value >= ONE_THOUSAND) {
    return `${(value / ONE_THOUSAND).toFixed(1)}k`;
  }

  return String(value);
}

/** Formata uma duração em ms de forma legível: `Xh Ym` / `Xm Ys` / `Xs`, ou `—` se nulo. */
function formatMs(ms: number | null): string {
  if (ms === null) {
    return '—';
  }

  const totalSeconds = Math.round(ms / MS_PER_SECOND);
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

/** Custo estimado (Bedrock cobra em USD); `—` se pendente. */
function formatCost(cost: number | null): string {
  if (cost === null) {
    return '—';
  }

  return `US$ ${cost.toFixed(2).replace(
    '.',
    ',',
  )}`;
}

/** Taxa de erro global (%) a partir das estatísticas por tool. */
function globalErrorRate(tools: ToolUsageStatInterface[]): number {
  const totals = tools.reduce(
    (
      acc,
      tool,
    ) => ({
      calls: acc.calls + tool.calls,
      errors: acc.errors + tool.errors,
    }),
    {
      calls: 0,
      errors: 0,
    },
  );

  return totals.calls === 0
    ? 0
    : (totals.errors / totals.calls) * PERCENT_SCALE;
}

/**
 * Tela de Observabilidade do assistente (`GET /observability`, admin), por JANELA temporal
 * (24h/7d/30d/Tudo): KPIs (sessões, duração média, tokens, custo, MTTA, WebSocket), latência por
 * tool (p50/p95/p99), consumo de tokens por hora, leitura do S3 e recusas (por motivo). Sem PII.
 * Detect→Notif e lag/média do WebSocket ficam de fora (sem telemetria). Atualiza a cada 30s.
 *
 * @returns A tela de observabilidade.
 */
export function ObservabilityPage(): JSX.Element {
  const [
    timeWindow,
    setTimeWindow,
  ] = useState('24h');

  const query = useObservability(timeWindow);
  const data = query.data;

  return (
    <div style={{
      maxWidth: 1200,
      margin: '0 auto',
      padding: cssVar.space32,
    }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: cssVar.space12,
        marginBottom: cssVar.space4,
      }}
      >
        <h1 style={{
          margin: 0,
          fontSize: cssVar.fs24,
          fontWeight: 600,
          color: cssVar.fg,
        }}
        >
          Observabilidade
        </h1>
        {data
          ? <HealthBadge rate={globalErrorRate(data.tools)} />
          : null}
        {data
          ? <LlmBadge llm={data.llm} />
          : null}
        <span style={{ flex: 1 }} />
        <div style={{
          display: cssValue.inlineFlex,
          gap: cssVar.space4,
          padding: 4,
          borderRadius: cssVar.radius8,
          background: cssVar.bgSoft,
          border: cssVar.borderLine,
        }}
        >
          {WINDOW_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => { setTimeWindow(option.value); }}
              style={{
                height: 28,
                padding: cssVar.paddingInline12,
                borderRadius: cssVar.radius4,
                border: 'none',
                background: timeWindow === option.value
                  ? cssVar.white
                  : 'transparent',
                color: timeWindow === option.value
                  ? cssVar.fg
                  : cssVar.fgMuted,
                fontSize: cssVar.fs14,
                fontWeight: 600,
                cursor: 'pointer',
                boxShadow: timeWindow === option.value
                  ? 'var(--at-shadow-xs, 0 1px 2px rgba(0,0,0,0.08))'
                  : 'none',
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <div style={{
        fontSize: cssVar.fs14,
        color: cssVar.fgMuted,
        marginBottom: cssVar.space24,
      }}
      >
        {data
          ? `${data.period} · saúde do próprio assistente · atualizado a cada 30s`
          : 'Carregando métricas…'}
      </div>

      {query.isError
        ? (
          <div style={{
            fontSize: cssVar.fs14,
            color: cssVar.fgMuted,
          }}
          >
            Não foi possível carregar as métricas.
          </div>
        )
        : null}

      {data
        ? (
          <>
            <S3ScanPanel
              scan={data.audit_scan}
              period={data.period}
            />

            {/* Assistente/LLM — 5 KPIs (o WebSocket tem painel próprio na coluna da direita). */}
            <div style={{
              fontSize: cssVar.fs12,
              fontWeight: 600,
              color: cssVar.fgSubtle,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              marginBottom: cssVar.space12,
            }}
            >
              Assistente (LLM · {data.period})
            </div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(5, 1fr)',
              gap: cssVar.space12,
              marginBottom: cssVar.space24,
            }}
            >
              <Kpi
                label="Sessões"
                value={String(data.overview.sessions)}
                hint="de chat"
                color={cssVar.primary}
              />
              <Kpi
                label="Duração média"
                value={formatMs(data.overview.avg_session_ms)}
                hint="por sessão"
              />
              <Kpi
                label="Tokens"
                value={compact(data.overview.tokens)}
                hint="LLM consumidos"
              />
              <Kpi
                label="Custo"
                value={formatCost(data.overview.cost)}
                hint="estimado"
              />
              <Kpi
                label="MTTA"
                value={data.overview.mtta ?? '—'}
                hint="até reconhecer"
                color={cssVar.success200}
              />
            </div>

            {/* Latência por tool (2fr) · Consumo de tokens + WebSocket empilhados (1fr). */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '2fr 1fr',
              gap: cssVar.space16,
              alignItems: 'start',
            }}
            >
              <ToolsPanel tools={data.tools} />
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: cssVar.space16,
              }}
              >
                <TokensPanel hourly={data.tokens_hourly} />
                <WebSocketPanel websocket={data.websocket} />
              </div>
            </div>

            <RefusalsPanel refusals={data.refusals} />
          </>
        )
        : null}
    </div>
  );
}

/**
 * Painel "Consumo de tokens": reaproveita o {@link HourlyChart} do relatório (mesma estética —
 * extremos no topo sem eixo Y, eixo X com ticks de hora, cursor com tooltip `DD/MM HHh · <tokens>`)
 * e, abaixo, dois cards iguais TOTAL e PICO/h. Vazio = aviso. Horas em ISO UTC, exibidas no fuso.
 *
 * @param props - Buckets horários de tokens.
 *
 * @returns O painel.
 */
function TokensPanel({ hourly }: Readonly<{ hourly: ObservabilityInterface['tokens_hourly'] }>): JSX.Element {
  const counts = hourly.map((bucket) => bucket.tokens);

  const total = counts.reduce(
    (
      acc,
      value,
    ) => acc + value,
    0,
  );

  const peak = counts.length > 0
    ? Math.max(...counts)
    : 0;

  return (
    <div style={{
      background: cssVar.white,
      border: cssVar.borderLine,
      borderRadius: 8,
      padding: '14px 18px',
    }}
    >
      {hourly.length === 0
        ? (
          <div style={{
            fontSize: cssVar.fs12,
            color: cssVar.fgMuted,
          }}
          >
            Sem consumo de tokens na janela.
          </div>
        )
        : (
          <>
            <HourlyChart
              title="Consumo de tokens"
              points={hourly.map((bucket) => ({
                at: bucket.at,
                value: bucket.tokens,
              }))}
              formatValue={(value) => compact(value)}
            />
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: cssVar.space12,
              marginTop: cssVar.space16,
            }}
            >
              <MiniStat
                label="Total"
                value={compact(total)}
                unit="tokens"
              />
              <MiniStat
                label="Pico"
                value={compact(peak)}
                unit="/h"
              />
            </div>
          </>
        )}
    </div>
  );
}

/**
 * Card compacto de estatística (rótulo em caixa-alta + valor + unidade) usado nos painéis da coluna
 * direita (tokens, WebSocket). Mais discreto que o {@link Kpi} da visão geral — padroniza o tamanho.
 *
 * @param props - Rótulo, valor e unidade opcional.
 *
 * @returns O card.
 */
function MiniStat({
  label,
  value,
  unit,
  tone,
}: Readonly<{
  label: string;
  value: string;
  unit?: string;
  /** `primary` destaca o valor em verde (ex.: WebSocket "conectados agora"), como no protótipo. */
  tone?: 'primary'
}>): JSX.Element {
  return (
    <div style={{
      background: cssVar.bgSoft,
      border: cssVar.borderLine,
      borderRadius: 6,
      padding: '8px 10px',
    }}
    >
      <div style={{
        fontSize: cssVar.fs10,
        fontWeight: 600,
        color: cssVar.fgSubtle,
        textTransform: 'uppercase',
        letterSpacing: 0.4,
        marginBottom: cssVar.space4,
      }}
      >
        {label}
      </div>
      <div style={{
        fontFamily: cssVar.fontHeading,
        fontSize: cssVar.fs14,
        fontWeight: 600,
        color: tone === 'primary'
          ? cssVar.primary
          : cssVar.fg,
        lineHeight: 1.1,
        fontVariantNumeric: cssValue.tabularNums,
      }}
      >
        {value}
        {unit
          ? (
            <span style={{
              fontFamily: 'var(--at-font-body, inherit)',
              fontSize: cssVar.fs12,
              fontWeight: 400,
              // segue o tom do valor: verde quando primary (o "N clientes" fica verde por inteiro).
              color: tone === 'primary'
                ? cssVar.primary
                : cssVar.fgMuted,
              marginLeft: cssVar.space4,
            }}
            >
              {unit}
            </span>
          )
          : null}
      </div>
    </div>
  );
}

/**
 * Painel "WebSocket": status ao vivo do gateway de tempo real. Badge de conexão + dois cards
 * (conectados agora e pico na janela). Latência/média de conexões ficam de fora (sem fonte de dado
 * real — ver decisão "dado real, não demo").
 *
 * @param props - Conexões ao vivo.
 *
 * @returns O painel.
 */
function WebSocketPanel({ websocket }: Readonly<{ websocket: ObservabilityInterface['websocket'] }>): JSX.Element {
  const isConnected = websocket.connected > 0;

  return (
    <div style={{
      background: cssVar.white,
      border: cssVar.borderLine,
      borderRadius: 8,
      padding: '14px 18px',
    }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: cssValue.spaceBetween,
        marginBottom: cssVar.space12,
      }}
      >
        <span style={{
          fontSize: cssVar.fs14,
          fontWeight: 600,
          color: cssVar.fg,
        }}
        >
          WebSocket
        </span>
        <span style={{
          display: cssValue.inlineFlex,
          alignItems: 'center',
          gap: cssVar.space4,
          padding: '2px 10px',
          borderRadius: 999,
          fontSize: cssVar.fs12,
          fontWeight: 600,
          background: isConnected
            ? cssVar.success50
            : cssVar.bgSoft,
          color: isConnected
            ? cssVar.success200
            : cssVar.fgMuted,
        }}
        >
          <span style={{
            width: 7,
            height: 7,
            borderRadius: 999,
            background: isConnected
              ? cssVar.success200
              : cssVar.fgMuted,
          }}
          />
          {isConnected
            ? 'conectado'
            : 'sem conexões'}
        </span>
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: cssVar.space12,
      }}
      >
        <MiniStat
          label="Conectados agora"
          value={String(websocket.connected)}
          unit="clientes"
          tone="primary"
        />
        <MiniStat
          label="Pico na janela"
          value={websocket.peak === null
            ? '—'
            : String(websocket.peak)}
          unit="clientes"
        />
      </div>
    </div>
  );
}

/** Average materialize time above which the KPI turns red. */
const SLOW_MATERIALIZE_MS = 30_000;

/** Decimal places of the estimated S3 cost in USD. */
const COST_USD_DECIMALS = 4;

/**
 * Painel "Leitura do S3 (custo)": leitura do motor de auditoria na janela selecionada (eventos
 * persistidos, sobrevive a restart) — quanto se lê do S3 (fonte de verdade) vs. do cache `/tmp`,
 * objetos lidos, tempo médio e custo estimado.
 *
 * @param props - Scan + período.
 *
 * @returns O painel.
 */
function S3ScanPanel({
  scan,
  period,
}: Readonly<{
  scan: ObservabilityInterface['audit_scan'];
  period: string
}>): JSX.Element {
  return (
    <div style={{ marginBottom: cssVar.space24 }}>
      <div style={{
        fontSize: cssVar.fs12,
        fontWeight: 600,
        color: cssVar.fgSubtle,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        marginBottom: cssVar.space12,
      }}
      >
        Leitura do S3 (custo · {period})
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(6, 1fr)',
        gap: cssVar.space12,
      }}
      >
        <Kpi
          label="Consultas"
          value={compact(scan.queries)}
          hint="ao motor (S3)"
        />
        <Kpi
          label="Cache hit"
          value={`${Math.round(scan.cache_hit_rate * PERCENT_SCALE)}%`}
          hint="partições do cache"
          color={cssVar.success200}
        />
        <Kpi
          label="Partições S3"
          value={compact(scan.partitions_scanned)}
          hint="lidas (frias+recentes)"
        />
        <Kpi
          label="Objetos S3"
          value={compact(scan.s3_objects)}
          hint="lidos do bucket"
        />
        <Kpi
          label="Materialize"
          value={`${compact(scan.avg_materialize_ms)} ms`}
          hint="médio/consulta"
          color={scan.avg_materialize_ms > SLOW_MATERIALIZE_MS
            ? cssVar.danger300
            : undefined}
        />
        <Kpi
          label="Custo est."
          value={`US$ ${scan.estimated_cost_usd.toFixed(COST_USD_DECIMALS)}`}
          hint="GET + LIST (aprox.)"
        />
      </div>
    </div>
  );
}

/** Card de KPI (rótulo + número + dica); `color` destaca o número (default = `--at-fg`). */
function Kpi({
  label,
  value,
  hint,
  color = cssVar.fg,
}: Readonly<{
  label: string;
  value: string;
  hint: string;
  color?: string
}>): JSX.Element {
  return (
    <div style={{
      background: cssVar.white,
      border: cssVar.borderLine,
      borderRadius: 8,
      padding: cssVar.space16,
    }}
    >
      <div style={{
        fontSize: cssVar.fs12,
        fontWeight: 600,
        color: cssVar.fgSubtle,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
      }}
      >
        {label}
      </div>
      <div style={{
        fontFamily: cssVar.fontHeading,
        fontSize: cssVar.fs24,
        fontWeight: 700,
        color,
        lineHeight: 1.1,
        marginTop: cssVar.space4,
        fontVariantNumeric: cssValue.tabularNums,
      }}
      >
        {value}
      </div>
      <div style={{
        fontSize: cssVar.fs12,
        color: cssVar.fgMuted,
        marginTop: 2,
      }}
      >
        {hint}
      </div>
    </div>
  );
}

/**
 * Badge do provider/modelo LLM ativo (ex.: `LLM · Amazon Nova Pro v1`). `fake` (sem credencial) ganha
 * tom de atenção e rótulo `Simulado` — deixa claro que não é o modelo real.
 *
 * @param props - Provider + modelo ativos.
 *
 * @returns O badge.
 */
function LlmBadge({ llm }: Readonly<{ llm: ObservabilityInterface['llm'] }>): JSX.Element {
  const isFake = llm.provider === 'fake';

  return (
    <span
      title={`Provider LLM: ${llm.provider}`}
      style={{
        display: cssValue.inlineFlex,
        alignItems: 'center',
        gap: cssVar.space4,
        padding: '2px 10px',
        borderRadius: 999,
        background: isFake
          ? cssVar.warning50
          : cssVar.bgSoft,
        color: isFake
          ? cssVar.warning300
          : cssVar.fgMuted,
        fontSize: cssVar.fs12,
        fontWeight: 600,
      }}
    >
      <span
        aria-hidden="true"
        style={{ opacity: 0.7 }}
      >
        LLM ·
      </span>
      {llm.model}
    </span>
  );
}

/** Badge de saúde geral conforme a taxa de erro. */
function HealthBadge({ rate }: Readonly<{ rate: number }>): JSX.Element {
  const {
    label,
    color,
    bg,
  } = healthStatus(rate);

  return (
    <span style={{
      display: cssValue.inlineFlex,
      alignItems: 'center',
      gap: cssVar.space4,
      padding: '2px 10px',
      borderRadius: 999,
      background: bg,
      color,
      fontSize: cssVar.fs12,
      fontWeight: 600,
    }}
    >
      <span style={{
        width: 7,
        height: 7,
        borderRadius: 999,
        background: color,
      }}
      />
      {label}
    </span>
  );
}

/** Rótulo + cor (texto/fundo) da saúde conforme a taxa de erro global; usa tokens `--at-*`. */
function healthStatus(rate: number): {
  label: string;
  color: string;
  bg: string
} {
  if (rate >= HEALTH_DEGRADED) {
    return {
      label: 'Degradado',
      color: cssVar.danger300,
      bg: cssVar.danger50,
    };
  }

  if (rate >= HEALTH_WARN) {
    return {
      label: 'Atenção',
      color: cssVar.warning300,
      bg: cssVar.warning50,
    };
  }

  return {
    label: 'Sistema saudável',
    color: cssVar.success200,
    bg: cssVar.success50,
  };
}

/** Painel "Latência por tool" (tabela calls/erros/latência média). */
function ToolsPanel({ tools }: Readonly<{ tools: ToolUsageStatInterface[] }>): JSX.Element {
  return (
    <div style={{
      background: cssVar.white,
      border: cssVar.borderLine,
      borderRadius: 8,
      overflow: 'hidden',
    }}
    >
      <div style={{
        padding: '14px 18px',
        borderBottom: cssVar.borderLine,
        fontSize: cssVar.fs14,
        fontWeight: 600,
        color: cssVar.fg,
      }}
      >
        Latência por tool
        <span style={{
          fontWeight: 400,
          color: cssVar.fgSubtle,
        }}
        >
          {'  ·  p50 / p95 / p99 em ms'}
        </span>
      </div>
      <table style={{
        width: '100%',
        borderCollapse: 'collapse',
      }}
      >
        <thead>
          <tr style={{ background: cssVar.bgSoft }}>
            {[
              'Tool',
              'Calls',
              'Erros',
              'p50',
              'p95',
              'p99',
              '',
            ].map((column) => (
              <th
                key={column}
                style={{
                  textAlign: 'left',
                  padding: '8px 14px',
                  fontSize: cssVar.fs12,
                  fontWeight: 600,
                  color: cssVar.fgMuted,
                  textTransform: 'uppercase',
                  letterSpacing: 0.4,
                  borderBottom: cssVar.borderLine,
                }}
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tools.map((tool) => (
            <ToolRow
              key={tool.name}
              tool={tool}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Linha da tabela de tools (com badge de taxa de erro). */
function ToolRow({ tool }: Readonly<{ tool: ToolUsageStatInterface }>): JSX.Element {
  const errorRate = tool.calls === 0
    ? 0
    : (tool.errors / tool.calls) * PERCENT_SCALE;

  const errorHealth = healthStatus(errorRate);

  return (
    <tr style={{ borderBottom: cssVar.borderLine }}>
      <td style={{
        padding: '9px 14px',
        fontFamily: cssValue.fontMono,
        fontSize: cssVar.fs12,
        color: cssVar.fg,
      }}
      >
        {tool.name}
      </td>
      <td style={{
        padding: '9px 14px',
        fontSize: cssVar.fs14,
        fontVariantNumeric: cssValue.tabularNums,
        color: cssVar.fg,
      }}
      >
        {tool.calls.toLocaleString('pt-BR')}
      </td>
      <td style={{ padding: '9px 14px' }}>
        <span style={{
          display: cssValue.inlineFlex,
          alignItems: 'center',
          gap: cssVar.space4,
          padding: '2px 8px',
          borderRadius: 999,
          background: errorHealth.bg,
          color: errorHealth.color,
          fontSize: cssVar.fs12,
          fontWeight: 600,
          fontVariantNumeric: cssValue.tabularNums,
        }}
        >
          {tool.errors} · {errorRate.toFixed(1)}%
        </span>
      </td>
      <LatencyCell value={tool.p50_ms} />
      <LatencyCell
        value={tool.p95_ms}
        heavyThreshold={1000}
      />
      <LatencyCell
        value={tool.p99_ms}
        muted
      />
      <td style={{
        padding: '9px 14px',
        width: 92,
      }}
      >
        <LatencySparkline
          p50={tool.p50_ms}
          p95={tool.p95_ms}
          p99={tool.p99_ms}
        />
      </td>
    </tr>
  );
}

/**
 * Mini-barra de latência (p50 preenchido · p95 marcado · p99 no fim), escala 0..p99 — leitura visual
 * rápida da distribuição por tool. Sem amostra (qualquer p* nulo ou p99≤0) → não renderiza.
 *
 * @param props - Percentis (ms).
 *
 * @returns A barra, ou `null` quando não há amostra.
 */
function LatencySparkline({
  p50,
  p95,
  p99,
}: Readonly<{
  p50: number | null;
  p95: number | null;
  p99: number | null
}>): JSX.Element | null {
  if (
    p50 === null
    || p95 === null
    || p99 === null
    || p99 <= 0
  ) {
    return null;
  }

  const width = 80;

  const p50W = Math.max(
    0,
    Math.min(
      1,
      p50 / p99,
    ),
  ) * width;

  const p95X = Math.max(
    0,
    Math.min(
      1,
      p95 / p99,
    ),
  ) * width;

  return (
    <svg
      width={width}
      height={24}
      viewBox={`0 0 ${width} 24`}
      role="img"
      aria-label={`p50 ${p50}ms, p95 ${p95}ms, p99 ${p99}ms`}
    >
      <rect
        x={0}
        y={9}
        width={width}
        height={6}
        rx={2}
        fill={cssVar.bgSoft}
        stroke={cssVar.border}
        strokeWidth={0.5}
      />
      <rect
        x={0}
        y={9}
        width={p50W}
        height={6}
        rx={2}
        fill={cssVar.primary}
      />
      <line
        x1={p95X}
        y1={6}
        x2={p95X}
        y2={18}
        stroke={cssVar.warning200}
        strokeWidth={1.5}
      />
      <line
        x1={width - 1}
        y1={6}
        x2={width - 1}
        y2={18}
        stroke={cssVar.fgMuted}
        strokeWidth={1}
      />
    </svg>
  );
}

/**
 * Célula de latência (ms, tabular) — `—` quando sem amostra. Com `heavyThreshold`, fica ÂMBAR + bold
 * quando o valor passa do limiar (sinaliza tool lenta, como no protótipo); `muted` deixa o valor mais
 * apagado (p99, o "teto").
 *
 * @param props - Valor + realces.
 *
 * @returns A célula.
 */
function LatencyCell({
  value,
  heavyThreshold,
  muted,
}: Readonly<{
  value: number | null;
  heavyThreshold?: number;
  muted?: boolean
}>): JSX.Element {
  const heavy = heavyThreshold !== undefined
    && value !== null
    && value > heavyThreshold;

  const baseColor = muted
    ? cssVar.fgMuted
    : cssVar.fg;

  const color = heavy
    ? cssVar.warning200
    : baseColor;

  return (
    <td style={{
      padding: '9px 14px',
      fontSize: cssVar.fs14,
      fontVariantNumeric: cssValue.tabularNums,
      fontWeight: heavy
        ? FONT_WEIGHT.semibold
        : FONT_WEIGHT.medium,
      color,
    }}
    >
      {value === null
        ? '—'
        : value.toLocaleString('pt-BR')}
    </td>
  );
}

/**
 * Exemplo ESTÁTICO por motivo de recusa (o backend manda só `{reason, count}`; o exemplo é ilustrativo,
 * como no protótipo). Motivo sem exemplo mapeado → o card mostra só reason + contagem.
 */
const REFUSAL_REASON_EXAMPLE: Record<string, string> = {
  // `fora_do_escopo` é o motivo REAL emitido pelo orquestrador (buildRefusal). Os demais ficam
  // mapeados de forma prospectiva (caso um classificador de recusa passe a distingui-los).
  fora_do_escopo: 'Reenviar mensagem',
  fora_de_escopo: 'Reenviar mensagem',
  falta_de_contexto: 'Sem message_id ou telefone',
  prompt_injection: 'Tentativa em conteúdo de SMS',
};

/**
 * Painel "Recusas do assistente": total (badge) + um card por motivo (`reason` + contagem + exemplo).
 * Recusa = quando o LLM se nega a responder (proteção contra alucinação). Largura cheia, abaixo do grid.
 *
 * @param props - Total + quebra por motivo.
 *
 * @returns O painel.
 */
function RefusalsPanel({ refusals }: Readonly<{ refusals: ObservabilityInterface['refusals'] }>): JSX.Element {
  return (
    <div style={{
      marginTop: cssVar.space24,
      background: cssVar.white,
      border: cssVar.borderLine,
      borderRadius: 8,
      padding: '14px 18px',
    }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: cssValue.spaceBetween,
        gap: cssVar.space12,
        flexWrap: 'wrap',
        marginBottom: cssVar.space12,
      }}
      >
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: cssVar.space8,
        }}
        >
          <span style={{
            fontSize: cssVar.fs14,
            fontWeight: 600,
            color: cssVar.fg,
          }}
          >
            Recusas do assistente
          </span>
          <span style={{
            padding: '1px 8px',
            borderRadius: 999,
            background: cssVar.bgSoft,
            color: cssVar.fgMuted,
            fontSize: cssVar.fs12,
            fontWeight: 700,
            fontVariantNumeric: cssValue.tabularNums,
          }}
          >
            {refusals.total}
          </span>
        </div>
        <span style={{
          fontSize: cssVar.fs12,
          color: cssVar.fgSubtle,
        }}
        >
          quando o LLM se recusa a responder (proteção contra alucinação)
        </span>
      </div>
      {refusals.by_reason.length > 0
        ? (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: cssVar.space12,
          }}
          >
            {refusals.by_reason.map((item) => (
              <div
                key={item.reason}
                style={{
                  background: cssVar.bgSoft,
                  border: cssVar.borderLine,
                  borderRadius: 6,
                  padding: '12px 14px',
                }}
              >
                <div style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  justifyContent: cssValue.spaceBetween,
                  gap: cssVar.space8,
                  marginBottom: cssVar.space4,
                }}
                >
                  <code style={{
                    fontFamily: cssValue.fontMono,
                    fontSize: cssVar.fs12,
                    fontWeight: 600,
                    color: cssVar.fg,
                    wordBreak: 'break-word',
                  }}
                  >
                    {item.reason}
                  </code>
                  <b style={{
                    fontFamily: cssVar.fontHeading,
                    fontSize: cssVar.fs18,
                    fontWeight: 700,
                    color: cssVar.fg,
                    fontVariantNumeric: cssValue.tabularNums,
                  }}
                  >
                    {item.count}
                  </b>
                </div>
                {REFUSAL_REASON_EXAMPLE[item.reason]
                  ? (
                    <div style={{
                      fontSize: cssVar.fs12,
                      color: cssVar.fgMuted,
                    }}
                    >
                      ex.:
                      {' '}
                      <i>
                        &quot;
                        {REFUSAL_REASON_EXAMPLE[item.reason]}
                        &quot;
                      </i>
                    </div>
                  )
                  : null}
              </div>
            ))}
          </div>
        )
        : (
          <div style={{
            fontSize: cssVar.fs12,
            color: cssVar.fgMuted,
          }}
          >
            Nenhuma recusa registrada.
          </div>
        )}
    </div>
  );
}
