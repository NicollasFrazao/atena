import { createContext, useContext } from 'react';
import type { SessionUserInterface } from '@atena/types';

/** Estado de autenticação: carregando a sessão, autenticado ou sem sessão. */
export type AuthStatusType = 'loading' | 'authenticated' | 'unauthenticated';

/**
 * Estado/ações de autenticação compartilhados acima das rotas.
 *
 * @property {SessionUserInterface | null} user - Usuário da sessão (não-nulo quando autenticado).
 * @property {AuthStatusType} status - Fase do boot/sessão.
 * @property {() => void} signOut - Encerra a sessão (limpa o cookie) e volta à tela de login.
 */
export interface AuthStateInterface {
  user: SessionUserInterface | null;
  status: AuthStatusType;
  signOut: () => void;
}

/** Contexto de autenticação (sessão por cookie). */
export const AuthContext = createContext<AuthStateInterface | null>(null);

/**
 * Acessa o estado de autenticação. Deve estar dentro de `<AuthProvider>`.
 *
 * @returns {AuthStateInterface} Estado/ações de auth.
 */
export function useAuth(): AuthStateInterface {
  const ctx = useContext(AuthContext);

  if (ctx === null) {
    throw new Error('useAuth deve ser usado dentro de <AuthProvider>');
  }

  return ctx;
}
