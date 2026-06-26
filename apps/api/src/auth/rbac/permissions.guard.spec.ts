import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { AuthenticatedUserInterface } from '../identity-provider.interface';
import { PermissionsGuard } from './permissions.guard';

function context(user?: Partial<AuthenticatedUserInterface>): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

function reflector(required: string[] | undefined): Reflector {
  return { getAllAndOverride: jest.fn().mockReturnValue(required) } as unknown as Reflector;
}

describe('PermissionsGuard', () => {
  it('libera quando o handler não exige permissão', () => {
    const guard = new PermissionsGuard(reflector(undefined));

    expect(guard.canActivate(context({
      roles: ['viewer'],
      permissions: ['app:use'],
      status: 'active',
    }))).toBe(true);
  });

  it('libera quando o usuário tem a permissão exigida', () => {
    const guard = new PermissionsGuard(reflector(['pii:reveal']));

    expect(guard.canActivate(context({
      roles: ['support_lead'],
      permissions: ['pii:reveal'],
      status: 'active',
    }))).toBe(true);
  });

  it('403 access_disabled quando o usuário está desabilitado', () => {
    const guard = new PermissionsGuard(reflector(['app:use']));

    expect(() => guard.canActivate(context({
      roles: ['support_analyst'],
      permissions: ['app:use'],
      status: 'disabled',
    }))).toThrow(ForbiddenException);
  });

  it('403 access_pending quando autenticado sem papel', () => {
    const guard = new PermissionsGuard(reflector(['app:use']));

    try {
      guard.canActivate(context({
        roles: [],
        permissions: [],
        status: 'active',
      }));

      throw new Error('deveria ter lançado');
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenException);

      expect((err as ForbiddenException).getResponse()).toMatchObject({
        error: { code: 'access_pending' },
      });
    }
  });

  it('403 forbidden quando tem papel mas não a permissão', () => {
    const guard = new PermissionsGuard(reflector(['pii:reveal']));

    try {
      guard.canActivate(context({
        roles: ['support_analyst'],
        permissions: ['app:use'],
        status: 'active',
      }));

      throw new Error('deveria ter lançado');
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenException);

      expect((err as ForbiddenException).getResponse()).toMatchObject({
        error: { code: 'forbidden' },
      });
    }
  });
});
