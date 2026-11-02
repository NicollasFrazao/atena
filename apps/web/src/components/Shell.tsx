import { type ReactNode, useEffect, useRef, useState, type JSX } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  ArrowsClockwiseIcon as ArrowsClockwise,
  ArrowSquareOutIcon as ArrowSquareOut,
  CaretDownIcon as CaretDown,
  type Icon,
  GearIcon as Gear,
  ShieldCheckIcon as ShieldCheck,
  SignOutIcon as SignOut,
  TrendUpIcon as TrendUp,
  UsersThreeIcon as UsersThree,
} from '@phosphor-icons/react';
import logoUrl from '../styles/design-system/assets/atena-logo.svg';
import { useAuth } from '../auth/auth-context';
import { usePermissions } from '../auth/usePermissions';
import { useCurrentUser } from '../user/currentUser';
import { useOpenIncidentCount } from '../api/incidents';
import { useChatContext } from '../chat/chat-context';
import { IncidentBanner } from '../realtime/IncidentBanner';
import { cssValue, cssVar, FONT_WEIGHT } from '../styles/tokens';

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
 * @param props - Conteúdo da rota.
 *
 * @returns Layout com topbar + área de conteúdo rolável.
 */
export function Shell({ children }: Readonly<ShellProps>): JSX.Element {
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
        gap: cssVar.space12,
        height: 56,
        flexShrink: 0,
        padding: '0 var(--at-space-24)',
        background: cssVar.white,
        borderBottom: cssVar.borderLine,
      }}
      >
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: cssVar.space8,
        }}
        >
          <img
            src={logoUrl}
            alt="Atena"
            style={{ height: 22 }}
          />
          <span style={{
            paddingLeft: cssVar.space8,
            borderLeft: cssVar.borderLine,
            fontFamily: cssVar.fontHeading,
            fontSize: cssVar.fs12,
            fontWeight: 600,
            letterSpacing: 0.3,
            textTransform: 'uppercase',
            color: cssVar.fgMuted,
          }}
          >
            Atena
          </span>
        </div>

        <nav
          className="at-hide-mobile"
          style={{
            display: 'flex',
            gap: cssVar.space4,
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
            display: cssValue.inlineFlex,
            alignItems: 'center',
            gap: cssVar.space4,
            height: 30,
            padding: cssVar.paddingInline12,
            borderRadius: cssVar.radius4,
            border: 'none',
            background: 'transparent',
            color: cssVar.fgMuted,
            fontSize: cssVar.fs12,
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
}: Readonly<{
  item: NavItemInterface;
  badgeCount: number
}>): JSX.Element {
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      style={({ isActive }) => ({
        display: cssValue.inlineFlex,
        alignItems: 'center',
        gap: cssVar.space4,
        height: 30,
        padding: cssVar.paddingInline12,
        borderRadius: cssVar.radius4,
        textDecoration: 'none',
        fontSize: cssVar.fs14,
        fontWeight: isActive
          ? FONT_WEIGHT.semibold
          : FONT_WEIGHT.medium,
        background: isActive
          ? cssVar.bgSoft
          : 'transparent',
        color: isActive
          ? cssVar.fg
          : cssVar.fgMuted,
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
            background: cssVar.danger200,
            color: cssVar.white,
            fontSize: cssVar.fs10,
            fontWeight: 700,
            lineHeight: 1,
            display: cssValue.inlineFlex,
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
    () => { setOpen(false); },
  );

  return (
    <div
      ref={ref}
      className="at-hide-mobile"
      style={{ position: 'relative' }}
    >
      <button
        type="button"
        onClick={() => { setOpen((value) => !value); }}
        style={{
          display: cssValue.inlineFlex,
          alignItems: 'center',
          gap: cssVar.space4,
          height: 30,
          padding: '0 var(--at-space-8)',
          borderRadius: cssVar.radius4,
          border: 'none',
          background: open
            ? cssVar.bgSoft
            : 'transparent',
          color: cssVar.fgMuted,
          fontSize: cssVar.fs12,
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
            background: cssVar.white,
            border: cssVar.borderLine,
            borderRadius: 8,
            boxShadow: '0 12px 32px rgba(0, 0, 0, 0.12)',
            overflow: 'hidden',
            zIndex: 50,
          }}
          >
            <div style={{
              padding: '8px 12px',
              fontSize: cssVar.fs10,
              fontWeight: 600,
              color: cssVar.fgSubtle,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              borderBottom: cssVar.borderLine,
            }}
            >
              Administração
            </div>
            {items.map((item) => (
              <AdminMenuItem
                key={item.to}
                item={item}
                onPick={() => { setOpen(false); }}
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
}: Readonly<{
  item: AdminItemInterface;
  onPick: () => void
}>): JSX.Element {
  const ItemIcon = item.icon;

  return (
    <NavLink
      to={item.to}
      onClick={onPick}
      style={({ isActive }) => ({
        display: 'flex',
        alignItems: 'flex-start',
        gap: cssVar.space8,
        padding: '10px 12px',
        textDecoration: 'none',
        background: isActive
          ? cssVar.primaryLighter
          : 'transparent',
      })}
    >
      <ItemIcon
        size={14}
        style={{
          marginTop: 2,
          flexShrink: 0,
          color: cssVar.fgMuted,
        }}
      />
      <span style={{ minWidth: 0 }}>
        <span style={{
          display: 'block',
          fontSize: cssVar.fs12,
          fontWeight: 600,
          color: cssVar.fg,
        }}
        >
          {item.label}
        </span>
        <span style={{
          display: 'block',
          fontSize: cssVar.fs12,
          color: cssVar.fgMuted,
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
function ProfileButton({ user }: Readonly<{ user: ReturnType<typeof useCurrentUser> }>): JSX.Element {
  const [
    open,
    setOpen,
  ] = useState(false);

  const ref = useRef<HTMLDivElement>(null);

  useClickOutside(
    ref,
    () => { setOpen(false); },
  );

  return (
    <div
      ref={ref}
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        paddingLeft: cssVar.space12,
        borderLeft: cssVar.borderLine,
      }}
    >
      <button
        type="button"
        onClick={() => { setOpen((value) => !value); }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: cssVar.space8,
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
            fontSize: cssVar.fs12,
            fontWeight: 600,
            color: cssVar.fg,
          }}
          >
            {user.name}
          </span>
          <span style={{
            display: 'block',
            fontSize: cssVar.fs10,
            color: cssVar.fgMuted,
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
function Avatar({ initials }: Readonly<{ initials: string }>): JSX.Element {
  return (
    <span style={{
      width: 28,
      height: 28,
      borderRadius: 999,
      flexShrink: 0,
      background: cssVar.plankton50,
      color: cssVar.plankton700,
      display: 'grid',
      placeItems: 'center',
      fontSize: cssVar.fs12,
      fontWeight: 700,
    }}
    >
      {initials}
    </span>
  );
}

/** Popover de perfil: identidade + documentação + sair. */
function ProfilePopover({ user }: Readonly<{ user: ReturnType<typeof useCurrentUser> }>): JSX.Element {
  const { signOut } = useAuth();

  return (
    <div style={{
      position: 'absolute',
      top: 46,
      right: 0,
      width: 260,
      background: cssVar.white,
      border: cssVar.borderLine,
      borderRadius: 8,
      boxShadow: '0 16px 40px rgba(0, 0, 0, 0.14)',
      overflow: 'hidden',
      zIndex: 60,
    }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: cssVar.space12,
        padding: cssVar.space12,
        borderBottom: cssVar.borderLine,
      }}
      >
        <Avatar initials={user.initials} />
        <span style={{ minWidth: 0 }}>
          <span style={{
            display: 'block',
            fontSize: cssVar.fs12,
            fontWeight: 600,
            color: cssVar.fg,
          }}
          >
            {user.name}
          </span>
          <span style={{
            display: 'block',
            fontSize: cssVar.fs12,
            color: cssVar.fgMuted,
          }}
          >
            {user.role}
          </span>
        </span>
      </div>
      <div style={{ padding: cssVar.space4 }}>
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
}: Readonly<{
  icon: Icon;
  label: string;
  hint?: string;
  onClick?: () => void;
  danger?: boolean
}>): JSX.Element {
  const ActionIcon = icon;

  return (
    <button
      type="button"
      title={hint}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: cssVar.space8,
        width: '100%',
        padding: '8px 10px',
        borderRadius: cssVar.radius4,
        border: 'none',
        background: 'transparent',
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      <ActionIcon
        size={13}
        color={danger
          ? cssVar.danger300
          : cssVar.fgMuted}
      />
      <span style={{
        flex: 1,
        fontSize: cssVar.fs12,
        color: danger
          ? cssVar.danger300
          : cssVar.fg,
        fontWeight: danger
          ? FONT_WEIGHT.semibold
          : FONT_WEIGHT.regular,
      }}
      >
        {label}
      </span>
      {hint
        ? (
          <span style={{
            fontSize: cssVar.fs10,
            color: cssVar.fgSubtle,
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

      return () => {
        document.removeEventListener(
          'mousedown',
          onDown,
        );
      };
    },
    [
      ref,
      onOutside,
    ],
  );
}
