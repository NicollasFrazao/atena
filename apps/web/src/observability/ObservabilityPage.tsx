import { useState } from 'react';
import type {
  ObservabilityInterface,
  ToolUsageStatInterface,
} from '@atena/types';
import { useObservability } from '../api/observability';
import { HourlyChart } from '../chat/tool-cards/HourlyChart';

/** Limiares de taxa de erro (%) para a saúde geral do assistente. */
const HEALTH_WARN = 2;
const HEALTH_DEGRADED = 5;

/** Janelas temporais selecionáveis na tela (valor enviado à API + rótulo). */
const WINDOW_OPTIONS: Array<{
  value: string;
  label: string
}> = [
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

/** Formata um inteiro grande de forma compacta: `1.2M`, `850.9k`, `42`. */
function compact(value: number | null): string {
  if (value === null) {
    return '—';
  }

  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }

  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}k`;
  }

  return String(value);
}

/** Formata uma duração em ms de forma legível: `Xh Ym` / `Xm Ys` / `Xs`, ou `—` se nulo. */
function formatMs(ms: number | null): string {
  if (ms === null) {
    return '—';
  }

  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

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
    : (totals.errors / totals.calls) * 100;
}

/**
 * Tela de Observabilidade do assistente (`GET /observability`, admin), por JANELA temporal
 * (24h/7d/30d/Tudo): KPIs (sessões, duração média, tokens, custo, MTTA, WebSocket), latência por
 * tool (p50/p95/p99), consumo de tokens por hora, leitura do S3 e recusas (por motivo). Sem PII.
 * Detect→Notif e lag/média do WebSocket ficam de fora (sem telemetria). Atualiza a cada 30s.
 *
 * @returns {JSX.Element} A tela de observabilidade.
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
      padding: 'var(--at-space-32)',
    }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--at-space-12)',
        marginBottom: 'var(--at-space-4)',
      }}
      >
        <h1 style={{
          margin: 0,
          fontSize: 'var(--at-fs-24)',
          fontWeight: 600,
          color: 'var(--at-fg)',
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
          display: 'inline-flex',
          gap: 'var(--at-space-4)',
          padding: 4,
          borderRadius: 'var(--at-radius-8)',
          background: 'var(--at-bg-soft)',
          border: '1px solid var(--at-border)',
        }}
        >
          {WINDOW_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setTimeWindow(option.value)}
              style={{
                height: 28,
                padding: '0 var(--at-space-12)',
                borderRadius: 'var(--at-radius-4)',
                border: 'none',
                background: timeWindow === option.value
                  ? 'var(--at-white)'
                  : 'transparent',
                color: timeWindow === option.value
                  ? 'var(--at-fg)'
                  : 'var(--at-fg-muted)',
                fontSize: 'var(--at-fs-14)',
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
        fontSize: 'var(--at-fs-14)',
        color: 'var(--at-fg-muted)',
        marginBottom: 'var(--at-space-24)',
      }}
      >
        {data
          ? `${data.period} · saúde do próprio assistente · atualizado a cada 30s`
          : 'Carregando métricas…'}
      </div>

      {query.isError
        ? (
          <div style={{
            fontSize: 'var(--at-fs-14)',
            color: 'var(--at-fg-muted)',
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
              fontSize: 'var(--at-fs-12)',
              fontWeight: 600,
              color: 'var(--at-fg-subtle)',
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              marginBottom: 'var(--at-space-12)',
            }}
            >
              Assistente (LLM · {data.period})
            </div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(5, 1fr)',
              gap: 'var(--at-space-12)',
              marginBottom: 'var(--at-space-24)',
            }}
            >
              <Kpi
                label="Sessões"
                value={String(data.overview.sessions)}
                hint="de chat"
                color="var(--at-primary)"
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
                color="var(--at-success-200)"
              />
            </div>

            {/* Latência por tool (2fr) · Consumo de tokens + WebSocket empilhados (1fr). */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '2fr 1fr',
              gap: 'var(--at-space-16)',
              alignItems: 'start',
            }}
            >
              <ToolsPanel tools={data.tools} />
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--at-space-16)',
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
 * @param {{ hourly: ObservabilityInterface['tokens_hourly'] }} props - Buckets horários de tokens.
 * @returns {JSX.Element} O painel.
 */
function TokensPanel({ hourly }: { hourly: ObservabilityInterface['tokens_hourly'] }): JSX.Element {
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
      background: 'var(--at-white)',
      border: '1px solid var(--at-border)',
      borderRadius: 8,
      padding: '14px 18px',
    }}
    >
      {hourly.length === 0
        ? (
          <div style={{
            fontSize: 'var(--at-fs-12)',
            color: 'var(--at-fg-muted)',
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
              gap: 'var(--at-space-12)',
              marginTop: 'var(--at-space-16)',
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
 * @param {{ label: string; value: string; unit?: string }} props - Rótulo, valor e unidade opcional.
 * @returns {JSX.Element} O card.
 */
function MiniStat({
  label,
  value,
  unit,
  tone,
}: {
  label: string;
  value: string;
  unit?: string;
  /** `primary` destaca o valor em verde (ex.: WebSocket "conectados agora"), como no protótipo. */
  tone?: 'primary'
}): JSX.Element {
  return (
    <div style={{
      background: 'var(--at-bg-soft)',
      border: '1px solid var(--at-border)',
      borderRadius: 6,
      padding: '8px 10px',
    }}
    >
      <div style={{
        fontSize: 'var(--at-fs-10)',
        fontWeight: 600,
        color: 'var(--at-fg-subtle)',
        textTransform: 'uppercase',
        letterSpacing: 0.4,
        marginBottom: 'var(--at-space-4)',
      }}
      >
        {label}
      </div>
      <div style={{
        fontFamily: 'var(--at-font-heading)',
        fontSize: 'var(--at-fs-14)',
        fontWeight: 600,
        color: tone === 'primary'
          ? 'var(--at-primary)'
          : 'var(--at-fg)',
        lineHeight: 1.1,
        fontVariantNumeric: 'tabular-nums',
      }}
      >
        {value}
        {unit
          ? (
            <span style={{
              fontFamily: 'var(--at-font-body, inherit)',
              fontSize: 'var(--at-fs-12)',
              fontWeight: 400,
              color: 'var(--at-fg-muted)',
              marginLeft: 'var(--at-space-4)',
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
 * @param {{ websocket: ObservabilityInterface['websocket'] }} props - Conexões ao vivo.
 * @returns {JSX.Element} O painel.
 */
function WebSocketPanel({ websocket }: { websocket: ObservabilityInterface['websocket'] }): JSX.Element {
  const isConnected = websocket.connected > 0;

  return (
    <div style={{
      background: 'var(--at-white)',
      border: '1px solid var(--at-border)',
      borderRadius: 8,
      padding: '14px 18px',
    }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 'var(--at-space-12)',
      }}
      >
        <span style={{
          fontSize: 'var(--at-fs-14)',
          fontWeight: 600,
          color: 'var(--at-fg)',
        }}
        >
          WebSocket
        </span>
        <span style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 'var(--at-space-4)',
          padding: '2px 10px',
          borderRadius: 999,
          fontSize: 'var(--at-fs-12)',
          fontWeight: 600,
          background: isConnected
            ? 'var(--at-success-50)'
            : 'var(--at-bg-soft)',
          color: isConnected
            ? 'var(--at-success-200)'
            : 'var(--at-fg-muted)',
        }}
        >
          <span style={{
            width: 7,
            height: 7,
            borderRadius: 999,
            background: isConnected
              ? 'var(--at-success-200)'
              : 'var(--at-fg-muted)',
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
        gap: 'var(--at-space-12)',
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

/**
 * Painel "Leitura do S3 (custo)": leitura do motor de auditoria na janela selecionada (eventos
 * persistidos, sobrevive a restart) — quanto se lê do S3 (fonte de verdade) vs. do cache `/tmp`,
 * objetos lidos, tempo médio e custo estimado.
 *
 * @param {{ scan: ObservabilityInterface['audit_scan']; period: string }} props - Scan + período.
 * @returns {JSX.Element} O painel.
 */
function S3ScanPanel({
  scan,
  period,
}: {
  scan: ObservabilityInterface['audit_scan'];
  period: string
}): JSX.Element {
  return (
    <div style={{ marginBottom: 'var(--at-space-24)' }}>
      <div style={{
        fontSize: 'var(--at-fs-12)',
        fontWeight: 600,
        color: 'var(--at-fg-subtle)',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        marginBottom: 'var(--at-space-12)',
      }}
      >
        Leitura do S3 (custo · {period})
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(6, 1fr)',
        gap: 'var(--at-space-12)',
      }}
      >
        <Kpi
          label="Consultas"
          value={compact(scan.queries)}
          hint="ao motor (S3)"
        />
        <Kpi
          label="Cache hit"
          value={`${Math.round(scan.cache_hit_rate * 100)}%`}
          hint="partições do cache"
          color="var(--at-success-200)"
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
          color={scan.avg_materialize_ms > 30000
            ? 'var(--at-danger-300)'
            : undefined}
        />
        <Kpi
          label="Custo est."
          value={`US$ ${scan.estimated_cost_usd.toFixed(4)}`}
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
  color = 'var(--at-fg)',
}: {
  label: string;
  value: string;
  hint: string;
  color?: string
}): JSX.Element {
  return (
    <div style={{
      background: 'var(--at-white)',
      border: '1px solid var(--at-border)',
      borderRadius: 8,
      padding: 'var(--at-space-16)',
    }}
    >
      <div style={{
        fontSize: 'var(--at-fs-12)',
        fontWeight: 600,
        color: 'var(--at-fg-subtle)',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
      }}
      >
        {label}
      </div>
      <div style={{
        fontFamily: 'var(--at-font-heading)',
        fontSize: 'var(--at-fs-24)',
        fontWeight: 700,
        color,
        lineHeight: 1.1,
        marginTop: 'var(--at-space-4)',
        fontVariantNumeric: 'tabular-nums',
      }}
      >
        {value}
      </div>
      <div style={{
        fontSize: 'var(--at-fs-12)',
        color: 'var(--at-fg-muted)',
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
 * @param {{ llm: ObservabilityInterface['llm'] }} props - Provider + modelo ativos.
 * @returns {JSX.Element} O badge.
 */
function LlmBadge({ llm }: { llm: ObservabilityInterface['llm'] }): JSX.Element {
  const isFake = llm.provider === 'fake';

  return (
    <span
      title={`Provider LLM: ${llm.provider}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--at-space-4)',
        padding: '2px 10px',
        borderRadius: 999,
        background: isFake
          ? 'var(--at-warning-50)'
          : 'var(--at-bg-soft)',
        color: isFake
          ? 'var(--at-warning-300)'
          : 'var(--at-fg-muted)',
        fontSize: 'var(--at-fs-12)',
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
function HealthBadge({ rate }: { rate: number }): JSX.Element {
  const {
    label,
    color,
    bg,
  } = healthStatus(rate);

  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 'var(--at-space-4)',
      padding: '2px 10px',
      borderRadius: 999,
      background: bg,
      color,
      fontSize: 'var(--at-fs-12)',
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
      color: 'var(--at-danger-300)',
      bg: 'var(--at-danger-50)',
    };
  }

  if (rate >= HEALTH_WARN) {
    return {
      label: 'Atenção',
      color: 'var(--at-warning-300)',
      bg: 'var(--at-warning-50)',
    };
  }

  return {
    label: 'Sistema saudável',
    color: 'var(--at-success-200)',
    bg: 'var(--at-success-50)',
  };
}

/** Painel "Latência por tool" (tabela calls/erros/latência média). */
function ToolsPanel({ tools }: { tools: ToolUsageStatInterface[] }): JSX.Element {
  return (
    <div style={{
      background: 'var(--at-white)',
      border: '1px solid var(--at-border)',
      borderRadius: 8,
      overflow: 'hidden',
    }}
    >
      <div style={{
        padding: '14px 18px',
        borderBottom: '1px solid var(--at-border)',
        fontSize: 'var(--at-fs-14)',
        fontWeight: 600,
        color: 'var(--at-fg)',
      }}
      >
        Latência por tool
        <span style={{
          fontWeight: 400,
          color: 'var(--at-fg-subtle)',
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
          <tr style={{ background: 'var(--at-bg-soft)' }}>
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
                  fontSize: 'var(--at-fs-12)',
                  fontWeight: 600,
                  color: 'var(--at-fg-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: 0.4,
                  borderBottom: '1px solid var(--at-border)',
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
function ToolRow({ tool }: { tool: ToolUsageStatInterface }): JSX.Element {
  const errorRate = tool.calls === 0
    ? 0
    : (tool.errors / tool.calls) * 100;

  const errorHealth = healthStatus(errorRate);

  return (
    <tr style={{ borderBottom: '1px solid var(--at-border)' }}>
      <td style={{
        padding: '9px 14px',
        fontFamily: 'ui-monospace, Menlo, monospace',
        fontSize: 'var(--at-fs-12)',
        color: 'var(--at-fg)',
      }}
      >
        {tool.name}
      </td>
      <td style={{
        padding: '9px 14px',
        fontSize: 'var(--at-fs-14)',
        fontVariantNumeric: 'tabular-nums',
        color: 'var(--at-fg)',
      }}
      >
        {tool.calls.toLocaleString('pt-BR')}
      </td>
      <td style={{ padding: '9px 14px' }}>
        <span style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 'var(--at-space-4)',
          padding: '2px 8px',
          borderRadius: 999,
          background: errorHealth.bg,
          color: errorHealth.color,
          fontSize: 'var(--at-fs-12)',
          fontWeight: 600,
          fontVariantNumeric: 'tabular-nums',
        }}
        >
          {tool.errors} · {errorRate.toFixed(1)}%
        </span>
      </td>
      <LatencyCell value={tool.p50_ms} />
      <LatencyCell value={tool.p95_ms} />
      <LatencyCell value={tool.p99_ms} />
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
 * @param {{ p50: number | null; p95: number | null; p99: number | null }} props - Percentis (ms).
 * @returns {JSX.Element | null} A barra, ou `null` quando não há amostra.
 */
function LatencySparkline({
  p50,
  p95,
  p99,
}: {
  p50: number | null;
  p95: number | null;
  p99: number | null
}): JSX.Element | null {
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
        fill="var(--at-bg-soft)"
        stroke="var(--at-border)"
        strokeWidth={0.5}
      />
      <rect
        x={0}
        y={9}
        width={p50W}
        height={6}
        rx={2}
        fill="var(--at-primary)"
      />
      <line
        x1={p95X}
        y1={6}
        x2={p95X}
        y2={18}
        stroke="var(--at-warning-200)"
        strokeWidth={1.5}
      />
      <line
        x1={width - 1}
        y1={6}
        x2={width - 1}
        y2={18}
        stroke="var(--at-fg-muted)"
        strokeWidth={1}
      />
    </svg>
  );
}

/** Célula de latência (ms, tabular) — `—` quando sem amostra. */
function LatencyCell({ value }: { value: number | null }): JSX.Element {
  return (
    <td style={{
      padding: '9px 14px',
      fontSize: 'var(--at-fs-14)',
      fontVariantNumeric: 'tabular-nums',
      color: 'var(--at-fg-muted)',
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
  fora_de_escopo: 'Reenviar mensagem',
  falta_de_contexto: 'Sem message_id ou telefone',
  prompt_injection: 'Tentativa em conteúdo de SMS',
};

/**
 * Painel "Recusas do assistente": total (badge) + um card por motivo (`reason` + contagem + exemplo).
 * Recusa = quando o LLM se nega a responder (proteção contra alucinação). Largura cheia, abaixo do grid.
 *
 * @param {{ refusals: ObservabilityInterface['refusals'] }} props - Total + quebra por motivo.
 * @returns {JSX.Element} O painel.
 */
function RefusalsPanel({ refusals }: { refusals: ObservabilityInterface['refusals'] }): JSX.Element {
  return (
    <div style={{
      marginTop: 'var(--at-space-24)',
      background: 'var(--at-white)',
      border: '1px solid var(--at-border)',
      borderRadius: 8,
      padding: '14px 18px',
    }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--at-space-12)',
        flexWrap: 'wrap',
        marginBottom: 'var(--at-space-12)',
      }}
      >
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--at-space-8)',
        }}
        >
          <span style={{
            fontSize: 'var(--at-fs-14)',
            fontWeight: 600,
            color: 'var(--at-fg)',
          }}
          >
            Recusas do assistente
          </span>
          <span style={{
            padding: '1px 8px',
            borderRadius: 999,
            background: 'var(--at-bg-soft)',
            color: 'var(--at-fg-muted)',
            fontSize: 'var(--at-fs-12)',
            fontWeight: 700,
            fontVariantNumeric: 'tabular-nums',
          }}
          >
            {refusals.total}
          </span>
        </div>
        <span style={{
          fontSize: 'var(--at-fs-12)',
          color: 'var(--at-fg-subtle)',
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
            gap: 'var(--at-space-12)',
          }}
          >
            {refusals.by_reason.map((item) => (
              <div
                key={item.reason}
                style={{
                  background: 'var(--at-bg-soft)',
                  border: '1px solid var(--at-border)',
                  borderRadius: 6,
                  padding: '12px 14px',
                }}
              >
                <div style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  gap: 'var(--at-space-8)',
                  marginBottom: 'var(--at-space-4)',
                }}
                >
                  <code style={{
                    fontFamily: 'ui-monospace, Menlo, monospace',
                    fontSize: 'var(--at-fs-12)',
                    fontWeight: 600,
                    color: 'var(--at-fg)',
                    wordBreak: 'break-word',
                  }}
                  >
                    {item.reason}
                  </code>
                  <b style={{
                    fontFamily: 'var(--at-font-heading)',
                    fontSize: 'var(--at-fs-18)',
                    fontWeight: 700,
                    color: 'var(--at-fg)',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                  >
                    {item.count}
                  </b>
                </div>
                {REFUSAL_REASON_EXAMPLE[item.reason]
                  ? (
                    <div style={{
                      fontSize: 'var(--at-fs-12)',
                      color: 'var(--at-fg-muted)',
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
            fontSize: 'var(--at-fs-12)',
            color: 'var(--at-fg-muted)',
          }}
          >
            Nenhuma recusa registrada.
          </div>
        )}
    </div>
  );
}
