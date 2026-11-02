import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { RoleType } from '@atena/types';
import type { AuthenticatedUserInterface } from '../identity-provider.interface';
import { ROLES_KEY } from './roles.decorator';

/**
 * Guard de RBAC: lê os papéis exigidos (via `@Roles(...)`) e os compara com
 * `request.user.roles` (populado antes pelo {@link AuthGuard}).
 *
 * Semântica OR: basta o usuário possuir um dos papéis exigidos.
 * Sem `@Roles` no handler/controller → libera (controle de papel é opt-in).
 * Pressupõe que o {@link AuthGuard} já tenha rodado e autenticado a request.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  /**
   * @param reflector - Utilitário do NestJS para ler os metadados
   *   gravados por `@Roles(...)`.
   */
  constructor(private readonly reflector: Reflector) {}

  /**
   * Autoriza a request conforme os papéis exigidos pelo handler/controller.
   *
   * @param context - Contexto de execução do NestJS.
   *
   * @returns `true` se não houver papéis exigidos ou se o usuário
   *   possuir ao menos um deles.
   *
   * @throws {ForbiddenException} Se o usuário não possuir nenhum dos papéis
   *   exigidos.
   */
  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<RoleType[] | undefined>(
      ROLES_KEY,
      [
        context.getHandler(),
        context.getClass(),
      ],
    );

    if (
      !requiredRoles
      || requiredRoles.length === 0
    ) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUserInterface }>();

    const userRoles = request.user?.roles ?? [];

    const hasRole = requiredRoles.some((role) => userRoles.includes(role));

    if (!hasRole) {
      throw new ForbiddenException('Permissão insuficiente para este recurso.');
    }

    return true;
  }
}
