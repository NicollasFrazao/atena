import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Issuer, custom, type Client, type TokenSet } from 'openid-client';
import {
  type AuthenticatedIdentityInterface,
  type AuthorizationChallengeInterface,
  type CallbackChallengeInterface,
  type IdentityProviderInterface,
} from './identity-provider.interface';

/**
 * Timeout (ms) das requisições HTTP do `openid-client` (discovery + token exchange). O default
 * (3500ms) era curto demais para o `login.microsoftonline.com` a partir do container, causando
 * `RPError: outgoing request timed out` (500 no `/auth/login`).
 */
const OIDC_HTTP_TIMEOUT_MS = 10_000;

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
  /** Client OIDC inicializado via discovery (lazy, cacheado após o 1º uso). */
  private client?: Client;

  /**
   * @param {ConfigService} configService - Acesso à configuração OIDC
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
   * @param {AuthorizationChallengeInterface} challenge - `state`/`nonce`/`codeChallenge`.
   * @returns {Promise<string>} URL de autorização absoluta do IdP, com escopos
   *   `openid profile email` e `response_mode=query`.
   */
  async getAuthorizationUrl(challenge: AuthorizationChallengeInterface): Promise<string> {
    const client = await this.getClient();

    return client.authorizationUrl({
      scope: 'openid profile email',
      state: challenge.state,
      nonce: challenge.nonce,
      code_challenge: challenge.codeChallenge,
      code_challenge_method: 'S256',
      // Sempre oferecer o seletor de conta (permite trocar de conta no login).
      prompt: 'select_account',
      // `response_mode: 'query'` mantém o callback simples (GET com query params).
      response_mode: 'query',
    });
  }

  /**
   * Conclui o login: troca o `code` por tokens (validando `state`/`nonce`/PKCE contra o
   * desafio original), extrai as claims do `id_token`, valida o domínio institucional e
   * normaliza o resultado para {@link AuthenticatedUserInterface}.
   *
   * @param {Record<string, string>} params - Query params do callback do IdP (`code`, `state`, …).
   * @param {CallbackChallengeInterface} challenge - Desafio original (do cookie curto).
   * @returns {Promise<AuthenticatedIdentityInterface>} Identidade autenticada e normalizada.
   * @throws {UnauthorizedException} Se o e-mail estiver fora do domínio institucional permitido.
   */
  async handleCallback(
    params: Record<string, string>,
    challenge: CallbackChallengeInterface,
  ): Promise<AuthenticatedIdentityInterface> {
    const client = await this.getClient();
    const redirectUri = this.configService.get<string>('auth.oidc.redirectUri') ?? '';

    const tokenSet = await this.exchangeCode(
      client,
      redirectUri,
      params,
      challenge,
    );

    const claims = tokenSet.claims();
    const email = claims.email ?? claims.preferred_username ?? '';
    this.assertAllowedDomain(email);

    return {
      sub: claims.sub,
      email,
      name: claims.name ?? '',
    };
  }

  /**
   * Troca o `code` por tokens com **1 retry** em erro transitório de rede/timeout (a rede do
   * container até o Entra às vezes dá hiccup). Se o `code` já tiver sido consumido na 1ª tentativa,
   * o retry falha com `invalid_grant` — erro claro, não pior que não tentar.
   *
   * @param {Client} client - Client OIDC.
   * @param {string} redirectUri - Redirect URI registrado.
   * @param {Record<string, string>} params - Query params do callback.
   * @param {CallbackChallengeInterface} challenge - Desafio (state/nonce/codeVerifier).
   * @returns {Promise<TokenSet>} Tokens validados.
   */
  private async exchangeCode(
    client: Client,
    redirectUri: string,
    params: Record<string, string>,
    challenge: CallbackChallengeInterface,
  ): Promise<TokenSet> {
    const checks = {
      state: challenge.state,
      nonce: challenge.nonce,
      code_verifier: challenge.codeVerifier,
    };

    try {
      return await client.callback(
        redirectUri,
        params,
        checks,
      );
    } catch (err) {
      if (!this.isTransientNetworkError(err)) {
        throw err;
      }

      return client.callback(
        redirectUri,
        params,
        checks,
      );
    }
  }

  /**
   * Identifica erros transitórios de rede/timeout (dignos de 1 retry).
   *
   * @param {unknown} err - Erro capturado.
   * @returns {boolean} `true` se for timeout/conexão (não um erro de protocolo do IdP).
   */
  private isTransientNetworkError(err: unknown): boolean {
    const message = err instanceof Error
      ? err.message
      : String(err);

    return /timed out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|socket hang up|network/i.test(message);
  }

  /**
   * Inicializa (uma única vez) o Client OIDC a partir do issuer configurado,
   * via discovery, e o cacheia para chamadas subsequentes.
   *
   * @returns {Promise<Client>} Client OIDC pronto para uso.
   */
  private async getClient(): Promise<Client> {
    if (this.client) {
      return this.client;
    }

    const issuerUrl = this.configService.get<string>('auth.oidc.issuerUrl') ?? '';
    const clientId = this.configService.get<string>('auth.oidc.clientId') ?? '';
    const clientSecret = this.configService.get<string>('auth.oidc.clientSecret') ?? '';
    const redirectUri = this.configService.get<string>('auth.oidc.redirectUri') ?? '';

    // Timeout HTTP mais folgado p/ discovery + token exchange (default 3500ms estourava).
    custom.setHttpOptionsDefaults({ timeout: OIDC_HTTP_TIMEOUT_MS });

    // Discovery do issuer do Entra ID (.../v2.0/.well-known/openid-configuration).
    const issuer = await Issuer.discover(issuerUrl);

    this.client = new issuer.Client({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uris: [redirectUri],
      response_types: ['code'],
    });

    return this.client;
  }

  /**
   * Garante que o e-mail pertence ao domínio institucional permitido.
   * Qualquer e-mail fora de `@${allowedDomain}` é rejeitado (comparação
   * case-insensitive). É a fronteira que restringe o acesso à organização.
   *
   * @param {string} email - E-mail extraído das claims do IdP.
   * @returns {void}
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
