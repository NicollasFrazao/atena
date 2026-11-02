import { createContext, useContext, useEffect, useRef } from 'react';
import type { WsServerEvent } from '@atena/types';

/**
 * Contexto do realtime: uma ÚNICA conexão `/ws/support` (no {@link RealtimeProvider}) faz fan-out
 * dos eventos para vários assinantes — evita abrir um socket por consumidor (chat, banner, lista).
 */
export interface RealtimeContextInterface {
  /** Assina; devolve o cancelamento. */
  subscribe: (handler: (event: WsServerEvent) => void) => () => void;
  /** Status da conexão. */
  connected: boolean;
}

/** Contexto do realtime (null fora do provider). */
export const RealtimeContext = createContext<RealtimeContextInterface | null>(null);

/**
 * Registra um handler para os eventos do `/ws/support` (via a conexão única do provider). O handler
 * é mantido por ref, então re-renders não re-assinam.
 *
 * @param handler - Chamado a cada evento do servidor.
 */
export function useRealtimeEvent(handler: (event: WsServerEvent) => void): void {
  const ctx = useContext(RealtimeContext);
  const ref = useRef(handler);

  ref.current = handler;

  useEffect(
    () => {
      if (!ctx) {
        return undefined;
      }

      return ctx.subscribe((event) => {
        ref.current(event);
      });
    },
    [ctx],
  );
}

/**
 * Status da conexão do realtime (para a faixa de "WS desconectado").
 *
 * @returns `true` se conectado.
 */
export function useRealtimeConnected(): boolean {
  return useContext(RealtimeContext)?.connected ?? false;
}
