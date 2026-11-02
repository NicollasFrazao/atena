import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import type {
  AuthenticatedIdentityInterface,
  IdentityProviderInterface,
} from './identity-provider.interface';

function config(): ConfigService {
  const values: Partial<Record<string, unknown>> = {
    'auth.sessionSecret': 'test-secret-please-rotate',
    'auth.session.ttlHours': 8,
    'auth.adminEmails': [],
  };

  return { get: jest.fn((key: string) => values[key]) } as unknown as ConfigService;
}

function provider(overrides: Partial<IdentityProviderInterface> = {}): IdentityProviderInterface {
  return {
    getAuthorizationUrl: jest.fn().mockResolvedValue('https://idp/authorize'),
    handleCallback: jest.fn(),
    ...overrides,
  };
}

function usersService(): UsersService {
  return { upsertOnLogin: jest.fn().mockResolvedValue(undefined) } as unknown as UsersService;
}

const IDENTITY: AuthenticatedIdentityInterface = {
  sub: 'u-1',
  email: 'ana@example.com',
  name: 'Ana',
};

describe('AuthService', () => {
  it('getLoginUrl gera state/nonce/PKCE e repassa o code_challenge ao provider', async () => {
    const idp = provider();

    const service = new AuthService(
      idp,
      config(),
      usersService(),
    );

    const {
      url,
      challenge,
    } = await service.getLoginUrl();

    expect(url).toBe('https://idp/authorize');
    expect(challenge.state).toEqual(expect.any(String));
    expect(challenge.nonce).toEqual(expect.any(String));
    expect(challenge.codeVerifier).toEqual(expect.any(String));

    const call = (idp.getAuthorizationUrl as jest.Mock).mock.calls[0][0];
    expect(call.state).toBe(challenge.state);
    expect(call.nonce).toBe(challenge.nonce);
    // O challenge guardado tem o verifier; ao provider vai o code_challenge (hash), não o verifier.
    expect(call.codeChallenge).toEqual(expect.any(String));
    expect(call.codeChallenge).not.toBe(challenge.codeVerifier);
  });

  it('completeLogin delega ao provider e persiste o usuário (upsert)', async () => {
    const handleCallback = jest.fn().mockResolvedValue(IDENTITY);
    const users = usersService();

    const service = new AuthService(
      provider({ handleCallback }),
      config(),
      users,
    );

    const challenge = {
      state: 'st',
      nonce: 'no',
      codeVerifier: 'cv',
    };

    const identity = await service.completeLogin(
      { code: 'c' },
      challenge,
    );

    expect(handleCallback).toHaveBeenCalledWith(
      { code: 'c' },
      challenge,
    );

    expect(users.upsertOnLogin).toHaveBeenCalledWith(IDENTITY);

    expect(identity).toEqual(IDENTITY);
  });

  it('issueSession/verifySession faz round-trip da identidade (sem papéis no JWT)', () => {
    const service = new AuthService(
      provider(),
      config(),
      usersService(),
    );

    const token = service.issueSession(IDENTITY);
    expect(typeof token).toBe('string');

    expect(service.verifySession(token)).toEqual(IDENTITY);
  });

  it('verifySession lança em token inválido', () => {
    const service = new AuthService(
      provider(),
      config(),
      usersService(),
    );

    expect(() => service.verifySession('not-a-jwt')).toThrow(UnauthorizedException);
  });

  it('issueChallengeToken/readChallengeToken faz round-trip do desafio', () => {
    const service = new AuthService(
      provider(),
      config(),
      usersService(),
    );

    const challenge = {
      state: 'st',
      nonce: 'no',
      codeVerifier: 'cv',
    };

    const token = service.issueChallengeToken(challenge);

    expect(service.readChallengeToken(token)).toEqual(challenge);
  });

  it('readChallengeToken lança quando o cookie está ausente', () => {
    const service = new AuthService(
      provider(),
      config(),
      usersService(),
    );

    expect(() => service.readChallengeToken(undefined)).toThrow(UnauthorizedException);
  });
});
