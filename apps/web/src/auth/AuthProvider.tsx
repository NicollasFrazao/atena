import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type JSX,
} from 'react';
import type { SessionUserInterface } from '@atena/types';
import { fetchMe, logout } from '../api/auth';
import { setUnauthorizedHandler } from '../api/client';
import {
  AuthContext,
  type AuthStatusType,
} from './auth-context';
import { Login } from './Login';
import { AccessPending } from './AccessPending';
import { cssVar } from '../styles/tokens';

/** Estado interno do provider (usuário + fase). */
interface AuthInternalState {
  user: SessionUserInterface | null;
  status: AuthStatusType;
}

/**
 * Provedor de autenticação. Montado ACIMA de tudo: no boot consulta `GET /auth/me` para descobrir
 * se há sessão (cookie) válida e **gateia** a aplicação — enquanto carrega mostra um spinner, sem
 * sessão renderiza a tela de {@link Login}, e só com sessão monta a árvore real (providers/Shell).
 *
 * Também registra o handler de 401 do `apiFetch`: uma sessão que expira no meio do uso volta para a
 * tela de login (em vez de recarregar a página).
 *
 * @param props - Árvore renderizada quando autenticado.
 *
 * @returns O provedor + a view conforme o estado.
 */
export function AuthProvider({ children }: Readonly<{ children: ReactNode }>): JSX.Element {
  const [
    state,
    setState,
  ] = useState<AuthInternalState>({
    user: null,
    status: 'loading',
  });

  useEffect(
    () => {
      let active = true;

      fetchMe()
        .then((user) => {
          if (active) {
            setState({
              user,
              status: 'authenticated',
            });
          }
        })
        .catch(() => {
          if (active) {
            setState({
              user: null,
              status: 'unauthenticated',
            });
          }
        });

      return () => {
        active = false;
      };
    },
    [],
  );

  useEffect(
    () => {
      // Sessão expirada no meio do uso (qualquer 401) → volta para o login.
      setUnauthorizedHandler(() => {
        setState({
          user: null,
          status: 'unauthenticated',
        });
      });
    },
    [],
  );

  const signOut = useCallback(
    () => {
      logout()
        .catch(() => undefined)
        .finally(() => {
          setState({
            user: null,
            status: 'unauthenticated',
          });
        });
    },
    [],
  );

  const value = useMemo(
    () => ({
      user: state.user,
      status: state.status,
      signOut,
    }),
    [
      state,
      signOut,
    ],
  );

  // Autenticado mas sem papel (pendente) ou desabilitado → gate (não monta o app).
  const blocked = state.status === 'authenticated'
    && (
      state.user === null
      || state.user.status === 'disabled'
      || state.user.roles.length === 0
    );

  const allowed = state.status === 'authenticated' && !blocked;

  return (
    <AuthContext.Provider value={value}>
      {state.status === 'loading'
        ? <AuthLoading />
        : null}
      {state.status === 'unauthenticated'
        ? <Login />
        : null}
      {blocked
        ? <AccessPending />
        : null}
      {allowed
        ? children
        : null}
    </AuthContext.Provider>
  );
}

/** Spinner full-screen enquanto a sessão é verificada no boot. */
function AuthLoading(): JSX.Element {
  return (
    <div style={{
      height: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: cssVar.bgSoft,
    }}
    >
      <span
        className="at-spin"
        style={{
          width: 28,
          height: 28,
          borderRadius: 999,
          border: '3px solid var(--at-border)',
          borderTopColor: cssVar.primary,
        }}
      />
    </div>
  );
}
