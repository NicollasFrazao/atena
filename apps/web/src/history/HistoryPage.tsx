import { useMemo, useState, type JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  ChatsCircleIcon as ChatsCircle,
  MagnifyingGlassIcon as MagnifyingGlass,
  PushPinIcon as PushPin,
  WrenchIcon as Wrench,
} from '@phosphor-icons/react';
import type { ChatSessionListItemInterface } from '@atena/types';
import { setSessionPinned, useSessions } from '../api/sessions';
import { useChatContext } from '../chat/chat-context';
import { dayKeyInTz, formatDate, formatTime } from '../util/time';
import { cssValue, cssVar } from '../styles/tokens';
import { MS_PER_DAY } from '../util/units';

/** Filtro ativo da lista. */
type HistoryFilterType = 'all' | 'pinned' | 'incident';

/** Abas de filtro. */
const FILTERS: {
  id: HistoryFilterType;
  label: string
}[] = [
  {
    id: 'all',
    label: 'Todas',
  },
  {
    id: 'pinned',
    label: 'Fixadas',
  },
  {
    id: 'incident',
    label: 'Com incidente',
  },
];

/** Rótulo do dia (Hoje / Ontem / DD/MM) a partir do ISO, no fuso de exibição do app. */
function dayLabel(iso: string): string {
  const now = new Date();
  const todayKey = dayKeyInTz(now.toISOString());
  const yesterdayKey = dayKeyInTz(new Date(now.getTime() - MS_PER_DAY).toISOString());
  const key = dayKeyInTz(iso);

  if (key === todayKey) {
    return 'Hoje';
  }

  if (key === yesterdayKey) {
    return 'Ontem';
  }

  return formatDate(iso);
}

/** Hora (HH:MM) do ISO, no fuso de exibição do app. */
function timeLabel(iso: string): string {
  return formatTime(iso);
}

/**
 * Tela de Histórico de conversas (`GET /chat/sessions`): lista as sessões agrupadas por dia, com
 * busca (título/tag/prévia) e filtros (todas/fixadas/com incidente). "Abrir" mostra o transcript
 * read-only da sessão. Dados reais.
 *
 * @returns A tela de histórico.
 */
export function HistoryPage(): JSX.Element {
  const sessions = useSessions();
  const { resume } = useChatContext();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [
    query,
    setQuery,
  ] = useState('');

  const [
    filter,
    setFilter,
  ] = useState<HistoryFilterType>('all');

  // Continuar uma sessão: carrega o histórico no chat compartilhado e vai para o assistente.
  const onOpen = (session: ChatSessionListItemInterface): void => {
    resume(
      session.id,
      session.title,
    );

    void navigate('/');
  };

  // Fixa/desafixa e recarrega a lista (otimismo via invalidação da query de sessões).
  const togglePin = (session: ChatSessionListItemInterface): void => {
    setSessionPinned(
      session.id,
      !session.pinned,
    )
      .then(() => queryClient.invalidateQueries({ queryKey: ['sessions'] }))
      .catch(() => undefined);
  };

  const list = useMemo(
    () => filterSessions(
      sessions.data ?? [],
      query,
      filter,
    ),
    [
      sessions.data,
      query,
      filter,
    ],
  );

  const groups = useMemo(
    () => groupByDay(list),
    [list],
  );

  return (
    <div style={{
      maxWidth: 1100,
      margin: '0 auto',
      padding: cssVar.space32,
    }}
    >
      <h1 style={{
        margin: 0,
        marginBottom: cssVar.space4,
        fontSize: cssVar.fs24,
        fontWeight: 600,
        color: cssVar.fg,
      }}
      >
        Histórico de conversas
      </h1>
      <div style={{
        fontSize: cssVar.fs14,
        color: cssVar.fgMuted,
        marginBottom: cssVar.space24,
      }}
      >
        {sessions.data?.length ?? 0}
        {' '}
        {(sessions.data?.length ?? 0) === 1
          ? 'sessão'
          : 'sessões'}
        {' no total · retenção 90 dias (limite do hot store)'}
      </div>

      <div style={{
        display: 'flex',
        gap: cssVar.space12,
        marginBottom: cssVar.space24,
        flexWrap: 'wrap',
      }}
      >
        <div style={{
          position: 'relative',
          flex: 1,
          minWidth: 240,
          maxWidth: 380,
        }}
        >
          <MagnifyingGlass
            size={16}
            style={{
              position: 'absolute',
              left: 12,
              top: '50%',
              transform: 'translateY(-50%)',
              color: cssVar.fgSubtle,
            }}
          />
          <input
            value={query}
            onChange={(event) => { setQuery(event.target.value); }}
            placeholder="Buscar por código, título, tag ou conteúdo…"
            style={{
              width: '100%',
              height: 38,
              padding: '0 12px 0 34px',
              border: cssVar.borderLine,
              borderRadius: cssVar.radius4,
              fontFamily: 'inherit',
              fontSize: cssVar.fs14,
              color: cssVar.fg,
            }}
          />
        </div>
        <div style={{
          display: 'flex',
          gap: cssVar.space4,
          padding: 2,
          background: cssVar.bgSoft,
          border: cssVar.borderLine,
          borderRadius: cssVar.radius4,
        }}
        >
          {FILTERS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => { setFilter(option.id); }}
              style={{
                height: 32,
                padding: cssVar.paddingInline12,
                borderRadius: cssVar.radius4,
                border: 'none',
                background: filter === option.id
                  ? cssVar.white
                  : 'transparent',
                boxShadow: filter === option.id
                  ? cssVar.shadowXs
                  : 'none',
                color: filter === option.id
                  ? cssVar.fg
                  : cssVar.fgMuted,
                fontSize: cssVar.fs12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {sessions.isLoading
        ? <Muted>Carregando sessões…</Muted>
        : null}
      {sessions.isError
        ? <Muted>Não foi possível carregar o histórico.</Muted>
        : null}
      {!sessions.isLoading && list.length === 0
        ? (
          <div style={{
            background: cssVar.white,
            border: cssVar.borderLine,
            borderRadius: 8,
            padding: cssVar.space32,
            textAlign: 'center',
          }}
          >
            <MagnifyingGlass
              size={24}
              color={cssVar.fgSubtle}
            />
            <div style={{
              marginTop: cssVar.space12,
              fontSize: cssVar.fs14,
              fontWeight: 600,
              color: cssVar.fg,
            }}
            >
              Nenhuma sessão encontrada
            </div>
            <div style={{
              marginTop: cssVar.space4,
              fontSize: cssVar.fs12,
              color: cssVar.fgMuted,
            }}
            >
              Ajuste os filtros ou o termo de busca.
            </div>
          </div>
        )
        : null}

      {groups.map((group) => (
        <div
          key={group.label}
          style={{ marginBottom: cssVar.space24 }}
        >
          <div style={{
            fontSize: cssVar.fs12,
            fontWeight: 600,
            color: cssVar.fgSubtle,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            marginBottom: cssVar.space8,
          }}
          >
            {group.label}
          </div>
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: cssVar.space8,
          }}
          >
            {group.sessions.map((session) => (
              <SessionCard
                key={session.id}
                session={session}
                onOpen={() => { onOpen(session); }}
                onTogglePin={() => { togglePin(session); }}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Card de uma sessão (linha inteira clicável → continua a sessão no assistente). */
function SessionCard({
  session,
  onOpen,
  onTogglePin,
}: Readonly<{
  session: ChatSessionListItemInterface;
  onOpen: () => void;
  onTogglePin: () => void
}>): JSX.Element {
  return (
    <div
      className="at-hover-lift"
      onClick={onOpen}
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        gap: cssVar.space16,
        alignItems: 'flex-start',
        background: cssVar.white,
        border: cssVar.borderLine,
        borderLeft: `3px solid ${session.has_incident
          ? cssVar.danger200
          : 'transparent'}`,
        borderRadius: 8,
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
          {session.pinned
            ? (
              <PushPin
                size={12}
                weight="fill"
                color={cssVar.primary}
              />
            )
            : null}
          {session.has_incident
            ? (
              <span style={{
                display: cssValue.inlineFlex,
                alignItems: 'center',
                gap: cssVar.space4,
                padding: '2px 8px',
                borderRadius: 999,
                background: '#C127221a',
                color: '#C12722',
                fontSize: cssVar.fs12,
                fontWeight: 600,
              }}
              >
                <span style={{
                  width: 6,
                  height: 6,
                  borderRadius: 999,
                  background: '#C12722',
                }}
                />
                incidente
              </span>
            )
            : null}
          <span style={{
            fontSize: cssVar.fs12,
            color: cssVar.fgMuted,
          }}
          >
            {dayLabel(session.started_at)}, {timeLabel(session.started_at)} · {session.duration}
            {' · '}
            <code style={{
              fontFamily: cssValue.fontMono,
              color: cssVar.fgSubtle,
            }}
            >
              {session.id}
            </code>
          </span>
        </div>
        <div style={{
          fontSize: cssVar.fs14,
          fontWeight: 600,
          color: cssVar.fg,
          marginBottom: cssVar.space4,
        }}
        >
          {session.title}
        </div>
        <div style={{
          fontSize: cssVar.fs12,
          color: cssVar.fgMuted,
          marginBottom: cssVar.space8,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        >
          {session.preview}
        </div>
        {session.tags.length > 0
          ? (
            <div style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: cssVar.space4,
            }}
            >
              {session.tags.map((tag) => (
                <span
                  key={tag}
                  style={{
                    padding: '2px 8px',
                    borderRadius: 999,
                    background: cssVar.bgSoft,
                    border: cssVar.borderLine,
                    fontSize: cssVar.fs10,
                    fontWeight: 600,
                    color: cssVar.fgMuted,
                  }}
                >
                  {tag}
                </span>
              ))}
            </div>
          )
          : null}
      </div>

      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: cssVar.space4,
        flexShrink: 0,
      }}
      >
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onTogglePin();
          }}
          title={session.pinned
            ? 'Desafixar'
            : 'Fixar'}
          style={{
            display: cssValue.inlineFlex,
            alignItems: 'center',
            justifyContent: 'center',
            width: 26,
            height: 26,
            border: 'none',
            borderRadius: cssVar.radius4,
            background: 'transparent',
            color: session.pinned
              ? cssVar.primary
              : cssVar.fgSubtle,
            cursor: 'pointer',
          }}
        >
          <PushPin
            size={15}
            weight={session.pinned
              ? 'fill'
              : 'regular'}
          />
        </button>
        <div style={{
          display: 'flex',
          gap: cssVar.space16,
          fontSize: cssVar.fs12,
          color: cssVar.fgMuted,
        }}
        >
          <span style={{
            display: cssValue.inlineFlex,
            alignItems: 'center',
            gap: cssVar.space4,
          }}
          >
            <ChatsCircle size={12} />
            {session.message_count}
          </span>
          <span style={{
            display: cssValue.inlineFlex,
            alignItems: 'center',
            gap: cssVar.space4,
          }}
          >
            <Wrench size={12} />
            {session.tool_count} tools
          </span>
        </div>
        <span style={{
          fontSize: cssVar.fs12,
          fontWeight: 600,
          color: cssVar.primaryDark,
        }}
        >
          Abrir ›
        </span>
      </div>
    </div>
  );
}

/** Linha de texto auxiliar (loading/erro/vazio). */
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

/** Aplica busca (título/tag/prévia) + filtro (todas/fixadas/incidente). */
function filterSessions(
  sessions: ChatSessionListItemInterface[],
  query: string,
  filter: HistoryFilterType,
): ChatSessionListItemInterface[] {
  const term = query.trim().toLowerCase();

  return sessions.filter((session) => {
    if (
      filter === 'pinned'
      && !session.pinned
    ) {
      return false;
    }

    if (
      filter === 'incident'
      && !session.has_incident
    ) {
      return false;
    }

    if (term === '') {
      return true;
    }

    const haystack = [
      session.id,
      session.title,
      session.preview,
      ...session.tags,
    ].join(' ').toLowerCase();

    return haystack.includes(term);
  });
}

/** Agrupa as sessões por dia, preservando a ordem (mais recentes primeiro). */
function groupByDay(sessions: ChatSessionListItemInterface[]): {
  label: string;
  sessions: ChatSessionListItemInterface[]
}[] {
  const groups: {
    label: string;
    sessions: ChatSessionListItemInterface[]
  }[] = [];

  for (const session of sessions) {
    const label = dayLabel(session.started_at);
    const last = groups.at(-1);

    if (last?.label === label) {
      last.sessions.push(session);
    }
    else {
      groups.push({
        label,
        sessions: [session],
      });
    }
  }

  return groups;
}
