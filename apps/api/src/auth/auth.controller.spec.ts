import { HttpStatus } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { AuthController } from './auth.controller';
import type { AuthService } from './auth.service';
import type { AuthenticatedUserInterface } from './identity-provider.interface';

function config(): ConfigService {
  return {
    get: jest.fn((key: string) => {
      const map: Record<string, unknown> = {
        'auth.session.cookieName': 'atena_session',
        'auth.oidcCookieName': 'atena_oidc',
        'auth.session.sameSite': 'none',
        'auth.session.secure': true,
        'auth.session.ttlHours': 8,
        'auth.webOrigin': 'http://localhost:5173',
      };

      return map[key];
    }),
  } as unknown as ConfigService;
}

function res(): Response & {
  cookie: jest.Mock;
  clearCookie: jest.Mock;
  redirect: jest.Mock;
} {
  return {
    cookie: jest.fn(),
    clearCookie: jest.fn(),
    redirect: jest.fn(),
  } as unknown as Response & {
    cookie: jest.Mock;
    clearCookie: jest.Mock;
    redirect: jest.Mock;
  };
}

const USER: AuthenticatedUserInterface = {
  sub: 'u-1',
  email: 'ana@example.com',
  name: 'Ana',
  roles: ['support_analyst'],
  permissions: ['app:use'],
  status: 'active',
  is_super_admin: false,
};

const CHALLENGE = {
  state: 'st',
  nonce: 'no',
  codeVerifier: 'cv',
};

describe('AuthController', () => {
  it('login: guarda o desafio no cookie atena_oidc e redireciona (302) ao IdP', async () => {
    const auth = {
      getLoginUrl: jest.fn().mockResolvedValue({
        url: 'https://idp/authorize',
        challenge: CHALLENGE,
      }),
      issueChallengeToken: jest.fn().mockReturnValue('oidc-jwt'),
    } as unknown as AuthService;

    const controller = new AuthController(
      auth,
      config(),
    );

    const response = res();

    await controller.login(response);

    expect(auth.issueChallengeToken).toHaveBeenCalledWith(CHALLENGE);

    expect(response.cookie).toHaveBeenCalledWith(
      'atena_oidc',
      'oidc-jwt',
      expect.objectContaining({
        httpOnly: true,
        sameSite: 'none',
        secure: true,
      }),
    );

    expect(response.redirect).toHaveBeenCalledWith(
      HttpStatus.FOUND,
      'https://idp/authorize',
    );
  });

  it('callback: troca o code, emite o cookie de sessão e redireciona (302) ao frontend', async () => {
    const auth = {
      readChallengeToken: jest.fn().mockReturnValue(CHALLENGE),
      completeLogin: jest.fn().mockResolvedValue(USER),
      issueSession: jest.fn().mockReturnValue('session-jwt'),
    } as unknown as AuthService;

    const controller = new AuthController(
      auth,
      config(),
    );

    const response = res();
    const request = { cookies: { atena_oidc: 'oidc-jwt' } } as unknown as Request;

    await controller.callback(
      {
        code: 'the-code',
        state: 'st',
      },
      request,
      response,
    );

    expect(auth.readChallengeToken).toHaveBeenCalledWith('oidc-jwt');

    expect(auth.completeLogin).toHaveBeenCalledWith(
      {
        code: 'the-code',
        state: 'st',
      },
      CHALLENGE,
    );

    expect(response.clearCookie).toHaveBeenCalledWith(
      'atena_oidc',
      expect.any(Object),
    );

    expect(response.cookie).toHaveBeenCalledWith(
      'atena_session',
      'session-jwt',
      expect.objectContaining({ httpOnly: true }),
    );

    expect(response.redirect).toHaveBeenCalledWith(
      HttpStatus.FOUND,
      'http://localhost:5173',
    );
  });

  it('me: devolve o usuário da sessão', () => {
    const controller = new AuthController(
      {} as unknown as AuthService,
      config(),
    );

    expect(controller.me(USER)).toEqual(USER);
  });

  it('logout: limpa o cookie de sessão', () => {
    const controller = new AuthController(
      {} as unknown as AuthService,
      config(),
    );

    const response = res();

    controller.logout(response);

    expect(response.clearCookie).toHaveBeenCalledWith(
      'atena_session',
      expect.any(Object),
    );
  });
});
