import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Issuer } from 'openid-client';
import { MicrosoftEntraProvider } from './microsoft-entra.provider';

jest.mock('openid-client');

/** `authorizationUrl`/`callback` do client OIDC fake, reconfigurados a cada teste. */
const authorizationUrl = jest.fn();
const callback = jest.fn();

function config(): ConfigService {
  return {
    get: jest.fn((key: string) => {
      const map: Record<string, string> = {
        'auth.oidc.issuerUrl': 'https://login.microsoftonline.com/tenant/v2.0',
        'auth.oidc.clientId': 'client-id',
        'auth.oidc.clientSecret': 'client-secret',
        'auth.oidc.redirectUri': 'http://localhost:3000/api/auth/callback',
        'auth.allowedDomain': 'example.com',
      };

      return map[key];
    }),
  } as unknown as ConfigService;
}

describe('MicrosoftEntraProvider', () => {
  beforeEach(() => {
    authorizationUrl.mockReset().mockReturnValue('https://login.microsoftonline.com/authorize?x=1');
    callback.mockReset();

    (Issuer.discover as jest.Mock).mockResolvedValue({
      Client: jest.fn(() => ({
        authorizationUrl,
        callback,
      })),
    });
  });

  it('monta a URL de autorização com state, nonce e PKCE (S256)', async () => {
    const provider = new MicrosoftEntraProvider(config());

    const url = await provider.getAuthorizationUrl({
      state: 'st',
      nonce: 'no',
      codeChallenge: 'cc',
    });

    expect(url).toBe('https://login.microsoftonline.com/authorize?x=1');

    expect(authorizationUrl).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'openid profile email',
      state: 'st',
      nonce: 'no',
      code_challenge: 'cc',
      code_challenge_method: 'S256',
      prompt: 'select_account',
    }));
  });

  it('troca o code por claims e normaliza o usuário (domínio válido)', async () => {
    callback.mockResolvedValueOnce({
      claims: () => ({
        sub: 'abc-123',
        email: 'ana@example.com',
        name: 'Ana Souza',
      }),
    });

    const provider = new MicrosoftEntraProvider(config());

    const user = await provider.handleCallback(
      {
        code: 'the-code',
        state: 'st',
      },
      {
        state: 'st',
        nonce: 'no',
        codeVerifier: 'cv',
      },
    );

    expect(callback).toHaveBeenCalledWith(
      'http://localhost:3000/api/auth/callback',
      {
        code: 'the-code',
        state: 'st',
      },
      {
        state: 'st',
        nonce: 'no',
        code_verifier: 'cv',
      },
    );

    expect(user).toEqual({
      sub: 'abc-123',
      email: 'ana@example.com',
      name: 'Ana Souza',
    });
  });

  it('usa preferred_username quando não há email nas claims', async () => {
    callback.mockResolvedValueOnce({
      claims: () => ({
        sub: 'abc-123',
        preferred_username: 'bruno@example.com',
      }),
    });

    const provider = new MicrosoftEntraProvider(config());

    const user = await provider.handleCallback(
      {},
      {
        state: 'st',
        nonce: 'no',
        codeVerifier: 'cv',
      },
    );

    expect(user.email).toBe('bruno@example.com');
    expect(user.name).toBe('');
  });

  it('faz retry do token exchange em timeout transitório e conclui', async () => {
    callback
      .mockRejectedValueOnce(new Error('outgoing request timed out after 10000ms'))
      .mockResolvedValueOnce({
        claims: () => ({
          sub: 'abc-123',
          email: 'ana@example.com',
          name: 'Ana',
        }),
      });

    const provider = new MicrosoftEntraProvider(config());

    const user = await provider.handleCallback(
      {},
      {
        state: 'st',
        nonce: 'no',
        codeVerifier: 'cv',
      },
    );

    expect(callback).toHaveBeenCalledTimes(2);
    expect(user.sub).toBe('abc-123');
  });

  it('NÃO faz retry em erro não-transitório (ex.: invalid_grant) e propaga', async () => {
    callback.mockRejectedValue(new Error('invalid_grant'));

    const provider = new MicrosoftEntraProvider(config());

    await expect(
      provider.handleCallback(
        {},
        {
          state: 'st',
          nonce: 'no',
          codeVerifier: 'cv',
        },
      ),
    ).rejects.toThrow('invalid_grant');

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('rejeita e-mail fora do domínio institucional', async () => {
    callback.mockResolvedValueOnce({
      claims: () => ({
        sub: 'x',
        email: 'intruder@gmail.com',
      }),
    });

    const provider = new MicrosoftEntraProvider(config());

    await expect(
      provider.handleCallback(
        {},
        {
          state: 'st',
          nonce: 'no',
          codeVerifier: 'cv',
        },
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
