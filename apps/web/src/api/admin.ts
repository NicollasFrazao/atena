import type {
  AdminUserInterface,
  RoleCatalogItemInterface,
  RoleType,
  UserStatusType,
} from '@atena/types';
import { apiFetch } from './client';

/**
 * Lista todos os usuários (tela de admin): `GET /admin/users`. Exige `users:manage`.
 *
 * @returns Usuários com papéis/status.
 */
export function listUsers(): Promise<AdminUserInterface[]> {
  return apiFetch('/admin/users');
}

/**
 * Catálogo de papéis e suas permissões: `GET /admin/roles`.
 *
 * @returns Papéis disponíveis.
 */
export function fetchRoleCatalog(): Promise<RoleCatalogItemInterface[]> {
  return apiFetch('/admin/roles');
}

/**
 * Define o conjunto de papéis de um usuário: `PUT /admin/users/:id/roles`.
 *
 * @param sub - Id do usuário.
 * @param roles - Papéis a atribuir (pode ser vazio = revoga tudo).
 *
 * @returns Usuário atualizado.
 */
export function setUserRoles(
  sub: string,
  roles: RoleType[],
): Promise<AdminUserInterface> {
  return apiFetch(
    `/admin/users/${sub}/roles`,
    {
      method: 'PUT',
      body: JSON.stringify({ roles }),
    },
  );
}

/**
 * Habilita/desabilita um usuário: `PATCH /admin/users/:id/status`.
 *
 * @param sub - Id do usuário.
 * @param status - Novo status.
 *
 * @returns Usuário atualizado.
 */
export function setUserStatus(
  sub: string,
  status: UserStatusType,
): Promise<AdminUserInterface> {
  return apiFetch(
    `/admin/users/${sub}/status`,
    {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    },
  );
}
