import type { RoleType, SessionUserInterface } from '@atena/types';
import { useAuth } from '../auth/auth-context';

/** Rótulo do papel de maior precedência (admin > lead > analyst > viewer). */
const ROLE_LABELS: {
  role: RoleType;
  label: string
}[] = [
  {
    role: 'admin',
    label: 'Administrador',
  },
  {
    role: 'support_lead',
    label: 'Líder de suporte',
  },
  {
    role: 'support_analyst',
    label: 'Analista de suporte',
  },
  {
    role: 'viewer',
    label: 'Visualizador',
  },
];

/**
 * Usuário atual da sessão (analista), derivado da identidade autenticada (`/auth/me`, via
 * {@link useAuth}). Centralizado aqui para que a saudação do chat, o avatar e a topbar consumam a
 * MESMA identidade.
 */
export interface CurrentUserInterface {
  /** Nome de exibição (saudação e topbar). */
  name: string;
  /** Primeiro nome (saudação "Olá, {firstName}"). */
  firstName: string;
  /** Cargo/função exibido sob o nome. */
  role: string;
  /** Iniciais para o avatar (1–2 letras). */
  initials: string;
}

/** Identidade neutra de fallback (não deve aparecer — Shell só monta autenticado). */
const FALLBACK: CurrentUserInterface = {
  name: 'Usuário',
  firstName: 'Usuário',
  role: 'Analista de suporte',
  initials: 'U',
};

/**
 * Retorna o usuário atual derivado da sessão autenticada.
 *
 * @returns {CurrentUserInterface} Identidade do analista logado.
 */
export function useCurrentUser(): CurrentUserInterface {
  const { user } = useAuth();

  if (user === null) {
    return FALLBACK;
  }

  return deriveCurrentUser(user);
}

/**
 * Deriva nome/primeiro nome/iniciais/cargo da identidade da sessão. Função pura (testável).
 *
 * @param {SessionUserInterface} user - Usuário autenticado (`name`/`email`/`roles`).
 * @returns {CurrentUserInterface} Identidade pronta para a UI.
 */
export function deriveCurrentUser(user: SessionUserInterface): CurrentUserInterface {
  const name = (user.name || localPart(user.email)).trim();
  const words = name.split(/\s+/).filter(Boolean);
  const firstName = words[0] ?? name;

  const initials = words
    .slice(
      0,
      2,
    )
    .map((word) => word.charAt(0).toUpperCase())
    .join('') || firstName.charAt(0).toUpperCase();

  const roleLabel = ROLE_LABELS.find((item) => user.roles.includes(item.role));

  return {
    name,
    firstName,
    role: roleLabel?.label ?? 'Sem papel',
    initials,
  };
}

/**
 * Parte local de um e-mail (antes do `@`), usada como nome quando a claim `name` vem vazia.
 *
 * @param {string} email - E-mail institucional.
 * @returns {string} Texto antes do `@` (ou o próprio e-mail se não houver `@`).
 */
function localPart(email: string): string {
  const at = email.indexOf('@');

  return at > 0
    ? email.slice(
      0,
      at,
    )
    : email;
}
