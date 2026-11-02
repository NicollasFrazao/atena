import type { JSX } from 'react';
import {
  Navigate,
  Route,
  Routes,
} from 'react-router-dom';
import { AuthProvider } from './auth/AuthProvider';
import { Shell } from './components/Shell';
import { RouteTitle } from './components/RouteTitle';
import { RelatoriosPage } from './reports/RelatoriosPage';
import { RealtimeProvider } from './realtime/RealtimeProvider';
import { ChatProvider } from './chat/ChatProvider';
import { ChatPage } from './chat/ChatPage';
import { IncidentsPage } from './incidents/IncidentsPage';
import { RulesPage } from './rules/RulesPage';
import { ObservabilityPage } from './observability/ObservabilityPage';
import { HistoryPage } from './history/HistoryPage';
import { AuditPage } from './audit/AuditPage';
import { UsuariosPage } from './admin/UsuariosPage';

/**
 * Raiz do app web da Atena. O `AuthProvider` (no topo) gateia tudo: verifica a sessão (cookie) no
 * boot, mostra a tela de login quando não há sessão e só monta a árvore real quando autenticado —
 * 401 em qualquer chamada volta para o login. O `ChatProvider` mantém a sessão/conversa do chat
 * viva durante a navegação entre telas; o banner de incidentes vive no `Shell`.
 *
 * @returns App montado (login ou Shell, conforme a sessão).
 */
export function App(): JSX.Element {
  return (
    <AuthProvider>
      <RealtimeProvider>
        <ChatProvider>
          <RouteTitle />
          <Shell>
            <Routes>
              <Route
                path="/"
                element={<ChatPage />}
              />
              <Route
                path="/incidentes"
                element={<IncidentsPage />}
              />
              <Route
                path="/relatorios"
                element={<RelatoriosPage />}
              />
              <Route
                path="/historico"
                element={<HistoryPage />}
              />
              <Route
                path="/regras"
                element={<RulesPage />}
              />
              <Route
                path="/auditoria"
                element={<AuditPage />}
              />
              <Route
                path="/admin/usuarios"
                element={<UsuariosPage />}
              />
              <Route
                path="/observabilidade"
                element={<ObservabilityPage />}
              />
              <Route
                path="*"
                element={(
                  <Navigate
                    to="/"
                    replace
                  />
                )}
              />
            </Routes>
          </Shell>
        </ChatProvider>
      </RealtimeProvider>
    </AuthProvider>
  );
}
