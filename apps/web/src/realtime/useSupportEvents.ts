import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import type { WsServerEvent } from '@atena/types';
import { WS_URL } from '../api/config';

/** Eventos que o servidor empurra no namespace `/ws/support`. */
const SERVER_EVENTS: WsServerEvent['type'][] = [
  'connection.status',
  'incident.created',
  'incident.updated',
  'incident.auto_resolved',
];

/**
 * Conecta no `/ws/support` (socket.io, reconexão automática) e chama `onEvent` a cada
 * evento de incidente. Conecta uma vez (callback via ref, sem reconectar a cada render).
 *
 * @param onEvent - Handler dos eventos do servidor.
 *
 * @returns Estado da conexão (p/ a faixa de "WS desconectado").
 */
export function useSupportEvents(onEvent: (event: WsServerEvent) => void): { connected: boolean } {
  const handlerRef = useRef(onEvent);

  // The ref follows the latest handler after each commit, never during render.
  useLayoutEffect(
    () => {
      handlerRef.current = onEvent;
    },
  );

  const [
    connected,
    setConnected,
  ] = useState(false);

  useEffect(
    () => {
      const socket = io(
        `${WS_URL}/ws/support`,
        {
          transports: ['websocket'],
          reconnection: true,
          // Envia o cookie de sessão no handshake (o gateway valida o JWT).
          withCredentials: true,
        },
      );

      socket.on(
        'connect',
        () => { setConnected(true); },
      );

      socket.on(
        'disconnect',
        () => { setConnected(false); },
      );

      for (const name of SERVER_EVENTS) {
        socket.on(
          name,
          (payload: WsServerEvent) => { handlerRef.current(payload); },
        );
      }

      return () => {
        socket.disconnect();
      };
    },
    [],
  );

  return { connected };
}
