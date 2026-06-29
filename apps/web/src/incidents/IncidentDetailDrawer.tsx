import { useEffect, useState } from 'react';
import {
  ChatsCircle,
  CheckCircle,
  DownloadSimple,
  type Icon,
  MagnifyingGlass,
  Flag,
  Wrench,
  X,
} from '@phosphor-icons/react';
import type {
  IncidentActivityInterface,
  IncidentInterface,
} from '@atena/types';
import { downloadIncidentExport, useIncidentDetail, useIncidentShippings } from '../api/incidents';
import { formatRelativeTime } from '../util/time';
import { SEVERITY_COLOR, SEVERITY_LABEL } from './severity';

/** Visual (ícone + cor) de um item de atividade conforme o tipo. */
function activityVisual(type: IncidentActivityInterface['type']): {
  icon: Icon;
  color: string
} {
  if (type === 'status_change') {
    return {
      icon: Flag,
      color: '#0052CC',
    };
  }

  if (type === 'tool_call') {
    return {
      icon: Wrench,
      color: 'var(--at-fg-muted)',
    };
  }

  return {
    icon: ChatsCircle,
    color: 'var(--at-fg-muted)',
  };
}

/** Texto legível de uma atividade (best-effort sobre o payload, sem vazar PII). */
function activityText(activity: IncidentActivityInterface): string {
  const payload = activity.payload;

  const str = (key: string): string | null => (typeof payload[key] === 'string'
    ? payload[key] as string
    : null);

  if (activity.type === 'status_change') {
    const to = str('to') ?? str('status');

    return to
      ? `alterou o status para ${to}`
      : 'alterou o status';
  }

  if (activity.type === 'tool_call') {
    const tool = str('name') ?? str('tool');

    return tool
      ? `executou ${tool}`
      : 'executou uma ferramenta';
  }

  return str('text') ?? 'comentou';
}

/**
 * Painel de Detalhes do incidente (slide-over à direita): cabeçalho (severidade/id/regra/dimensão),
 * métricas que dispararam, resumo e a trilha de atividades (`GET /incidents/:id`). No rodapé, a ação
 * primária (Acknowledge se `detected`, senão Resolver) + Investigar. Somente leitura do detalhe.
 *
 * @param {object} props - Id do incidente + callbacks de ação.
 * @returns {JSX.Element} O painel de detalhes.
 */
export function IncidentDetailDrawer({
  incidentId,
  onClose,
  onAcknowledge,
  onResolve,
  onInvestigate,
}: {
  incidentId: string;
  onClose: () => void;
  onAcknowledge: (id: string) => void;
  onResolve: (incident: IncidentInterface) => void;
  onInvestigate: (incident: IncidentInterface) => void
}): JSX.Element {
  const query = useIncidentDetail(incidentId);
  const incident = query.data;

  useEffect(
    () => {
      const onKey = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') {
          onClose();
        }
      };

      document.addEventListener(
        'keydown',
        onKey,
      );

      return () => document.removeEventListener(
        'keydown',
        onKey,
      );
    },
    [onClose],
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Detalhes do incidente"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        justifyContent: 'flex-end',
        background: 'rgba(0, 0, 0, 0.5)',
      }}
    >
      <div
        className="at-slide-right"
        onClick={(event) => event.stopPropagation()}
        style={{
          width: 'min(460px, 100%)',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--at-white)',
          boxShadow: '-12px 0 40px rgba(0, 0, 0, 0.2)',
        }}
      >
        {incident
          ? (
            <>
              <Header
                incident={incident}
                onClose={onClose}
              />
              <div style={{
                flex: 1,
                overflowY: 'auto',
                padding: 'var(--at-space-20)',
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--at-space-20)',
              }}
              >
                <Metrics incident={incident} />
                <Section title="Resumo">
                  <p style={{
                    margin: 0,
                    fontSize: 'var(--at-fs-14)',
                    color: 'var(--at-fg)',
                    lineHeight: 'var(--at-lh-22)',
                  }}
                  >
                    {incident.summary}
                  </p>
                </Section>
                <RelatedMessages incident={incident} />
                <Section title="Atividade">
                  <Activity activities={query.data?.activities ?? []} />
                </Section>
              </div>
              <Footer
                incident={incident}
                onAcknowledge={onAcknowledge}
                onResolve={onResolve}
                onInvestigate={onInvestigate}
              />
            </>
          )
          : (
            <div style={{
              flex: 1,
              display: 'grid',
              placeItems: 'center',
              fontSize: 'var(--at-fs-14)',
              color: 'var(--at-fg-muted)',
            }}
            >
              {query.isError
                ? 'Não foi possível carregar o incidente.'
                : 'Carregando…'}
            </div>
          )}
      </div>
    </div>
  );
}

/** Cabeçalho do painel (severidade + id + regra + dimensão + fechar). */
function Header({
  incident,
  onClose,
}: {
  incident: IncidentInterface;
  onClose: () => void
}): JSX.Element {
  const color = SEVERITY_COLOR[incident.severity];

  return (
    <div style={{
      padding: 'var(--at-space-16) var(--at-space-20)',
      borderBottom: '1px solid var(--at-border)',
    }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--at-space-8)',
        marginBottom: 'var(--at-space-8)',
      }}
      >
        <span style={{
          width: 8,
          height: 8,
          borderRadius: 999,
          background: color,
        }}
        />
        <code style={{
          fontFamily: 'ui-monospace, Menlo, monospace',
          fontSize: 'var(--at-fs-12)',
          fontWeight: 600,
          color: 'var(--at-fg-muted)',
        }}
        >
          {incident.id}
        </code>
        <span style={{
          padding: '2px 8px',
          borderRadius: 999,
          background: `${color}1a`,
          color,
          fontSize: 'var(--at-fs-12)',
          fontWeight: 600,
        }}
        >
          {SEVERITY_LABEL[incident.severity]}
        </span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar"
          style={{
            display: 'grid',
            placeItems: 'center',
            width: 28,
            height: 28,
            border: 'none',
            background: 'transparent',
            color: 'var(--at-fg-muted)',
            cursor: 'pointer',
          }}
        >
          <X size={16} />
        </button>
      </div>
      <h2 style={{
        margin: 0,
        fontSize: 'var(--at-fs-18)',
        fontWeight: 600,
        color: 'var(--at-fg)',
        lineHeight: 1.3,
      }}
      >
        {incident.rule}
      </h2>
      <div style={{
        fontSize: 'var(--at-fs-12)',
        color: 'var(--at-fg-muted)',
        marginTop: 'var(--at-space-4)',
      }}
      >
        {incident.dimension_type} ={' '}
        <b style={{ color: 'var(--at-fg)' }}>{incident.dimension_value}</b>
        {' · '}{incident.window}
      </div>
    </div>
  );
}

/** Grade "Métricas que dispararam". */
function Metrics({ incident }: { incident: IncidentInterface }): JSX.Element {
  const items: Array<{
    label: string;
    value: string;
    danger?: boolean
  }> = [
    {
      label: 'Baseline',
      value: incident.metrics.baseline,
    },
    {
      label: 'Atual',
      value: incident.metrics.current,
      danger: true,
    },
    {
      label: 'Threshold',
      value: incident.metrics.threshold,
    },
    {
      label: 'Amostra',
      value: incident.metrics.sample,
    },
  ];

  return (
    <Section title="Métricas que dispararam">
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(2, 1fr)',
        gap: 'var(--at-space-8)',
      }}
      >
        {items.map((item) => (
          <div
            key={item.label}
            style={{
              background: 'var(--at-bg-soft)',
              border: '1px solid var(--at-border)',
              borderRadius: 'var(--at-radius-4)',
              padding: '8px 10px',
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
              {item.label}
            </div>
            <div style={{
              fontFamily: 'var(--at-font-heading)',
              fontSize: 'var(--at-fs-16)',
              fontWeight: 700,
              fontVariantNumeric: 'tabular-nums',
              marginTop: 2,
              color: item.danger
                ? 'var(--at-danger-200)'
                : 'var(--at-fg)',
            }}
            >
              {item.value}
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

/** Lista de atividades do incidente. */
function Activity({ activities }: { activities: IncidentActivityInterface[] }): JSX.Element {
  if (activities.length === 0) {
    return (
      <div style={{
        fontSize: 'var(--at-fs-12)',
        color: 'var(--at-fg-muted)',
      }}
      >
        Nenhuma atividade registrada.
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--at-space-8)',
    }}
    >
      {activities.map((activity) => {
        const visual = activityVisual(activity.type);
        const ItemIcon = visual.icon;

        return (
          <div
            key={activity.id}
            style={{
              display: 'flex',
              gap: 'var(--at-space-8)',
            }}
          >
            <div style={{
              display: 'grid',
              placeItems: 'center',
              width: 22,
              height: 22,
              flexShrink: 0,
              borderRadius: 'var(--at-radius-4)',
              background: 'var(--at-bg-soft)',
              color: visual.color,
            }}
            >
              <ItemIcon size={11} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{
                fontSize: 'var(--at-fs-12)',
                color: 'var(--at-fg)',
              }}
              >
                <b style={{ fontWeight: 600 }}>{activity.user_id ?? 'Sistema'}</b>{' '}
                {activityText(activity)}
              </div>
              <div style={{
                fontSize: 'var(--at-fs-10)',
                color: 'var(--at-fg-subtle)',
                marginTop: 1,
              }}
              >
                {formatRelativeTime(activity.at)}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Botão primário (preenchido) do rodapé. */
const FOOTER_PRIMARY_BUTTON = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 'var(--at-space-4)',
  flex: 1,
  height: 38,
  borderRadius: 'var(--at-radius-4)',
  border: 'none',
  background: 'var(--at-primary)',
  color: 'var(--at-white)',
  fontSize: 'var(--at-fs-14)',
  fontWeight: 600,
  cursor: 'pointer',
} as const;

/** Botão secundário (contorno) do rodapé. */
const FOOTER_OUTLINE_BUTTON = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'var(--at-space-4)',
  height: 38,
  padding: '0 var(--at-space-16)',
  borderRadius: 'var(--at-radius-4)',
  border: '1px solid var(--at-border)',
  background: 'var(--at-white)',
  color: 'var(--at-fg)',
  fontSize: 'var(--at-fs-14)',
  fontWeight: 600,
  cursor: 'pointer',
} as const;

/**
 * Rodapé com as ações do incidente. `detected`: Reconhecer (primária) + Resolver + Investigar.
 * Já reconhecido/resolvido: Resolver (primária) + Investigar.
 *
 * @param {object} props - Incidente + callbacks de ação.
 * @returns {JSX.Element} O rodapé de ações.
 */
function Footer({
  incident,
  onAcknowledge,
  onResolve,
  onInvestigate,
}: {
  incident: IncidentInterface;
  onAcknowledge: (id: string) => void;
  onResolve: (incident: IncidentInterface) => void;
  onInvestigate: (incident: IncidentInterface) => void
}): JSX.Element {
  const isDetected = incident.status === 'detected';

  return (
    <div style={{
      display: 'flex',
      gap: 'var(--at-space-8)',
      padding: 'var(--at-space-16) var(--at-space-20)',
      borderTop: '1px solid var(--at-border)',
      background: 'var(--at-bg-soft)',
    }}
    >
      {isDetected
        ? (
          <button
            type="button"
            onClick={() => onAcknowledge(incident.id)}
            style={FOOTER_PRIMARY_BUTTON}
          >
            <CheckCircle size={15} />
            Reconhecer
          </button>
        )
        : (
          <button
            type="button"
            onClick={() => onResolve(incident)}
            style={FOOTER_PRIMARY_BUTTON}
          >
            <Flag size={15} />
            Resolver…
          </button>
        )}
      {isDetected
        ? (
          <button
            type="button"
            onClick={() => onResolve(incident)}
            style={FOOTER_OUTLINE_BUTTON}
          >
            <Flag size={15} />
            Resolver…
          </button>
        )
        : null}
      <button
        type="button"
        onClick={() => onInvestigate(incident)}
        style={FOOTER_OUTLINE_BUTTON}
      >
        <MagnifyingGlass size={15} />
        Investigar
      </button>
    </div>
  );
}

/** Texto auxiliar (muted) das mensagens relacionadas (loading / contagem / vazio). */
function RelatedNote({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div style={{
      fontSize: 'var(--at-fs-12)',
      color: 'var(--at-fg-muted)',
    }}
    >
      {children}
    </div>
  );
}

/**
 * Seção "Mensagens relacionadas" do detalhe: total impactado, os códigos de envio (campaign_id) com
 * mais ocorrências na janela do incidente e download (CSV) das envios impactados. Busca real
 * ({@link useIncidentShippings}); dimensões sem busca direta caem no modo contagem.
 *
 * @param {{ incident: IncidentInterface }} props - Incidente em foco.
 * @returns {JSX.Element} A seção de mensagens relacionadas.
 */
function RelatedMessages({ incident }: { incident: IncidentInterface }): JSX.Element {
  const query = useIncidentShippings(incident.id);
  const data = query.data;

  const [
    downloading,
    setDownloading,
  ] = useState(false);

  // Baixa EXATAMENTE as envios impactados (ids do detector) — CSV gerado no servidor, telefone em
  // claro (acesso auditado: export_report · pii).
  const onDownload = (): void => {
    setDownloading(true);

    downloadIncidentExport(incident.id)
      .catch(() => undefined)
      .finally(() => setDownloading(false));
  };

  let body: React.ReactNode;

  if (query.isLoading) {
    body = <RelatedNote>Carregando mensagens…</RelatedNote>;
  }
  else if (
    !data
         || !data.available
  ) {
    body = (
      <RelatedNote>
        <b style={{
          color: 'var(--at-fg)',
          fontWeight: 600,
        }}
        >
          {incident.related_shippings}
        </b>
        {' envios impactados (resumo por contagem)'}
      </RelatedNote>
    );
  }
  else if (data.total === 0) {
    body = <RelatedNote>Nenhuma mensagem na janela de detecção.</RelatedNote>;
  }
  else {
    body = (
      <div>
        <div style={{
          fontSize: 'var(--at-fs-14)',
          color: 'var(--at-fg)',
          marginBottom: 'var(--at-space-8)',
        }}
        >
          <b style={{ fontWeight: 600 }}>{incident.related_shippings}</b> envios impactados
        </div>
        <div style={{
          fontSize: 'var(--at-fs-10)',
          fontWeight: 600,
          color: 'var(--at-fg-subtle)',
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          marginBottom: 'var(--at-space-4)',
        }}
        >
          Principais códigos de envio
        </div>
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--at-space-4)',
          marginBottom: 'var(--at-space-12)',
        }}
        >
          {data.top_campaigns.map((campaign) => (
            <div
              key={campaign.campaign_id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 'var(--at-space-8)',
              }}
            >
              <code style={{
                fontFamily: 'ui-monospace, Menlo, monospace',
                fontSize: 'var(--at-fs-12)',
                color: 'var(--at-fg-muted)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              >
                {campaign.campaign_id}
              </code>
              {campaign.count > 1
                ? (
                  <span style={{
                    flexShrink: 0,
                    fontSize: 'var(--at-fs-12)',
                    color: 'var(--at-fg-subtle)',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                  >
                    ×{campaign.count}
                  </span>
                )
                : null}
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={onDownload}
          disabled={downloading}
          title="Baixa as envios impactados · telefone em claro (acesso auditado)"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--at-space-4)',
            height: 32,
            padding: '0 var(--at-space-12)',
            borderRadius: 'var(--at-radius-4)',
            border: '1px solid var(--at-border)',
            background: 'var(--at-white)',
            color: 'var(--at-fg)',
            fontSize: 'var(--at-fs-12)',
            fontWeight: 600,
            cursor: downloading
              ? 'wait'
              : 'pointer',
            opacity: downloading
              ? 0.7
              : 1,
          }}
        >
          <DownloadSimple size={14} />
          {downloading
            ? 'Baixando…'
            : 'Baixar envios impactados'}
        </button>
      </div>
    );
  }

  return <Section title="Mensagens relacionadas">{body}</Section>;
}

/** Bloco com rótulo em maiúsculas + conteúdo. */
function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode
}): JSX.Element {
  return (
    <div>
      <div style={{
        fontSize: 'var(--at-fs-10)',
        fontWeight: 600,
        color: 'var(--at-fg-subtle)',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        marginBottom: 'var(--at-space-8)',
      }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}
