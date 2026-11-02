import type { JSX } from 'react';
import {
  ArrowSquareOutIcon as ArrowSquareOut,
  BroadcastIcon as Broadcast,
  ClockCounterClockwiseIcon as ClockCounterClockwise,
  FlagIcon as Flag,
  PaperPlaneTiltIcon as PaperPlaneTilt,
  TrayIcon as Tray,
  type Icon,
} from '@phosphor-icons/react';
import { type ShippingEventType, type ShippingTrailInterface } from '@atena/types';
import { type RevealWindowInterface } from '../reveal';
import { ToolResultFrame } from './ToolResultFrame';
import { StatusPill } from './StatusPill';
import { RevealField } from './RevealField';
import { formatDateTimeSeconds, TONE_COLORS, type StatusToneType } from './format';
import { cssValue, cssVar } from '../../styles/tokens';
import {
  HOURS_PER_DAY,
  MINUTES_PER_HOUR,
  MS_PER_MINUTE,
  MS_PER_SECOND,
  SECONDS_PER_DAY,
  SECONDS_PER_HOUR,
  SECONDS_PER_MINUTE,
} from '../../util/units';

/** Ícone + tom de um tipo de evento da trilha. */
interface EventVisualInterface {
  icon: Icon;
  tone: StatusToneType;
}

/** Ícone + tom por tipo de evento da trilha. */
const EVENT_VISUALS: Record<ShippingEventType, EventVisualInterface> = {
  api_request: {
    icon: ArrowSquareOut,
    tone: 'neutral',
  },
  routing: {
    icon: Broadcast,
    tone: 'neutral',
  },
  provider_attempt: {
    icon: PaperPlaneTilt,
    tone: 'warning',
  },
  webhook_status: {
    icon: Tray,
    tone: 'neutral',
  },
  final: {
    icon: Flag,
    tone: 'danger',
  },
};

/**
 * The same map, indexed by any string: the trail arrives in a tool result over SSE and can carry an
 * event type this build does not know, which is drawn as `routing`.
 */
const VISUALS_BY_RECEIVED_TYPE: Partial<Record<string, EventVisualInterface>> = EVENT_VISUALS;

/** Rótulo legível do canal do envio (`campaign_type`). */
const CHANNEL_LABELS: Record<string, string> = {
  sms: 'SMS',
  sms_flash: 'SMS Flash',
};

/** Below this duration the seconds keep one decimal (`4.2 s`); from it on they are whole (`12 s`). */
const DECIMAL_SECONDS_BELOW_MS = 10_000;

/** Duração da trilha (último − primeiro evento): `4.2 s`, `12 s`, `3m 07s`, `2h 05m`, `1d 0h` ou `—`. */
function trailDuration(events: ShippingTrailInterface['events']): string {
  const firstEvent = events.at(0);
  const lastEvent = events.at(-1);

  if (
    !firstEvent
    || !lastEvent
    || firstEvent === lastEvent
  ) {
    return '—';
  }

  const ms = new Date(lastEvent.at).getTime() - new Date(firstEvent.at).getTime();

  if (
    !Number.isFinite(ms)
    || ms < 0
  ) {
    return '—';
  }

  if (ms < MS_PER_MINUTE) {
    return `${(ms / MS_PER_SECOND).toFixed(ms < DECIMAL_SECONDS_BELOW_MS
      ? 1
      : 0)} s`;
  }

  const totalSeconds = Math.round(ms / MS_PER_SECOND);
  const seconds = totalSeconds % SECONDS_PER_MINUTE;
  const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE) % MINUTES_PER_HOUR;
  const hours = Math.floor(totalSeconds / SECONDS_PER_HOUR) % HOURS_PER_DAY;
  const days = Math.floor(totalSeconds / SECONDS_PER_DAY);

  if (days > 0) {
    return `${days}d ${hours}h`;
  }

  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(
      2,
      '0',
    )}m`;
  }

  return `${minutes}m ${String(seconds).padStart(
    2,
    '0',
  )}s`;
}

/**
 * Card da tool `get_shipping_trail`: strip de resumo (cliente / fornecedor / tentativas /
 * duração / telefone), status final no header e timeline vertical dos eventos. Telefone e conteúdo
 * ficam mascarados por padrão, com reveal auditado sob demanda ({@link RevealField}).
 *
 * @param props - Trilha do envio + janela do contexto.
 * @param props.result - Trilha (cabeçalho + eventos).
 * @param [props.window] - Janela do contexto (escopa o reveal de telefone/conteúdo).
 *
 * @returns O card da trilha.
 */
export function TrailCard({
  result,
  window,
}: Readonly<{
  result: ShippingTrailInterface;
  window?: RevealWindowInterface
}>): JSX.Element {
  const attempts = result.events.filter((event) => event.type === 'provider_attempt').length;
  const duration = trailDuration(result.events);

  return (
    <ToolResultFrame
      icon={<ClockCounterClockwise size={13} />}
      toolName="get_shipping_trail"
      title={`Trilha · ${result.shipping_id}`}
      subtitle={`${result.customer} → ${result.provider}`}
      actions={<StatusPill status={result.final_status} />}
    >
      <div style={{ padding: '16px 18px' }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: cssVar.space12,
          marginBottom: cssVar.space16,
        }}
        >
          <SummaryItem
            label="Cliente"
            value={result.customer}
          />
          <div style={{ minWidth: 0 }}>
            <FieldLabel>App</FieldLabel>
            <div style={{
              marginTop: cssVar.space4,
              fontFamily: cssValue.fontMono,
              fontSize: cssVar.fs12,
              color: cssVar.fg,
              wordBreak: 'break-all',
            }}
            >
              {result.app_id ?? '—'}
            </div>
          </div>
          <div style={{ minWidth: 0 }}>
            <FieldLabel>ID da campanha</FieldLabel>
            <div style={{
              marginTop: cssVar.space4,
              fontFamily: cssValue.fontMono,
              fontSize: cssVar.fs12,
              color: cssVar.fg,
              wordBreak: 'break-all',
            }}
            >
              {result.campaign_id ?? '—'}
            </div>
          </div>
          <SummaryItem
            label="Canal"
            value={result.channel
              ? (CHANNEL_LABELS[result.channel] ?? result.channel)
              : '—'}
          />
          <div>
            <FieldLabel>Telefone</FieldLabel>
            <div style={{
              marginTop: cssVar.space4,
              fontSize: cssVar.fs12,
              color: cssVar.fg,
            }}
            >
              <RevealField
                shippingId={result.shipping_id}
                kind="phone"
                masked={result.phone_masked}
                window={window}
              />
            </div>
          </div>
          <SummaryItem
            label="Fornecedor"
            value={result.provider}
          />
          <SummaryItem
            label="Tentativas"
            value={String(attempts)}
          />
          <SummaryItem
            label="Duração"
            value={duration}
          />
        </div>

        <div style={{
          position: 'relative',
          paddingLeft: 28,
        }}
        >
          <div style={{
            position: 'absolute',
            left: 11,
            top: 6,
            bottom: 6,
            width: 1,
            background: cssVar.border,
          }}
          />
          {result.events.map((
            event,
            index,
          ) => {
            const visual = VISUALS_BY_RECEIVED_TYPE[event.type] ?? EVENT_VISUALS.routing;
            const colors = TONE_COLORS[visual.tone];
            const EventIcon = visual.icon;
            const isLast = index === result.events.length - 1;

            return (
              <div
                key={`${event.type}-${event.at}`}
                style={{
                  position: 'relative',
                  paddingBottom: isLast
                    ? 0
                    : cssVar.space16,
                }}
              >
                <div style={{
                  position: 'absolute',
                  left: -28,
                  top: 0,
                  display: 'grid',
                  placeItems: 'center',
                  width: 24,
                  height: 24,
                  borderRadius: cssVar.radius4,
                  background: colors.background,
                  color: colors.color,
                  boxShadow: '0 0 0 3px var(--at-white)',
                }}
                >
                  <EventIcon size={12} />
                </div>
                <div style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: cssVar.space8,
                  flexWrap: 'wrap',
                }}
                >
                  <span style={{
                    fontSize: cssVar.fs14,
                    fontWeight: 600,
                    color: cssVar.fg,
                  }}
                  >
                    {event.label}
                  </span>
                  <code style={{
                    fontFamily: cssValue.fontMono,
                    fontSize: 11,
                    color: cssVar.fgSubtle,
                  }}
                  >
                    {formatDateTimeSeconds(event.at)}
                  </code>
                </div>
                <div style={{
                  marginTop: cssVar.space2,
                  fontSize: cssVar.fs12,
                  color: cssVar.fgMuted,
                }}
                >
                  {event.detail}
                </div>
              </div>
            );
          })}
        </div>

        <div style={{
          marginTop: cssVar.space16,
          padding: '10px 12px',
          background: cssVar.bgSoft,
          border: '1px dashed var(--at-border)',
          borderRadius: cssVar.radius4,
          fontSize: 11,
          color: cssVar.fgMuted,
          display: 'flex',
          alignItems: 'baseline',
          gap: cssVar.space8,
          flexWrap: 'wrap',
        }}
        >
          {result.content_available
            ? (
              <>
                <span>Conteúdo mascarado por padrão ·</span>
                <RevealField
                  shippingId={result.shipping_id}
                  kind="content"
                  window={window}
                />
              </>
            )
            : (
              <span title="O relatório de auditoria registra status e metadados de entrega, não o texto do envio.">
                Conteúdo do envio não disponível nesta fonte de auditoria.
              </span>
            )}
        </div>
      </div>
    </ToolResultFrame>
  );
}

/** Rótulo curto em maiúsculas usado nos campos de resumo. */
function FieldLabel({ children }: Readonly<{ children: string }>): JSX.Element {
  return (
    <div style={{
      fontSize: 10,
      fontWeight: 600,
      color: cssVar.fgSubtle,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    }}
    >
      {children}
    </div>
  );
}

/** Item do strip de resumo: rótulo + valor. */
function SummaryItem({
  label,
  value,
}: Readonly<{
  label: string;
  value: string
}>): JSX.Element {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div style={{
        marginTop: cssVar.space2,
        fontSize: cssVar.fs14,
        fontWeight: 600,
        color: cssVar.fg,
      }}
      >
        {value}
      </div>
    </div>
  );
}
