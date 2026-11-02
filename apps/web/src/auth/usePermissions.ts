import type { PermissionType } from '@atena/types';
import { useAuth } from './auth-context';

/** API do hook de permissões. */
interface PermissionsApiInterface {
  /** `true` se o usuário logado tem a permissão. */
  can: (permission: PermissionType) => boolean;
  /** Todas as permissões efetivas do usuário. */
  permissions: PermissionType[];
}

/**
 * Hook de autorização para a UI: esconde/desabilita ações sem permissão (ex.: botão de reveal de
 * PII, item de nav do admin). NÃO substitui a checagem do backend — é só para a experiência.
 *
 * @returns `can(permission)` e a lista de permissões.
 */
export function usePermissions(): PermissionsApiInterface {
  const { user } = useAuth();
  const permissions = user?.permissions ?? [];

  return {
    can: (permission: PermissionType): boolean => permissions.includes(permission),
    permissions,
  };
}
