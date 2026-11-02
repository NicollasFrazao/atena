import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { RoleType } from '@atena/types';
import { IS_PUBLIC_KEY } from '../common/public.decorator';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import { ALL_PERMISSIONS, emailInAllowlist, permissionsFor } from './rbac/permissions';
import type { AuthenticatedUserInterface } from './identity-provider.interface';

/** Papéis do usuário stub de dev (acesso total local, sem tocar o banco). */
const DEV_ROLES: RoleType[] = ['admin'];

/**
 * Guard de sessão (global): autentica e popula `request.user`, de onde o {@link CurrentUser} e o
 * `PermissionsGuard` o leem. Roda antes dos guards de autorização. Rotas `@Public()` são liberadas.
 *
 * Resolve a **identidade** pelo cookie de sessão (JWT, via {@link AuthService}) e os
 * **papéis/permissões/status** do banco (via {@link UsersService}, com cache curto) — assim a
 * atribuição/revogação de papéis vale na hora. NÃO bloqueia aqui usuário sem papel/`disabled`
 * (isso é do `PermissionsGuard`): `/auth/me` precisa responder para o front mostrar a tela certa.
 *
 * Fallback de dev: sem cookie e com `auth.devBypass`, resolve um usuário `admin` (acesso total).
 * Em produção (`AUTH_DEV_BYPASS=false`) e sem cookie válido, bloqueia (401).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  /**
   * @param reflector - Lê a marca `@Public()` do handler/controller.
   * @param config - `auth.devBypass`, `auth.allowedDomain`, nome do cookie.
   * @param authService - Verifica o JWT do cookie (identidade).
   * @param users - Resolve papéis/status do banco.
   */
  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
    private readonly authService: AuthService,
    private readonly users: UsersService,
  ) {}

  /**
   * Libera rotas públicas; caso contrário resolve o usuário (cookie + banco, ou stub de dev) e o
   * injeta em `request.user`.
   *
   * @param context - Contexto de execução do NestJS.
   *
   * @returns `true` se a rota é pública ou há usuário resolvido.
   *
   * @throws {UnauthorizedException} Se não for pública e não houver usuário.
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(
      IS_PUBLIC_KEY,
      [
        context.getHandler(),
        context.getClass(),
      ],
    );

    if (isPublic) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<Request & {
        user?: AuthenticatedUserInterface;
        cookies?: Record<string, string>
      }>();

    const user = request.user
      ?? await this.fromSessionCookie(request)
      ?? this.devUser();

    if (!user) {
      throw new UnauthorizedException('Sessão ausente ou inválida.');
    }

    request.user = user;

    return true;
  }

  /**
   * Resolve o usuário a partir do cookie de sessão: identidade (JWT) + papéis/permissões/status
   * (banco). Retorna `undefined` se não houver cookie; cookie inválido/expirado lança 401.
   *
   * @param request - Requisição Express (com `cookies` do cookie-parser).
   *
   * @returns Usuário, ou `undefined` se ausente.
   */
  private async fromSessionCookie(
    request: Omit<Request, 'cookies'> & { cookies?: Partial<Record<string, string>> },
  ): Promise<AuthenticatedUserInterface | undefined> {
    const cookieName = this.config.get<string>('auth.session.cookieName') ?? 'atena_session';
    const token = request.cookies?.[cookieName];

    if (!token) {
      return undefined;
    }

    const identity = this.authService.verifySession(token);
    const access = await this.users.resolveAccess(identity.sub);
    const isSuperAdmin = this.isSuperAdminEmail(identity.email);

    // Super admin (via env): acesso total, sempre ativo e nunca "pendente" (papel admin sintético).
    if (isSuperAdmin) {
      return {
        ...identity,
        roles: [...new Set<RoleType>([
          'admin',
          ...access.roles,
        ])],
        permissions: ALL_PERMISSIONS,
        status: 'active',
        is_super_admin: true,
      };
    }

    return {
      ...identity,
      roles: access.roles,
      permissions: permissionsFor(access.roles),
      status: access.status,
      is_super_admin: false,
    };
  }

  /**
   * Indica se o e-mail é de um super admin (definido só pelo `auth.adminEmails`/env).
   *
   * @param email - E-mail do usuário.
   *
   * @returns `true` se estiver na allowlist de super admins.
   */
  private isSuperAdminEmail(email: string): boolean {
    return emailInAllowlist(
      email,
      this.config.get<string[]>('auth.adminEmails') ?? [],
    );
  }

  /**
   * Usuário stub de desenvolvimento (`admin`), quando `auth.devBypass` está ligado.
   *
   * @returns Usuário de dev, ou `undefined` se o bypass
   *   estiver desligado (produção).
   */
  private devUser(): AuthenticatedUserInterface | undefined {
    if (this.config.get<boolean>('auth.devBypass') !== true) {
      return undefined;
    }

    const domain = this.config.get<string>('auth.allowedDomain') ?? 'example.com';

    return {
      sub: 'dev-user',
      email: `dev@${domain}`,
      name: 'Dev User',
      roles: DEV_ROLES,
      permissions: permissionsFor(DEV_ROLES),
      status: 'active',
      is_super_admin: true,
    };
  }
}
