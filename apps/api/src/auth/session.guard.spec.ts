import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Reflector } from '@nestjs/core';
import type { AuthService } from './auth.service';
import type { UsersService } from '../users/users.service';
import type { AuthenticatedUserInterface } from './identity-provider.interface';
import { AuthGuard } from './session.guard';

function context(req: {
  user?: unknown;
  cookies?: Record<string, string>
}): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

function reflector(isPublic: boolean): Reflector {
  return { getAllAndOverride: jest.fn().mockReturnValue(isPublic) } as unknown as Reflector;
}

function config(devBypass: boolean): ConfigService {
  const values: Partial<Record<string, unknown>> = {
    'auth.devBypass': devBypass,
    'auth.session.cookieName': 'atena_session',
    'auth.adminEmails': [],
  };

  // Any other key (e.g. `auth.allowedDomain`) reads 'example.com'.
  return { get: jest.fn((key: string) => values[key] ?? 'example.com') } as unknown as ConfigService;
}

function authService(verifySession: jest.Mock): AuthService {
  return { verifySession } as unknown as AuthService;
}

function usersService(resolveAccess: jest.Mock): UsersService {
  return { resolveAccess } as unknown as UsersService;
}

const IDENTITY = {
  sub: 'u-1',
  email: 'ana@example.com',
  name: 'Ana',
};

describe('AuthGuard', () => {
  it('libera rota pública sem exigir sessão', async () => {
    const guard = new AuthGuard(
      reflector(true),
      config(false),
      authService(jest.fn()),
      usersService(jest.fn()),
    );

    await expect(guard.canActivate(context({}))).resolves.toBe(true);
  });

  it('resolve identidade (cookie) + papéis/permissões (banco) em request.user', async () => {
    const verifySession = jest.fn().mockReturnValue(IDENTITY);

    const resolveAccess = jest.fn().mockResolvedValue({
      roles: ['support_lead'],
      status: 'active',
    });

    const guard = new AuthGuard(
      reflector(false),
      config(false),
      authService(verifySession),
      usersService(resolveAccess),
    );

    const req: {
      user?: AuthenticatedUserInterface;
      cookies?: Record<string, string>
    } = {
      cookies: { atena_session: 'jwt-abc' },
    };

    await expect(guard.canActivate(context(req))).resolves.toBe(true);
    expect(verifySession).toHaveBeenCalledWith('jwt-abc');
    expect(resolveAccess).toHaveBeenCalledWith('u-1');
    expect(req.user?.roles).toEqual(['support_lead']);
    expect(req.user?.permissions).toContain('pii:reveal');
    expect(req.user?.status).toBe('active');
  });

  it('401 quando o cookie de sessão é inválido (verifySession lança)', async () => {
    const verifySession = jest.fn(() => {
      throw new UnauthorizedException('Sessão inválida ou expirada.');
    });

    const guard = new AuthGuard(
      reflector(false),
      config(true), // mesmo com devBypass ligado, cookie inválido não cai no stub
      authService(verifySession),
      usersService(jest.fn()),
    );

    await expect(
      guard.canActivate(context({ cookies: { atena_session: 'bad' } })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('resolve usuário stub (admin) quando não há cookie e devBypass está ligado', async () => {
    const guard = new AuthGuard(
      reflector(false),
      config(true),
      authService(jest.fn()),
      usersService(jest.fn()),
    );

    const req: {
      user?: AuthenticatedUserInterface;
      cookies?: Record<string, string>
    } = {};

    await expect(guard.canActivate(context(req))).resolves.toBe(true);
    expect(req.user?.roles).toContain('admin');
    expect(req.user?.permissions).toContain('users:manage');
  });

  it('401 quando não é público, sem cookie e sem devBypass', async () => {
    const guard = new AuthGuard(
      reflector(false),
      config(false),
      authService(jest.fn()),
      usersService(jest.fn()),
    );

    await expect(guard.canActivate(context({}))).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
