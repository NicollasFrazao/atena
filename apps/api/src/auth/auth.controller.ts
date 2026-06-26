import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Request, Response } from 'express';
import type { SessionUserInterface } from '@atena/types';
import { Public } from '../common/public.decorator';
import { AuthService } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import type { AuthenticatedUserInterface } from './identity-provider.interface';

/** Milissegundos em uma hora (TTL do cookie de sessão em ms). */
const HOUR_MS = 60 * 60 * 1000;

/** Validade (ms) do cookie curto de desafio OIDC entre `login` e `callback`. */
const CHALLENGE_MAX_AGE_MS = 10 * 60 * 1000;

/**
 * Endpoints HTTP do login social institucional (OIDC) + sessão por cookie JWT.
 *
 *  - `GET  /auth/login`    → gera o desafio (state/nonce/PKCE), guarda no cookie `atena_oidc`
 *                            e redireciona (302) para o IdP.
 *  - `GET  /auth/callback` → recebe o redirect do IdP, troca o `code` por claims, emite o cookie
 *                            de sessão e redireciona (302) para o frontend.
 *  - `GET  /auth/me`       → devolve o usuário da sessão (rota protegida pelo `AuthGuard`).
 *  - `POST /auth/logout`   → limpa o cookie de sessão (204).
 *
 * Os três passos do fluxo (`login`/`callback`/`logout`) são `@Public()`; `me` é protegido para
 * que o guard popule `request.user` a partir do cookie.
 */
@Controller('auth')
export class AuthController {
  /**
   * @param {AuthService} authService - Orquestra login OIDC e sessão (JWT).
   * @param {ConfigService} config - Nomes/atributos dos cookies e origin do frontend.
   */
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Inicia o login: gera o desafio, persiste-o no cookie curto `atena_oidc` e redireciona (302)
   * o navegador para a URL de autorização do IdP.
   *
   * @param {Response} res - Resposta Express (emite o cookie + redirect).
   * @returns {Promise<void>}
   */
  @Public()
  @Get('login')
  async login(@Res() res: Response): Promise<void> {
    const {
      url,
      challenge,
    } = await this.authService.getLoginUrl();

    res.cookie(
      this.oidcCookieName(),
      this.authService.issueChallengeToken(challenge),
      {
        ...this.cookieOptions(),
        maxAge: CHALLENGE_MAX_AGE_MS,
      },
    );

    res.redirect(
      HttpStatus.FOUND,
      url,
    );
  }

  /**
   * Recebe o redirect do IdP, recupera o desafio do cookie, troca o `code` por claims, emite o
   * cookie de sessão e redireciona (302) o navegador para o frontend.
   *
   * @param {Record<string, string>} query - Query params do callback (`code`, `state`, …).
   * @param {Request} req - Requisição Express (lê o cookie `atena_oidc`).
   * @param {Response} res - Resposta Express (emite o cookie de sessão + redirect).
   * @returns {Promise<void>}
   * @throws {UnauthorizedException} Se o desafio/estado ou as claims forem inválidos.
   */
  @Public()
  @Get('callback')
  async callback(
    @Query() query: Record<string, string>,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const cookies = req.cookies as Record<string, string> | undefined;
    const challenge = this.authService.readChallengeToken(cookies?.[this.oidcCookieName()]);

    const identity = await this.authService.completeLogin(
      query,
      challenge,
    );

    res.clearCookie(
      this.oidcCookieName(),
      this.cookieOptions(),
    );

    res.cookie(
      this.sessionCookieName(),
      this.authService.issueSession(identity),
      {
        ...this.cookieOptions(),
        maxAge: this.ttlHours() * HOUR_MS,
      },
    );

    res.redirect(
      HttpStatus.FOUND,
      this.config.get<string>('auth.webOrigin') ?? '/',
    );
  }

  /**
   * Devolve o usuário autenticado da sessão atual (lido do cookie pelo `AuthGuard`).
   *
   * @param {AuthenticatedUserInterface} user - Usuário injetado por {@link CurrentUser}.
   * @returns {SessionUserInterface} Identidade da sessão (`sub`/`email`/`name`/`roles`).
   */
  @Get('me')
  me(@CurrentUser() user: AuthenticatedUserInterface): SessionUserInterface {
    return user;
  }

  /**
   * Encerra a sessão: limpa o cookie de sessão. Responde com HTTP 204 (No Content).
   *
   * @param {Response} res - Resposta Express (limpa o cookie).
   * @returns {void}
   */
  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@Res({ passthrough: true }) res: Response): void {
    res.clearCookie(
      this.sessionCookieName(),
      this.cookieOptions(),
    );
  }

  /**
   * Atributos comuns dos cookies de auth (HttpOnly + SameSite/Secure da config).
   * `SameSite=None; Secure` é exigido pelo acesso cross-origin (web ↔ api).
   *
   * @returns {CookieOptions} Opções base (sem `maxAge`, definido por cookie).
   */
  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      sameSite: this.config.get<'none' | 'lax' | 'strict'>('auth.session.sameSite') ?? 'none',
      secure: this.config.get<boolean>('auth.session.secure') ?? true,
      path: '/',
    };
  }

  /**
   * @returns {string} Nome do cookie de sessão.
   */
  private sessionCookieName(): string {
    return this.config.get<string>('auth.session.cookieName') ?? 'atena_session';
  }

  /**
   * @returns {string} Nome do cookie curto de desafio OIDC.
   */
  private oidcCookieName(): string {
    return this.config.get<string>('auth.oidcCookieName') ?? 'atena_oidc';
  }

  /**
   * @returns {number} Janela de validade (horas) do cookie de sessão.
   */
  private ttlHours(): number {
    return this.config.get<number>('auth.session.ttlHours') ?? 8;
  }
}
