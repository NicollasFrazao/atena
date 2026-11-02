import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { CaretRightIcon as CaretRight, CheckCircleIcon as CheckCircle, type Icon, WarningIcon as Warning, WifiSlashIcon as WifiSlash, XIcon } from '@phosphor-icons/react';
import type { IncidentInterface, WsServerEvent } from '@atena/types';
import { acknowledgeIncident } from '../api/incidents';
import { SEVERITY_COLOR, SEVERITY_LABEL } from '../incidents/severity';
import { formatRelativeTime } from '../util/time';
import { useRealtimeConnected, useRealtimeEvent } from './realtime-context';
import { capNotices, eventToNotice, type IncidentNoticeInterface } from './incident-notice';
import { cssValue, cssVar } from '../styles/tokens';

/** Máximo de banners empilhados (os mais antigos não-persistentes saem). */
const MAX_NOTICES = 3;

/** Tempo até auto-dispensar um banner não-persistente (ms). */
const AUTO_DISMISS_MS = 8000;

/** Estilo base dos botões de ação do banner (pequenos, com ícone). */
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
  flexShrink: 0,
  whiteSpace: 'nowrap',
} as const;

/** Notificação na pilha (com chave única para render/dismiss). */
interface StackedNoticeInterface extends IncidentNoticeInterface {
  key: number;
}

/**
 * Reconcilia a pilha de banners quando um incidente muda de status (realtime):
 *  - resolvido (`resolved`/`auto_resolved`) → remove a faixa (já foi tratado);
 *  - reconhecido → marca o incidente da faixa com o novo status/responsável (continua visível).
 *
 * @param list - Pilha atual.
 * @param incidentId - Id do incidente alterado.
 * @param status - Novo status.
 * @param [assignee] - Responsável (quando reconhecido).
 *
 * @returns Pilha reconciliada.
 */
function reconcileNotices(
  list: StackedNoticeInterface[],
  incidentId: string,
  status: IncidentInterface['status'],
  assignee?: string,
): StackedNoticeInterface[] {
  if (
    status === 'resolved'
    || status === 'auto_resolved'
  ) {
    return list.filter((item) => item.incident?.id !== incidentId);
  }

  return list.map((item) => {
    if (item.incident?.id !== incidentId) {
      return item;
    }

    return {
      ...item,
      incident: {
        ...item.incident,
        status,
        assignee: assignee ?? item.incident.assignee,
      },
    };
  });
}

/**
 * Faixa rica de um incidente detectado (`incident.created`), fiel ao banner do protótipo: gradiente
 * por severidade, ícone, badge + id + "detectado há…", regra + métrica e as ações Reconhecer /
 * Abrir detalhes / dispensar. Auto-contida: Reconhecer chama o lifecycle; Abrir detalhes navega ao
 * painel de detalhes (`?detalhe=<id>`).
 *
 * @param props - Incidente + dispensar.
 *
 * @returns A faixa do incidente.
 */
function IncidentBar({
  incident,
  onDismiss,
}: Readonly<{
  incident: IncidentInterface;
  onDismiss: () => void
}>): JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const color = SEVERITY_COLOR[incident.severity];

  // Otimismo local; o status real vem do incident (atualizado em tempo real por outro operador).
  const [
    ackedLocal,
    setAckedLocal,
  ] = useState(false);

  const acked = ackedLocal || incident.status !== 'detected';

  const onAck = (): void => {
    setAckedLocal(true);

    acknowledgeIncident(incident.id)
      .then(() => queryClient.invalidateQueries({ queryKey: ['incidents'] }))
      .catch(() => undefined);
  };

  // Métrica em uma linha (generaliza o "taxa de entrega caiu para…" do protótipo p/ qualquer regra);
  // sem `current`, cai no resumo. Parte do baseline isolada p/ evitar template literal aninhado.
  const baselinePart = incident.metrics.baseline
    ? ` (baseline ${incident.metrics.baseline})`
    : '';

  const detail = incident.metrics.current
    ? `atual ${incident.metrics.current}${baselinePart}`
    : incident.summary;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: cssVar.space12,
      padding: '10px 20px',
      background: `linear-gradient(90deg, ${color}26, ${color}0d)`,
      borderBottom: `1px solid ${color}66`,
      animation: 'at-banner-slide-down .3s ease',
    }}
    >
      <div style={{
        width: 28,
        height: 28,
        flexShrink: 0,
        borderRadius: cssVar.radius4,
        background: cssVar.white,
        display: 'grid',
        placeItems: 'center',
        color,
        boxShadow: `0 0 0 1px ${color}4d`,
      }}
      >
        <Warning
          size={14}
          weight="fill"
        />
      </div>

      <div style={{
        flex: 1,
        minWidth: 0,
      }}
      >
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: cssVar.space8,
          marginBottom: 2,
          flexWrap: 'wrap',
        }}
        >
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
          <code style={{
            fontFamily: cssValue.fontMono,
            fontSize: cssVar.fs12,
            fontWeight: 600,
            color,
          }}
          >
            {incident.id}
          </code>
          <span style={{
            fontSize: cssVar.fs12,
            color: cssVar.fgMuted,
          }}
          >
            · detectado {formatRelativeTime(incident.detected_at)}
          </span>
        </div>
        <div style={{
          fontSize: cssVar.fs13,
          color: cssVar.fg,
          lineHeight: cssVar.lh22,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        >
          <strong>{incident.rule}</strong>
          {' · '}{detail}
        </div>
      </div>

      {acked
        ? (
          <span style={{
            display: cssValue.inlineFlex,
            alignItems: 'center',
            gap: cssVar.space4,
            flexShrink: 0,
            fontSize: cssVar.fs12,
            fontWeight: 600,
            color: cssVar.primaryDark,
          }}
          >
            <CheckCircle size={13} />
            {incident.assignee
              ? `Assumido por ${incident.assignee}`
              : 'Reconhecido'}
          </span>
        )
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
        onClick={() => { void navigate(`/incidentes?detalhe=${incident.id}`); }}
        style={{
          ...ACTION_BUTTON,
          border: cssVar.borderLine,
          background: cssVar.white,
          color: cssVar.fg,
        }}
      >
        Abrir detalhes
        <CaretRight size={13} />
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Ocultar banner"
        style={{
          appearance: 'none',
          border: 'none',
          background: 'none',
          padding: 0,
          cursor: 'pointer',
          color: cssVar.fgSubtle,
          display: 'flex',
          flexShrink: 0,
        }}
      >
        <XIcon size={14} />
      </button>
    </div>
  );
}

/**
 * Faixa simples de informação (auto-resolvido / conexão), full-width como o banner mas discreta.
 *
 * @param props - Ícone, texto e dispensar opcional.
 *
 * @returns A faixa de informação.
 */
function InfoStrip({
  icon: StripIcon,
  text,
  onDismiss,
}: Readonly<{
  icon: Icon;
  text: string;
  onDismiss?: () => void
}>): JSX.Element {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: cssVar.space8,
      padding: '8px 20px',
      background: cssVar.bgSoft,
      borderBottom: cssVar.borderLine,
      fontSize: cssVar.fs12,
      color: cssVar.fgMuted,
      animation: 'at-banner-slide-down .3s ease',
    }}
    >
      <StripIcon
        size={14}
        style={{ flexShrink: 0 }}
      />
      <span style={{ flex: 1 }}>{text}</span>
      {onDismiss
        ? (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dispensar"
            style={{
              appearance: 'none',
              border: 'none',
              background: 'none',
              padding: 0,
              cursor: 'pointer',
              color: cssVar.fgSubtle,
              display: 'flex',
              flexShrink: 0,
            }}
          >
            <XIcon size={14} />
          </button>
        )
        : null}
    </div>
  );
}

/**
 * Banner de tempo real (app-wide), montado entre a topbar e o conteúdo (em fluxo — empurra a página,
 * igual ao protótipo). `incident.created` vira a faixa rica {@link IncidentBar} (críticos ficam até
 * dispensar; warning/info somem em ~8s); `incident.auto_resolved` vira uma {@link InfoStrip}; e a
 * queda da conexão WS (depois de já ter conectado) vira uma faixa de reconexão.
 *
 * @returns As faixas empilhadas, ou `null` se não há nada a mostrar.
 */
export function IncidentBanner(): JSX.Element | null {
  const [
    notices,
    setNotices,
  ] = useState<StackedNoticeInterface[]>([]);

  const seqRef = useRef(0);

  const [
    everConnected,
    setEverConnected,
  ] = useState(false);

  // Timers de auto-dispensa pendentes — limpos no unmount p/ não chamar setNotices após desmontar.
  const timeoutsRef = useRef<number[]>([]);

  const dismiss = useCallback(
    (key: number) => { setNotices((prev) => prev.filter((notice) => notice.key !== key)); },
    [],
  );

  const onEvent = useCallback(
    (event: WsServerEvent) => {
      // Realtime: incidente reconhecido/resolvido por outro operador → reflete no banner já exibido
      // (acknowledged: marca "assumido por X"; resolvido: remove a faixa, pois já foi tratado).
      if (event.type === 'incident.updated') {
        setNotices((prev) => reconcileNotices(
          prev,
          event.incident_id,
          event.status,
          event.acknowledged_by,
        ));

        return;
      }

      // Auto-resolvido: remove a faixa original do incidente (a faixa de info é adicionada abaixo).
      if (event.type === 'incident.auto_resolved') {
        setNotices((prev) => prev.filter((item) => item.incident?.id !== event.incident_id));
      }

      const notice = eventToNotice(event);

      if (!notice) {
        return;
      }

      seqRef.current += 1;
      const key = seqRef.current;

      setNotices((prev) => capNotices(
        [
          ...prev,
          {
            ...notice,
            key,
          },
        ],
        MAX_NOTICES,
      ));

      if (!notice.persist) {
        const timeoutId = window.setTimeout(
          () => { dismiss(key); },
          AUTO_DISMISS_MS,
        );

        timeoutsRef.current.push(timeoutId);
      }
    },
    [dismiss],
  );

  useEffect(
    () => () => {
      timeoutsRef.current.forEach((id) => {
        window.clearTimeout(id);
      });
    },
    [],
  );

  useRealtimeEvent(onEvent);

  const connected = useRealtimeConnected();

  // Remembered once the first connection succeeds; adjusted while rendering, as React allows for
  // state derived from other values, so no effect or ref is read during render.
  if (
    connected
    && !everConnected
  ) {
    setEverConnected(true);
  }

  // Faixa só aparece se a conexão CAIU depois de já ter conectado — evita o flicker do connect inicial.
  const showDisconnected = !connected && everConnected;

  if (
    notices.length === 0
    && !showDisconnected
  ) {
    return null;
  }

  return (
    <div style={{ flexShrink: 0 }}>
      <style>{'@keyframes at-banner-slide-down { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: none; } }'}</style>
      {showDisconnected
        ? (
          <InfoStrip
            icon={WifiSlash}
            text="Tempo real desconectado — reconectando…"
          />
        )
        : null}
      {notices.map((notice) => (notice.incident
        ? (
          <IncidentBar
            key={notice.key}
            incident={notice.incident}
            onDismiss={() => { dismiss(notice.key); }}
          />
        )
        : (
          <InfoStrip
            key={notice.key}
            icon={CheckCircle}
            text={notice.text ?? ''}
            onDismiss={() => { dismiss(notice.key); }}
          />
        )))}
    </div>
  );
}
