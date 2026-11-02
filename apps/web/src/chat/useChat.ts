import { type Dispatch, type SetStateAction, useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ChatMessageInterface, IncidentInterface } from '@atena/types';
import { createSession } from './api';
import { getSessionMessages, listSessions, renameSession } from '../api/sessions';
import { streamChatMessage } from './sse';

/** Título padrão de uma sessão recém-criada. */
const DEFAULT_SESSION_TITLE = 'Sessão';

/** Andamento de uma tool em execução (etapa atual do motor + barra opcional de partições). */
interface ToolProgressInterface {
  phase: string;
  label: string;
  current?: number;
  total?: number;
}

/** Invocação de tool no estado de exibição (inclui o estado transitório `running`). */
export interface DisplayToolInterface {
  name: string;
  args: Record<string, unknown>;
  status: 'running' | 'success' | 'error';
  result: unknown;
  /** Epoch (ms) do início da execução; base do timer ao vivo enquanto `running`. */
  startedAt?: number;
  /** Duração total (ms) reportada no `tool_result`; presente após a conclusão. */
  durationMs?: number;
  /** Última etapa de progresso recebida (enquanto `running`). */
  progress?: ToolProgressInterface;
}

/** Recusa estruturada do assistente. */
export interface RefusalInterface {
  reason: string;
  explanation: string;
  can_do: string[];
}

/**
 * Parte ordenada do conteúdo de uma mensagem — preserva a ORDEM em que o stream produziu o
 * raciocínio, as chamadas de tool e o texto (ex.: pensa → tool → pensa → responde). O `thinking`
 * é efêmero (não persiste). Cada delta de mesmo tipo é anexado à última parte do tipo.
 */
export type DisplayPartInterface =
  | {
    kind: 'thinking';
    text: string
  }
  | {
    kind: 'text';
    text: string
  }
  | {
    kind: 'tool';
    tool: DisplayToolInterface
  }
  | {
    kind: 'incident';
    incident: IncidentInterface
  };

/** Mensagem como exibida no chat (constrói-se incrementalmente durante o stream). */
export interface DisplayMessageInterface {
  id: string;
  role: 'user' | 'assistant';
  /** Conteúdo em ORDEM cronológica (raciocínio / tool / texto). */
  parts: DisplayPartInterface[];
  refusal: RefusalInterface | null;
  streaming: boolean;
  error?: string;
}

let messageSeq = 0;

const nextId = (prefix: string): string => {
  messageSeq += 1;

  return `${prefix}-${messageSeq}`;
};

/**
 * Aplica um patch ao incidente de qualquer cartão (`kind: 'incident'`) da mensagem cujo id casar.
 *
 * @param message - Mensagem da conversa.
 * @param incidentId - Id do incidente a atualizar.
 * @param patch - Campos a sobrescrever (ex.: `status`, `assignee`).
 *
 * @returns Mensagem com o cartão atualizado (ou inalterada).
 */
function patchMessageIncident(
  message: DisplayMessageInterface,
  incidentId: string,
  patch: Partial<IncidentInterface>,
): DisplayMessageInterface {
  return {
    ...message,
    parts: message.parts.map((part) => (part.kind === 'incident' && part.incident.id === incidentId
      ? {
        ...part,
        incident: {
          ...part.incident,
          ...patch,
        },
      }
      : part)),
  };
}

/** Estado e ações do chat, compartilhados via contexto (sobrevivem à navegação entre telas). */
export interface ChatStateInterface {
  /** Conversa atual. */
  messages: DisplayMessageInterface[];
  /** Envia uma mensagem do usuário. */
  send: (text: string) => void;
  /** Há um turno em andamento. */
  sending: boolean;
  /** A sessão está criada/carregada (pode enviar). */
  ready: boolean;
  /** Inicia uma sessão nova (limpa a conversa). */
  reset: () => void;
  /** Carrega uma sessão existente para continuá-la. */
  resume: (sessionId: string, title: string) => void;
  /** Injeta um incidente detectado (realtime) como um cartão inline na conversa atual; ignora duplicatas pelo id. */
  pushIncident: (incident: IncidentInterface) => void;
  /** Atualiza (status/assignee) um cartão de incidente já na conversa — realtime. */
  updateIncident: (incidentId: string, patch: Partial<IncidentInterface>) => void;
  /** Id (código) da sessão atual; `null` enquanto não criada/carregada. */
  sessionId: string | null;
  /** Nome (editável) da sessão atual. */
  sessionTitle: string;
  /** Renomeia a sessão atual (otimista + persiste). */
  rename: (title: string) => void;
}

/**
 * Reconstrói a conversa de exibição a partir das mensagens persistidas (para retomar uma sessão do
 * histórico): cada turno do assistente vira as partes de tool (na ordem) + o texto final; o usuário
 * vira uma parte de texto. O raciocínio (thinking) não é persistido, então não é reconstruído.
 *
 * @param persisted - Mensagens persistidas (ordem cronológica).
 *
 * @returns Conversa para exibir/continuar.
 */
function toDisplayMessages(persisted: ChatMessageInterface[]): DisplayMessageInterface[] {
  return persisted.map((message) => {
    if (message.role === 'user') {
      return {
        id: nextId('u'),
        role: 'user',
        parts: [{
          kind: 'text',
          text: message.content.text,
        }],
        refusal: null,
        streaming: false,
      };
    }

    const toolParts: DisplayPartInterface[] = (message.content.tools ?? []).map((tool) => ({
      kind: 'tool',
      tool: {
        name: tool.name,
        args: tool.args,
        status: tool.status,
        result: tool.result,
      },
    }));

    const textParts: DisplayPartInterface[] = message.content.text
      ? [{
        kind: 'text',
        text: message.content.text,
      }]
      : [];

    return {
      id: nextId('a'),
      role: 'assistant',
      parts: [
        ...toolParts,
        ...textParts,
      ],
      refusal: message.content.refusal ?? null,
      streaming: false,
    };
  });
}

/**
 * Estado e ações da tela de Chat: cria a sessão, mantém as mensagens e consome o stream SSE
 * (token-a-token), anexando cada evento como uma parte ORDENADA da mensagem do assistente.
 *
 * @returns Estado do chat e as ações (enviar / nova sessão / retomar).
 */
export function useChat(): ChatStateInterface {
  const [
    messages,
    setMessages,
  ] = useState<DisplayMessageInterface[]>([]);

  const [
    sending,
    setSending,
  ] = useState(false);

  const sessionIdRef = useRef<string | null>(null);

  // Ids de incidentes já injetados na conversa (dedupe do realtime; reconexões/StrictMode reenviam).
  const seenIncidentsRef = useRef<Set<string>>(new Set());

  const [
    ready,
    setReady,
  ] = useState(false);

  // Espelho reativo do código da sessão (o ref acima é usado nos closures assíncronos do envio).
  const [
    currentSessionId,
    setCurrentSessionId,
  ] = useState<string | null>(null);

  const [
    sessionTitle,
    setSessionTitle,
  ] = useState<string>(DEFAULT_SESSION_TITLE);

  const queryClient = useQueryClient();

  // Cria uma sessão nova no servidor e marca a UI como pronta; devolve um cleanup que invalida
  // a criação em voo (evita setState após desmontar / corrida do StrictMode).
  const startSession = useCallback(
    (): (() => void) => {
      let active = true;

      setReady(false);
      sessionIdRef.current = null;
      setCurrentSessionId(null);
      setSessionTitle(DEFAULT_SESSION_TITLE);

      createSession(DEFAULT_SESSION_TITLE)
        .then((res) => {
          if (active) {
            sessionIdRef.current = res.session_id;
            setCurrentSessionId(res.session_id);
            setReady(true);
            // Sessão nova entra no histórico → atualiza a lista/contador.
            queryClient.invalidateQueries({ queryKey: ['sessions'] }).catch(() => undefined);
          }
        })
        .catch(() => {
        // erro de criação aparece no primeiro envio; mantém a UI utilizável
        });

      return () => {
        active = false;
      };
    },
    [queryClient],
  );

  // "Nova sessão": limpa a conversa e abre uma sessão nova no servidor.
  const reset = useCallback(
    (): void => {
      setMessages([]);
      setSending(false);
      seenIncidentsRef.current.clear();
      startSession();
    },
    [startSession],
  );

  // Retoma uma sessão do histórico: carrega as mensagens persistidas e segue conversando nela.
  const resume = useCallback(
    (
      sessionId: string,
      title: string,
    ): void => {
      setReady(false);
      setSending(false);
      setMessages([]);
      seenIncidentsRef.current.clear();
      setCurrentSessionId(sessionId);
      setSessionTitle(title);

      getSessionMessages(sessionId)
        .then((persisted) => {
          sessionIdRef.current = sessionId;
          setMessages(toDisplayMessages(persisted));
          setReady(true);
        })
        .catch(() => {
        // se falhar, mantém a sessão atual; o erro aparece no próximo envio
        });
    },
    [],
  );

  // Renomeia a sessão atual: otimista (atualiza o título já) + persiste + atualiza o histórico/contador.
  const rename = useCallback(
    (title: string): void => {
      const id = sessionIdRef.current;
      const trimmed = title.trim();

      if (
        !id
        || trimmed.length === 0
      ) {
        return;
      }

      setSessionTitle(trimmed);

      renameSession(
        id,
        trimmed,
      )
        .then(() => {
          queryClient.invalidateQueries({ queryKey: ['sessions'] }).catch(() => undefined);
        })
        .catch(() => {
        // falha de rename é silenciosa; o título otimista permanece até o próximo refresh
        });
    },
    [queryClient],
  );

  // Injeta um incidente detectado (realtime) como cartão inline na conversa atual; ignora duplicatas.
  const pushIncident = useCallback(
    (incident: IncidentInterface): void => {
      if (seenIncidentsRef.current.has(incident.id)) {
        return;
      }

      seenIncidentsRef.current.add(incident.id);

      setMessages((prev) => [
        ...prev,
        {
          id: nextId('i'),
          role: 'assistant',
          parts: [{
            kind: 'incident',
            incident,
          }],
          refusal: null,
          streaming: false,
        },
      ]);
    },
    [],
  );

  // Atualiza um cartão de incidente já na conversa (realtime: status/assignee mudados por outro
  // operador). Só mexe em cartões existentes — não injeta nada novo.
  const updateIncident = useCallback(
    (
      incidentId: string,
      patch: Partial<IncidentInterface>,
    ): void => {
      setMessages((prev) => prev.map((message) => patchMessageIncident(
        message,
        incidentId,
        patch,
      )));
    },
    [],
  );

  // Ao montar (abrir/atualizar a tela): RETOMA a sessão mais recente do usuário em vez de criar uma
  // nova a cada refresh; só cria uma nova quando não existe nenhuma (ou se a listagem falhar).
  useEffect(
    () => {
      let active = true;

      listSessions()
        .then((sessions) => {
          if (!active) {
            return;
          }

          const latest = sessions.at(0);

          if (latest) {
            resume(
              latest.id,
              latest.title,
            );
          }
          else {
            startSession();
          }
        })
        .catch(() => {
          if (active) {
            startSession();
          }
        });

      return () => {
        active = false;
      };
    },
    [
      resume,
      startSession,
    ],
  );

  const send = useCallback(
    (text: string): void => {
      const trimmed = text.trim();
      const sessionId = sessionIdRef.current;

      if (
        !trimmed
      || !sessionId
      || sending
      ) {
        return;
      }

      setSending(true);

      const assistantId = nextId('a');

      setMessages((prev) => [
        ...prev,
        {
          id: nextId('u'),
          role: 'user',
          parts: [{
            kind: 'text',
            text: trimmed,
          }],
          refusal: null,
          streaming: false,
        },
        {
          id: assistantId,
          role: 'assistant',
          parts: [],
          refusal: null,
          streaming: true,
        },
      ]);

      const patch = makePatcher(
        setMessages,
        assistantId,
      );

      streamChatMessage(
        sessionId,
        trimmed,
        (event) => {
          if (event.event === 'text_delta') {
            patch((message) => ({
              ...message,
              parts: appendText(
                message.parts,
                'text',
                event.data.delta,
              ),
            }));
          } else if (event.event === 'thinking_delta') {
            patch((message) => ({
              ...message,
              parts: appendText(
                message.parts,
                'thinking',
                event.data.delta,
              ),
            }));
          } else if (event.event === 'tool_call') {
            patch((message) => ({
              ...message,
              parts: [
                ...message.parts,
                {
                  kind: 'tool',
                  tool: {
                    name: event.data.name,
                    args: event.data.args,
                    status: 'running',
                    result: null,
                    startedAt: Date.now(),
                  },
                },
              ],
            }));
          } else if (event.event === 'tool_progress') {
            patch((message) => ({
              ...message,
              parts: patchLastRunningTool(
                message.parts,
                event.data.name,
                {
                  progress: {
                    phase: event.data.phase,
                    label: event.data.label,
                    current: event.data.current,
                    total: event.data.total,
                  },
                },
              ),
            }));
          } else if (event.event === 'tool_result') {
            patch((message) => ({
              ...message,
              parts: patchLastRunningTool(
                message.parts,
                event.data.name,
                {
                  status: event.data.status,
                  result: event.data.result,
                  durationMs: event.data.duration_ms,
                  progress: undefined,
                },
              ),
            }));
          } else if (event.event === 'refusal') {
            patch((message) => ({
              ...message,
              refusal: event.data,
              streaming: false,
            }));
          } else if (event.event === 'done') {
            patch((message) => ({
              ...message,
              streaming: false,
            }));

            // Auto-título da 1ª troca: atualiza o nome exibido + o histórico/contador.
            if (event.data.session_title) {
              setSessionTitle(event.data.session_title);
              queryClient.invalidateQueries({ queryKey: ['sessions'] }).catch(() => undefined);
            }
          } else {
            patch((message) => ({
              ...message,
              streaming: false,
              error: event.data.error.message,
            }));
          }
        },
      )
        .catch((err: unknown) => {
          patch((message) => ({
            ...message,
            streaming: false,
            error: err instanceof Error
              ? err.message
              : 'Falha no stream',
          }));
        })
        .finally(() => { setSending(false); });
    },
    [
      sending,
      queryClient,
    ],
  );

  return {
    messages,
    send,
    sending,
    ready,
    reset,
    resume,
    pushIncident,
    updateIncident,
    sessionId: currentSessionId,
    sessionTitle,
    rename,
  };
}

/**
 * Cria a função que aplica uma transformação à mensagem do assistente em andamento,
 * preservando as demais mensagens do estado.
 */
function makePatcher(
  setMessages: Dispatch<SetStateAction<DisplayMessageInterface[]>>,
  assistantId: string,
): (fn: (message: DisplayMessageInterface) => DisplayMessageInterface) => void {
  return (fn) => {
    setMessages((prev) => prev.map((message) => (message.id === assistantId
      ? fn(message)
      : message)));
  };
}

/**
 * Anexa um `delta` de `thinking`/`text`: estende a última parte se for do mesmo tipo, senão abre
 * uma nova parte — preservando a ordem cronológica relativa às tools.
 *
 * @param parts - Partes atuais.
 * @param kind - Tipo do fragmento.
 * @param delta - Fragmento de texto.
 *
 * @returns Novas partes.
 */
export function appendText(
  parts: DisplayPartInterface[],
  kind: 'thinking' | 'text',
  delta: string,
): DisplayPartInterface[] {
  const last = parts.at(-1);

  if (last?.kind === kind) {
    return [
      ...parts.slice(
        0,
        -1,
      ),
      {
        kind,
        text: last.text + delta,
      },
    ];
  }

  return [
    ...parts,
    {
      kind,
      text: delta,
    },
  ];
}

/** Aplica um patch parcial à última PARTE de tool `running` com o nome dado (progresso/resultado). */
export function patchLastRunningTool(
  parts: DisplayPartInterface[],
  name: string,
  changes: Partial<DisplayToolInterface>,
): DisplayPartInterface[] {
  let patched = false;

  return [...parts].reverse().map((part): DisplayPartInterface => {
    if (
      !patched
      && part.kind === 'tool'
      && part.tool.status === 'running'
      && part.tool.name === name
    ) {
      patched = true;

      return {
        kind: 'tool',
        tool: {
          ...part.tool,
          ...changes,
        },
      };
    }

    return part;
  }).reverse();
}
