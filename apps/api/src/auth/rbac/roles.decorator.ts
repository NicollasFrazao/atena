import { SetMetadata, type CustomDecorator } from '@nestjs/common';
import type { RoleType } from '@atena/types';

/**
 * Chave de metadados sob a qual os papéis exigidos por um handler/controller
 * ficam guardados. Usada pelo {@link RolesGuard} ao ler os metadados via
 * `Reflector`.
 */
export const ROLES_KEY = 'roles';

/**
 * Decorator que anota um handler/controller com os papéis (RBAC) exigidos para
 * acessá-lo (`support_analyst` | `support_lead`). Lido pelo {@link RolesGuard}
 * via `Reflector`.
 *
 * O controle de papel é opt-in: handlers sem `@Roles` ficam liberados.
 *
 * Uso: `@Roles('support_lead')`
 *
 * @param {...RoleType} roles - Papéis aceitos; o acesso é liberado se o usuário
 *   possuir ao menos um deles.
 * @returns {CustomDecorator} Decorator que grava os papéis nos metadados.
 */
export const Roles = (...roles: RoleType[]): CustomDecorator => SetMetadata(
  ROLES_KEY,
  roles,
);
