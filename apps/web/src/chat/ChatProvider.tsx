import { type ReactNode, useCallback } from 'react';
import type { WsServerEvent } from '@atena/types';
import { useRealtimeEvent } from '../realtime/realtime-context';
import { useChat } from './useChat';
import { ChatContext } from './chat-context';

/**
 * Provedor do estado do chat. Montado ACIMA das rotas (no App), mantém a sessão e a conversa vivas
 * enquanto o usuário navega entre as telas — sem resetar ao trocar de aba.
 *
 * Também escuta o `/ws/support`: a cada `incident.created`, injeta o incidente como um cartão inline
 * na conversa (proativo), em paralelo ao banner app-wide. Dedupe por id fica no `pushIncident`.
 *
 * @param {{ children: ReactNode }} props - Árvore que consome o contexto.
 * @returns {JSX.Element} O provedor.
 */
export function ChatProvider({ children }: { children: ReactNode }): JSX.Element {
  const chat = useChat();

  const {
    pushIncident,
    updateIncident,
  } = chat;

  const onEvent = useCallback(
    (event: WsServerEvent): void => {
      if (event.type === 'incident.created') {
        pushIncident(event.incident);

        return;
      }

      // Realtime: outro operador reconheceu/resolveu → atualiza o cartão na conversa (status/dono),
      // evitando que se atue em algo já resolvido ou já assumido.
      if (event.type === 'incident.updated') {
        updateIncident(
          event.incident_id,
          event.acknowledged_by
            ? {
              status: event.status,
              assignee: event.acknowledged_by,
            }
            : { status: event.status },
        );

        return;
      }

      if (event.type === 'incident.auto_resolved') {
        updateIncident(
          event.incident_id,
          { status: 'auto_resolved' },
        );
      }
    },
    [
      pushIncident,
      updateIncident,
    ],
  );

  useRealtimeEvent(onEvent);

  return (
    <ChatContext.Provider value={chat}>
      {children}
    </ChatContext.Provider>
  );
}
