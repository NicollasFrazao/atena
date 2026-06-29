import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  CaretRight,
  ChatsCircle,
  CheckCircle,
  EyeSlash,
  Flag,
  type Icon,
  MagnifyingGlass,
} from '@phosphor-icons/react';
import type {
  DimensionType,
  IncidentInterface,
  IncidentSeverityType,
  WsServerEvent,
} from '@atena/types';
import { acknowledgeIncident, useIncidents } from '../api/incidents';
import { useRealtimeConnected, useRealtimeEvent } from '../realtime/realtime-context';
import { SEVERITY_COLOR, SEVERITY_LABEL } from './severity';
import { ResolveIncidentModal } from './ResolveIncidentModal';
import { IncidentDetailDrawer } from './IncidentDetailDrawer';

/** Caminho do assistente já investigando o incidente (auto-envia via `?q=`). */
function investigateHref(incident: IncidentInterface): string {
  return `/?q=${encodeURIComponent(
    `Investigue o incidente ${incident.id} (${incident.rule}). ${incident.summary}`,
  )}`;
}

/**
 * Tela de Incidentes ativos: KPIs + seções "Aguardando ação" (detected) e "Em análise"
 * (acknowledged), com cards ricos (severidade, métricas, envios impactados). Os incidentes vêm da
 * detecção REAL (o detector roda sobre os dados); esta tela só os lista e reflete os abertos em tempo
 * quase real (WebSocket invalida as queries). Resolução manual é fatia futura (ações de mutação ficam
 * desabilitadas). "Investigar" leva o analista ao assistente.
 *
 * @returns {JSX.Element} A tela de incidentes.
 */
export function IncidentsPage(): JSX.Element {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [
    resolveTarget,
    setResolveTarget,
  ] = useState<IncidentInterface | null>(null);

  const [
    detailTarget,
    setDetailTarget,
  ] = useState<string | null>(null);

  // Alterna entre incidentes ativos (alertados) e os em shadow mode (registrados, mas silenciosos).
  const [
    shadowView,
    setShadowView,
  ] = useState(false);

  // Abre o drawer quando se chega via `?detalhe=<id>` (ex.: card de incidente no chat → "Ver detalhes").
  const [
    searchParams,
    setSearchParams,
  ] = useSearchParams();

  const detalheParam = searchParams.get('detalhe');

  useEffect(
    () => {
      if (detalheParam) {
        setDetailTarget(detalheParam);
      }
    },
    [detalheParam],
  );

  // Fecha o drawer e limpa o `?detalhe` — sem isso, reabrir o MESMO incidente (param inalterado)
  // não dispararia o efeito.
  const closeDetail = useCallback(
    (): void => {
      setDetailTarget(null);

      const next = new URLSearchParams(searchParams);

      next.delete('detalhe');

      setSearchParams(
        next,
        { replace: true },
      );
    },
    [
      searchParams,
      setSearchParams,
    ],
  );

  const open = useIncidents({
    status: 'open',
    limit: 100,
    shadow: shadowView
      ? 'true'
      : undefined,
  });

  const resolvedTotal = useIncidents({
    status: 'resolved',
    limit: 1,
  }).data?.total ?? 0;

  const autoResolvedTotal = useIncidents({
    status: 'auto_resolved',
    limit: 1,
  }).data?.total ?? 0;

  // Qualquer evento de incidente invalida as listas (badge + esta tela atualizam sozinhos).
  const onWsEvent = useCallback(
    (_event: WsServerEvent): void => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] }).catch(() => undefined);
    },
    [queryClient],
  );

  useRealtimeEvent(onWsEvent);

  const connected = useRealtimeConnected();

  const [
    query,
    setQuery,
  ] = useState('');

  const [
    severityFilter,
    setSeverityFilter,
  ] = useState<IncidentSeverityType | 'all'>('all');

  const [
    dimensionFilter,
    setDimensionFilter,
  ] = useState<DimensionType | 'all'>('all');

  const incidents = open.data?.rows ?? [];
  const detected = incidents.filter((incident) => incident.status === 'detected');
  const acknowledged = incidents.filter((incident) => incident.status === 'acknowledged');

  // Filtro client-side (lista de ativos é pequena): texto/código + severidade + dimensão.
  const matchesFilter = (incident: IncidentInterface): boolean => {
    if (
      severityFilter !== 'all'
      && incident.severity !== severityFilter
    ) {
      return false;
    }

    if (
      dimensionFilter !== 'all'
      && incident.dimension_type !== dimensionFilter
    ) {
      return false;
    }

    const term = query.trim().toLowerCase();

    if (!term) {
      return true;
    }

    return `${incident.id} ${incident.dimension_value} ${incident.summary} ${incident.rule}`
      .toLowerCase()
      .includes(term);
  };

  const detectedList = detected.filter(matchesFilter);
  const acknowledgedList = acknowledged.filter(matchesFilter);

  const noMatches = incidents.length > 0
    && detectedList.length === 0
    && acknowledgedList.length === 0;

  const invalidate = (): void => {
    queryClient.invalidateQueries({ queryKey: ['incidents'] }).catch(() => undefined);
  };

  const onAcknowledge = (id: string): void => {
    acknowledgeIncident(id).then(invalidate).catch(() => undefined);
  };

  const onResolved = (): void => {
    setResolveTarget(null);
    setDetailTarget(null);
    invalidate();
  };

  const onInvestigate = (incident: IncidentInterface): void => {
    navigate(investigateHref(incident));
  };

  const onResolveFromDetail = (incident: IncidentInterface): void => {
    setDetailTarget(null);
    setResolveTarget(incident);
  };

  return (
    <div style={{
      maxWidth: 1200,
      margin: '0 auto',
      padding: 'var(--at-space-32)',
    }}
    >
      <IncidentsHeader
        shadowView={shadowView}
        onShadowChange={setShadowView}
        detectedCount={detected.length}
        acknowledgedCount={acknowledged.length}
        connected={connected}
        incidentsCount={incidents.length}
      />

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 'var(--at-space-12)',
        marginBottom: 'var(--at-space-24)',
      }}
      >
        <StatCard
          label="Novos"
          value={detected.length}
          color={detected.length > 0
            ? 'var(--at-danger-200)'
            : 'var(--at-fg)'}
        />
        <StatCard
          label="Em análise"
          value={acknowledged.length}
          color={acknowledged.length > 0
            ? 'var(--at-info-100)'
            : 'var(--at-fg)'}
        />
        <StatCard
          label="Resolvidos"
          value={resolvedTotal}
          color="var(--at-success-200)"
        />
        <StatCard
          label="Auto-resolvidos"
          value={autoResolvedTotal}
          color="var(--at-fg)"
        />
      </div>

      {incidents.length > 0
        ? (
          <IncidentFilters
            query={query}
            onQuery={setQuery}
            severity={severityFilter}
            onSeverity={setSeverityFilter}
            dimension={dimensionFilter}
            onDimension={setDimensionFilter}
          />
        )
        : null}

      {open.isLoading
        ? <Muted>Carregando incidentes…</Muted>
        : null}

      {open.isError
        ? <Muted>Não foi possível carregar os incidentes.</Muted>
        : null}

      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--at-space-12)',
      }}
      >
        {detectedList.length > 0
          ? (
            <SectionHeader
              dotColor="var(--at-danger-200)"
              title="Aguardando ação"
              count={detectedList.length}
            />
          )
          : null}
        {detectedList.map((incident) => (
          <IncidentBigCard
            key={incident.id}
            incident={incident}
            onAcknowledge={onAcknowledge}
            onResolve={setResolveTarget}
            onInvestigate={onInvestigate}
            onDetail={(target) => setDetailTarget(target.id)}
          />
        ))}

        {acknowledgedList.length > 0
          ? (
            <SectionHeader
              dotColor="var(--at-info-100)"
              title="Em análise"
              count={acknowledgedList.length}
            />
          )
          : null}
        {acknowledgedList.map((incident) => (
          <IncidentBigCard
            key={incident.id}
            incident={incident}
            onAcknowledge={onAcknowledge}
            onResolve={setResolveTarget}
            onInvestigate={onInvestigate}
            onDetail={(target) => setDetailTarget(target.id)}
          />
        ))}

        {noMatches
          ? <Muted>Nenhum incidente com esses filtros.</Muted>
          : null}

        {!open.isLoading && incidents.length === 0
          ? <EmptyState />
          : null}
      </div>

      {detailTarget !== null
        ? (
          <IncidentDetailDrawer
            incidentId={detailTarget}
            onClose={closeDetail}
            onAcknowledge={onAcknowledge}
            onResolve={onResolveFromDetail}
            onInvestigate={onInvestigate}
          />
        )
        : null}

      {resolveTarget !== null
        ? (
          <ResolveIncidentModal
            incident={resolveTarget}
            onClose={() => setResolveTarget(null)}
            onResolved={onResolved}
          />
        )
        : null}
    </div>
  );
}

/** Card de KPI (rótulo + número grande). */
function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string
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
        fontSize: 'var(--at-fs-32)',
        fontWeight: 700,
        lineHeight: 1.1,
        marginTop: 'var(--at-space-4)',
        fontVariantNumeric: 'tabular-nums',
        color,
      }}
      >
        {value}
      </div>
    </div>
  );
}

/** Cabeçalho de seção (ponto colorido + título + contagem). */
function SectionHeader({
  dotColor,
  title,
  count,
}: {
  dotColor: string;
  title: string;
  count: number
}): JSX.Element {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--at-space-8)',
      marginTop: 'var(--at-space-8)',
    }}
    >
      <span style={{
        width: 8,
        height: 8,
        borderRadius: 999,
        background: dotColor,
      }}
      />
      <h2 style={{
        margin: 0,
        fontSize: 'var(--at-fs-14)',
        fontWeight: 600,
        color: 'var(--at-fg)',
      }}
      >
        {title}
      </h2>
      <span style={{
        fontSize: 'var(--at-fs-12)',
        fontWeight: 700,
        color: 'var(--at-fg-muted)',
      }}
      >
        {count}
      </span>
    </div>
  );
}

/** Opções do filtro de severidade. */
const SEVERITY_FILTERS: (IncidentSeverityType | 'all')[] = [
  'all',
  'critical',
  'warning',
  'info',
];

/** Opções do filtro de dimensão. */
const DIMENSION_FILTERS: {
  value: DimensionType | 'all';
  label: string
}[] = [
  {
    value: 'all',
    label: 'Todas',
  },
  {
    value: 'customer',
    label: 'Cliente',
  },
  {
    value: 'provider',
    label: 'Provedor',
  },
  {
    value: 'route',
    label: 'Rota',
  },
  {
    value: 'global',
    label: 'Global',
  },
];

/**
 * Barra de filtros dos incidentes ativos: busca por texto (código do incidente, cliente/provedor/
 * rota, resumo) + filtro por severidade e por dimensão. Tudo client-side sobre os ativos carregados.
 *
 * @param {object} props - Estado e callbacks dos filtros.
 * @returns {JSX.Element} A barra de filtros.
 */
function IncidentFilters({
  query,
  onQuery,
  severity,
  onSeverity,
  dimension,
  onDimension,
}: {
  query: string;
  onQuery: (value: string) => void;
  severity: IncidentSeverityType | 'all';
  onSeverity: (value: IncidentSeverityType | 'all') => void;
  dimension: DimensionType | 'all';
  onDimension: (value: DimensionType | 'all') => void
}): JSX.Element {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--at-space-8)',
      marginBottom: 'var(--at-space-16)',
    }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--at-space-8)',
        height: 38,
        padding: '0 var(--at-space-12)',
        background: 'var(--at-white)',
        border: '1px solid var(--at-border)',
        borderRadius: 'var(--at-radius-8)',
      }}
      >
        <MagnifyingGlass
          size={16}
          color="var(--at-fg-muted)"
        />
        <input
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="Buscar por código, cliente/provedor/rota ou resumo…"
          style={{
            flex: 1,
            border: 'none',
            outline: 'none',
            background: 'transparent',
            fontSize: 'var(--at-fs-14)',
            color: 'var(--at-fg)',
          }}
        />
      </div>

      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 'var(--at-space-4)',
      }}
      >
        {SEVERITY_FILTERS.map((value) => (
          <FilterChip
            key={value}
            label={value === 'all'
              ? 'Todas'
              : SEVERITY_LABEL[value]}
            active={severity === value}
            activeColor={value === 'all'
              ? 'var(--at-fg)'
              : SEVERITY_COLOR[value]}
            onClick={() => onSeverity(value)}
          />
        ))}
        <span style={{
          width: 1,
          height: 18,
          background: 'var(--at-border)',
          margin: '0 var(--at-space-4)',
        }}
        />
        {DIMENSION_FILTERS.map((item) => (
          <FilterChip
            key={item.value}
            label={item.label}
            active={dimension === item.value}
            activeColor="var(--at-fg)"
            onClick={() => onDimension(item.value)}
          />
        ))}
      </div>
    </div>
  );
}

/** Chip de filtro (segmentado): ativo ganha borda/realce na cor informada. */
function FilterChip({
  label,
  active,
  activeColor,
  onClick,
}: {
  label: string;
  active: boolean;
  activeColor: string;
  onClick: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '4px 10px',
        borderRadius: 999,
        fontSize: 'var(--at-fs-12)',
        fontWeight: 600,
        cursor: 'pointer',
        border: active
          ? `1px solid ${activeColor}`
          : '1px solid var(--at-border)',
        background: active
          ? 'var(--at-bg-soft)'
          : 'var(--at-white)',
        color: active
          ? activeColor
          : 'var(--at-fg-muted)',
      }}
    >
      {label}
    </button>
  );
}

/** Cabeçalho da tela: título (varia por modo), toggle Ativos/Shadow e subtítulo de status. */
function IncidentsHeader({
  shadowView,
  onShadowChange,
  detectedCount,
  acknowledgedCount,
  connected,
  incidentsCount,
}: {
  shadowView: boolean;
  onShadowChange: (shadow: boolean) => void;
  detectedCount: number;
  acknowledgedCount: number;
  connected: boolean;
  incidentsCount: number
}): JSX.Element {
  const emptyText = shadowView
    ? 'Nenhuma regra em shadow mode disparando no momento.'
    : 'Tudo limpo. Nenhum incidente aberto.';

  return (
    <>
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
          {shadowView
            ? 'Incidentes em shadow mode'
            : 'Incidentes ativos'}
        </h1>
        <span style={{ flex: 1 }} />
        <ShadowToggle
          shadowView={shadowView}
          onChange={onShadowChange}
        />
      </div>

      <div style={{
        fontSize: 'var(--at-fs-14)',
        color: 'var(--at-fg-muted)',
        marginBottom: 'var(--at-space-24)',
      }}
      >
        {incidentsCount === 0
          ? emptyText
          : (
            <>
              {detectedCount} novos · {acknowledgedCount} em análise · WebSocket{' '}
              {connected
                ? 'conectado'
                : 'desconectado'}
              <span style={{
                display: 'inline-block',
                width: 6,
                height: 6,
                borderRadius: 999,
                marginLeft: 4,
                verticalAlign: 'middle',
                background: connected
                  ? 'var(--at-success-200)'
                  : 'var(--at-danger-200)',
              }}
              />
            </>
          )}
      </div>
    </>
  );
}

/** Alterna a listagem entre incidentes ativos (alertados) e os em shadow mode (silenciosos). */
function ShadowToggle({
  shadowView,
  onChange,
}: {
  shadowView: boolean;
  onChange: (shadow: boolean) => void
}): JSX.Element {
  const options: Array<{
    value: boolean;
    label: string
  }> = [
    {
      value: false,
      label: 'Ativos',
    },
    {
      value: true,
      label: 'Shadow',
    },
  ];

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
          key={String(option.value)}
          type="button"
          onClick={() => onChange(option.value)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--at-space-4)',
            height: 28,
            padding: '0 var(--at-space-12)',
            borderRadius: 'var(--at-radius-4)',
            border: 'none',
            background: shadowView === option.value
              ? 'var(--at-white)'
              : 'transparent',
            color: shadowView === option.value
              ? 'var(--at-fg)'
              : 'var(--at-fg-muted)',
            fontSize: 'var(--at-fs-13)',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {option.value
            ? <EyeSlash size={13} />
            : null}
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Selo "shadow" no card do incidente (registrado, mas não notificado). */
function ShadowPill(): JSX.Element {
  return (
    <span
      title="Shadow mode: registrado, mas não notificado"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--at-space-4)',
        padding: '2px 8px',
        borderRadius: 999,
        background: 'var(--at-bg-soft)',
        border: '1px solid var(--at-border)',
        color: 'var(--at-fg-muted)',
        fontSize: 'var(--at-fs-12)',
        fontWeight: 600,
      }}
    >
      <EyeSlash size={11} />
      shadow
    </span>
  );
}

/** Card rico de um incidente: severidade, metadados, resumo, métricas e ações. */
function IncidentBigCard({
  incident,
  onAcknowledge,
  onResolve,
  onInvestigate,
  onDetail,
}: {
  incident: IncidentInterface;
  onAcknowledge: (id: string) => void;
  onResolve: (incident: IncidentInterface) => void;
  onInvestigate: (incident: IncidentInterface) => void;
  onDetail: (incident: IncidentInterface) => void
}): JSX.Element {
  const severityColor = SEVERITY_COLOR[incident.severity];

  return (
    <div
      className="at-card-hover"
      style={{
        background: 'var(--at-white)',
        border: '1px solid var(--at-border)',
        borderLeft: `4px solid ${severityColor}`,
        borderRadius: 8,
        boxShadow: 'var(--at-shadow-xs)',
        overflow: 'hidden',
      }}
    >
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        gap: 'var(--at-space-16)',
        alignItems: 'flex-start',
        padding: '14px 18px',
      }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--at-space-8)',
            marginBottom: 'var(--at-space-4)',
            flexWrap: 'wrap',
          }}
          >
            <code style={{
              fontFamily: 'ui-monospace, Menlo, monospace',
              fontSize: 'var(--at-fs-12)',
              fontWeight: 600,
              color: 'var(--at-fg-muted)',
            }}
            >
              {incident.id}
            </code>
            <SeverityBadge severity={incident.severity} />
            <StatusBadge
              status={incident.status}
              assignee={incident.assignee}
            />
            {incident.shadow
              ? <ShadowPill />
              : null}
          </div>
          <h3 style={{
            margin: 0,
            fontSize: 'var(--at-fs-16)',
            fontWeight: 600,
            color: 'var(--at-fg)',
          }}
          >
            {incident.rule}
          </h3>
          <div style={{
            fontSize: 'var(--at-fs-12)',
            color: 'var(--at-fg-muted)',
            marginTop: 'var(--at-space-4)',
            marginBottom: 'var(--at-space-8)',
          }}
          >
            {incident.dimension_type} ={' '}
            <b style={{ color: 'var(--at-fg)' }}>{incident.dimension_value}</b>
            {' · '}{incident.window}
          </div>
          <p style={{
            margin: 0,
            fontSize: 'var(--at-fs-14)',
            color: 'var(--at-fg)',
            lineHeight: 'var(--at-lh-22)',
          }}
          >
            {incident.summary}
          </p>
        </div>
        <div style={{
          width: 180,
          flexShrink: 0,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 'var(--at-space-4)',
        }}
        >
          <Metric
            label="Atual"
            value={incident.metrics.current}
            danger
          />
          <Metric
            label="Baseline"
            value={incident.metrics.baseline}
          />
          <Metric
            label="Threshold"
            value={incident.metrics.threshold}
          />
          <Metric
            label="Amostra"
            value={incident.metrics.sample}
          />
        </div>
      </div>

      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--at-space-8)',
        padding: '10px 18px',
        background: 'var(--at-bg-soft)',
        borderTop: '1px solid var(--at-border)',
      }}
      >
        <span style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 'var(--at-space-4)',
          fontSize: 'var(--at-fs-12)',
          color: 'var(--at-fg-muted)',
        }}
        >
          <ChatsCircle size={14} />
          <b style={{ color: 'var(--at-fg)' }}>{incident.related_shippings}</b> envios impactados
        </span>
        <span style={{ flex: 1 }} />
        {incident.status === 'detected'
          ? (
            <FooterButton
              icon={CheckCircle}
              label="Reconhecer"
              variant="primary"
              onClick={() => onAcknowledge(incident.id)}
            />
          )
          : null}
        <FooterButton
          icon={MagnifyingGlass}
          label="Investigar"
          variant="outline"
          onClick={() => onInvestigate(incident)}
        />
        <FooterButton
          icon={Flag}
          label="Resolver"
          variant="neutral"
          onClick={() => onResolve(incident)}
        />
        <FooterButton
          icon={CaretRight}
          label="Detalhes"
          variant="ghost"
          onClick={() => onDetail(incident)}
        />
      </div>
    </div>
  );
}

/** Item de métrica do card (rótulo + valor; `danger` realça o valor atual). */
function Metric({
  label,
  value,
  danger,
}: {
  label: string;
  value: string;
  danger?: boolean
}): JSX.Element {
  return (
    <div style={{
      background: 'var(--at-bg-soft)',
      border: '1px solid var(--at-border)',
      borderRadius: 'var(--at-radius-4)',
      padding: '6px 8px',
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
        fontSize: 'var(--at-fs-12)',
        fontWeight: 700,
        fontVariantNumeric: 'tabular-nums',
        color: danger
          ? 'var(--at-danger-200)'
          : 'var(--at-fg)',
      }}
      >
        {value}
      </div>
    </div>
  );
}

/** Badge de severidade (cor + rótulo). */
function SeverityBadge({ severity }: { severity: IncidentSeverityType }): JSX.Element {
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
      fontSize: 'var(--at-fs-12)',
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

/** Badge de status (novo / em análise + responsável). */
function StatusBadge({
  status,
  assignee,
}: {
  status: IncidentInterface['status'];
  assignee: string | null
}): JSX.Element {
  const isNew = status === 'detected';

  const color = isNew
    ? 'var(--at-danger-200)'
    : 'var(--at-info-100)';

  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 'var(--at-space-4)',
      padding: '2px 8px',
      borderRadius: 999,
      background: isNew
        ? '#C127221a'
        : '#0052cc1a',
      color,
      fontSize: 'var(--at-fs-12)',
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
      {isNew
        ? 'novo'
        : `em análise · ${assignee ?? '—'}`}
    </span>
  );
}

/** Variantes de botão do rodapé. */
type FooterVariantType = 'primary' | 'outline' | 'neutral' | 'ghost';

/** Estilo (borda/fundo/cor) por variante de botão do rodapé. */
const FOOTER_VARIANT: Record<FooterVariantType, {
  border: string;
  background: string;
  color: string
}> = {
  primary: {
    border: 'none',
    background: 'var(--at-primary)',
    color: 'var(--at-white)',
  },
  outline: {
    border: '1px solid var(--at-primary)',
    background: 'var(--at-white)',
    color: 'var(--at-primary-dark)',
  },
  neutral: {
    border: '1px solid var(--at-border)',
    background: 'var(--at-white)',
    color: 'var(--at-fg)',
  },
  ghost: {
    border: 'none',
    background: 'transparent',
    color: 'var(--at-primary-dark)',
  },
};

/** Botão de ação do rodapé do card (hierarquia: primary = CTA, outline, neutral, ghost). */
function FooterButton({
  icon,
  label,
  onClick,
  variant,
}: {
  icon: Icon;
  label: string;
  onClick: () => void;
  variant: FooterVariantType
}): JSX.Element {
  const ButtonIcon = icon;
  const style = FOOTER_VARIANT[variant];

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
        border: style.border,
        background: style.background,
        color: style.color,
        fontSize: 'var(--at-fs-12)',
        fontWeight: 600,
        cursor: 'pointer',
      }}
    >
      <ButtonIcon size={13} />
      {label}
    </button>
  );
}

/** Estado vazio (nenhum incidente aberto). */
function EmptyState(): JSX.Element {
  return (
    <div style={{
      background: 'var(--at-white)',
      border: '1px solid var(--at-border)',
      borderRadius: 8,
      padding: 'var(--at-space-40)',
      textAlign: 'center',
    }}
    >
      <div style={{
        width: 48,
        height: 48,
        margin: '0 auto var(--at-space-12)',
        borderRadius: 999,
        background: 'var(--at-success-50)',
        display: 'grid',
        placeItems: 'center',
      }}
      >
        <CheckCircle
          size={24}
          color="var(--at-success-200)"
          weight="fill"
        />
      </div>
      <div style={{
        fontSize: 'var(--at-fs-16)',
        fontWeight: 600,
        color: 'var(--at-fg)',
      }}
      >
        Tudo sob controle
      </div>
      <div style={{
        fontSize: 'var(--at-fs-14)',
        color: 'var(--at-fg-muted)',
        marginTop: 'var(--at-space-4)',
      }}
      >
        Nenhum incidente aberto. Aviso por WebSocket assim que algo aparecer.
      </div>
    </div>
  );
}

/** Linha de texto auxiliar (loading/erro). */
function Muted({ children }: { children: string }): JSX.Element {
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
