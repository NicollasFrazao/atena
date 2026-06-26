import { type ReactNode, useEffect, useRef, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  ArrowsClockwise,
  ArrowSquareOut,
  CaretDown,
  type Icon,
  Gear,
  ShieldCheck,
  SignOut,
  TrendUp,
  UsersThree,
} from '@phosphor-icons/react';
import logoUrl from '../styles/design-system/assets/atena-logo.svg';
import { useAuth } from '../auth/auth-context';
import { usePermissions } from '../auth/usePermissions';
import { useCurrentUser } from '../user/currentUser';
import { useOpenIncidentCount } from '../api/incidents';
import { useChatContext } from '../chat/chat-context';
import { IncidentBanner } from '../realtime/IncidentBanner';

interface ShellProps {
  children: ReactNode;
}

/** Item da navegação principal. */
interface NavItemInterface {
  to: string;
  label: string;
  badge?: boolean;
}

/** Item do menu de administração. */
interface AdminItemInterface {
  to: string;
  label: string;
  icon: Icon;
  hint: string;
}

/** Navegação principal (esquerda → direita). */
const NAV_ITEMS: NavItemInterface[] = [
  {
    to: '/',
    label: 'Assistente',
  },
  {
    to: '/incidentes',
    label: 'Incidentes',
    badge: true,
  },
  {
    to: '/relatorios',
    label: 'Relatórios',
  },
  {
    to: '/historico',
    label: 'Histórico',
  },
];

/** Itens administrativos (dropdown de engrenagem). */
const ADMIN_ITEMS: AdminItemInterface[] = [
  {
    to: '/regras',
    label: 'Regras de anomalia',
    icon: Gear,
    hint: 'Configurar thresholds e dimensões',
  },
  {
    to: '/observabilidade',
    label: 'Observabilidade',
    icon: TrendUp,
    hint: 'Saúde do próprio assistente (latência, custo)',
  },
  {
    to: '/auditoria',
    label: 'Audit log',
    icon: ShieldCheck,
    hint: 'Trilha imutável de eventos',
  },
];

/** Item administrativo visível só para quem tem `users:manage` (admin). */
const USER_ADMIN_ITEM: AdminItemInterface = {
  to: '/admin/usuarios',
  label: 'Usuários e acessos',
  icon: UsersThree,
  hint: 'Atribuir papéis e habilitar/desabilitar usuários',
};

/**
 * Shell immersive da Atena: topbar fina (logo + wordmark ATENA + navegação + ações + perfil) sobre
 * o conteúdo. A navegação usa react-router; o badge de Incidentes reflete os abertos em tempo quase
 * real. Estilos por tokens `--at-*`, alinhados ao protótipo.
 *
 * @param {ShellProps} props - Conteúdo da rota.
 * @returns {JSX.Element} Layout com topbar + área de conteúdo rolável.
 */
export function Shell({ children }: ShellProps): JSX.Element {
  const user = useCurrentUser();
  const openCount = useOpenIncidentCount().data ?? 0;
  const { reset } = useChatContext();
  const navigate = useNavigate();

  // "Nova sessão": limpa a conversa (estado compartilhado) e leva ao assistente.
  const onNewSession = (): void => {
    reset();
    navigate('/');
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
    }}
    >
      <header style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--at-space-12)',
        height: 56,
        flexShrink: 0,
        padding: '0 var(--at-space-24)',
        background: 'var(--at-white)',
        borderBottom: '1px solid var(--at-border)',
      }}
      >
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--at-space-8)',
        }}
        >
          <img
            src={logoUrl}
            alt="Atena"
            style={{ height: 22 }}
          />
          <span style={{
            paddingLeft: 'var(--at-space-8)',
            borderLeft: '1px solid var(--at-border)',
            fontFamily: 'var(--at-font-heading)',
            fontSize: 'var(--at-fs-12)',
            fontWeight: 600,
            letterSpacing: 0.3,
            textTransform: 'uppercase',
            color: 'var(--at-fg-muted)',
          }}
          >
            Atena
          </span>
        </div>

        <nav
          className="at-hide-mobile"
          style={{
            display: 'flex',
            gap: 'var(--at-space-4)',
          }}
        >
          {NAV_ITEMS.map((item) => (
            <NavTab
              key={item.to}
              item={item}
              badgeCount={openCount}
            />
          ))}
        </nav>

        <span style={{ flex: 1 }} />

        <button
          type="button"
          onClick={onNewSession}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--at-space-4)',
            height: 30,
            padding: '0 var(--at-space-12)',
            borderRadius: 'var(--at-radius-4)',
            border: 'none',
            background: 'transparent',
            color: 'var(--at-fg-muted)',
            fontSize: 'var(--at-fs-12)',
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          <ArrowsClockwise size={14} />
          <span className="at-hide-mobile">Nova sessão</span>
        </button>

        <SettingsMenu />

        <ProfileButton user={user} />
      </header>

      <IncidentBanner />

      <main style={{
        flex: 1,
        minHeight: 0,
        overflow: 'auto',
      }}
      >
        {children}
      </main>
    </div>
  );
}

/** Aba da navegação principal: estilo ativo + badge opcional (incidentes abertos). */
function NavTab({
  item,
  badgeCount,
}: {
  item: NavItemInterface;
  badgeCount: number
}): JSX.Element {
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      style={({ isActive }) => ({
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--at-space-4)',
        height: 30,
        padding: '0 var(--at-space-12)',
        borderRadius: 'var(--at-radius-4)',
        textDecoration: 'none',
        fontSize: 'var(--at-fs-14)',
        fontWeight: isActive
          ? 600
          : 500,
        background: isActive
          ? 'var(--at-bg-soft)'
          : 'transparent',
        color: isActive
          ? 'var(--at-fg)'
          : 'var(--at-fg-muted)',
      })}
    >
      {item.label}
      {item.badge && badgeCount > 0
        ? (
          <span style={{
            height: 18,
            minWidth: 18,
            padding: '0 5px',
            borderRadius: 999,
            background: 'var(--at-danger-200)',
            color: 'var(--at-white)',
            fontSize: 'var(--at-fs-10)',
            fontWeight: 700,
            lineHeight: 1,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          >
            {badgeCount}
          </span>
        )
        : null}
    </NavLink>
  );
}

/** Dropdown de administração (Regras / Observabilidade / Audit / Usuários). */
function SettingsMenu(): JSX.Element {
  const [
    open,
    setOpen,
  ] = useState(false);

  const { can } = usePermissions();

  // "Usuários e acessos" só aparece para quem pode gerenciar usuários (admin).
  const items = can('users:manage')
    ? [
      ...ADMIN_ITEMS,
      USER_ADMIN_ITEM,
    ]
    : ADMIN_ITEMS;

  const ref = useRef<HTMLDivElement>(null);

  useClickOutside(
    ref,
    () => setOpen(false),
  );

  return (
    <div
      ref={ref}
      className="at-hide-mobile"
      style={{ position: 'relative' }}
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 'var(--at-space-4)',
          height: 30,
          padding: '0 var(--at-space-8)',
          borderRadius: 'var(--at-radius-4)',
          border: 'none',
          background: open
            ? 'var(--at-bg-soft)'
            : 'transparent',
          color: 'var(--at-fg-muted)',
          fontSize: 'var(--at-fs-12)',
          fontWeight: 500,
          cursor: 'pointer',
        }}
      >
        <Gear size={14} />
        Admin
        <CaretDown
          size={11}
          style={{
            transform: open
              ? 'rotate(180deg)'
              : 'none',
            transition: 'transform .15s',
          }}
        />
      </button>
      {open
        ? (
          <div style={{
            position: 'absolute',
            top: 38,
            right: 0,
            minWidth: 260,
            background: 'var(--at-white)',
            border: '1px solid var(--at-border)',
            borderRadius: 8,
            boxShadow: '0 12px 32px rgba(0, 0, 0, 0.12)',
            overflow: 'hidden',
            zIndex: 50,
          }}
          >
            <div style={{
              padding: '8px 12px',
              fontSize: 'var(--at-fs-10)',
              fontWeight: 600,
              color: 'var(--at-fg-subtle)',
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              borderBottom: '1px solid var(--at-border)',
            }}
            >
              Administração
            </div>
            {items.map((item) => (
              <AdminMenuItem
                key={item.to}
                item={item}
                onPick={() => setOpen(false)}
              />
            ))}
          </div>
        )
        : null}
    </div>
  );
}

/** Item do dropdown de administração. */
function AdminMenuItem({
  item,
  onPick,
}: {
  item: AdminItemInterface;
  onPick: () => void
}): JSX.Element {
  const ItemIcon = item.icon;

  return (
    <NavLink
      to={item.to}
      onClick={onPick}
      style={({ isActive }) => ({
        display: 'flex',
        alignItems: 'flex-start',
        gap: 'var(--at-space-8)',
        padding: '10px 12px',
        textDecoration: 'none',
        background: isActive
          ? 'var(--at-primary-lighter)'
          : 'transparent',
      })}
    >
      <ItemIcon
        size={14}
        style={{
          marginTop: 2,
          flexShrink: 0,
          color: 'var(--at-fg-muted)',
        }}
      />
      <span style={{ minWidth: 0 }}>
        <span style={{
          display: 'block',
          fontSize: 'var(--at-fs-12)',
          fontWeight: 600,
          color: 'var(--at-fg)',
        }}
        >
          {item.label}
        </span>
        <span style={{
          display: 'block',
          fontSize: 'var(--at-fs-11)',
          color: 'var(--at-fg-muted)',
          marginTop: 1,
        }}
        >
          {item.hint}
        </span>
      </span>
    </NavLink>
  );
}

/** Avatar + nome/cargo com popover de perfil. */
function ProfileButton({ user }: { user: ReturnType<typeof useCurrentUser> }): JSX.Element {
  const [
    open,
    setOpen,
  ] = useState(false);

  const ref = useRef<HTMLDivElement>(null);

  useClickOutside(
    ref,
    () => setOpen(false),
  );

  return (
    <div
      ref={ref}
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        paddingLeft: 'var(--at-space-12)',
        borderLeft: '1px solid var(--at-border)',
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--at-space-8)',
          padding: 0,
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
        }}
      >
        <Avatar initials={user.initials} />
        <span
          className="at-hide-mobile"
          style={{
            textAlign: 'left',
            lineHeight: 1.2,
          }}
        >
          <span style={{
            display: 'block',
            fontSize: 'var(--at-fs-12)',
            fontWeight: 600,
            color: 'var(--at-fg)',
          }}
          >
            {user.name}
          </span>
          <span style={{
            display: 'block',
            fontSize: 'var(--at-fs-10)',
            color: 'var(--at-fg-muted)',
          }}
          >
            {user.role}
          </span>
        </span>
      </button>
      {open
        ? <ProfilePopover user={user} />
        : null}
    </div>
  );
}

/** Avatar circular com iniciais. */
function Avatar({ initials }: { initials: string }): JSX.Element {
  return (
    <span style={{
      width: 28,
      height: 28,
      borderRadius: 999,
      flexShrink: 0,
      background: 'var(--at-plankton-50)',
      color: 'var(--at-plankton-700)',
      display: 'grid',
      placeItems: 'center',
      fontSize: 'var(--at-fs-11)',
      fontWeight: 700,
    }}
    >
      {initials}
    </span>
  );
}

/** Popover de perfil: identidade + documentação + sair. */
function ProfilePopover({ user }: { user: ReturnType<typeof useCurrentUser> }): JSX.Element {
  const { signOut } = useAuth();

  return (
    <div style={{
      position: 'absolute',
      top: 46,
      right: 0,
      width: 260,
      background: 'var(--at-white)',
      border: '1px solid var(--at-border)',
      borderRadius: 8,
      boxShadow: '0 16px 40px rgba(0, 0, 0, 0.14)',
      overflow: 'hidden',
      zIndex: 60,
    }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--at-space-12)',
        padding: 'var(--at-space-12)',
        borderBottom: '1px solid var(--at-border)',
      }}
      >
        <Avatar initials={user.initials} />
        <span style={{ minWidth: 0 }}>
          <span style={{
            display: 'block',
            fontSize: 'var(--at-fs-12)',
            fontWeight: 600,
            color: 'var(--at-fg)',
          }}
          >
            {user.name}
          </span>
          <span style={{
            display: 'block',
            fontSize: 'var(--at-fs-11)',
            color: 'var(--at-fg-muted)',
          }}
          >
            {user.role}
          </span>
        </span>
      </div>
      <div style={{ padding: 'var(--at-space-4)' }}>
        <PopoverAction
          icon={ArrowSquareOut}
          label="Documentação"
          hint="em breve"
        />
        <PopoverAction
          icon={SignOut}
          label="Sair"
          onClick={signOut}
          danger
        />
      </div>
    </div>
  );
}

/** Linha de ação do popover de perfil. */
function PopoverAction({
  icon,
  label,
  hint,
  onClick,
  danger,
}: {
  icon: Icon;
  label: string;
  hint?: string;
  onClick?: () => void;
  danger?: boolean
}): JSX.Element {
  const ActionIcon = icon;

  return (
    <button
      type="button"
      title={hint}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--at-space-8)',
        width: '100%',
        padding: '8px 10px',
        borderRadius: 'var(--at-radius-4)',
        border: 'none',
        background: 'transparent',
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      <ActionIcon
        size={13}
        color={danger
          ? 'var(--at-danger-300)'
          : 'var(--at-fg-muted)'}
      />
      <span style={{
        flex: 1,
        fontSize: 'var(--at-fs-12)',
        color: danger
          ? 'var(--at-danger-300)'
          : 'var(--at-fg)',
        fontWeight: danger
          ? 600
          : 400,
      }}
      >
        {label}
      </span>
      {hint
        ? (
          <span style={{
            fontSize: 'var(--at-fs-10)',
            color: 'var(--at-fg-subtle)',
          }}
          >
            {hint}
          </span>
        )
        : null}
    </button>
  );
}

/** Fecha um popover/menu ao clicar fora do `ref`. */
function useClickOutside(
  ref: React.RefObject<HTMLElement>,
  onOutside: () => void,
): void {
  useEffect(
    () => {
      const onDown = (event: MouseEvent): void => {
        if (
          ref.current
          && !ref.current.contains(event.target as Node)
        ) {
          onOutside();
        }
      };

      document.addEventListener(
        'mousedown',
        onDown,
      );

      return () => document.removeEventListener(
        'mousedown',
        onDown,
      );
    },
    [
      ref,
      onOutside,
    ],
  );
}
