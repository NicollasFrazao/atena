import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as oidc from 'openid-client';
import {
  type AuthenticatedIdentityInterface,
  type AuthorizationChallengeInterface,
  type CallbackChallengeInterface,
  type IdentityProviderInterface,
} from './identity-provider.interface';

/**
 * Timeout (seconds) of the `openid-client` HTTP requests (discovery and token exchange). openid-client
 * 5 defaulted to 3.5 s, too short for `login.microsoftonline.com` from the container (500 on
 * `/auth/login`); 6 defaults to 30 s. 10 s keeps a slow IdP from holding the login for long.
 */
const OIDC_HTTP_TIMEOUT_SECONDS = 10;

/** Token response of the code exchange, with the helpers that read the ID Token claims. */
type TokenResponse = Awaited<ReturnType<typeof oidc.authorizationCodeGrant>>;

/**
 * Implementação do {@link IdentityProviderInterface} para login social institucional
 * via Microsoft 365 / Entra ID usando OIDC (authorization code flow).
 *
 * É o default da Atena, mas é totalmente plugável: o {@link AuthModule} amarra
 * este provider ao token `IDENTITY_PROVIDER`. Para trocar de IdP, basta criar
 * outra classe que implemente a interface e mudar o binding.
 *
 * Invariantes do contrato:
 *  - Apenas e-mails do domínio institucional configurado são aceitos.
 *  - Devolve APENAS identidade (sub/email/name); os papéis (RBAC) NÃO vêm do IdP — são
 *    resolvidos do banco pelos guards/UsersService.
 */
@Injectable()
export class MicrosoftEntraProvider implements IdentityProviderInterface {
  /** OIDC configuration from discovery (lazy, cached after the first use). */
  private config?: oidc.Configuration;

  /**
   * @param configService - Acesso à configuração OIDC
   *   (`issuerUrl`, `clientId`, `clientSecret`, `redirectUri`) e ao domínio
   *   institucional permitido (`auth.allowedDomain`).
   */
  constructor(private readonly configService: ConfigService) {}

  /**
   * Monta a URL de autorização do Entra ID para iniciar o login, com `state`
   * (anti-CSRF), `nonce` (anti-replay do `id_token`) e PKCE (`code_challenge` S256).
   *
   * `prompt=select_account` força o Entra a mostrar o **seletor de conta** em vez de fazer
   * login silencioso na sessão existente da Microsoft — assim o usuário pode entrar com OUTRA
   * conta após sair (nosso `logout` só limpa o cookie local; a sessão do IdP permanece).
   *
   * @param challenge - `state`/`nonce`/`codeChallenge`.
   *
   * @returns URL de autorização absoluta do IdP, com escopos
   *   `openid profile email` e `response_mode=query`.
   */
  async getAuthorizationUrl(challenge: AuthorizationChallengeInterface): Promise<string> {
    const config = await this.getConfig();
    const redirectUri = this.configService.get<string>('auth.oidc.redirectUri') ?? '';

    return oidc.buildAuthorizationUrl(
      config,
      {
        redirect_uri: redirectUri,
        scope: 'openid profile email',
        state: challenge.state,
        nonce: challenge.nonce,
        code_challenge: challenge.codeChallenge,
        code_challenge_method: 'S256',
        // Sempre oferecer o seletor de conta (permite trocar de conta no login).
        prompt: 'select_account',
        // `response_mode: 'query'` mantém o callback simples (GET com query params).
        response_mode: 'query',
      },
    ).href;
  }

  /**
   * Conclui o login: troca o `code` por tokens (validando `state`/`nonce`/PKCE contra o
   * desafio original), extrai as claims do `id_token`, valida o domínio institucional e
   * normaliza o resultado para {@link AuthenticatedUserInterface}.
   *
   * @param params - Query params do callback do IdP (`code`, `state`, …).
   * @param challenge - Desafio original (do cookie curto).
   *
   * @returns Identidade autenticada e normalizada.
   *
   * @throws {UnauthorizedException} Se o e-mail estiver fora do domínio institucional permitido.
   */
  async handleCallback(
    params: Record<string, string>,
    challenge: CallbackChallengeInterface,
  ): Promise<AuthenticatedIdentityInterface> {
    const config = await this.getConfig();
    const redirectUri = this.configService.get<string>('auth.oidc.redirectUri') ?? '';

    const tokens = await this.exchangeCode(
      config,
      redirectUri,
      params,
      challenge,
    );

    // `expectedNonce` makes an ID Token mandatory, so the claims are always there.
    const claims = tokens.claims();

    if (!claims) {
      throw new UnauthorizedException('The identity provider returned no ID Token.');
    }

    const email = stringClaim(claims.email) ?? stringClaim(claims.preferred_username) ?? '';
    this.assertAllowedDomain(email);

    return {
      sub: claims.sub,
      email,
      name: stringClaim(claims.name) ?? '',
    };
  }

  /**
   * Troca o `code` por tokens com **1 retry** em erro transitório de rede/timeout (a rede do
   * container até o Entra às vezes dá hiccup). Se o `code` já tiver sido consumido na 1ª tentativa,
   * o retry falha com `invalid_grant` — erro claro, não pior que não tentar.
   *
   * @param config - OIDC configuration.
   * @param redirectUri - Redirect URI registrado.
   * @param params - Query params do callback.
   * @param challenge - Desafio (state/nonce/codeVerifier).
   *
   * @returns Tokens validados.
   */
  private async exchangeCode(
    config: oidc.Configuration,
    redirectUri: string,
    params: Record<string, string>,
    challenge: CallbackChallengeInterface,
  ): Promise<TokenResponse> {
    // openid-client 6 reads the authorization response from the callback URL itself.
    const callbackUrl = new URL(redirectUri);

    for (const [
      name,
      value,
    ] of Object.entries(params)) {
      callbackUrl.searchParams.set(
        name,
        value,
      );
    }

    const checks: oidc.AuthorizationCodeGrantChecks = {
      expectedState: challenge.state,
      expectedNonce: challenge.nonce,
      pkceCodeVerifier: challenge.codeVerifier,
    };

    try {
      return await oidc.authorizationCodeGrant(
        config,
        callbackUrl,
        checks,
      );
    } catch (err) {
      if (!this.isTransientNetworkError(err)) {
        throw err;
      }

      return oidc.authorizationCodeGrant(
        config,
        callbackUrl,
        checks,
      );
    }
  }

  /**
   * Identifica erros transitórios de rede/timeout (dignos de 1 retry).
   *
   * @param err - Erro capturado.
   *
   * @returns `true` se for timeout/conexão (não um erro de protocolo do IdP).
   */
  private isTransientNetworkError(err: unknown): boolean {
    const message = err instanceof Error
      ? err.message
      : String(err);

    // `timeout`: openid-client 6 aborts with a TimeoutError; `fetch failed`: undici's network error.
    return /timed out|timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|socket hang up|fetch failed|network/i.test(message);
  }

  /**
   * Discovers the configured issuer once (Entra ID `.../v2.0/.well-known/openid-configuration`) and
   * caches the OIDC configuration for later calls.
   *
   * @returns OIDC configuration ready for use.
   */
  private async getConfig(): Promise<oidc.Configuration> {
    if (this.config) {
      return this.config;
    }

    const issuerUrl = this.configService.get<string>('auth.oidc.issuerUrl') ?? '';
    const clientId = this.configService.get<string>('auth.oidc.clientId') ?? '';
    const clientSecret = this.configService.get<string>('auth.oidc.clientSecret') ?? '';

    // client_secret_basic, the openid-client 5 default; the timeout also applies to the token
    // exchange of the resulting configuration.
    this.config = await oidc.discovery(
      new URL(issuerUrl),
      clientId,
      undefined,
      oidc.ClientSecretBasic(clientSecret),
      { timeout: OIDC_HTTP_TIMEOUT_SECONDS },
    );

    return this.config;
  }

  /**
   * Garante que o e-mail pertence ao domínio institucional permitido.
   * Qualquer e-mail fora de `@${allowedDomain}` é rejeitado (comparação
   * case-insensitive). É a fronteira que restringe o acesso à organização.
   *
   * @param email - E-mail extraído das claims do IdP.
   *
   * @throws {UnauthorizedException} Se o domínio não estiver configurado ou o
   *   e-mail não pertencer ao domínio permitido.
   */
  private assertAllowedDomain(email: string): void {
    const allowedDomain = this.configService.get<string>('auth.allowedDomain') ?? '';
    const suffix = `@${allowedDomain}`;

    if (
      !allowedDomain
      || !email.toLowerCase().endsWith(suffix.toLowerCase())
    ) {
      throw new UnauthorizedException(
        `Acesso restrito ao domínio ${suffix}.`,
      );
    }
  }
}

/**
 * Reads an ID Token claim that should be a string; anything else counts as absent.
 *
 * @param value - Claim value.
 *
 * @returns The string, or `undefined`.
 */
function stringClaim(value: unknown): string | undefined {
  return typeof value === 'string'
    ? value
    : undefined;
}
