import { useState } from 'react';
import {
  Buildings,
  CalendarBlank,
  ChartBar,
  CheckCircle,
  Circle,
  CircleNotch,
  DownloadSimple,
  EyeSlash,
  Funnel,
  TrendUp,
  X,
} from '@phosphor-icons/react';
import type {
  ActionCategoryType,
  AffectedDimensionInterface,
  DimensionType,
  IncidentReportInterface,
  IncidentSeverityType,
  ResolvedIncidentInterface,
} from '@atena/types';
import {
  type DeliveryProgressInterface,
  type ReportWindowInterface,
  useDeliveryReportStream,
  useIncidentReport,
} from '../api/reports';
import { ReportCard } from '../chat/tool-cards/ReportCard';
import { SEVERITY_COLOR, SEVERITY_LABEL } from '../incidents/severity';
import { triggerBlobDownload } from '../util/download';
import { dayKeyInTz, formatRelativeTime } from '../util/time';

/** Tipo de relatório selecionado. */
type ReportType = 'delivery' | 'incidents';

/** Presets de janela disponíveis na tela. */
const RANGES: Array<{
  value: string;
  label: string
}> = [
  {
    value: '24h',
    label: 'Últimas 24h',
  },
  {
    value: '7d',
    label: '7 dias',
  },
  {
    value: '30d',
    label: '30 dias',
  },
];

/** Rótulo PT-BR de cada categoria de ação de resolução (paridade com o protótipo). */
const ACTION_LABEL: Record<ActionCategoryType, string> = {
  provider_recovered: 'Fornecedor se recuperou',
  provider_escalated: 'Escalado p/ fornecedor',
  internal_escalated: 'Escalado interno',
  false_positive: 'Falso positivo',
  customer_communicated: 'Cliente comunicado',
  monitoring_only: 'Só monitoramento',
  other: 'Outro',
};

/** Cor de realce por categoria de ação (barras de distribuição + badge da tabela). */
const ACTION_PALETTE: Record<ActionCategoryType, string> = {
  provider_recovered: '#077E70',
  provider_escalated: '#E0A500',
  internal_escalated: '#0052CC',
  false_positive: '#7C7C83',
  customer_communicated: '#0E534B',
  monitoring_only: '#21973B',
  other: '#313135',
};

/** Rótulo PT-BR de cada dimensão (abas de "Top dimensões afetadas"). */
const DIMENSION_LABEL: Record<DimensionType, string> = {
  provider: 'Fornecedor',
  customer: 'Cliente',
  route: 'Rota',
  global: 'Global',
};

/** Dimensões com aba na seção "Top dimensões afetadas" (espelha o protótipo: Fornecedor/Cliente/Rota). */
const DIMENSION_TABS: DimensionType[] = [
  'provider',
  'customer',
  'route',
];

/** Metas de SLA (em segundos) exibidas nas dicas dos KPIs de MTTA/MTTR. */
const MTTA_TARGET_SECONDS = 5 * 60;

const MTTR_TARGET_SECONDS = 30 * 60;

/**
 * Resolve a janela do relatório de entregabilidade: sem dia escolhido usa o preset; com dia, vira o
 * dia inteiro (`date_from`/`date_to` só-data) ou um intervalo de horas (datetime sem fuso). Tudo no
 * fuso do operador (o backend interpreta data nua e datetime naive em BRT).
 *
 * @param {string} range - Preset selecionado (`24h`/`7d`/`30d`).
 * @param {string} day - Dia escolhido (`YYYY-MM-DD`) ou vazio.
 * @param {string} fromTime - Hora inicial (`HH:mm`) ou vazio.
 * @param {string} toTime - Hora final (`HH:mm`) ou vazio.
 * @returns {ReportWindowInterface} Janela a enviar ao endpoint.
 */
function deliveryWindow(
  range: string,
  day: string,
  fromTime: string,
  toTime: string,
  customer: string,
): ReportWindowInterface {
  const customerId = customer.trim();

  const filters = customerId
    ? { filters: { customer_id: customerId } }
    : {};

  if (!day) {
    return {
      date_range: range,
      ...filters,
    };
  }

  if (
    fromTime
    && toTime
  ) {
    return {
      date_from: `${day}T${fromTime}`,
      date_to: `${day}T${toTime}`,
      ...filters,
    };
  }

  return {
    date_from: day,
    date_to: day,
    ...filters,
  };
}

/**
 * Tela de Relatórios (admin): alterna entre **Entregabilidade** (`POST /reports/delivery`, reusa o
 * {@link ReportCard}) e **Incidentes resolvidos** (`POST /reports/incidents`), por janela
 * (`24h`/`7d`/`30d`). O export CSV do relatório de entrega vem do próprio card.
 *
 * @returns {JSX.Element} A tela de Relatórios.
 */
export function RelatoriosPage(): JSX.Element {
  const [
    type,
    setType,
  ] = useState<ReportType>('delivery');

  const [
    range,
    setRange,
  ] = useState<string>('24h');

  // Seletor de DIA específico (entregabilidade): vazio = usa o preset; preenchido = sobrepõe.
  const [
    day,
    setDay,
  ] = useState<string>('');

  const [
    fromTime,
    setFromTime,
  ] = useState<string>('');

  const [
    toTime,
    setToTime,
  ] = useState<string>('');

  // Filtro de cliente (entregabilidade): id do cliente (ex.: "1001"); vazio = todos.
  const [
    customer,
    setCustomer,
  ] = useState<string>('');

  const delivery = useDeliveryReportStream(
    deliveryWindow(
      range,
      day,
      fromTime,
      toTime,
      customer,
    ),
    type === 'delivery',
  );

  const incidents = useIncidentReport(
    range,
    type === 'incidents',
  );

  const loading = type === 'delivery'
    ? delivery.isLoading
    : incidents.isLoading;

  const isError = type === 'delivery'
    ? delivery.isError
    : incidents.isError;

  return (
    <div style={{
      maxWidth: 1200,
      margin: '0 auto',
      padding: 'var(--at-space-32)',
    }}
    >
      <h1 style={{
        margin: 0,
        fontFamily: 'var(--at-font-heading)',
        fontSize: 'var(--at-fs-24)',
        fontWeight: 600,
        color: 'var(--at-fg)',
      }}
      >
        Relatórios
      </h1>
      <div style={{
        fontSize: 'var(--at-fs-14)',
        color: 'var(--at-fg-muted)',
        marginTop: 'var(--at-space-4)',
        marginBottom: 'var(--at-space-24)',
      }}
      >
        Entregabilidade e incidentes resolvidos · dado real do período
      </div>

      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--at-space-12)',
        flexWrap: 'wrap',
        marginBottom: 'var(--at-space-24)',
      }}
      >
        <Segmented
          options={[
            {
              value: 'delivery',
              label: 'Entregabilidade',
              icon: <TrendUp size={14} />,
            },
            {
              value: 'incidents',
              label: 'Incidentes',
              icon: <ChartBar size={14} />,
            },
          ]}
          value={type}
          onChange={(value) => setType(value as ReportType)}
        />
        {type === 'delivery'
          ? (
            <CustomerFilter
              value={customer}
              onChange={setCustomer}
            />
          )
          : null}
        <span style={{ flex: 1 }} />
        {type === 'delivery'
          ? (
            <DayPicker
              day={day}
              fromTime={fromTime}
              toTime={toTime}
              onDay={setDay}
              onFromTime={setFromTime}
              onToTime={setToTime}
            />
          )
          : null}
        <div style={{
          opacity: type === 'delivery' && day
            ? 0.45
            : 1,
          transition: 'opacity .15s',
        }}
        >
          <Segmented
            options={RANGES.map((preset) => ({
              value: preset.value,
              label: preset.label,
            }))}
            value={range}
            onChange={setRange}
          />
        </div>
      </div>

      {loading
        ? (
          <ReportLoading
            type={type}
            progress={type === 'delivery'
              ? delivery.progress
              : undefined}
          />
        )
        : null}

      {isError
        ? <Note>Não foi possível gerar o relatório.</Note>
        : null}

      {type === 'delivery' && delivery.data && !loading
        ? <ReportCard result={delivery.data} />
        : null}

      {type === 'incidents' && incidents.data && !loading
        ? <IncidentReportView report={incidents.data} />
        : null}
    </div>
  );
}

/** Texto auxiliar (muted) de loading/erro. */
function Note({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div style={{
      fontSize: 'var(--at-fs-14)',
      color: 'var(--at-fg-muted)',
      padding: 'var(--at-space-16) 0',
    }}
    >
      {children}
    </div>
  );
}

/** Etapas mostradas no loading de cada tipo de relatório (descreve o que está rodando). */
const REPORT_STEPS: Record<ReportType, {
  title: string;
  steps: string[]
}> = {
  delivery: {
    title: 'Gerando relatório de entregabilidade',
    steps: [
      'Consultando os envios do período (S3 · DuckDB)',
      'Agregando por fornecedor e por hora',
      'Calculando taxa de entrega e top erros',
    ],
  },
  incidents: {
    title: 'Gerando relatório de incidentes',
    steps: [
      'Apurando os incidentes do período',
      'Calculando MTTA / MTTR e variação vs. anterior',
      'Levantando as dimensões mais afetadas',
    ],
  },
};

/** Fases reais da geração do relatório de entregabilidade (ordem do motor), com rótulo PT-BR. */
const DELIVERY_PHASES: Array<{
  phase: DeliveryProgressInterface['phase'];
  label: string
}> = [
  {
    phase: 'mapping',
    label: 'Mapeando as partições da janela',
  },
  {
    phase: 'reading',
    label: 'Lendo os envios do período (S3 · DuckDB)',
  },
  {
    phase: 'querying',
    label: 'Agregando por fornecedor/hora e calculando os erros',
  },
];

/**
 * Loading do relatório, no estilo de "tool rodando". Para a entregabilidade COM progresso ao vivo
 * (stream), reflete a fase atual do motor (mapping → reading X/Y → querying) com ícone de estado;
 * sem progresso (ou incidentes), cai nas etapas descritivas estáticas.
 *
 * @param {{ type: ReportType; progress?: DeliveryProgressInterface }} props - Tipo + progresso ao vivo.
 * @returns {JSX.Element} O card de carregamento.
 */
function ReportLoading({
  type,
  progress,
}: {
  type: ReportType;
  progress?: DeliveryProgressInterface
}): JSX.Element {
  const {
    title,
    steps,
  } = REPORT_STEPS[type];

  const live = type === 'delivery' && progress
    ? progress
    : null;

  return (
    <div style={{
      display: 'flex',
      gap: 'var(--at-space-12)',
      padding: 'var(--at-space-16)',
      background: 'var(--at-white)',
      border: '1px solid var(--at-border)',
      borderRadius: 'var(--at-radius-8)',
    }}
    >
      <CircleNotch
        size={18}
        className="at-spin"
        color="var(--at-primary)"
        style={{
          flexShrink: 0,
          marginTop: 2,
        }}
      />
      <div style={{ flex: 1 }}>
        <div style={{
          fontSize: 'var(--at-fs-14)',
          fontWeight: 600,
          color: 'var(--at-fg)',
        }}
        >
          {title}…
        </div>
        {live
          ? <LivePhases progress={live} />
          : (
            <ul style={{
              margin: 'var(--at-space-8) 0 0',
              padding: 0,
              listStyle: 'none',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--at-space-4)',
            }}
            >
              {steps.map((step) => (
                <li
                  key={step}
                  style={{
                    fontSize: 'var(--at-fs-12)',
                    color: 'var(--at-fg-muted)',
                  }}
                >
                  · {step}
                </li>
              ))}
            </ul>
          )}
      </div>
    </div>
  );
}

/**
 * Lista das fases reais com estado (concluída ✓ / atual ↻ / pendente ○) a partir do progresso do
 * motor. Na fase `reading`, mostra a contagem de partições (X/Y) e uma barra de progresso.
 *
 * @param {{ progress: DeliveryProgressInterface }} props - Etapa atual do motor.
 * @returns {JSX.Element} A lista de fases ao vivo.
 */
function LivePhases({ progress }: { progress: DeliveryProgressInterface }): JSX.Element {
  const currentIndex = DELIVERY_PHASES.findIndex((item) => item.phase === progress.phase);

  return (
    <ul style={{
      margin: 'var(--at-space-8) 0 0',
      padding: 0,
      listStyle: 'none',
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--at-space-4)',
    }}
    >
      {DELIVERY_PHASES.map((
        item,
        index,
      ) => {
        const done = index < currentIndex;
        const active = index === currentIndex;

        const showCount = active
          && item.phase === 'reading'
          && typeof progress.total === 'number'
          && progress.total > 0;

        return (
          <li
            key={item.phase}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--at-space-8)',
              fontSize: 'var(--at-fs-12)',
              color: active
                ? 'var(--at-fg)'
                : 'var(--at-fg-muted)',
              fontWeight: active
                ? 600
                : 400,
            }}
          >
            <PhaseIcon
              done={done}
              active={active}
            />
            <span>
              {item.label}
              {showCount
                ? ` · ${progress.current ?? 0}/${progress.total}`
                : ''}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Ícone de estado da fase: ✓ concluída, ↻ atual (girando), ○ pendente. */
function PhaseIcon({
  done,
  active,
}: {
  done: boolean;
  active: boolean
}): JSX.Element {
  if (done) {
    return (
      <CheckCircle
        size={13}
        weight="fill"
        color="var(--at-success-300)"
        style={{ flexShrink: 0 }}
      />
    );
  }

  if (active) {
    return (
      <CircleNotch
        size={13}
        className="at-spin"
        color="var(--at-primary)"
        style={{ flexShrink: 0 }}
      />
    );
  }

  return (
    <Circle
      size={13}
      color="var(--at-fg-subtle)"
      style={{ flexShrink: 0 }}
    />
  );
}

/** Controle segmentado (botões mutuamente exclusivos). */
function Segmented({
  options,
  value,
  onChange,
}: {
  options: Array<{
    value: string;
    label: string;
    icon?: React.ReactNode
  }>;
  value: string;
  onChange: (value: string) => void
}): JSX.Element {
  return (
    <div style={{
      display: 'inline-flex',
      gap: 'var(--at-space-4)',
      padding: 4,
      borderRadius: 'var(--at-radius-8)',
      background: 'var(--at-bg-soft)',
      border: '1px solid var(--at-border)',
    }}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--at-space-4)',
            height: 30,
            padding: '0 var(--at-space-12)',
            borderRadius: 'var(--at-radius-4)',
            border: 'none',
            background: value === option.value
              ? 'var(--at-white)'
              : 'transparent',
            color: value === option.value
              ? 'var(--at-fg)'
              : 'var(--at-fg-muted)',
            fontSize: 'var(--at-fs-13)',
            fontWeight: 600,
            cursor: 'pointer',
            boxShadow: value === option.value
              ? 'var(--at-shadow-xs, 0 1px 2px rgba(0,0,0,0.08))'
              : 'none',
          }}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Filtro de cliente da entregabilidade: id do cliente (ex.: "1001"); vazio = todos. Debounce natural
 * via estado controlado — a query refaz quando o valor muda (a janela inclui `filters.customer_id`).
 *
 * @param {{ value: string; onChange: (next: string) => void }} props - Valor e setter.
 * @returns {JSX.Element} O campo de cliente.
 */
function CustomerFilter({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void
}): JSX.Element {
  return (
    <div style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 'var(--at-space-8)',
      height: 38,
      padding: '0 var(--at-space-12)',
      borderRadius: 'var(--at-radius-8)',
      background: 'var(--at-bg-soft)',
      border: '1px solid var(--at-border)',
    }}
    >
      <Buildings
        size={14}
        color="var(--at-fg-muted)"
      />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Cliente (id) · todos"
        inputMode="numeric"
        style={{
          width: 130,
          border: 'none',
          outline: 'none',
          background: 'transparent',
          fontSize: 'var(--at-fs-13)',
          color: 'var(--at-fg)',
        }}
      />
      {value
        ? (
          <button
            type="button"
            onClick={() => onChange('')}
            title="Limpar (todos os clientes)"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 22,
              height: 22,
              border: 'none',
              borderRadius: 'var(--at-radius-4)',
              background: 'transparent',
              color: 'var(--at-fg-muted)',
              cursor: 'pointer',
            }}
          >
            <X size={13} />
          </button>
        )
        : null}
    </div>
  );
}

/** Estilo dos campos nativos (date/time) do seletor de dia. */
const PICKER_INPUT_STYLE: React.CSSProperties = {
  height: 30,
  border: '1px solid var(--at-border)',
  borderRadius: 'var(--at-radius-4)',
  background: 'var(--at-white)',
  color: 'var(--at-fg)',
  fontSize: 'var(--at-fs-13)',
  padding: '0 var(--at-space-8)',
  colorScheme: 'light',
};

/**
 * Seletor de DIA específico (com intervalo de horas opcional) da entregabilidade — tudo no fuso do
 * operador. Vazio = usa o preset; com dia preenchido, sobrepõe o preset (dia inteiro, ou `das X às Y`).
 *
 * @returns {JSX.Element} O seletor de dia/horário.
 */
function DayPicker({
  day,
  fromTime,
  toTime,
  onDay,
  onFromTime,
  onToTime,
}: {
  day: string;
  fromTime: string;
  toTime: string;
  onDay: (value: string) => void;
  onFromTime: (value: string) => void;
  onToTime: (value: string) => void
}): JSX.Element {
  const clear = (): void => {
    onDay('');
    onFromTime('');
    onToTime('');
  };

  return (
    // lang="pt-BR" força o formato dos inputs nativos: data DD/MM/AAAA e hora 24h (independe do locale do navegador).
    <div
      lang="pt-BR"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--at-space-8)',
        height: 38,
        padding: '0 var(--at-space-8)',
        borderRadius: 'var(--at-radius-8)',
        background: 'var(--at-bg-soft)',
        border: '1px solid var(--at-border)',
      }}
    >
      <CalendarBlank
        size={14}
        color="var(--at-fg-muted)"
      />
      <input
        type="date"
        value={day}
        max={dayKeyInTz(new Date().toISOString())}
        onChange={(event) => onDay(event.target.value)}
        title="Dia específico (horário de Brasília)"
        style={PICKER_INPUT_STYLE}
      />
      {day
        ? (
          <>
            <span style={{
              fontSize: 'var(--at-fs-12)',
              color: 'var(--at-fg-muted)',
            }}
            >
              das
            </span>
            <input
              type="time"
              value={fromTime}
              onChange={(event) => onFromTime(event.target.value)}
              style={PICKER_INPUT_STYLE}
            />
            <span style={{
              fontSize: 'var(--at-fs-12)',
              color: 'var(--at-fg-muted)',
            }}
            >
              às
            </span>
            <input
              type="time"
              value={toTime}
              onChange={(event) => onToTime(event.target.value)}
              style={PICKER_INPUT_STYLE}
            />
            <button
              type="button"
              onClick={clear}
              title="Limpar (voltar ao preset)"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 28,
                height: 28,
                border: 'none',
                borderRadius: 'var(--at-radius-4)',
                background: 'transparent',
                color: 'var(--at-fg-muted)',
                cursor: 'pointer',
              }}
            >
              <X size={14} />
            </button>
          </>
        )
        : null}
    </div>
  );
}

/**
 * Visão do relatório de incidentes resolvidos (paridade com o protótipo "Relatórios de incidentes"):
 * subtítulo com MTTA/MTTR, KPIs (total/críticos/MTTA/MTTR), distribuição por ação tomada, top
 * dimensões afetadas e tabela de incidentes recentes (com export CSV).
 *
 * @param {{ report: IncidentReportInterface }} props - Relatório de incidentes da janela.
 * @returns {JSX.Element} A visão de incidentes.
 */
function IncidentReportView({ report }: { report: IncidentReportInterface }): JSX.Element {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--at-space-24)',
    }}
    >
      <div style={{
        fontSize: 'var(--at-fs-13)',
        color: 'var(--at-fg-muted)',
      }}
      >
        {report.window}
        {' · '}
        {report.total}
        {' incidentes resolvidos · MTTA '}
        {formatDurationSeconds(report.mtta_seconds)}
        {' · MTTR '}
        {formatDurationSeconds(report.mttr_seconds)}
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 'var(--at-space-12)',
      }}
      >
        <Kpi
          label="Total no período"
          value={String(report.total)}
          hint={deltaHint(report.delta_vs_previous)}
        />
        <Kpi
          label="Críticos"
          value={String(report.by_severity.critical)}
          hint={criticalHint(
            report.by_severity.critical,
            report.total,
          )}
          color="var(--at-danger-300)"
        />
        <Kpi
          label="MTTA médio"
          value={formatDurationSeconds(report.mtta_seconds)}
          hint={slaHint(
            report.mtta_seconds,
            MTTA_TARGET_SECONDS,
            '5 min',
          )}
          color="var(--at-primary)"
        />
        <Kpi
          label="MTTR médio"
          value={formatDurationSeconds(report.mttr_seconds)}
          hint={slaHint(
            report.mttr_seconds,
            MTTR_TARGET_SECONDS,
            '30 min',
          )}
          color="var(--at-primary)"
        />
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1.2fr',
        gap: 'var(--at-space-16)',
      }}
      >
        <ActionDistribution report={report} />
        <TopDimensions dimensions={report.affected_dimensions} />
      </div>

      <IncidentsTable report={report} />
    </div>
  );
}

/** Formata uma duração em segundos: `3m 12s` / `28m 04s` / `1h 5m` / `45s`; `—` se nulo. */
function formatDurationSeconds(seconds: number | null): string {
  if (seconds === null) {
    return '—';
  }

  const total = Math.max(
    0,
    Math.round(seconds),
  );

  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${String(secs).padStart(
      2,
      '0',
    )}s`;
  }

  return `${secs}s`;
}

/** Dica do KPI "Total no período": variação vs o período anterior de mesmo tamanho. */
function deltaHint(delta: number | null): string | undefined {
  if (delta === null) {
    return undefined;
  }

  if (delta > 0) {
    return `+${delta} vs período anterior`;
  }

  if (delta < 0) {
    return `${delta} vs período anterior`;
  }

  return 'sem variação vs período anterior';
}

/** Dica do KPI "Críticos": participação percentual no volume total. */
function criticalHint(
  critical: number,
  total: number,
): string {
  if (total === 0) {
    return '0% do volume';
  }

  return `${Math.round((critical / total) * 100)}% do volume`;
}

/** Dica de SLA dos KPIs de MTTA/MTTR (`meta < X · ok|acima|sem dados`). */
function slaHint(
  seconds: number | null,
  targetSeconds: number,
  targetLabel: string,
): string {
  if (seconds === null) {
    return `meta < ${targetLabel} · sem dados`;
  }

  const status = seconds <= targetSeconds
    ? 'ok'
    : 'acima';

  return `meta < ${targetLabel} · ${status}`;
}

/** Largura (%) da barra de distribuição: proporção do total, com mínimo visível quando há contagem. */
function barWidth(
  count: number,
  total: number,
): number {
  if (
    total === 0
    || count === 0
  ) {
    return 0;
  }

  return Math.max(
    (count / total) * 100,
    6,
  );
}

/** Soma os incidentes resolvidos por categoria de ação. */
function actionCounts(report: IncidentReportInterface): Record<ActionCategoryType, number> {
  const counts: Record<ActionCategoryType, number> = {
    provider_recovered: 0,
    provider_escalated: 0,
    internal_escalated: 0,
    false_positive: 0,
    customer_communicated: 0,
    monitoring_only: 0,
    other: 0,
  };

  for (const incident of report.resolved) {
    counts[incident.action] += 1;
  }

  return counts;
}

/** Painel "Distribuição por ação tomada": uma barra por categoria (todas, inclusive zeradas). */
function ActionDistribution({ report }: { report: IncidentReportInterface }): JSX.Element {
  const counts = actionCounts(report);

  return (
    <Card>
      <PanelHeading>Distribuição por ação tomada</PanelHeading>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--at-space-12)',
        marginTop: 'var(--at-space-16)',
      }}
      >
        {(Object.keys(ACTION_LABEL) as ActionCategoryType[]).map((action) => (
          <div
            key={action}
            style={{
              display: 'grid',
              gridTemplateColumns: '170px 1fr 30px',
              alignItems: 'center',
              gap: 'var(--at-space-12)',
            }}
          >
            <span style={{
              fontSize: 'var(--at-fs-13)',
              color: 'var(--at-fg)',
            }}
            >
              {ACTION_LABEL[action]}
            </span>
            <span style={{
              height: 8,
              background: 'var(--at-bg-soft)',
              borderRadius: 'var(--at-radius-full)',
              overflow: 'hidden',
            }}
            >
              <span style={{
                display: 'block',
                width: `${barWidth(
                  counts[action],
                  report.total,
                )}%`,
                height: '100%',
                background: ACTION_PALETTE[action],
              }}
              />
            </span>
            <span style={{
              fontFamily: 'ui-monospace, Menlo, monospace',
              fontSize: 'var(--at-fs-12)',
              color: 'var(--at-fg-muted)',
              textAlign: 'right',
              fontVariantNumeric: 'tabular-nums',
            }}
            >
              {counts[action]}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

/** Painel "Top dimensões afetadas": abas Fornecedor/Cliente/Rota + lista ordenada por contagem. */
function TopDimensions({ dimensions }: { dimensions: AffectedDimensionInterface[] }): JSX.Element {
  // Abre na dimensão mais afetada (lista vem ordenada por contagem) — evita abrir numa aba vazia.
  const [
    tab,
    setTab,
  ] = useState<DimensionType>(dimensions[0]?.dimension ?? 'provider');

  const items = dimensions.filter((dimension) => dimension.dimension === tab);

  return (
    <Card>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--at-space-12)',
        marginBottom: 'var(--at-space-16)',
      }}
      >
        <PanelHeading>Top dimensões afetadas</PanelHeading>
        <Segmented
          options={DIMENSION_TABS.map((dimension) => ({
            value: dimension,
            label: DIMENSION_LABEL[dimension],
          }))}
          value={tab}
          onChange={(value) => setTab(value as DimensionType)}
        />
      </div>
      {items.length === 0
        ? (
          <Note>
            Nenhuma dimensão
            {' '}
            {DIMENSION_LABEL[tab].toLowerCase()}
            {' '}
            afetada na janela.
          </Note>
        )
        : (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--at-space-8)',
          }}
          >
            {items.map((item) => (
              <div
                key={`${item.dimension}-${item.value}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--at-space-12)',
                  padding: '8px 10px',
                  background: 'var(--at-bg-soft)',
                  borderRadius: 'var(--at-radius-4)',
                  border: '1px solid var(--at-border)',
                }}
              >
                <span style={{
                  width: 8,
                  height: 8,
                  borderRadius: 'var(--at-radius-full)',
                  background: SEVERITY_COLOR[item.severity],
                }}
                />
                <span style={{
                  flex: 1,
                  fontSize: 'var(--at-fs-13)',
                  fontWeight: 600,
                  color: 'var(--at-fg)',
                }}
                >
                  {item.value}
                </span>
                <span style={{
                  fontFamily: 'ui-monospace, Menlo, monospace',
                  fontSize: 'var(--at-fs-12)',
                  color: 'var(--at-fg-muted)',
                }}
                >
                  {item.count}
                  {' incidentes'}
                </span>
              </div>
            ))}
          </div>
        )}
    </Card>
  );
}

/** Tabela "Incidentes recentes": filtro por severidade + export CSV (metadados, sem PII). */
function IncidentsTable({ report }: { report: IncidentReportInterface }): JSX.Element {
  const [
    severity,
    setSeverity,
  ] = useState<string>('all');

  const [
    filterOpen,
    setFilterOpen,
  ] = useState(false);

  const rows = severity === 'all'
    ? report.resolved
    : report.resolved.filter((incident) => incident.severity === severity);

  const headers = [
    'Incidente',
    'Severidade',
    'Regra',
    'Resolvido',
    'Ação',
    'Analista',
    'Duração',
    'Escalonamento',
  ];

  return (
    <Card padding={0}>
      <div style={{
        padding: '14px 18px',
        borderBottom: '1px solid var(--at-border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--at-space-12)',
      }}
      >
        <PanelHeading>Incidentes recentes</PanelHeading>
        <div style={{
          display: 'flex',
          gap: 'var(--at-space-8)',
        }}
        >
          <ToolbarButton
            icon={<Funnel size={14} />}
            active={filterOpen}
            onClick={() => setFilterOpen((open) => !open)}
          >
            Filtrar
          </ToolbarButton>
          <ToolbarButton
            icon={<DownloadSimple size={14} />}
            onClick={() => exportIncidentsCsv(rows)}
          >
            Exportar CSV
          </ToolbarButton>
        </div>
      </div>

      {filterOpen
        ? (
          <div style={{
            padding: '12px 18px',
            borderBottom: '1px solid var(--at-border)',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--at-space-12)',
          }}
          >
            <span style={{
              fontSize: 'var(--at-fs-12)',
              color: 'var(--at-fg-muted)',
            }}
            >
              Severidade
            </span>
            <Segmented
              options={[
                {
                  value: 'all',
                  label: 'Todas',
                },
                {
                  value: 'critical',
                  label: 'Crítico',
                },
                {
                  value: 'warning',
                  label: 'Atenção',
                },
                {
                  value: 'info',
                  label: 'Info',
                },
              ]}
              value={severity}
              onChange={setSeverity}
            />
          </div>
        )
        : null}

      <div style={{ overflowX: 'auto' }}>
        <table style={{
          width: '100%',
          borderCollapse: 'collapse',
        }}
        >
          <thead>
            <tr style={{ background: 'var(--at-bg-soft)' }}>
              {headers.map((header) => (
                <th
                  key={header}
                  style={{
                    textAlign: 'left',
                    padding: '9px 14px',
                    fontSize: 11,
                    fontWeight: 600,
                    color: 'var(--at-fg-muted)',
                    textTransform: 'uppercase',
                    letterSpacing: 0.4,
                    borderBottom: '1px solid var(--at-border)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((
              incident,
              index,
            ) => (
              <tr
                key={incident.id}
                style={{
                  borderBottom: index < rows.length - 1
                    ? '1px solid var(--at-border)'
                    : 'none',
                }}
              >
                <td style={{ padding: '10px 14px' }}>
                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 'var(--at-space-8)',
                  }}
                  >
                    <span style={{
                      fontFamily: 'ui-monospace, Menlo, monospace',
                      fontSize: 'var(--at-fs-12)',
                      color: 'var(--at-fg)',
                    }}
                    >
                      {incident.id}
                    </span>
                    {incident.shadow
                      ? <ShadowTag />
                      : null}
                  </span>
                </td>
                <td style={{ padding: '10px 14px' }}>
                  <SeverityChip severity={incident.severity} />
                </td>
                <td style={{
                  padding: '10px 14px',
                  fontSize: 'var(--at-fs-13)',
                  color: 'var(--at-fg)',
                }}
                >
                  {incident.rule}
                </td>
                <td style={{
                  padding: '10px 14px',
                  fontSize: 'var(--at-fs-12)',
                  color: 'var(--at-fg-muted)',
                  whiteSpace: 'nowrap',
                }}
                >
                  {formatRelativeTime(incident.resolved_at)}
                </td>
                <td style={{ padding: '10px 14px' }}>
                  <ActionBadge action={incident.action} />
                </td>
                <td style={{
                  padding: '10px 14px',
                  fontSize: 'var(--at-fs-13)',
                  color: 'var(--at-fg)',
                }}
                >
                  {incident.analyst ?? '—'}
                </td>
                <td style={{
                  padding: '10px 14px',
                  fontSize: 'var(--at-fs-13)',
                  color: 'var(--at-fg-muted)',
                  fontVariantNumeric: 'tabular-nums',
                }}
                >
                  {incident.duration}
                </td>
                <td style={{
                  padding: '10px 14px',
                  fontSize: 'var(--at-fs-12)',
                  color: 'var(--at-fg-muted)',
                }}
                >
                  {incident.escalated_to ?? '—'}
                </td>
              </tr>
            ))}
            {rows.length === 0
              ? (
                <tr>
                  <td
                    colSpan={headers.length}
                    style={{
                      padding: 'var(--at-space-20)',
                      textAlign: 'center',
                      fontSize: 'var(--at-fs-13)',
                      color: 'var(--at-fg-muted)',
                    }}
                  >
                    Nenhum incidente resolvido na janela.
                  </td>
                </tr>
              )
              : null}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** Badge da ação tomada: ponto + rótulo, tonalizado pela paleta da ação. */
function ActionBadge({ action }: { action: ActionCategoryType }): JSX.Element {
  const color = ACTION_PALETTE[action];

  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 'var(--at-space-4)',
      padding: '2px 8px',
      borderRadius: 999,
      background: `${color}1a`,
      color,
      fontSize: 'var(--at-fs-11)',
      fontWeight: 600,
      whiteSpace: 'nowrap',
    }}
    >
      <span style={{
        width: 6,
        height: 6,
        borderRadius: 999,
        background: color,
      }}
      />
      {ACTION_LABEL[action]}
    </span>
  );
}

/** Selo "shadow" junto ao id do incidente: nasceu de regra em observação silenciosa. */
function ShadowTag(): JSX.Element {
  return (
    <span
      title="Detectado por regra em shadow mode (registrado, não notificado)"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--at-space-4)',
        padding: '1px 6px',
        borderRadius: 999,
        background: 'var(--at-bg-soft)',
        border: '1px solid var(--at-border)',
        color: 'var(--at-fg-muted)',
        fontSize: 'var(--at-fs-11)',
        fontWeight: 600,
      }}
    >
      <EyeSlash size={11} />
      shadow
    </span>
  );
}

/** Escapa um valor para célula CSV (`;` delimitador): aspas se contiver `;`, `"` ou quebra de linha. */
function csvCell(value: string): string {
  if (/[";\n\r]/.test(value)) {
    return `"${value.replace(
      /"/g,
      '""',
    )}"`;
  }

  return value;
}

/**
 * Gera e baixa o CSV (BOM + `;`, Excel pt-BR) dos incidentes resolvidos exibidos — apenas metadados
 * do incidente (sem PII), montado no cliente a partir do que já está em tela.
 *
 * @param {ResolvedIncidentInterface[]} rows - Incidentes resolvidos exibidos (já filtrados).
 * @returns {void}
 */
function exportIncidentsCsv(rows: ResolvedIncidentInterface[]): void {
  const header = [
    'Incidente',
    'Severidade',
    'Regra',
    'Resolvido',
    'Ação',
    'Analista',
    'Duração',
    'Escalonamento',
    'Shadow',
  ];

  const lines = rows.map((incident) => [
    incident.id,
    SEVERITY_LABEL[incident.severity],
    incident.rule,
    incident.resolved_at,
    ACTION_LABEL[incident.action],
    incident.analyst ?? '',
    incident.duration,
    incident.escalated_to ?? '',
    incident.shadow
      ? 'Sim'
      : 'Não',
  ]
    .map(csvCell)
    .join(';'));

  const content = `\uFEFF${[
    header.join(';'),
    ...lines,
  ].join('\r\n')}`;

  triggerBlobDownload(
    new Blob(
      [content],
      { type: 'text/csv;charset=utf-8' },
    ),
    'atena-relatorio-incidentes.csv',
  );
}

/** Botão pequeno de toolbar (contorno neutro) usado no cabeçalho da tabela. */
function ToolbarButton({
  children,
  onClick,
  active,
  icon,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  icon?: React.ReactNode
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--at-space-4)',
        height: 30,
        padding: '0 var(--at-space-12)',
        borderRadius: 'var(--at-radius-4)',
        border: '1px solid var(--at-border)',
        background: active
          ? 'var(--at-bg-soft)'
          : 'var(--at-white)',
        color: 'var(--at-fg)',
        fontSize: 'var(--at-fs-13)',
        fontWeight: 600,
        cursor: 'pointer',
      }}
    >
      {icon}
      {children}
    </button>
  );
}

/** Cartão branco com borda (base dos painéis do relatório de incidentes). */
function Card({
  children,
  padding = 20,
}: {
  children: React.ReactNode;
  padding?: number
}): JSX.Element {
  return (
    <div style={{
      background: 'var(--at-white)',
      border: '1px solid var(--at-border)',
      borderRadius: 'var(--at-radius-8)',
      padding,
      overflow: 'hidden',
    }}
    >
      {children}
    </div>
  );
}

/** Título de painel (h4 14px, normal-case — paridade com o protótipo). */
function PanelHeading({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <h4 style={{
      margin: 0,
      fontFamily: 'var(--at-font-heading)',
      fontSize: 'var(--at-fs-14)',
      fontWeight: 600,
      color: 'var(--at-fg)',
    }}
    >
      {children}
    </h4>
  );
}

/** Card de KPI (rótulo + número + dica). */
function Kpi({
  label,
  value,
  hint,
  color = 'var(--at-fg)',
}: {
  label: string;
  value: string;
  hint?: string;
  color?: string
}): JSX.Element {
  return (
    <div style={{
      padding: 'var(--at-space-16)',
      background: 'var(--at-white)',
      border: '1px solid var(--at-border)',
      borderRadius: 'var(--at-radius-8)',
    }}
    >
      <div style={{
        fontSize: 'var(--at-fs-10)',
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
        fontSize: 'var(--at-fs-28)',
        fontWeight: 700,
        lineHeight: 1.15,
        color,
        marginTop: 'var(--at-space-4)',
        fontVariantNumeric: 'tabular-nums',
      }}
      >
        {value}
      </div>
      {hint !== undefined
        ? (
          <div style={{
            fontSize: 'var(--at-fs-11)',
            color: 'var(--at-fg-muted)',
            marginTop: 'var(--at-space-4)',
          }}
          >
            {hint}
          </div>
        )
        : null}
    </div>
  );
}

/** Chip de severidade (cor + rótulo). */
function SeverityChip({ severity }: { severity: IncidentSeverityType }): JSX.Element {
  const color = SEVERITY_COLOR[severity];

  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 'var(--at-space-4)',
      padding: '2px 8px',
      borderRadius: 999,
      background: `${color}1a`,
      color,
      fontSize: 'var(--at-fs-11)',
      fontWeight: 600,
    }}
    >
      <span style={{
        width: 6,
        height: 6,
        borderRadius: 999,
        background: color,
      }}
      />
      {SEVERITY_LABEL[severity]}
    </span>
  );
}
