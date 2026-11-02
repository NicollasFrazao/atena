import { useCallback, useState, type JSX } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  CaretRightIcon as CaretRight,
  ChatsCircleIcon as ChatsCircle,
  CheckCircleIcon as CheckCircle,
  EyeSlashIcon as EyeSlash,
  FlagIcon as Flag,
  type Icon,
  MagnifyingGlassIcon as MagnifyingGlass,
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
import { cssValue, cssVar } from '../styles/tokens';

/** Caminho do assistente já investigando o incidente (auto-envia via `?q=`). */
function investigateHref(incident: IncidentInterface): string {
  return `/?q=${encodeURIComponent(
    `Investigue o incidente ${incident.id} (${incident.rule}). ${incident.summary}`,
  )}`;
}

/**
 * Opens the incident named by a new `?detalhe` param (e.g. "Ver detalhes" on a chat incident card).
 * The state is adjusted while rendering when the param changes, instead of inside an effect.
 *
 * @param param - Current `?detalhe` value.
 * @param open - Opens the detail drawer for an incident id.
 */
function useOpenFromParam(
  param: string | null,
  open: (id: string) => void,
): void {
  const [
    synced,
    setSynced,
  ] = useState<string | null>(null);

  if (param !== synced) {
    setSynced(param);

    if (param) {
      open(param);
    }
  }
}

/**
 * Tela de Incidentes ativos: KPIs + seções "Aguardando ação" (detected) e "Em análise"
 * (acknowledged), com cards ricos (severidade, métricas, envios impactados). Os incidentes vêm da
 * detecção REAL (o detector roda sobre os dados); esta tela só os lista e reflete os abertos em tempo
 * quase real (WebSocket invalida as queries). Resolução manual é fatia futura (ações de mutação ficam
 * desabilitadas). "Investigar" leva o analista ao assistente.
 *
 * @returns A tela de incidentes.
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

  useOpenFromParam(
    detalheParam,
    setDetailTarget,
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
    void navigate(investigateHref(incident));
  };

  const onResolveFromDetail = (incident: IncidentInterface): void => {
    setDetailTarget(null);
    setResolveTarget(incident);
  };

  return (
    <div style={{
      maxWidth: 1200,
      margin: '0 auto',
      padding: cssVar.space32,
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
        gap: cssVar.space12,
        marginBottom: cssVar.space24,
      }}
      >
        <StatCard
          label="Novos"
          value={detected.length}
          color={detected.length > 0
            ? cssVar.danger200
            : cssVar.fg}
        />
        <StatCard
          label="Em análise"
          value={acknowledged.length}
          color={acknowledged.length > 0
            ? cssVar.info100
            : cssVar.fg}
        />
        <StatCard
          label="Resolvidos"
          value={resolvedTotal}
          color={cssVar.success200}
        />
        <StatCard
          label="Auto-resolvidos"
          value={autoResolvedTotal}
          color={cssVar.fg}
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
        gap: cssVar.space12,
      }}
      >
        {detectedList.length > 0
          ? (
            <SectionHeader
              dotColor={cssVar.danger200}
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
            onDetail={(target) => { setDetailTarget(target.id); }}
          />
        ))}

        {acknowledgedList.length > 0
          ? (
            <SectionHeader
              dotColor={cssVar.info100}
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
            onDetail={(target) => { setDetailTarget(target.id); }}
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
            onClose={() => { setResolveTarget(null); }}
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
}: Readonly<{
  label: string;
  value: number;
  color: string
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
        fontSize: cssVar.fs32,
        fontWeight: 700,
        lineHeight: 1.1,
        marginTop: cssVar.space4,
        fontVariantNumeric: cssValue.tabularNums,
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
}: Readonly<{
  dotColor: string;
  title: string;
  count: number
}>): JSX.Element {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: cssVar.space8,
      marginTop: cssVar.space8,
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
        fontSize: cssVar.fs14,
        fontWeight: 600,
        color: cssVar.fg,
      }}
      >
        {title}
      </h2>
      <span style={{
        fontSize: cssVar.fs12,
        fontWeight: 700,
        color: cssVar.fgMuted,
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
 * @param props - Estado e callbacks dos filtros.
 *
 * @returns A barra de filtros.
 */
function IncidentFilters({
  query,
  onQuery,
  severity,
  onSeverity,
  dimension,
  onDimension,
}: Readonly<{
  query: string;
  onQuery: (value: string) => void;
  severity: IncidentSeverityType | 'all';
  onSeverity: (value: IncidentSeverityType | 'all') => void;
  dimension: DimensionType | 'all';
  onDimension: (value: DimensionType | 'all') => void
}>): JSX.Element {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: cssVar.space8,
      marginBottom: cssVar.space16,
    }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: cssVar.space8,
        height: 38,
        padding: cssVar.paddingInline12,
        background: cssVar.white,
        border: cssVar.borderLine,
        borderRadius: cssVar.radius8,
      }}
      >
        <MagnifyingGlass
          size={16}
          color={cssVar.fgMuted}
        />
        <input
          value={query}
          onChange={(event) => { onQuery(event.target.value); }}
          placeholder="Buscar por código, cliente/provedor/rota ou resumo…"
          style={{
            flex: 1,
            border: 'none',
            outline: 'none',
            background: 'transparent',
            fontSize: cssVar.fs14,
            color: cssVar.fg,
          }}
        />
      </div>

      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: cssVar.space4,
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
              ? cssVar.fg
              : SEVERITY_COLOR[value]}
            onClick={() => { onSeverity(value); }}
          />
        ))}
        <span style={{
          width: 1,
          height: 18,
          background: cssVar.border,
          margin: '0 var(--at-space-4)',
        }}
        />
        {DIMENSION_FILTERS.map((item) => (
          <FilterChip
            key={item.value}
            label={item.label}
            active={dimension === item.value}
            activeColor={cssVar.fg}
            onClick={() => { onDimension(item.value); }}
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
}: Readonly<{
  label: string;
  active: boolean;
  activeColor: string;
  onClick: () => void
}>): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '4px 10px',
        borderRadius: 999,
        fontSize: cssVar.fs12,
        fontWeight: 600,
        cursor: 'pointer',
        border: active
          ? `1px solid ${activeColor}`
          : cssVar.borderLine,
        background: active
          ? cssVar.bgSoft
          : cssVar.white,
        color: active
          ? activeColor
          : cssVar.fgMuted,
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
}: Readonly<{
  shadowView: boolean;
  onShadowChange: (shadow: boolean) => void;
  detectedCount: number;
  acknowledgedCount: number;
  connected: boolean;
  incidentsCount: number
}>): JSX.Element {
  const emptyText = shadowView
    ? 'Nenhuma regra em shadow mode disparando no momento.'
    : 'Tudo limpo. Nenhum incidente aberto.';

  return (
    <>
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
        fontSize: cssVar.fs14,
        color: cssVar.fgMuted,
        marginBottom: cssVar.space24,
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
                  ? cssVar.success200
                  : cssVar.danger200,
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
}: Readonly<{
  shadowView: boolean;
  onChange: (shadow: boolean) => void
}>): JSX.Element {
  const options: {
    value: boolean;
    label: string
  }[] = [
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
      display: cssValue.inlineFlex,
      gap: cssVar.space4,
      padding: 4,
      borderRadius: cssVar.radius8,
      background: cssVar.bgSoft,
      border: cssVar.borderLine,
    }}
    >
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          onClick={() => { onChange(option.value); }}
          style={{
            display: cssValue.inlineFlex,
            alignItems: 'center',
            gap: cssVar.space4,
            height: 28,
            padding: cssVar.paddingInline12,
            borderRadius: cssVar.radius4,
            border: 'none',
            background: shadowView === option.value
              ? cssVar.white
              : 'transparent',
            color: shadowView === option.value
              ? cssVar.fg
              : cssVar.fgMuted,
            fontSize: cssVar.fs13,
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
        display: cssValue.inlineFlex,
        alignItems: 'center',
        gap: cssVar.space4,
        padding: '2px 8px',
        borderRadius: 999,
        background: cssVar.bgSoft,
        border: cssVar.borderLine,
        color: cssVar.fgMuted,
        fontSize: cssVar.fs12,
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
}: Readonly<{
  incident: IncidentInterface;
  onAcknowledge: (id: string) => void;
  onResolve: (incident: IncidentInterface) => void;
  onInvestigate: (incident: IncidentInterface) => void;
  onDetail: (incident: IncidentInterface) => void
}>): JSX.Element {
  const severityColor = SEVERITY_COLOR[incident.severity];

  return (
    <div
      className="at-card-hover"
      style={{
        background: cssVar.white,
        border: cssVar.borderLine,
        borderLeft: `4px solid ${severityColor}`,
        borderRadius: 8,
        boxShadow: cssVar.shadowXs,
        overflow: 'hidden',
      }}
    >
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        gap: cssVar.space16,
        alignItems: 'flex-start',
        padding: '14px 18px',
      }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: cssVar.space8,
            marginBottom: cssVar.space4,
            flexWrap: 'wrap',
          }}
          >
            <code style={{
              fontFamily: cssValue.fontMono,
              fontSize: cssVar.fs12,
              fontWeight: 600,
              color: cssVar.fgMuted,
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
            fontSize: cssVar.fs16,
            fontWeight: 600,
            color: cssVar.fg,
          }}
          >
            {incident.rule}
          </h3>
          <div style={{
            fontSize: cssVar.fs12,
            color: cssVar.fgMuted,
            marginTop: cssVar.space4,
            marginBottom: cssVar.space8,
          }}
          >
            {incident.dimension_type} ={' '}
            <b style={{ color: cssVar.fg }}>{incident.dimension_value}</b>
            {' · '}{incident.window}
          </div>
          <p style={{
            margin: 0,
            fontSize: cssVar.fs14,
            color: cssVar.fg,
            lineHeight: cssVar.lh22,
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
          gap: cssVar.space4,
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
        gap: cssVar.space8,
        padding: '10px 18px',
        background: cssVar.bgSoft,
        borderTop: cssVar.borderLine,
      }}
      >
        <span style={{
          display: cssValue.inlineFlex,
          alignItems: 'center',
          gap: cssVar.space4,
          fontSize: cssVar.fs12,
          color: cssVar.fgMuted,
        }}
        >
          <ChatsCircle size={14} />
          <b style={{ color: cssVar.fg }}>{incident.related_shippings}</b> envios impactados
        </span>
        <span style={{ flex: 1 }} />
        {incident.status === 'detected'
          ? (
            <FooterButton
              icon={CheckCircle}
              label="Reconhecer"
              variant="primary"
              onClick={() => { onAcknowledge(incident.id); }}
            />
          )
          : null}
        <FooterButton
          icon={MagnifyingGlass}
          label="Investigar"
          variant="outline"
          onClick={() => { onInvestigate(incident); }}
        />
        <FooterButton
          icon={Flag}
          label="Resolver"
          variant="neutral"
          onClick={() => { onResolve(incident); }}
        />
        <FooterButton
          icon={CaretRight}
          label="Detalhes"
          variant="ghost"
          onClick={() => { onDetail(incident); }}
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
}: Readonly<{
  label: string;
  value: string;
  danger?: boolean
}>): JSX.Element {
  return (
    <div style={{
      background: cssVar.bgSoft,
      border: cssVar.borderLine,
      borderRadius: cssVar.radius4,
      padding: '6px 8px',
    }}
    >
      <div style={{
        fontSize: cssVar.fs10,
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
        fontSize: cssVar.fs12,
        fontWeight: 700,
        fontVariantNumeric: cssValue.tabularNums,
        color: danger
          ? cssVar.danger200
          : cssVar.fg,
      }}
      >
        {value}
      </div>
    </div>
  );
}

/** Badge de severidade (cor + rótulo). */
function SeverityBadge({ severity }: Readonly<{ severity: IncidentSeverityType }>): JSX.Element {
  const color = SEVERITY_COLOR[severity];

  return (
    <span style={{
      display: cssValue.inlineFlex,
      alignItems: 'center',
      gap: cssVar.space4,
      padding: '2px 8px',
      borderRadius: 999,
      background: `${color}1a`,
      color,
      fontSize: cssVar.fs12,
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
}: Readonly<{
  status: IncidentInterface['status'];
  assignee: string | null
}>): JSX.Element {
  const isNew = status === 'detected';

  const color = isNew
    ? cssVar.danger200
    : cssVar.info100;

  return (
    <span style={{
      display: cssValue.inlineFlex,
      alignItems: 'center',
      gap: cssVar.space4,
      padding: '2px 8px',
      borderRadius: 999,
      background: isNew
        ? '#C127221a'
        : '#0052cc1a',
      color,
      fontSize: cssVar.fs12,
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
    background: cssVar.primary,
    color: cssVar.white,
  },
  outline: {
    border: '1px solid var(--at-primary)',
    background: cssVar.white,
    color: cssVar.primaryDark,
  },
  neutral: {
    border: cssVar.borderLine,
    background: cssVar.white,
    color: cssVar.fg,
  },
  ghost: {
    border: 'none',
    background: 'transparent',
    color: cssVar.primaryDark,
  },
};

/** Botão de ação do rodapé do card (hierarquia: primary = CTA, outline, neutral, ghost). */
function FooterButton({
  icon,
  label,
  onClick,
  variant,
}: Readonly<{
  icon: Icon;
  label: string;
  onClick: () => void;
  variant: FooterVariantType
}>): JSX.Element {
  const ButtonIcon = icon;
  const style = FOOTER_VARIANT[variant];

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: cssValue.inlineFlex,
        alignItems: 'center',
        gap: cssVar.space4,
        height: 30,
        padding: cssVar.paddingInline12,
        borderRadius: cssVar.radius4,
        border: style.border,
        background: style.background,
        color: style.color,
        fontSize: cssVar.fs12,
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
      background: cssVar.white,
      border: cssVar.borderLine,
      borderRadius: 8,
      padding: cssVar.space40,
      textAlign: 'center',
    }}
    >
      <div style={{
        width: 48,
        height: 48,
        margin: '0 auto var(--at-space-12)',
        borderRadius: 999,
        background: cssVar.success50,
        display: 'grid',
        placeItems: 'center',
      }}
      >
        <CheckCircle
          size={24}
          color={cssVar.success200}
          weight="fill"
        />
      </div>
      <div style={{
        fontSize: cssVar.fs16,
        fontWeight: 600,
        color: cssVar.fg,
      }}
      >
        Tudo sob controle
      </div>
      <div style={{
        fontSize: cssVar.fs14,
        color: cssVar.fgMuted,
        marginTop: cssVar.space4,
      }}
      >
        Nenhum incidente aberto. Aviso por WebSocket assim que algo aparecer.
      </div>
    </div>
  );
}

/** Linha de texto auxiliar (loading/erro). */
function Muted({ children }: Readonly<{ children: string }>): JSX.Element {
  return (
    <div style={{
      fontSize: cssVar.fs14,
      color: cssVar.fgMuted,
      padding: 'var(--at-space-16) 0',
    }}
    >
      {children}
    </div>
  );
}
