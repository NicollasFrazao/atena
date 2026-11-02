import { createContext, useContext } from 'react';
import type { ChatStateInterface } from './useChat';

/** Contexto com o estado/ações do chat, compartilhado acima das rotas (persiste na navegação). */
export const ChatContext = createContext<ChatStateInterface | null>(null);

/**
 * Acessa o estado do chat compartilhado. Deve estar dentro de `<ChatProvider>`.
 *
 * @returns Estado/ações do chat.
 *
 * @throws {@link Error} when called outside a `<ChatProvider>`.
 */
export function useChatContext(): ChatStateInterface {
  const ctx = useContext(ChatContext);

  if (ctx === null) {
    throw new Error('useChatContext deve ser usado dentro de <ChatProvider>');
  }

  return ctx;
}
