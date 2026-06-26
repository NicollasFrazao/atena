import { type ReactNode, useCallback, useMemo, useRef } from 'react';
import type { WsServerEvent } from '@atena/types';
import { useSupportEvents } from './useSupportEvents';
import { RealtimeContext, type RealtimeContextInterface } from './realtime-context';

/**
 * Abre UMA conexão `/ws/support` e faz fan-out dos eventos para os assinantes (chat, banner, lista
 * de incidentes) — em vez de cada consumidor abrir o seu próprio socket. Montado no topo do App.
 *
 * @param {{ children: ReactNode }} props - Árvore que consome o realtime.
 * @returns {JSX.Element} O provedor.
 */
export function RealtimeProvider({ children }: { children: ReactNode }): JSX.Element {
  const subscribers = useRef<Set<(event: WsServerEvent) => void>>(new Set());

  const onEvent = useCallback(
    (event: WsServerEvent): void => {
      for (const handler of subscribers.current) {
        handler(event);
      }
    },
    [],
  );

  const { connected } = useSupportEvents(onEvent);

  const subscribe = useCallback(
    (handler: (event: WsServerEvent) => void): (() => void) => {
      subscribers.current.add(handler);

      return () => {
        subscribers.current.delete(handler);
      };
    },
    [],
  );

  const value = useMemo<RealtimeContextInterface>(
    () => ({
      subscribe,
      connected,
    }),
    [
      subscribe,
      connected,
    ],
  );

  return (
    <RealtimeContext.Provider value={value}>
      {children}
    </RealtimeContext.Provider>
  );
}
