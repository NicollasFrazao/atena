import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { generators } from 'openid-client';
import { sign, verify, type JwtPayload } from 'jsonwebtoken';
import { UsersService } from '../users/users.service';
import {
  IDENTITY_PROVIDER,
  type AuthenticatedIdentityInterface,
  type CallbackChallengeInterface,
  type IdentityProviderInterface,
} from './identity-provider.interface';

/** Janela padrão (horas) de validade do cookie de sessão, se a config não vier. */
const DEFAULT_TTL_HOURS = 8;

/** Segundos em uma hora (TTL do JWT em segundos). */
const HOUR_SECONDS = 60 * 60;

/** Validade (segundos) do cookie curto de desafio OIDC: o login deve concluir nesse prazo. */
const CHALLENGE_TTL_SECONDS = 10 * 60;

/**
 * Orquestra o fluxo de login social institucional (OIDC) e a sessão (stateless) da Atena.
 *
 * Não conhece o IdP concreto — fala apenas com o {@link IdentityProviderInterface} injetado via
 * token {@link IDENTITY_PROVIDER}, o que mantém o provider totalmente trocável. A sessão é um
 * **JWT assinado** com `auth.sessionSecret`, carregado num cookie pelo controller; aqui ficam a
 * geração do desafio OIDC (state/nonce/PKCE) e a emissão/verificação desse JWT.
 */
@Injectable()
export class AuthService {
  /**
   * @param {IdentityProviderInterface} identityProvider - Provedor de identidade plugável.
   * @param {ConfigService} config - Segredo de sessão, TTL do cookie e allowlist de admin.
   * @param {UsersService} users - Persiste o usuário no login e faz o bootstrap de admin.
   */
  constructor(
    @Inject(IDENTITY_PROVIDER)
    private readonly identityProvider: IdentityProviderInterface,
    private readonly config: ConfigService,
    private readonly users: UsersService,
  ) {}

  /**
   * Inicia o login: gera o desafio anti-CSRF/replay (`state`/`nonce`/PKCE) e monta a URL de
   * autorização do IdP. O `challenge` deve ser persistido pelo controller (cookie curto) para
   * ser validado no callback.
   *
   * @returns {Promise<{ url: string; challenge: CallbackChallengeInterface }>} URL do IdP e o
   *   desafio (state/nonce/codeVerifier) a guardar até o callback.
   */
  async getLoginUrl(): Promise<{
    url: string;
    challenge: CallbackChallengeInterface;
  }> {
    const state = generators.state();
    const nonce = generators.nonce();
    const codeVerifier = generators.codeVerifier();
    const codeChallenge = generators.codeChallenge(codeVerifier);

    const url = await this.identityProvider.getAuthorizationUrl({
      state,
      nonce,
      codeChallenge,
    });

    return {
      url,
      challenge: {
        state,
        nonce,
        codeVerifier,
      },
    };
  }

  /**
   * Conclui o login: delega ao provider a troca do `code` por claims (validando state/nonce/PKCE),
   * **persiste o usuário** (upsert + bootstrap de admin pela allowlist) e devolve a identidade.
   * Os papéis NÃO são resolvidos aqui — o guard os lê do banco a cada requisição.
   *
   * @param {Record<string, string>} params - Query params do callback (`code`, `state`, …).
   * @param {CallbackChallengeInterface} challenge - Desafio original recuperado do cookie.
   * @returns {Promise<AuthenticatedIdentityInterface>} Identidade autenticada e normalizada.
   * @throws {UnauthorizedException} Propagada pelo provider se domínio/claims forem inválidos.
   */
  async completeLogin(
    params: Record<string, string>,
    challenge: CallbackChallengeInterface,
  ): Promise<AuthenticatedIdentityInterface> {
    const identity = await this.identityProvider.handleCallback(
      params,
      challenge,
    );

    await this.users.upsertOnLogin(identity);

    return identity;
  }

  /**
   * Assina o desafio OIDC (`state`/`nonce`/`codeVerifier`) num JWT curto, para o controller
   * guardar no cookie `atena_oidc` entre o `login` e o `callback`.
   *
   * @param {CallbackChallengeInterface} challenge - Desafio gerado em {@link getLoginUrl}.
   * @returns {string} JWT assinado (valor do cookie de desafio).
   */
  issueChallengeToken(challenge: CallbackChallengeInterface): string {
    return sign(
      { ...challenge },
      this.sessionSecret(),
      { expiresIn: CHALLENGE_TTL_SECONDS },
    );
  }

  /**
   * Verifica o cookie de desafio e reconstrói o `state`/`nonce`/`codeVerifier`.
   *
   * @param {string | undefined} token - Valor do cookie `atena_oidc`.
   * @returns {CallbackChallengeInterface} Desafio original.
   * @throws {UnauthorizedException} Se ausente, inválido, expirado ou malformado.
   */
  readChallengeToken(token: string | undefined): CallbackChallengeInterface {
    if (!token) {
      throw new UnauthorizedException('Desafio de login ausente ou expirado.');
    }

    let payload: string | JwtPayload;

    try {
      payload = verify(
        token,
        this.sessionSecret(),
      );
    } catch {
      throw new UnauthorizedException('Desafio de login inválido ou expirado.');
    }

    if (
      typeof payload === 'string'
      || typeof payload.state !== 'string'
      || typeof payload.nonce !== 'string'
      || typeof payload.codeVerifier !== 'string'
    ) {
      throw new UnauthorizedException('Desafio de login malformado.');
    }

    return {
      state: payload.state,
      nonce: payload.nonce,
      codeVerifier: payload.codeVerifier,
    };
  }

  /**
   * Emite a sessão: assina um JWT com a **identidade** (`{ sub, email, name }`) e validade
   * `ttlHours`. Papéis NÃO entram no cookie (são resolvidos do banco a cada requisição).
   *
   * @param {AuthenticatedIdentityInterface} identity - Identidade a serializar na sessão.
   * @returns {string} JWT assinado (valor do cookie de sessão).
   */
  issueSession(identity: AuthenticatedIdentityInterface): string {
    return sign(
      {
        sub: identity.sub,
        email: identity.email,
        name: identity.name,
      },
      this.sessionSecret(),
      { expiresIn: this.ttlHours() * HOUR_SECONDS },
    );
  }

  /**
   * Verifica o JWT do cookie de sessão e reconstrói a identidade.
   *
   * @param {string} token - Valor do cookie de sessão (JWT assinado).
   * @returns {AuthenticatedIdentityInterface} Identidade da sessão.
   * @throws {UnauthorizedException} Se o token for inválido, expirado ou malformado.
   */
  verifySession(token: string): AuthenticatedIdentityInterface {
    let payload: string | JwtPayload;

    try {
      payload = verify(
        token,
        this.sessionSecret(),
      );
    } catch {
      throw new UnauthorizedException('Sessão inválida ou expirada.');
    }

    if (
      typeof payload === 'string'
      || typeof payload.sub !== 'string'
      || typeof payload.email !== 'string'
      || typeof payload.name !== 'string'
    ) {
      throw new UnauthorizedException('Sessão malformada.');
    }

    return {
      sub: payload.sub,
      email: payload.email,
      name: payload.name,
    };
  }

  /**
   * Segredo de assinatura do JWT de sessão.
   *
   * @returns {string} Segredo configurado (`auth.sessionSecret`).
   * @throws {UnauthorizedException} Se o segredo não estiver configurado (evita assinar com '').
   */
  private sessionSecret(): string {
    const secret = this.config.get<string>('auth.sessionSecret') ?? '';

    if (!secret) {
      throw new UnauthorizedException('Sessão indisponível: segredo não configurado.');
    }

    return secret;
  }

  /**
   * Janela de validade (horas) do cookie de sessão.
   *
   * @returns {number} `auth.session.ttlHours` ou o default.
   */
  private ttlHours(): number {
    return this.config.get<number>('auth.session.ttlHours') ?? DEFAULT_TTL_HOURS;
  }
}
