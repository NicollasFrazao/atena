import type { ChatStreamEvent } from '@atena/types';
import { ApiError, type ApiErrorBodyType, notifyUnauthorized } from '../api/client';
import { API_URL } from '../api/config';
import { HTTP_STATUS_UNAUTHORIZED } from '../api/http-status';

/**
 * Parseia frames SSE completos de um buffer (`event: <tipo>\ndata: <json>\n\n`).
 * Devolve os eventos parseados e o `rest` (frame possivelmente incompleto) p/ o próximo chunk.
 *
 * @param buffer - Texto acumulado do stream.
 *
 * @returns Eventos completos + sobra.
 */
export function parseSseFrames(buffer: string): {
  events: ChatStreamEvent[];
  rest: string
} {
  const parts = buffer.split('\n\n');
  const rest = parts.pop() ?? '';
  const events: ChatStreamEvent[] = [];

  for (const frame of parts) {
    const event = parseFrame(frame);

    if (event) {
      events.push(event);
    }
  }

  return {
    events,
    rest,
  };
}

/**
 * The event names the chat understands. A `Record` so that adding an event to
 * {@link ChatStreamEvent} without listing it here fails the type check.
 */
const KNOWN_EVENT_NAMES: Record<ChatStreamEvent['event'], true> = {
  tool_call: true,
  tool_progress: true,
  tool_result: true,
  text_delta: true,
  thinking_delta: true,
  done: true,
  refusal: true,
  error: true,
};

/**
 * Whether a frame's event name is one of {@link ChatStreamEvent}'s.
 *
 * @param name - The `event:` field of the frame.
 *
 * @returns `true` for a known event name.
 */
function isKnownEventName(name: string): name is ChatStreamEvent['event'] {
  return Object.hasOwn(
    KNOWN_EVENT_NAMES,
    name,
  );
}

/**
 * Parseia um único frame SSE em um {@link ChatStreamEvent}; `null` se incompleto/inválido.
 *
 * @remarks
 * An event name outside {@link ChatStreamEvent} (a newer server, a keep-alive) also yields `null`,
 * so the returned type is the truth: the chat ignored those events anyway.
 */
function parseFrame(frame: string): ChatStreamEvent | null {
  let name = '';
  const dataLines: string[] = [];

  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) {
      name = line.slice('event:'.length).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trim());
    }
  }

  if (
    !isKnownEventName(name)
    || dataLines.length === 0
  ) {
    return null;
  }

  try {
    const data: unknown = JSON.parse(dataLines.join('\n'));

    return {
      event: name,
      data,
    } as ChatStreamEvent;
  } catch {
    return null;
  }
}

/**
 * Envia a mensagem do usuário e consome o stream SSE (`POST /chat/sessions/:id/messages`),
 * chamando `onEvent` a cada evento (tool_call → tool_result → text_delta → done/refusal).
 *
 * @param sessionId - Id da sessão.
 * @param text - Texto do usuário.
 * @param onEvent - Handler de cada evento.
 * @param [signal] - Para cancelar o stream.
 *
 * @returns Resolve quando o stream encerra.
 *
 * @throws {Error} Se a resposta não trouxer um corpo legível.
 */
export async function streamChatMessage(
  sessionId: string,
  text: string,
  onEvent: (event: ChatStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(
    `${API_URL}/api/chat/sessions/${sessionId}/messages`,
    {
      method: 'POST',
      // Envia o cookie de sessão (stream cross-origin); sem isso o POST do SSE dá 401.
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({ text }),
      signal,
    },
  );

  // Erro ANTES do stream (401 sessão expirada / 403 / 404 do assertSession, que roda antes do
  // flushHeaders): a resposta tem corpo JSON, não SSE. Sem checar `response.ok`, o reader leria o
  // erro como stream vazio → balão em branco sem erro e sem overlay de re-login.
  if (!response.ok) {
    if (response.status === HTTP_STATUS_UNAUTHORIZED) {
      notifyUnauthorized();
    }

    const body = (await response.json().catch(() => null)) as ApiErrorBodyType;

    throw new ApiError(
      body?.error?.code ?? 'error',
      body?.error?.message ?? response.statusText,
      response.status,
    );
  }

  if (!response.body) {
    throw new Error(`Falha ao abrir o stream do chat (HTTP ${response.status})`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const {
      done,
      value,
    } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(
      value,
      { stream: true },
    );

    const parsed = parseSseFrames(buffer);
    buffer = parsed.rest;
    parsed.events.forEach(onEvent);
  }
}
