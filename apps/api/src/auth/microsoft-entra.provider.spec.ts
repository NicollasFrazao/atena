import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import * as oidc from 'openid-client';
import { MicrosoftEntraProvider } from './microsoft-entra.provider';

// A factory keeps Jest from loading the ESM-only package: only these four functions are used.
jest.mock(
  'openid-client',
  () => ({
    discovery: jest.fn(),
    buildAuthorizationUrl: jest.fn(),
    authorizationCodeGrant: jest.fn(),
    ClientSecretBasic: jest.fn(() => 'client-secret-basic'),
  }),
);

const discovery = jest.mocked(oidc.discovery);
const buildAuthorizationUrl = jest.mocked(oidc.buildAuthorizationUrl);
const authorizationCodeGrant = jest.mocked(oidc.authorizationCodeGrant);

/** Stand-in for the discovered configuration; the provider only passes it along. */
const DISCOVERED = { issuer: 'entra' } as unknown as oidc.Configuration;

const REDIRECT_URI = 'http://localhost:3000/api/auth/callback';

const CHALLENGE = {
  state: 'st',
  nonce: 'no',
  codeVerifier: 'cv',
};

function config(): ConfigService {
  return {
    get: jest.fn((key: string) => {
      const map: Record<string, string> = {
        'auth.oidc.issuerUrl': 'https://login.microsoftonline.com/tenant/v2.0',
        'auth.oidc.clientId': 'client-id',
        'auth.oidc.clientSecret': 'client-secret',
        'auth.oidc.redirectUri': REDIRECT_URI,
        'auth.allowedDomain': 'example.com',
      };

      return map[key];
    }),
  } as unknown as ConfigService;
}

/** Token response of the code exchange. */
type TokenResponse = Awaited<ReturnType<typeof oidc.authorizationCodeGrant>>;

/** Token response whose ID Token carries these claims. */
function tokensWith(claims: Record<string, unknown> | undefined): TokenResponse {
  return { claims: () => claims } as unknown as TokenResponse;
}

describe('MicrosoftEntraProvider', () => {
  beforeEach(() => {
    discovery.mockReset().mockResolvedValue(DISCOVERED);
    buildAuthorizationUrl.mockReset().mockReturnValue(new URL('https://login.microsoftonline.com/authorize?x=1'));
    authorizationCodeGrant.mockReset();
  });

  it('discovers the issuer once, with client_secret_basic and a 10 s timeout', async () => {
    const provider = new MicrosoftEntraProvider(config());

    const authorization = {
      state: 'st',
      nonce: 'no',
      codeChallenge: 'cc',
    };

    await provider.getAuthorizationUrl(authorization);
    await provider.getAuthorizationUrl(authorization);

    expect(discovery).toHaveBeenCalledTimes(1);

    expect(discovery).toHaveBeenCalledWith(
      new URL('https://login.microsoftonline.com/tenant/v2.0'),
      'client-id',
      undefined,
      'client-secret-basic',
      { timeout: 10 },
    );
  });

  it('builds the authorization URL with state, nonce and PKCE (S256)', async () => {
    const provider = new MicrosoftEntraProvider(config());

    const url = await provider.getAuthorizationUrl({
      state: 'st',
      nonce: 'no',
      codeChallenge: 'cc',
    });

    expect(url).toBe('https://login.microsoftonline.com/authorize?x=1');

    expect(buildAuthorizationUrl).toHaveBeenCalledWith(
      DISCOVERED,
      expect.objectContaining({
        redirect_uri: REDIRECT_URI,
        scope: 'openid profile email',
        state: 'st',
        nonce: 'no',
        code_challenge: 'cc',
        code_challenge_method: 'S256',
        prompt: 'select_account',
        response_mode: 'query',
      }),
    );
  });

  it('exchanges the code for claims and normalises the user (allowed domain)', async () => {
    authorizationCodeGrant.mockResolvedValueOnce(tokensWith({
      sub: 'abc-123',
      email: 'ana@example.com',
      name: 'Ana Souza',
    }));

    const provider = new MicrosoftEntraProvider(config());

    const user = await provider.handleCallback(
      {
        code: 'the-code',
        state: 'st',
      },
      CHALLENGE,
    );

    const [
      configuration,
      callbackUrl,
      checks,
    ] = authorizationCodeGrant.mock.calls[0];

    expect(configuration).toBe(DISCOVERED);
    expect(callbackUrl).toBeInstanceOf(URL);
    expect((callbackUrl as URL).origin + (callbackUrl as URL).pathname).toBe(REDIRECT_URI);
    expect((callbackUrl as URL).searchParams.get('code')).toBe('the-code');
    expect((callbackUrl as URL).searchParams.get('state')).toBe('st');

    expect(checks).toEqual({
      expectedState: 'st',
      expectedNonce: 'no',
      pkceCodeVerifier: 'cv',
    });

    expect(user).toEqual({
      sub: 'abc-123',
      email: 'ana@example.com',
      name: 'Ana Souza',
    });
  });

  it('uses preferred_username when the claims have no email', async () => {
    authorizationCodeGrant.mockResolvedValueOnce(tokensWith({
      sub: 'abc-123',
      preferred_username: 'bruno@example.com',
    }));

    const provider = new MicrosoftEntraProvider(config());

    const user = await provider.handleCallback(
      {},
      CHALLENGE,
    );

    expect(user.email).toBe('bruno@example.com');
    expect(user.name).toBe('');
  });

  it('retries the code exchange once on a transient timeout and completes', async () => {
    authorizationCodeGrant
      .mockRejectedValueOnce(new Error('The operation was aborted due to timeout'))
      .mockResolvedValueOnce(tokensWith({
        sub: 'abc-123',
        email: 'ana@example.com',
        name: 'Ana',
      }));

    const provider = new MicrosoftEntraProvider(config());

    const user = await provider.handleCallback(
      {},
      CHALLENGE,
    );

    expect(authorizationCodeGrant).toHaveBeenCalledTimes(2);
    expect(user.sub).toBe('abc-123');
  });

  it('does not retry a protocol error (e.g. invalid_grant) and propagates it', async () => {
    authorizationCodeGrant.mockRejectedValue(new Error('invalid_grant'));

    const provider = new MicrosoftEntraProvider(config());

    await expect(provider.handleCallback(
      {},
      CHALLENGE,
    )).rejects.toThrow('invalid_grant');

    expect(authorizationCodeGrant).toHaveBeenCalledTimes(1);
  });

  it('rejects an email outside the institutional domain', async () => {
    authorizationCodeGrant.mockResolvedValueOnce(tokensWith({
      sub: 'x',
      email: 'intruder@gmail.com',
    }));

    const provider = new MicrosoftEntraProvider(config());

    await expect(provider.handleCallback(
      {},
      CHALLENGE,
    )).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a token response without an ID Token', async () => {
    authorizationCodeGrant.mockResolvedValueOnce(tokensWith(undefined));

    const provider = new MicrosoftEntraProvider(config());

    await expect(provider.handleCallback(
      {},
      CHALLENGE,
    )).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
