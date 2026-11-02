import { useMemo, useState, type JSX } from 'react';
import { LockIcon as Lock, MagnifyingGlassIcon as MagnifyingGlass } from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AdminUserInterface,
  RoleCatalogItemInterface,
  RoleType,
} from '@atena/types';
import type { SessionUserInterface } from '@atena/types';
import {
  fetchRoleCatalog,
  listUsers,
  setUserRoles,
  setUserStatus,
} from '../api/admin';
import { useAuth } from '../auth/auth-context';
import { cssValue, cssVar } from '../styles/tokens';

/** Chave de query da lista de usuários. */
const USERS_KEY = ['admin-users'];

/**
 * Tela de administração de usuários e acessos (`/admin/usuarios`, só `users:manage`):
 * lista os usuários, atribui/revoga papéis (chips do catálogo, com descrição) e habilita/desabilita
 * contas. Traz uma legenda explicando cada papel e busca por nome/e-mail. Sem papel = pendente.
 *
 * @returns A tela de administração de usuários.
 */
export function UsuariosPage(): JSX.Element {
  const queryClient = useQueryClient();
  const { user: me } = useAuth();

  const [
    search,
    setSearch,
  ] = useState('');

  const users = useQuery({
    queryKey: USERS_KEY,
    queryFn: listUsers,
  });

  const catalog = useQuery({
    queryKey: ['admin-roles'],
    queryFn: fetchRoleCatalog,
  });

  const refresh = (): void => {
    queryClient.invalidateQueries({ queryKey: USERS_KEY }).catch(() => undefined);
  };

  const roles = catalog.data ?? [];

  const all = useMemo(
    () => users.data ?? [],
    [users.data],
  );

  const filtered = useMemo(
    () => {
      const term = search.trim().toLowerCase();

      if (!term) {
        return all;
      }

      return all.filter((user) => `${user.name} ${user.email}`.toLowerCase().includes(term));
    },
    [
      all,
      search,
    ],
  );

  const pending = all.filter((user) => user.roles.length === 0).length;

  return (
    <div style={{
      padding: cssVar.space24,
      maxWidth: 1000,
      margin: '0 auto',
    }}
    >
      <header style={{ marginBottom: cssVar.space20 }}>
        <h1 style={{
          margin: 0,
          fontSize: cssVar.fs24,
          fontWeight: 700,
          color: cssVar.fg,
        }}
        >
          Usuários e acessos
        </h1>
        <p style={{
          margin: '6px 0 0',
          fontSize: cssVar.fs14,
          color: cssVar.fgMuted,
        }}
        >
          {all.length}
          {' '}
          usuário(s)
          {pending > 0
            ? ` · ${pending} pendente(s) de liberação`
            : ' · nenhum pendente'}
        </p>
      </header>

      <RolesLegend roles={roles} />

      <SearchBox
        value={search}
        onChange={setSearch}
      />

      {users.isLoading
        ? <p style={{ color: cssVar.fgMuted }}>Carregando…</p>
        : null}

      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: cssVar.space8,
      }}
      >
        {filtered.map((user) => (
          <UserRow
            key={user.sub}
            user={user}
            roles={roles}
            me={me}
            onChanged={refresh}
          />
        ))}
        {users.data && filtered.length === 0
          ? (
            <p style={{
              color: cssVar.fgMuted,
              padding: cssVar.space12,
            }}
            >
              Nenhum usuário encontrado.
            </p>
          )
          : null}
      </div>
    </div>
  );
}

/** Legenda dos papéis: explica o que cada papel concede (descrição do catálogo). */
function RolesLegend({ roles }: Readonly<{ roles: RoleCatalogItemInterface[] }>): JSX.Element | null {
  if (roles.length === 0) {
    return null;
  }

  return (
    <div style={{
      background: cssVar.white,
      border: cssVar.borderLine,
      borderRadius: cssVar.radius8,
      padding: cssVar.space16,
      marginBottom: cssVar.space16,
    }}
    >
      <div style={{
        fontSize: cssVar.fs12,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        color: cssVar.fgSubtle,
        marginBottom: cssVar.space12,
      }}
      >
        Papéis
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: cssVar.space12,
      }}
      >
        {roles.map((item) => (
          <div key={item.role}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: cssVar.space8,
            }}
            >
              <span style={{
                width: 8,
                height: 8,
                borderRadius: 999,
                background: ROLE_DOT[item.role] ?? cssVar.fgMuted,
              }}
              />
              <span style={{
                fontSize: cssVar.fs14,
                fontWeight: 600,
                color: cssVar.fg,
              }}
              >
                {item.label}
              </span>
            </div>
            <p style={{
              margin: '4px 0 0 16px',
              fontSize: cssVar.fs12,
              color: cssVar.fgMuted,
              lineHeight: 1.45,
            }}
            >
              {item.description}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Campo de busca por nome/e-mail. */
function SearchBox({
  value,
  onChange,
}: Readonly<{
  value: string;
  onChange: (next: string) => void
}>): JSX.Element {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: cssVar.space8,
      height: 38,
      padding: cssVar.paddingInline12,
      background: cssVar.white,
      border: cssVar.borderLine,
      borderRadius: cssVar.radius8,
      marginBottom: cssVar.space16,
    }}
    >
      <MagnifyingGlass
        size={16}
        color={cssVar.fgMuted}
      />
      <input
        value={value}
        onChange={(event) => { onChange(event.target.value); }}
        placeholder="Buscar por nome ou e-mail…"
        style={{
          flex: 1,
          border: 'none',
          outline: 'none',
          background: 'transparent',
          fontSize: cssVar.fs14,
          color: cssVar.fg,
        }}
      />
    </div>
  );
}

/** Opacity of the row of a disabled user. */
const DISABLED_ROW_OPACITY = 0.65;

/** Uma linha de usuário: avatar + identidade + status + chips de papéis + ação. */
function UserRow({
  user,
  roles,
  me,
  onChanged,
}: Readonly<{
  user: AdminUserInterface;
  roles: RoleCatalogItemInterface[];
  me: SessionUserInterface | null;
  onChanged: () => void
}>): JSX.Element {
  const disabled = user.status === 'disabled';

  // Hierarquia: ninguém edita a si mesmo; super admins são imutáveis; só super admin mexe em admin.
  const isSelf = me?.sub === user.sub;
  const targetIsAdmin = user.roles.includes('admin');
  const meIsSuper = me?.is_super_admin === true;
  const adminChipLocked = !meIsSuper; // conceder/revogar 'admin' é só de super admin

  // Motivo do bloqueio (vazio = editável). Define a área read-only no lugar dos chips/ações.
  let lockReason = '';

  if (user.is_super_admin) {
    lockReason = 'Definido no ambiente (.env)';
  } else if (isSelf) {
    lockReason = 'Sua conta — peça a outro admin';
  } else if (
    targetIsAdmin
           && !meIsSuper
  ) {
    lockReason = 'Apenas super admins gerenciam admins';
  }

  const locked = lockReason !== '';

  const statusBtnColor = disabled
    ? cssVar.primary
    : cssVar.danger300;

  const toggleRole = (role: RoleType): void => {
    const next = user.roles.includes(role)
      ? user.roles.filter((item) => item !== role)
      : [
        ...user.roles,
        role,
      ];

    setUserRoles(
      user.sub,
      next,
    ).then(onChanged).catch(() => undefined);
  };

  const toggleStatus = (): void => {
    setUserStatus(
      user.sub,
      disabled
        ? 'active'
        : 'disabled',
    ).then(onChanged).catch(() => undefined);
  };

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: cssVar.space16,
      padding: cssVar.space12,
      background: cssVar.white,
      border: cssVar.borderLine,
      borderRadius: cssVar.radius8,
      opacity: disabled
        ? DISABLED_ROW_OPACITY
        : 1,
    }}
    >
      <Avatar text={user.name || user.email} />

      <div style={{
        minWidth: 0,
        flex: 1,
      }}
      >
        <div style={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: cssVar.space4,
          fontSize: cssVar.fs14,
          fontWeight: 600,
          color: cssVar.fg,
        }}
        >
          <span style={{
            marginRight: cssVar.space4,
            whiteSpace: 'nowrap',
          }}
          >
            {user.name || user.email}
          </span>
          <StatusPill user={user} />
          {user.is_super_admin
            ? <Tag text="Super admin" />
            : null}
          {isSelf
            ? <Tag text="você" />
            : null}
        </div>
        <div style={{
          fontSize: cssVar.fs12,
          color: cssVar.fgMuted,
        }}
        >
          {user.email}
        </div>
      </div>

      {locked
        ? <LockedAccess reason={lockReason} />
        : (
          <>
            <div style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: cssVar.space4,
              justifyContent: 'flex-end',
              maxWidth: 440,
            }}
            >
              {roles.map((item) => (
                <RoleChip
                  key={item.role}
                  role={item}
                  active={user.roles.includes(item.role)}
                  disabled={item.role === 'admin' && adminChipLocked}
                  onToggle={() => { toggleRole(item.role); }}
                />
              ))}
            </div>

            <button
              type="button"
              onClick={toggleStatus}
              style={{
                flexShrink: 0,
                width: 96,
                padding: '6px 12px',
                borderRadius: cssVar.radius4,
                border: cssVar.borderLine,
                background: cssVar.white,
                color: statusBtnColor,
                fontSize: cssVar.fs12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {disabled
                ? 'Habilitar'
                : 'Desabilitar'}
            </button>
          </>
        )}
    </div>
  );
}

/** Área read-only mostrada quando o usuário não é editável (super admin / você / requer super). */
function LockedAccess({ reason }: Readonly<{ reason: string }>): JSX.Element {
  return (
    <span style={{
      display: cssValue.inlineFlex,
      alignItems: 'center',
      gap: cssVar.space4,
      flexShrink: 0,
      padding: '6px 12px',
      fontSize: cssVar.fs12,
      color: cssVar.fgSubtle,
      whiteSpace: 'nowrap',
    }}
    >
      <Lock size={13} />
      {reason}
    </span>
  );
}

/** Opacity of a role chip the hierarchy does not let the viewer toggle. */
const DISABLED_CHIP_OPACITY = 0.5;

/** Chip de papel (clicável); `title` mostra a descrição do papel. Desabilitado pela hierarquia. */
function RoleChip({
  role,
  active,
  disabled,
  onToggle,
}: Readonly<{
  role: RoleCatalogItemInterface;
  active: boolean;
  disabled: boolean;
  onToggle: () => void
}>): JSX.Element {
  return (
    <button
      type="button"
      onClick={disabled
        ? undefined
        : onToggle}
      disabled={disabled}
      title={role.description}
      style={{
        padding: '4px 10px',
        borderRadius: 999,
        fontSize: cssVar.fs12,
        fontWeight: 500,
        cursor: disabled
          ? 'not-allowed'
          : 'pointer',
        opacity: disabled && !active
          ? DISABLED_CHIP_OPACITY
          : 1,
        border: active
          ? '1px solid var(--at-primary)'
          : cssVar.borderLine,
        background: active
          ? cssVar.primary
          : cssVar.white,
        color: active
          ? cssVar.white
          : cssVar.fgMuted,
      }}
    >
      {role.label}
    </button>
  );
}

/** Etiqueta pequena (ex.: "Super admin", "você"). */
function Tag({ text }: Readonly<{ text: string }>): JSX.Element {
  return (
    <span style={{
      flexShrink: 0,
      whiteSpace: 'nowrap',
      padding: '1px 8px',
      borderRadius: 999,
      fontSize: cssVar.fs10,
      fontWeight: 600,
      background: cssVar.bgSoft,
      color: cssVar.fgMuted,
      border: cssVar.borderLine,
    }}
    >
      {text}
    </span>
  );
}

/** Pílula de status: Ativo / Pendente / Desabilitado. */
function StatusPill({ user }: Readonly<{ user: AdminUserInterface }>): JSX.Element {
  const tone = statusTone(user);

  return (
    <span style={{
      padding: '1px 8px',
      borderRadius: 999,
      fontSize: cssVar.fs10,
      fontWeight: 600,
      background: tone.bg,
      color: tone.fg,
      border: `1px solid ${tone.border}`,
    }}
    >
      {tone.label}
    </span>
  );
}

/** Iniciais do usuário em um avatar circular. */
function Avatar({ text }: Readonly<{ text: string }>): JSX.Element {
  const initials = text
    .split(/\s+/)
    .filter(Boolean)
    .slice(
      0,
      2,
    )
    .map((word) => word.charAt(0).toUpperCase())
    .join('') || '?';

  return (
    <span style={{
      flexShrink: 0,
      width: 36,
      height: 36,
      borderRadius: 999,
      background: cssVar.bgSoft,
      border: cssVar.borderLine,
      display: cssValue.inlineFlex,
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: cssVar.fs12,
      fontWeight: 600,
      color: cssVar.fgMuted,
    }}
    >
      {initials}
    </span>
  );
}

/**
 * Cor do ponto de cada papel na legenda.
 *
 * @remarks
 * Partial on purpose: the role catalog comes from the API and can list a role this build does not
 * know yet, which falls back to the muted color.
 */
const ROLE_DOT: Partial<Record<RoleType, string>> = {
  admin: cssVar.primary,
  support_lead: '#0052CC',
  support_analyst: '#E0A500',
  viewer: cssVar.fgSubtle,
};

/** Rótulo/cores da pílula de status conforme papel/situação. */
function statusTone(user: AdminUserInterface): {
  label: string;
  bg: string;
  fg: string;
  border: string
} {
  if (user.status === 'disabled') {
    return {
      label: 'Desabilitado',
      bg: cssVar.bgSoft,
      fg: cssVar.danger300,
      border: cssVar.border,
    };
  }

  if (user.roles.length === 0) {
    return {
      label: 'Pendente',
      bg: '#FFF7E6',
      fg: '#B26A00',
      border: '#F0D38A',
    };
  }

  return {
    label: 'Ativo',
    bg: '#E8F5F1',
    fg: cssVar.primaryDark,
    border: '#BFE3D8',
  };
}
