import { useState, type JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import { CaretRightIcon as CaretRight, ChatsCircleIcon as ChatsCircle, CheckCircleIcon as CheckCircle, FlagIcon as Flag, MagnifyingGlassIcon as MagnifyingGlass, WarningIcon as Warning } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import type { IncidentInterface } from '@atena/types';
import { acknowledgeIncident } from '../api/incidents';
import { SEVERITY_COLOR, SEVERITY_LABEL } from '../incidents/severity';
import { ResolveIncidentModal } from '../incidents/ResolveIncidentModal';
import { ToolResultFrame } from './tool-cards/ToolResultFrame';
import { useChatContext } from './chat-context';
import { cssValue, cssVar } from '../styles/tokens';

/** Métricas exibidas na grade (rótulo, valor, se é o valor "fora do normal"). */
type MetricTuple = [string, string, boolean];

/** Estilo base dos botões de ação do card (pequenos, com ícone). */
const ACTION_BUTTON = {
  display: cssValue.inlineFlex,
  alignItems: 'center',
  gap: cssVar.space4,
  height: 30,
  padding: cssVar.paddingInline12,
  borderRadius: cssVar.radius4,
  fontSize: cssVar.fs12,
  fontWeight: 600,
  cursor: 'pointer',
} as const;

/**
 * Cartão inline de incidente detectado (realtime), no estilo do protótipo (`IncidentInlineCard`):
 * frame de tool + grade de métricas (baseline/atual/threshold/amostra) + resumo + ações
 * (Reconhecer / Investigar / Resolver) e a contagem de envios impactados. Auto-contido: as ações
 * usam o chat (Investigar), o lifecycle (Reconhecer) e o modal de resolução (Resolver).
 *
 * @param props - Incidente recém-detectado.
 *
 * @returns O cartão.
 */
export function IncidentChatCard({ incident }: Readonly<{ incident: IncidentInterface }>): JSX.Element {
  const chat = useChatContext();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const color = SEVERITY_COLOR[incident.severity];

  // Otimismo local do "Reconhecer"; o status real vem do incident (atualizado em tempo real).
  const [
    ackedLocal,
    setAckedLocal,
  ] = useState(false);

  const [
    resolving,
    setResolving,
  ] = useState(false);

  const isResolved = incident.status === 'resolved' || incident.status === 'auto_resolved';
  const isAcked = ackedLocal || incident.status === 'acknowledged' || isResolved;

  const invalidate = (): void => {
    queryClient.invalidateQueries({ queryKey: ['incidents'] }).catch(() => undefined);
  };

  const onAck = (): void => {
    setAckedLocal(true);
    acknowledgeIncident(incident.id).then(invalidate).catch(() => undefined);
  };

  const onInvestigate = (): void => {
    chat.send(`Investigue o incidente ${incident.id} (${incident.rule}). ${incident.summary}`);
  };

  const metrics: MetricTuple[] = [
    [
      'Baseline',
      incident.metrics.baseline,
      false,
    ],
    [
      'Atual',
      incident.metrics.current,
      true,
    ],
    [
      'Threshold',
      incident.metrics.threshold,
      false,
    ],
    [
      'Amostra',
      incident.metrics.sample,
      false,
    ],
  ];

  return (
    <>
      <ToolResultFrame
        icon={<Warning
          size={13}
          weight="fill"
        />}
        toolName="Incidente detectado"
        title={`${incident.id} · ${incident.rule}`}
        subtitle={`${incident.dimension_type} = ${incident.dimension_value} · ${incident.window}`}
        actions={(
          <span style={{
            padding: '2px 8px',
            borderRadius: 999,
            background: `${color}1a`,
            color,
            fontSize: cssVar.fs12,
            fontWeight: 600,
          }}
          >
            {SEVERITY_LABEL[incident.severity]}
          </span>
        )}
      >
        <div style={{ padding: '14px 16px' }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: cssVar.space8,
            marginBottom: cssVar.space12,
          }}
          >
            {metrics.map(([
              label,
              value,
              danger,
            ]) => (
              <div
                key={label}
                style={{
                  background: cssVar.bgSoft,
                  border: cssVar.borderLine,
                  borderRadius: cssVar.radius4,
                  padding: '8px 10px',
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
                  fontSize: cssVar.fs16,
                  fontWeight: 700,
                  fontVariantNumeric: cssValue.tabularNums,
                  marginTop: 2,
                  color: danger
                    ? cssVar.danger200
                    : cssVar.fg,
                }}
                >
                  {value}
                </div>
              </div>
            ))}
          </div>

          <p style={{
            margin: 0,
            fontSize: cssVar.fs13,
            color: cssVar.fg,
            lineHeight: cssVar.lh22,
          }}
          >
            {incident.summary}
          </p>

          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: cssVar.space8,
            marginTop: cssVar.space12,
            flexWrap: 'wrap',
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
              <ChatsCircle size={13} />
              <span>
                <b style={{ color: cssVar.fg }}>{incident.related_shippings}</b> envios impactados
              </span>
            </span>
            <span style={{ flex: 1 }} />
            <IncidentLiveStatus incident={incident} />
            {isAcked
              ? null
              : (
                <button
                  type="button"
                  onClick={onAck}
                  style={{
                    ...ACTION_BUTTON,
                    border: 'none',
                    background: cssVar.primary,
                    color: cssVar.white,
                  }}
                >
                  <CheckCircle size={14} />
                  Reconhecer
                </button>
              )}
            <button
              type="button"
              onClick={onInvestigate}
              style={{
                ...ACTION_BUTTON,
                border: '1px solid var(--at-primary)',
                background: cssVar.white,
                color: cssVar.primaryDark,
              }}
            >
              <MagnifyingGlass size={14} />
              Investigar
            </button>
            {isResolved
              ? null
              : (
                <button
                  type="button"
                  onClick={() => { setResolving(true); }}
                  style={{
                    ...ACTION_BUTTON,
                    border: cssVar.borderLine,
                    background: cssVar.white,
                    color: cssVar.fg,
                  }}
                >
                  <Flag size={14} />
                  Resolver
                </button>
              )}
            <button
              type="button"
              onClick={() => { navigate(`/incidentes?detalhe=${incident.id}`); }}
              style={{
                ...ACTION_BUTTON,
                border: 'none',
                background: 'transparent',
                color: cssVar.primaryDark,
              }}
            >
              Detalhes
              <CaretRight size={13} />
            </button>
          </div>
        </div>
      </ToolResultFrame>

      {resolving
        ? (
          <ResolveIncidentModal
            incident={incident}
            onClose={() => { setResolving(false); }}
            onResolved={() => {
              setResolving(false);
              invalidate();
            }}
          />
        )
        : null}
    </>
  );
}

/**
 * Pílula de status em tempo real do incidente no cartão: "Resolvido" (resolved/auto_resolved) ou
 * "Em análise" + responsável (acknowledged). Em `detected` não mostra nada (as ações já indicam).
 *
 * @param props - Incidente do cartão.
 *
 * @returns A pílula, ou `null` se ainda não houve ação.
 */
function IncidentLiveStatus({ incident }: Readonly<{ incident: IncidentInterface }>): JSX.Element | null {
  const resolved = incident.status === 'resolved' || incident.status === 'auto_resolved';
  const acknowledged = incident.status === 'acknowledged';

  if (
    !resolved
    && !acknowledged
  ) {
    return null;
  }

  let label = 'Resolvido';

  if (!resolved) {
    label = incident.assignee
      ? `Em análise · ${incident.assignee}`
      : 'Em análise';
  }

  const color = resolved
    ? cssVar.success200
    : cssVar.info100;

  return (
    <span style={{
      display: cssValue.inlineFlex,
      alignItems: 'center',
      gap: cssVar.space4,
      padding: '2px 10px',
      borderRadius: 999,
      background: `${color}1a`,
      color,
      fontSize: cssVar.fs12,
      fontWeight: 600,
    }}
    >
      {resolved
        ? <CheckCircle size={13} />
        : <ChatsCircle size={13} />}
      {label}
    </span>
  );
}
