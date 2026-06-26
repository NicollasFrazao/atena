import { useMemo, useState } from 'react';
import { Lock, MagnifyingGlass } from '@phosphor-icons/react';
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

/** Chave de query da lista de usuários. */
const USERS_KEY = ['admin-users'];

/**
 * Tela de administração de usuários e acessos (`/admin/usuarios`, só `users:manage`):
 * lista os usuários, atribui/revoga papéis (chips do catálogo, com descrição) e habilita/desabilita
 * contas. Traz uma legenda explicando cada papel e busca por nome/e-mail. Sem papel = pendente.
 *
 * @returns {JSX.Element} A tela de administração de usuários.
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
      padding: 'var(--at-space-24)',
      maxWidth: 1000,
      margin: '0 auto',
    }}
    >
      <header style={{ marginBottom: 'var(--at-space-20)' }}>
        <h1 style={{
          margin: 0,
          fontSize: 'var(--at-fs-24)',
          fontWeight: 700,
          color: 'var(--at-fg)',
        }}
        >
          Usuários e acessos
        </h1>
        <p style={{
          margin: '6px 0 0',
          fontSize: 'var(--at-fs-14)',
          color: 'var(--at-fg-muted)',
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
        ? <p style={{ color: 'var(--at-fg-muted)' }}>Carregando…</p>
        : null}

      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--at-space-8)',
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
              color: 'var(--at-fg-muted)',
              padding: 'var(--at-space-12)',
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
function RolesLegend({ roles }: { roles: RoleCatalogItemInterface[] }): JSX.Element | null {
  if (roles.length === 0) {
    return null;
  }

  return (
    <div style={{
      background: 'var(--at-white)',
      border: '1px solid var(--at-border)',
      borderRadius: 'var(--at-radius-8)',
      padding: 'var(--at-space-16)',
      marginBottom: 'var(--at-space-16)',
    }}
    >
      <div style={{
        fontSize: 'var(--at-fs-12)',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        color: 'var(--at-fg-subtle)',
        marginBottom: 'var(--at-space-12)',
      }}
      >
        Papéis
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: 'var(--at-space-12)',
      }}
      >
        {roles.map((item) => (
          <div key={item.role}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--at-space-8)',
            }}
            >
              <span style={{
                width: 8,
                height: 8,
                borderRadius: 999,
                background: ROLE_DOT[item.role] ?? 'var(--at-fg-muted)',
              }}
              />
              <span style={{
                fontSize: 'var(--at-fs-14)',
                fontWeight: 600,
                color: 'var(--at-fg)',
              }}
              >
                {item.label}
              </span>
            </div>
            <p style={{
              margin: '4px 0 0 16px',
              fontSize: 'var(--at-fs-12)',
              color: 'var(--at-fg-muted)',
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
}: {
  value: string;
  onChange: (next: string) => void
}): JSX.Element {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--at-space-8)',
      height: 38,
      padding: '0 var(--at-space-12)',
      background: 'var(--at-white)',
      border: '1px solid var(--at-border)',
      borderRadius: 'var(--at-radius-8)',
      marginBottom: 'var(--at-space-16)',
    }}
    >
      <MagnifyingGlass
        size={16}
        color="var(--at-fg-muted)"
      />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Buscar por nome ou e-mail…"
        style={{
          flex: 1,
          border: 'none',
          outline: 'none',
          background: 'transparent',
          fontSize: 'var(--at-fs-14)',
          color: 'var(--at-fg)',
        }}
      />
    </div>
  );
}

/** Uma linha de usuário: avatar + identidade + status + chips de papéis + ação. */
function UserRow({
  user,
  roles,
  me,
  onChanged,
}: {
  user: AdminUserInterface;
  roles: RoleCatalogItemInterface[];
  me: SessionUserInterface | null;
  onChanged: () => void
}): JSX.Element {
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
    ? 'var(--at-primary)'
    : 'var(--at-danger-300)';

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
      gap: 'var(--at-space-16)',
      padding: 'var(--at-space-12)',
      background: 'var(--at-white)',
      border: '1px solid var(--at-border)',
      borderRadius: 'var(--at-radius-8)',
      opacity: disabled
        ? 0.65
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
          gap: 'var(--at-space-4)',
          fontSize: 'var(--at-fs-14)',
          fontWeight: 600,
          color: 'var(--at-fg)',
        }}
        >
          <span style={{
            marginRight: 'var(--at-space-4)',
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
          fontSize: 'var(--at-fs-12)',
          color: 'var(--at-fg-muted)',
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
              gap: 'var(--at-space-4)',
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
                  onToggle={() => toggleRole(item.role)}
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
                borderRadius: 'var(--at-radius-4)',
                border: '1px solid var(--at-border)',
                background: 'var(--at-white)',
                color: statusBtnColor,
                fontSize: 'var(--at-fs-12)',
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
function LockedAccess({ reason }: { reason: string }): JSX.Element {
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 'var(--at-space-4)',
      flexShrink: 0,
      padding: '6px 12px',
      fontSize: 'var(--at-fs-12)',
      color: 'var(--at-fg-subtle)',
      whiteSpace: 'nowrap',
    }}
    >
      <Lock size={13} />
      {reason}
    </span>
  );
}

/** Chip de papel (clicável); `title` mostra a descrição do papel. Desabilitado pela hierarquia. */
function RoleChip({
  role,
  active,
  disabled,
  onToggle,
}: {
  role: RoleCatalogItemInterface;
  active: boolean;
  disabled: boolean;
  onToggle: () => void
}): JSX.Element {
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
        fontSize: 'var(--at-fs-12)',
        fontWeight: 500,
        cursor: disabled
          ? 'not-allowed'
          : 'pointer',
        opacity: disabled && !active
          ? 0.5
          : 1,
        border: active
          ? '1px solid var(--at-primary)'
          : '1px solid var(--at-border)',
        background: active
          ? 'var(--at-primary)'
          : 'var(--at-white)',
        color: active
          ? 'var(--at-white)'
          : 'var(--at-fg-muted)',
      }}
    >
      {role.label}
    </button>
  );
}

/** Etiqueta pequena (ex.: "Super admin", "você"). */
function Tag({ text }: { text: string }): JSX.Element {
  return (
    <span style={{
      flexShrink: 0,
      whiteSpace: 'nowrap',
      padding: '1px 8px',
      borderRadius: 999,
      fontSize: 'var(--at-fs-10)',
      fontWeight: 600,
      background: 'var(--at-bg-soft)',
      color: 'var(--at-fg-muted)',
      border: '1px solid var(--at-border)',
    }}
    >
      {text}
    </span>
  );
}

/** Pílula de status: Ativo / Pendente / Desabilitado. */
function StatusPill({ user }: { user: AdminUserInterface }): JSX.Element {
  const tone = statusTone(user);

  return (
    <span style={{
      padding: '1px 8px',
      borderRadius: 999,
      fontSize: 'var(--at-fs-10)',
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
function Avatar({ text }: { text: string }): JSX.Element {
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
      background: 'var(--at-bg-soft)',
      border: '1px solid var(--at-border)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: 'var(--at-fs-12)',
      fontWeight: 600,
      color: 'var(--at-fg-muted)',
    }}
    >
      {initials}
    </span>
  );
}

/** Cor do ponto de cada papel na legenda. */
const ROLE_DOT: Record<RoleType, string> = {
  admin: 'var(--at-primary)',
  support_lead: '#0052CC',
  support_analyst: '#E0A500',
  viewer: 'var(--at-fg-subtle)',
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
      bg: 'var(--at-bg-soft)',
      fg: 'var(--at-danger-300)',
      border: 'var(--at-border)',
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
    fg: 'var(--at-primary-dark)',
    border: '#BFE3D8',
  };
}
