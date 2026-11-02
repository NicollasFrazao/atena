import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUserInterface } from './identity-provider.interface';

/**
 * Decorator de parâmetro que injeta o usuário autenticado no handler, lendo-o
 * de `request.user` (populado antes pelo {@link AuthGuard}).
 *
 * Retorna `undefined` quando não há usuário na request (ex.: rota sem o
 * {@link AuthGuard}), portanto use em conjunto com o guard de sessão.
 *
 * Uso: `meHandler(@CurrentUser() user: AuthenticatedUserInterface) { ... }`
 *
 * @param {unknown} _data - Argumento do decorator (não utilizado).
 * @param {ExecutionContext} ctx - Contexto de execução do NestJS.
 *
 * @returns {AuthenticatedUserInterface | undefined} Usuário autenticado, ou `undefined`
 *   se a request não tiver sido autenticada.
 */
export const CurrentUser = createParamDecorator(
  (
    _data: unknown,
    ctx: ExecutionContext,
  ): AuthenticatedUserInterface | undefined => {
    const request = ctx.switchToHttp().getRequest<Request & { user?: AuthenticatedUserInterface }>();

    return request.user;
  },
);
