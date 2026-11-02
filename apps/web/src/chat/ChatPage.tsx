import { type ReactNode, useEffect, useRef, useState, type JSX } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowUpIcon as ArrowUp,
  ChatCircleIcon as ChatCircle,
  CheckIcon as Check,
  CircleNotchIcon as CircleNotch,
  CopyIcon as Copy,
  type Icon,
  ListChecksIcon as ListChecks,
  MagnifyingGlassIcon as MagnifyingGlass,
  PencilSimpleIcon as PencilSimple,
  ShieldCheckIcon as ShieldCheck,
  SparkleIcon as Sparkle,
  TrendUpIcon as TrendUp,
  WarningCircleIcon as WarningCircle,
} from '@phosphor-icons/react';
import {
  type DisplayMessageInterface,
  type DisplayPartInterface,
  type DisplayToolInterface,
  type RefusalInterface,
} from './useChat';
import { useChatContext } from './chat-context';
import { useSessions } from '../api/sessions';
import { ToolResultCard } from './tool-cards/ToolResultCard';
import { IncidentChatCard } from './IncidentChatCard';
import { Markdown } from './Markdown';
import { ToolsDisclaimer } from './ToolsDisclaimer';
import { humanizeToolNames, toolLabel } from './tools-catalog';
import { useCurrentUser } from '../user/currentUser';
import { cssValue, cssVar } from '../styles/tokens';
import { MS_PER_SECOND, PERCENT_SCALE, SECONDS_PER_MINUTE } from '../util/units';

/** Degradê do avatar do assistente (ícone sparkle), igual ao protótipo. */
const SPARKLE_GRADIENT = 'linear-gradient(135deg, #077E70, #01322F)';

/** Cartão de sugestão do estado vazio: ícone + título + exemplo, dispara um prompt ao clicar. */
interface SuggestionInterface {
  icon: Icon;
  title: string;
  sub: string;
  prompt: string;
}

/** Sugestões do estado vazio (cards ricos 2×2; o clique envia o `prompt`). */
const SUGGESTIONS: SuggestionInterface[] = [
  {
    icon: MagnifyingGlass,
    title: 'Buscar envios de um cliente',
    sub: 'Ex.: envios do cliente 1001 nas últimas 24h',
    prompt: 'Mostre os envios do cliente 1001 nas últimas 24h',
  },
  {
    icon: ListChecks,
    title: 'Ver a trilha de um envio',
    sub: 'A jornada completa de uma mensagem, evento a evento',
    prompt: 'Quero ver a trilha completa de um envio',
  },
  {
    icon: TrendUp,
    title: 'Relatório de entregabilidade',
    sub: 'Agrupado por fornecedor, últimas 24 horas',
    prompt: 'Gere um relatório de entregabilidade das últimas 24h',
  },
  {
    icon: ShieldCheck,
    title: 'Analisar risco de um conteúdo',
    sub: 'Verifica padrões de phishing e SPAM',
    prompt: 'Analise o risco deste conteúdo: "Sua conta será bloqueada hoje. '
      + 'Clique http://bit.ly/regulariza para regularizar."',
  },
];

/**
 * Tela de Chat da Atena: estado vazio com sugestões, lista de mensagens com streaming
 * (pill de tool → card de resultado → texto token-a-token) e composer. Cada tool concluída
 * com sucesso renderiza um card rico abaixo da pill (ver `tool-cards/`); o reveal de PII
 * (telefone/conteúdo) é fatia futura.
 *
 * @returns A tela de chat.
 */
export function ChatPage(): JSX.Element {
  const {
    messages,
    send,
    sending,
    ready,
  } = useChatContext();

  const [
    searchParams,
    setSearchParams,
  ] = useSearchParams();

  const endRef = useRef<HTMLDivElement>(null);
  const autoSentRef = useRef(false);

  // "Investigar" (de Incidentes) abre o chat com `?q=…`; dispara a pergunta UMA vez, quando pronto.
  useEffect(
    () => {
      const pending = searchParams.get('q');

      if (
        !pending
        || !ready
        || autoSentRef.current
      ) {
        return;
      }

      autoSentRef.current = true;
      send(pending);

      setSearchParams(
        {},
        { replace: true },
      );
    },
    [
      ready,
      searchParams,
      send,
      setSearchParams,
    ],
  );

  useEffect(
    () => {
      endRef.current?.scrollIntoView({ behavior: 'smooth' });
    },
    [messages],
  );

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
    }}
    >
      <SessionHeader />
      <div style={{
        flex: 1,
        minHeight: 0,
        overflow: 'auto',
      }}
      >
        <div style={{
          width: '70%',
          maxWidth: 1600,
          margin: '0 auto',
          minHeight: '100%',
          display: 'flex',
          flexDirection: 'column',
          padding: 'var(--at-space-24) 0',
        }}
        >
          {messages.length === 0
            ? <EmptyState onPick={send} />
            : messages.map((message) => (
              <MessageRow
                key={message.id}
                message={message}
              />
            ))}
          <div ref={endRef} />
        </div>
      </div>
      <Composer
        disabled={!ready || sending}
        onSend={send}
      />
    </div>
  );
}

/**
 * Cabeçalho da sessão de chat (fixo acima da conversa): nome editável, código (id) copiável e o
 * total de sessões com mensagens. Renomear persiste via PATCH e atualiza o histórico/contador.
 *
 * @returns A barra de cabeçalho da sessão.
 */
function SessionHeader(): JSX.Element {
  const {
    sessionId,
    sessionTitle,
    rename,
  } = useChatContext();

  const sessions = useSessions();
  const navigate = useNavigate();
  const openCount = (sessions.data ?? []).filter((session) => session.message_count > 0).length;

  return (
    <div style={{
      borderBottom: cssVar.borderLine,
      background: cssVar.white,
      flexShrink: 0,
    }}
    >
      <div style={{
        width: '70%',
        maxWidth: 1600,
        margin: '0 auto',
        display: 'flex',
        alignItems: 'center',
        gap: cssVar.space12,
        padding: 'var(--at-space-12) 0',
      }}
      >
        <SessionNameEditor
          title={sessionTitle}
          onRename={rename}
        />
        <SessionCode sessionId={sessionId} />
        <span style={{ flex: 1 }} />
        <SessionCount
          count={openCount}
          onClick={() => { navigate('/historico'); }}
        />
      </div>
    </div>
  );
}

/** Nome da sessão, editável inline (clique → input; Enter/blur salva, Esc cancela). */
function SessionNameEditor({
  title,
  onRename,
}: Readonly<{
  title: string;
  onRename: (title: string) => void
}>): JSX.Element {
  const [
    editing,
    setEditing,
  ] = useState(false);

  const [
    draft,
    setDraft,
  ] = useState(title);

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(
    () => {
      if (editing) {
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    },
    [editing],
  );

  const open = (): void => {
    setDraft(title);
    setEditing(true);
  };

  const commit = (): void => {
    setEditing(false);
    const next = draft.trim();

    if (
      next.length > 0
      && next !== title
    ) {
      onRename(next);
    }
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(event) => { setDraft(event.target.value); }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            commit();
          }
          else if (event.key === 'Escape') {
            setEditing(false);
          }
        }}
        maxLength={200}
        style={{
          fontFamily: cssVar.fontHeading,
          fontSize: cssVar.fs16,
          fontWeight: 600,
          color: cssVar.fg,
          border: '1px solid var(--at-primary)',
          borderRadius: cssVar.radius4,
          padding: '2px 8px',
          outline: 'none',
          background: cssVar.white,
        }}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={open}
      title="Renomear a sessão"
      style={{
        display: cssValue.inlineFlex,
        alignItems: 'center',
        gap: cssVar.space4,
        border: 'none',
        background: 'none',
        padding: 0,
        cursor: 'pointer',
        color: cssVar.fg,
      }}
    >
      <span style={{
        fontFamily: cssVar.fontHeading,
        fontSize: cssVar.fs16,
        fontWeight: 600,
      }}
      >
        {title}
      </span>
      <PencilSimple
        size={13}
        color={cssVar.fgSubtle}
      />
    </button>
  );
}

/** How long the "copied" confirmation of the session code stays visible. */
const COPIED_FEEDBACK_MS = 1200;

/** Código (id) da sessão em mono, copiável ao clicar. */
function SessionCode({ sessionId }: Readonly<{ sessionId: string | null }>): JSX.Element {
  const [
    copied,
    setCopied,
  ] = useState(false);

  if (sessionId === null) {
    return (
      <span style={{
        fontFamily: cssValue.fontMono,
        fontSize: cssVar.fs12,
        color: cssVar.fgSubtle,
      }}
      >
        sessão nova…
      </span>
    );
  }

  const copy = (): void => {
    navigator.clipboard.writeText(sessionId)
      .then(() => {
        setCopied(true);

        window.setTimeout(
          () => { setCopied(false); },
          COPIED_FEEDBACK_MS,
        );
      })
      .catch(() => undefined);
  };

  return (
    <button
      type="button"
      onClick={copy}
      title="Copiar código da sessão"
      style={{
        display: cssValue.inlineFlex,
        alignItems: 'center',
        gap: cssVar.space4,
        border: cssVar.borderLine,
        background: cssVar.bgSoft,
        borderRadius: cssVar.radius4,
        padding: '2px 8px',
        cursor: 'pointer',
        fontFamily: cssValue.fontMono,
        fontSize: cssVar.fs12,
        color: cssVar.fgMuted,
      }}
    >
      {sessionId}
      {copied
        ? (
          <Check
            size={12}
            color={cssVar.success300}
          />
        )
        : <Copy size={12} />}
    </button>
  );
}

/** Total de sessões com mensagens (conversas reais); clicar abre o Histórico. */
function SessionCount({
  count,
  onClick,
}: Readonly<{
  count: number;
  onClick: () => void
}>): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Ver histórico de sessões"
      style={{
        display: cssValue.inlineFlex,
        alignItems: 'center',
        gap: cssVar.space4,
        border: cssVar.borderLine,
        background: cssVar.bgSoft,
        borderRadius: cssVar.radius4,
        padding: '4px 8px',
        cursor: 'pointer',
        fontSize: cssVar.fs13,
        color: cssVar.fgMuted,
        whiteSpace: 'nowrap',
      }}
    >
      <ChatCircle size={14} />
      {count}
      {' '}
      {count === 1
        ? 'sessão'
        : 'sessões'}
    </button>
  );
}

/** Estado vazio: avatar sparkle + saudação personalizada + nota read-only + 4 cards de sugestão. */
function EmptyState({ onPick }: Readonly<{ onPick: (text: string) => void }>): JSX.Element {
  const user = useCurrentUser();

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 'var(--at-space-40) var(--at-space-24)',
    }}
    >
      <div style={{
        width: 56,
        height: 56,
        borderRadius: 14,
        background: SPARKLE_GRADIENT,
        display: 'grid',
        placeItems: 'center',
        boxShadow: '0 8px 24px rgba(7, 126, 112, 0.25)',
        marginBottom: cssVar.space16,
      }}
      >
        <Sparkle
          size={26}
          weight="fill"
          color={cssVar.white}
        />
      </div>
      <h1 style={{
        fontSize: cssVar.fs28,
        fontWeight: 600,
        color: cssVar.fg,
        margin: 0,
        marginBottom: cssVar.space8,
        textAlign: 'center',
        letterSpacing: -0.3,
      }}
      >
        Olá, {user.firstName}. Em que posso ajudar?
      </h1>
      <p style={{
        fontSize: cssVar.fs14,
        color: cssVar.fgMuted,
        margin: 0,
        marginBottom: cssVar.space24,
        textAlign: 'center',
        maxWidth: 520,
        lineHeight: cssVar.lh22,
      }}
      >
        Eu busco mensagens, mostro a trilha completa de um envio, analiso risco de conteúdo e gero
        relatórios de entregabilidade. Para a Fase 1 todos os dados são{' '}
        <strong style={{ color: cssVar.fg }}>read-only</strong>.
      </p>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(2, 1fr)',
        gap: cssVar.space12,
        maxWidth: 640,
        width: '100%',
      }}
      >
        {SUGGESTIONS.map((suggestion) => (
          <SuggestionCard
            key={suggestion.title}
            suggestion={suggestion}
            onPick={onPick}
          />
        ))}
      </div>
    </div>
  );
}

/** Um card de sugestão (ícone + título + exemplo); o clique envia o prompt associado. */
function SuggestionCard({
  suggestion,
  onPick,
}: Readonly<{
  suggestion: SuggestionInterface;
  onPick: (text: string) => void
}>): JSX.Element {
  const IconComponent = suggestion.icon;

  return (
    <button
      type="button"
      className="at-suggestion-card"
      onClick={() => { onPick(suggestion.prompt); }}
      style={{
        textAlign: 'left',
        background: cssVar.white,
        border: cssVar.borderLine,
        borderRadius: 8,
        padding: '14px 16px',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'flex-start',
        gap: cssVar.space12,
        font: 'inherit',
      }}
    >
      <span style={{
        width: 32,
        height: 32,
        borderRadius: 6,
        flexShrink: 0,
        background: cssVar.primaryLighter,
        color: cssVar.primary,
        display: 'grid',
        placeItems: 'center',
      }}
      >
        <IconComponent size={16} />
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{
          display: 'block',
          fontSize: cssVar.fs14,
          fontWeight: 600,
          color: cssVar.fg,
        }}
        >
          {suggestion.title}
        </span>
        <span style={{
          display: 'block',
          fontSize: cssVar.fs12,
          color: cssVar.fgMuted,
          marginTop: 2,
        }}
        >
          {suggestion.sub}
        </span>
      </span>
    </button>
  );
}

/**
 * Renderiza UMA parte da mensagem, na ordem do stream: raciocínio (fonte pequena, transparente e
 * justificada), texto da resposta, ou a tool (pill + card rico).
 *
 * @param props - A parte e sua posição na mensagem.
 *
 * @returns A parte renderizada.
 */
function MessagePart({
  part,
  index,
}: Readonly<{
  part: DisplayPartInterface;
  index: number
}>): JSX.Element {
  if (part.kind === 'thinking') {
    return (
      <div style={{
        fontSize: cssVar.fs12,
        color: cssVar.fgMuted,
        opacity: 0.55,
        fontStyle: 'italic',
        whiteSpace: 'pre-wrap',
        lineHeight: cssVar.lh22,
        textAlign: 'justify',
      }}
      >
        {humanizeToolNames(part.text.trim())}
      </div>
    );
  }

  if (part.kind === 'text') {
    return (
      <div style={{
        textAlign: 'justify',
        marginTop: index > 0
          ? cssVar.space12
          : undefined,
      }}
      >
        <Markdown>{humanizeToolNames(part.text.trim())}</Markdown>
      </div>
    );
  }

  if (part.kind === 'incident') {
    return (
      <div style={{
        marginTop: index > 0
          ? cssVar.space12
          : undefined,
      }}
      >
        <IncidentChatCard incident={part.incident} />
      </div>
    );
  }

  return (
    <div style={{
      marginTop: index > 0
        ? cssVar.space12
        : undefined,
    }}
    >
      <ToolRow tool={part.tool} />
      <ToolResultCard tool={part.tool} />
    </div>
  );
}

/** Despacha a linha da mensagem: bolha verde (usuário) ou bloco com avatar sparkle (assistente). */
function MessageRow({ message }: { message: DisplayMessageInterface }): JSX.Element {
  return message.role === 'user'
    ? <UserBubble message={message} />
    : <AssistantRow message={message} />;
}

/** Texto cru de uma mensagem do usuário (só tem partes de texto). */
function userText(message: DisplayMessageInterface): string {
  return message.parts
    .filter((part) => part.kind === 'text')
    .map((part) => part.text)
    .join('\n');
}

/** Mensagem do usuário: bolha verde sólida alinhada à direita (cantos assimétricos, sem borda). */
function UserBubble({ message }: Readonly<{ message: DisplayMessageInterface }>): JSX.Element {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'flex-end',
      marginBottom: cssVar.space16,
    }}
    >
      <div style={{
        maxWidth: '78%',
        background: cssVar.primary,
        color: cssVar.white,
        padding: '12px 16px',
        borderRadius: '14px 14px 4px 14px',
        fontSize: cssVar.fs14,
        lineHeight: cssVar.lh22,
        whiteSpace: 'pre-wrap',
      }}
      >
        {userText(message)}
      </div>
    </div>
  );
}

/** Mensagem do assistente: avatar sparkle + coluna de conteúdo (partes ordenadas/spinner/refusal/erro). */
function AssistantRow({ message }: Readonly<{ message: DisplayMessageInterface }>): JSX.Element {
  const someToolRunning = message.parts.some((part) => part.kind === 'tool' && part.tool.status === 'running');
  const lastPart = message.parts.at(-1);

  // Sem texto/raciocínio fluindo e sem tool rodando → aguardando o próximo passo do modelo.
  const awaiting = message.streaming
    && !someToolRunning
    && (lastPart === undefined || lastPart.kind === 'tool');

  return (
    <div style={{
      display: 'flex',
      gap: cssVar.space12,
      alignItems: 'flex-start',
      marginBottom: cssVar.space20,
    }}
    >
      <div style={{
        width: 32,
        height: 32,
        borderRadius: 8,
        flexShrink: 0,
        background: SPARKLE_GRADIENT,
        display: 'grid',
        placeItems: 'center',
        boxShadow: 'inset 0 0 0 1px rgba(255, 255, 255, 0.1), 0 1px 2px rgba(0, 0, 0, 0.1)',
      }}
      >
        <Sparkle
          size={16}
          weight="fill"
          color={cssVar.white}
        />
      </div>
      <div style={{
        flex: 1,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
      }}
      >
        {message.parts.map((
          part,
          index,
        ) => (
          <MessagePart
            key={index}
            part={part}
            index={index}
          />
        ))}
        {awaiting
          ? <CircleNotch
            size={16}
            className="at-spin"
            color={cssVar.fgSubtle}
            style={{
              display: 'block',
              // Só separa do que vem acima (ex.: card de tool concluída); no spinner inicial
              // (coluna ainda vazia) não há nada acima, então sem margin.
              marginTop: message.parts.length > 0
                ? cssVar.space12
                : undefined,
            }}
          />
          : null}
        {message.refusal
          ? <RefusalCard refusal={message.refusal} />
          : null}
        {message.error
          ? <div style={{
            color: cssVar.danger300,
            fontSize: cssVar.fs12,
            marginTop: cssVar.space8,
          }}
          >
            Erro: {message.error}
          </div>
          : null}
      </div>
    </div>
  );
}

/** Resumo textual de uma tool concluída: `erro`, `N resultado(s)` ou `concluído`. */
function summarizeTool(
  status: DisplayToolInterface['status'],
  total: number | undefined,
): string {
  if (status === 'error') {
    return 'erro';
  }

  if (total != null) {
    return `${total} resultado(s)`;
  }

  return 'concluído';
}

/** Tempo total formatado após a conclusão da tool (ou `null` se ausente). */
function finalTime(durationMs: number | undefined): string | null {
  if (durationMs === undefined) {
    return null;
  }

  return formatDuration(durationMs);
}

/** Formata uma duração em ms de forma compacta: `850ms`, `12s`, `4m37s`. */
function formatDuration(ms: number): string {
  if (ms < MS_PER_SECOND) {
    return `${ms}ms`;
  }

  const totalSeconds = Math.round(ms / MS_PER_SECOND);

  if (totalSeconds < SECONDS_PER_MINUTE) {
    return `${totalSeconds}s`;
  }

  const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
  const seconds = totalSeconds % SECONDS_PER_MINUTE;

  return `${minutes}m${String(seconds).padStart(
    2,
    '0',
  )}s`;
}

/** Refresh interval of a running tool's live elapsed-time counter. */
const ELAPSED_TICK_MS = MS_PER_SECOND;

/**
 * Pill da tool com andamento: enquanto roda mostra a etapa atual (ou "buscando…"), um cronômetro
 * ao vivo e — na fase de leitura do S3 — uma barra de partições; ao concluir, o resumo + tempo total.
 *
 * @param props - A invocação de tool a exibir.
 *
 * @returns A pill da tool.
 */
function ToolRow({ tool }: Readonly<{ tool: DisplayToolInterface }>): JSX.Element {
  const running = tool.status === 'running';

  const [
    elapsed,
    setElapsed,
  ] = useState(0);

  useEffect(
    () => {
      if (
        !running
      || tool.startedAt === undefined
      ) {
        return undefined;
      }

      const startedAt = tool.startedAt;

      const tick = (): void => {
        setElapsed(Date.now() - startedAt);
      };

      tick();

      const handle = window.setInterval(
        tick,
        ELAPSED_TICK_MS,
      );

      return () => {
        window.clearInterval(handle);
      };
    },
    [
      running,
      tool.startedAt,
    ],
  );

  const result = tool.result as {
    total?: number;
    rows?: unknown[]
  } | null;

  const summary = summarizeTool(
    tool.status,
    result?.total,
  );

  const label = running
    ? (tool.progress?.label ?? 'buscando…')
    : summary;

  const time = running
    ? formatDuration(elapsed)
    : finalTime(tool.durationMs);

  const total = tool.progress?.total ?? 0;
  const showBar = running && total > 0;

  const pct = showBar
    ? Math.min(
      PERCENT_SCALE,
      Math.round(((tool.progress?.current ?? 0) / total) * PERCENT_SCALE),
    )
    : 0;

  return (
    <div style={{
      display: cssValue.inlineFlex,
      alignItems: 'center',
      gap: cssVar.space8,
      background: cssVar.bgSoft,
      border: cssVar.borderLine,
      borderRadius: 999,
      padding: '4px 10px',
      marginBottom: cssVar.space8,
      fontSize: cssVar.fs12,
      color: cssVar.fgMuted,
    }}
    >
      {running
        ? <CircleNotch size={14} className="at-spin" />
        : <MagnifyingGlass size={14} />}
      <span style={{ fontWeight: 600 }}>{toolLabel(tool.name)}</span>
      <span>·</span>
      <span>{label}</span>
      {showBar
        ? (
          <span style={{
            display: cssValue.inlineFlex,
            alignItems: 'center',
            gap: cssVar.space8,
          }}
          >
            <span style={{
              width: 48,
              height: 4,
              borderRadius: 999,
              background: cssVar.border,
              overflow: 'hidden',
            }}
            >
              <span style={{
                display: 'block',
                width: `${pct}%`,
                height: '100%',
                background: cssVar.fgMuted,
              }}
              />
            </span>
            <span style={{ fontVariantNumeric: cssValue.tabularNums }}>
              {tool.progress?.current ?? 0}/{total}
            </span>
          </span>
        )
        : null}
      {time
        ? (
          <>
            <span>·</span>
            <span style={{ fontVariantNumeric: cssValue.tabularNums }}>{time}</span>
          </>
        )
        : null}
    </div>
  );
}

/** Card de recusa (fora de escopo): motivo, explicação e o que dá pra fazer. */
function RefusalCard({ refusal }: Readonly<{ refusal: RefusalInterface }>): JSX.Element {
  return (
    <div style={{
      background: cssVar.warning50,
      border: '1px solid var(--at-warning-200)',
      borderRadius: 4,
      padding: '10px 12px',
      fontSize: cssVar.fs14,
    }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: cssVar.space8,
        fontWeight: 600,
        marginBottom: cssVar.space4,
      }}
      >
        <WarningCircle size={16} />
        Fora do escopo
      </div>
      <p style={{ margin: 0 }}>{refusal.explanation}</p>
      {refusal.can_do.length > 0
        ? <ul style={{
          margin: 'var(--at-space-8) 0 0',
          paddingLeft: cssVar.space20,
          color: cssVar.fgMuted,
        }}
        >
          {refusal.can_do.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        : null}
    </div>
  );
}

/** Caixa de composição: textarea + enviar (Enter envia, Shift+Enter quebra linha). */
function Composer({
  disabled,
  onSend,
}: Readonly<{
  disabled: boolean;
  onSend: (text: string) => void
}>): JSX.Element {
  const [
    text,
    setText,
  ] = useState('');

  const submit = (): void => {
    if (
      disabled
      || !text.trim()
    ) {
      return;
    }

    onSend(text);
    setText('');
  };

  const canSend = !disabled && Boolean(text.trim());

  return (
    <div style={{
      padding: 'var(--at-space-16) 0 var(--at-space-20)',
      borderTop: cssVar.borderLine,
      background: cssVar.white,
    }}
    >
      <div style={{
        width: '70%',
        maxWidth: 1600,
        margin: '0 auto',
      }}
      >
        <div
          className="at-composer-box"
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: cssVar.space8,
            background: cssVar.white,
            border: '1.5px solid var(--at-border)',
            borderRadius: 12,
            padding: '8px 8px 8px 14px',
          }}
        >
          <textarea
            value={text}
            onChange={(event) => { setText(event.target.value); }}
            onKeyDown={(event) => {
              if (
                event.key === 'Enter'
              && !event.shiftKey
              ) {
                event.preventDefault();
                submit();
              }
            }}
            placeholder={'Pergunte algo… ex.: "status do telefone +55 11 98765-1234 nas últimas 4h"'}
            rows={1}
            style={{
              flex: 1,
              resize: 'none',
              border: 'none',
              outline: 'none',
              padding: '8px 0',
              fontSize: cssVar.fs14,
              fontFamily: 'inherit',
              lineHeight: cssVar.lh22,
              background: 'transparent',
              color: cssVar.fg,
              maxHeight: 120,
            }}
          />
          <button
            type="button"
            onClick={submit}
            disabled={!canSend}
            aria-label="Enviar"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 36,
              height: 36,
              flexShrink: 0,
              border: 'none',
              borderRadius: 8,
              background: canSend
                ? cssVar.primary
                : cssVar.bgSoft,
              color: canSend
                ? cssVar.white
                : cssVar.fgSubtle,
              cursor: canSend
                ? 'pointer'
                : 'not-allowed',
            }}
          >
            <ArrowUp
              size={16}
              weight="bold"
            />
          </button>
        </div>
        <div style={{
          display: 'flex',
          justifyContent: cssValue.spaceBetween,
          alignItems: 'center',
          marginTop: cssVar.space8,
          fontSize: cssVar.fs12,
          color: cssVar.fgSubtle,
        }}
        >
          <span style={{
            display: cssValue.inlineFlex,
            alignItems: 'center',
            gap: cssVar.space12,
            minWidth: 0,
          }}
          >
            <ToolsDisclaimer />
            <span
              className="at-hide-tablet"
              style={{
                display: cssValue.inlineFlex,
                alignItems: 'center',
                gap: cssVar.space4,
              }}
            >
              <ShieldCheck size={12} />
              Telefones e conteúdo são mascarados por padrão. Toda ação é auditada.
            </span>
          </span>
          <span
            className="at-hide-mobile"
            style={{
              display: cssValue.inlineFlex,
              alignItems: 'center',
              gap: cssVar.space4,
              flexShrink: 0,
            }}
          >
            <Kbd>↵</Kbd> enviar · <Kbd>shift+↵</Kbd> nova linha
          </span>
        </div>
      </div>
    </div>
  );
}

/** Tecla estilizada para as dicas de atalho do composer. */
function Kbd({ children }: Readonly<{ children: ReactNode }>): JSX.Element {
  return (
    <kbd style={{
      fontFamily: 'inherit',
      fontSize: cssVar.fs10,
      color: cssVar.fgMuted,
      background: cssVar.bgSoft,
      border: cssVar.borderLine,
      borderRadius: cssVar.radius4,
      padding: '1px 5px',
    }}
    >
      {children}
    </kbd>
  );
}
