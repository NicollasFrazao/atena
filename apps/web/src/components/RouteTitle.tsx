import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/** Título (aba do navegador) de cada rota; espelha os rótulos da navegação. */
const ROUTE_TITLES: Record<string, string> = {
  '/': 'Assistente',
  '/incidentes': 'Incidentes',
  '/relatorios': 'Relatórios',
  '/historico': 'Histórico',
  '/regras': 'Regras',
  '/auditoria': 'Audit log',
  '/admin/usuarios': 'Usuários e acessos',
  '/observabilidade': 'Observabilidade',
};

/** Sufixo fixo do título (produto). */
const TITLE_SUFFIX = 'Atena';

/**
 * Atualiza o `document.title` conforme a rota (ex.: "Incidentes · Atena"). Sem rota
 * conhecida, usa só o sufixo do produto. Não renderiza nada — é só efeito de navegação.
 *
 * @returns Nada (componente de efeito).
 */
export function RouteTitle(): null {
  const { pathname } = useLocation();

  useEffect(
    () => {
      const page = ROUTE_TITLES[pathname];

      document.title = page
        ? `${page} · ${TITLE_SUFFIX}`
        : TITLE_SUFFIX;
    },
    [pathname],
  );

  return null;
}
