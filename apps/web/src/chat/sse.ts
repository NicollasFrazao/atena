import type { ApiErrorInterface, ChatStreamEvent } from '@atena/types';
import { ApiError, notifyUnauthorized } from '../api/client';
import { API_URL } from '../api/config';

/**
 * Parseia frames SSE completos de um buffer (`event: <tipo>\ndata: <json>\n\n`).
 * Devolve os eventos parseados e o `rest` (frame possivelmente incompleto) p/ o próximo chunk.
 *
 * @param {string} buffer - Texto acumulado do stream.
 *
 * @returns {{ events: ChatStreamEvent[]; rest: string }} Eventos completos + sobra.
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

/** Parseia um único frame SSE em um {@link ChatStreamEvent}; `null` se incompleto/inválido. */
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
    !name
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
 * @param {string} sessionId - Id da sessão.
 * @param {string} text - Texto do usuário.
 * @param {(event: ChatStreamEvent) => void} onEvent - Handler de cada evento.
 * @param {AbortSignal} [signal] - Para cancelar o stream.
 *
 * @returns {Promise<void>} Resolve quando o stream encerra.
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
    if (response.status === 401) {
      notifyUnauthorized();
    }

    const body = (await response.json().catch(() => null)) as ApiErrorInterface | null;

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
