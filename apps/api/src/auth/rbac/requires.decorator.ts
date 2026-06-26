import { SetMetadata, type CustomDecorator } from '@nestjs/common';
import type { PermissionType } from '@atena/types';

/** Chave de metadados com as permissões exigidas por um handler/controller. */
export const PERMISSIONS_KEY = 'requiredPermissions';

/**
 * Marca um handler/controller como exigindo permissões (RBAC granular). O `PermissionsGuard`
 * compara com `request.user.permissions` (semântica AND: todas são exigidas).
 *
 * Uso: `@Requires('pii:reveal')` · `@Requires('users:manage')`.
 *
 * @param {...PermissionType} permissions - Permissões exigidas.
 * @returns {CustomDecorator} Decorator que grava as permissões exigidas.
 */
export const Requires = (...permissions: PermissionType[]): CustomDecorator => SetMetadata(
  PERMISSIONS_KEY,
  permissions,
);
