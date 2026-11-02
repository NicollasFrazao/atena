import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { PermissionType } from '@atena/types';
import type { AuthenticatedUserInterface } from '../identity-provider.interface';
import { PERMISSIONS_KEY } from './requires.decorator';

/**
 * Guard de RBAC por **permissão**: lê as permissões exigidas (via `@Requires(...)`) e as compara
 * com `request.user.permissions` (populado antes pelo {@link AuthGuard}). Semântica AND: exige
 * todas as permissões listadas. Sem `@Requires` → libera (autorização é opt-in).
 *
 * Falha fechado, distinguindo os casos para o frontend:
 *  - `disabled` → 403 `access_disabled`.
 *  - autenticado sem papel → 403 `access_pending`.
 *  - papel sem a permissão → 403 `forbidden`.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  /**
   * @param reflector - Lê os metadados gravados por `@Requires(...)`.
   */
  constructor(private readonly reflector: Reflector) {}

  /**
   * Autoriza a request conforme as permissões exigidas.
   *
   * @param context - Contexto de execução do NestJS.
   *
   * @returns `true` se não houver exigência ou o usuário tiver todas as permissões.
   *
   * @throws {ForbiddenException} `access_disabled` | `access_pending` | `forbidden`.
   */
  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<PermissionType[] | undefined>(
      PERMISSIONS_KEY,
      [
        context.getHandler(),
        context.getClass(),
      ],
    );

    if (
      !required
      || required.length === 0
    ) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUserInterface }>();

    const user = request.user;

    if (user?.status === 'disabled') {
      throw new ForbiddenException({
        error: {
          code: 'access_disabled',
          message: 'Acesso desabilitado. Fale com o administrador.',
        },
      });
    }

    const userPermissions = user?.permissions ?? [];
    const hasAll = required.every((permission) => userPermissions.includes(permission));

    if (hasAll) {
      return true;
    }

    if (
      !user
      || user.roles.length === 0
    ) {
      throw new ForbiddenException({
        error: {
          code: 'access_pending',
          message: 'Acesso pendente de liberação. Fale com o administrador.',
        },
      });
    }

    throw new ForbiddenException({
      error: {
        code: 'forbidden',
        message: 'Permissão insuficiente para este recurso.',
      },
    });
  }
}
