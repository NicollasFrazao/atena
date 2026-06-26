import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { RoleType } from '@atena/types';
import { RolesGuard } from './roles.guard';

function contextWithRoles(roles: RoleType[]): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ user: { roles } }) }),
  } as unknown as ExecutionContext;
}

function reflectorReturning(required: RoleType[] | undefined): Reflector {
  return { getAllAndOverride: jest.fn().mockReturnValue(required) } as unknown as Reflector;
}

describe('RolesGuard', () => {
  it('libera quando o handler não exige papéis', () => {
    const guard = new RolesGuard(reflectorReturning(undefined));

    expect(guard.canActivate(contextWithRoles([]))).toBe(true);
  });

  it('libera quando o usuário possui um papel exigido (OR)', () => {
    const guard = new RolesGuard(reflectorReturning(['support_lead']));

    expect(guard.canActivate(contextWithRoles(['support_lead']))).toBe(true);
  });

  it('403 quando o usuário não possui o papel exigido', () => {
    const guard = new RolesGuard(reflectorReturning(['support_lead']));

    expect(() => guard.canActivate(contextWithRoles(['support_analyst']))).toThrow(ForbiddenException);
  });
});
