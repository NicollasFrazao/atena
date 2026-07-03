import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  AdminUserInterface,
  RoleType,
  UserStatusType,
} from '@atena/types';
import { PrismaService } from '../prisma/prisma.service';
import { emailInAllowlist } from '../auth/rbac/permissions';
import type { AuthenticatedUserInterface } from '../auth/identity-provider.interface';

/** TTL (ms) do cache de papéis por `sub` — curto para refletir mudanças do admin quase na hora. */
const ROLES_CACHE_TTL_MS = 30_000;

/** Identidade mínima vinda do IdP, usada no upsert de login. */
export interface LoginIdentityInterface {
  sub: string;
  email: string;
  name: string;
}

/** Papéis + status resolvidos do banco (consumido pelo guard). */
export interface ResolvedAccessInterface {
  roles: RoleType[];
  status: UserStatusType;
}

/** Entrada do cache de papéis. */
interface RolesCacheEntryInterface {
  access: ResolvedAccessInterface;
  expiresAt: number;
}

/**
 * Usuários e papéis (RBAC gerenciado no app). Persiste o usuário no login, resolve papéis/status
 * do banco (com cache curto) para o guard, faz o bootstrap do admin (allowlist) e expõe as
 * operações de administração (listar, atribuir papéis, habilitar/desabilitar).
 *
 * @see PrismaService - tabelas `users` / `user_roles`.
 */
@Injectable()
export class UsersService {
  /** Cache em memória de papéis/status por `sub` (TTL curto, invalidado nas mutações do admin). */
  private readonly rolesCache = new Map<string, RolesCacheEntryInterface>();

  /**
   * @param {PrismaService} prisma - Acesso às tabelas de usuários e papéis.
   * @param {ConfigService} config - Allowlist de super admins (`auth.adminEmails`).
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Persiste o usuário no login (upsert por `sub`) e atualiza `lastLoginAt`. Invalida o cache.
   * NÃO concede papéis: o **super admin** é derivado do env (`auth.adminEmails`), não um papel no
   * banco; os demais papéis são atribuídos por um (super) admin pela tela.
   *
   * @param {LoginIdentityInterface} identity - Identidade normalizada do IdP.
   * @returns {Promise<void>}
   */
  async upsertOnLogin(identity: LoginIdentityInterface): Promise<void> {
    await this.prisma.user.upsert({
      where: { id: identity.sub },
      create: {
        id: identity.sub,
        email: identity.email,
        name: identity.name,
        lastLoginAt: new Date(),
      },
      update: {
        email: identity.email,
        name: identity.name,
        lastLoginAt: new Date(),
      },
    });

    this.invalidate(identity.sub);
  }

  /**
   * Resolve papéis + status de um usuário (com cache curto). Usuário inexistente → sem papéis,
   * `active` (cai no gate de acesso pendente).
   *
   * @param {string} sub - Id do usuário (claim `sub`).
   * @returns {Promise<ResolvedAccessInterface>} Papéis e status.
   */
  async resolveAccess(sub: string): Promise<ResolvedAccessInterface> {
    const cached = this.rolesCache.get(sub);

    if (
      cached
      && cached.expiresAt > Date.now()
    ) {
      return cached.access;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: sub },
      include: { roles: true },
    });

    const access: ResolvedAccessInterface = {
      roles: (user?.roles ?? []).map((entry) => entry.role),
      status: (user?.status ?? 'active'),
    };

    this.rolesCache.set(
      sub,
      {
        access,
        expiresAt: Date.now() + ROLES_CACHE_TTL_MS,
      },
    );

    return access;
  }

  /**
   * Invalida o cache de papéis de um `sub` (chamado após mutações do admin / bootstrap).
   *
   * @param {string} sub - Id do usuário.
   * @returns {void}
   */
  invalidate(sub: string): void {
    this.rolesCache.delete(sub);
  }

  /**
   * Lista todos os usuários (tela de admin), mais recentes por último login.
   *
   * @returns {Promise<AdminUserInterface[]>} Usuários com papéis/status.
   */
  async listUsers(): Promise<AdminUserInterface[]> {
    const users = await this.prisma.user.findMany({
      orderBy: { lastLoginAt: 'desc' },
      include: { roles: true },
    });

    return users.map((user) => this.toAdminUser(user));
  }

  /**
   * Substitui o conjunto de papéis de um usuário (sujeito à hierarquia). Invalida o cache.
   *
   * @param {string} sub - Id do usuário-alvo.
   * @param {RoleType[]} roles - Novo conjunto de papéis (deduplicado).
   * @param {AuthenticatedUserInterface} actor - Quem está fazendo a mudança.
   * @returns {Promise<AdminUserInterface>} Usuário atualizado.
   * @throws {NotFoundException} Se o alvo não existir.
   * @throws {ForbiddenException} Se violar a hierarquia (auto-mod, super admin, escopo de admin).
   */
  async setRoles(
    sub: string,
    roles: RoleType[],
    actor: AuthenticatedUserInterface,
  ): Promise<AdminUserInterface> {
    const unique = [...new Set(roles)];
    const target = await this.loadTarget(sub);

    this.assertCanManage(
      actor,
      target,
      unique.includes('admin'),
    );

    await this.prisma.$transaction([
      this.prisma.userRole.deleteMany({ where: { userId: sub } }),
      this.prisma.userRole.createMany({
        data: unique.map((role) => ({
          userId: sub,
          role,
          assignedBy: actor.sub,
        })),
      }),
    ]);

    this.invalidate(sub);

    return this.getAdminUser(sub);
  }

  /**
   * Habilita/desabilita um usuário (sujeito à hierarquia). Invalida o cache.
   *
   * @param {string} sub - Id do usuário-alvo.
   * @param {UserStatusType} status - Novo status.
   * @param {AuthenticatedUserInterface} actor - Quem está fazendo a mudança.
   * @returns {Promise<AdminUserInterface>} Usuário atualizado.
   * @throws {NotFoundException} Se o alvo não existir.
   * @throws {ForbiddenException} Se violar a hierarquia.
   */
  async setStatus(
    sub: string,
    status: UserStatusType,
    actor: AuthenticatedUserInterface,
  ): Promise<AdminUserInterface> {
    const target = await this.loadTarget(sub);

    this.assertCanManage(
      actor,
      target,
      false,
    );

    await this.prisma.user.update({
      where: { id: sub },
      data: { status },
    });

    this.invalidate(sub);

    return this.getAdminUser(sub);
  }

  /**
   * Carrega o alvo (id/email/papéis) para as checagens de hierarquia.
   *
   * @param {string} sub - Id do usuário-alvo.
   * @returns {Promise<{ sub: string; email: string; roles: RoleType[] }>} Dados do alvo.
   * @throws {NotFoundException} Se não existir.
   */
  private async loadTarget(sub: string): Promise<{
    sub: string;
    email: string;
    roles: RoleType[]
  }> {
    const user = await this.prisma.user.findUnique({
      where: { id: sub },
      include: { roles: true },
    });

    if (!user) {
      throw new NotFoundException({
        error: {
          code: 'not_found',
          message: 'Usuário não encontrado',
        },
      });
    }

    return {
      sub: user.id,
      email: user.email,
      roles: user.roles.map((entry) => entry.role),
    };
  }

  /**
   * Aplica a hierarquia de modificações:
   *  - ninguém altera a si mesmo (evita auto-lockout);
   *  - super admins (definidos no env) são imutáveis pela tela;
   *  - só super admin concede/revoga `admin` ou altera quem já é admin.
   *
   * @param {AuthenticatedUserInterface} actor - Quem faz a mudança.
   * @param {{ sub: string; email: string; roles: RoleType[] }} target - Alvo.
   * @param {boolean} grantingAdmin - Se a operação concede o papel `admin`.
   * @returns {void}
   * @throws {ForbiddenException} Em qualquer violação.
   */
  private assertCanManage(
    actor: AuthenticatedUserInterface,
    target: {
      sub: string;
      email: string;
      roles: RoleType[]
    },
    grantingAdmin: boolean,
  ): void {
    if (actor.sub === target.sub) {
      throw new ForbiddenException({
        error: {
          code: 'forbidden_self',
          message: 'Você não pode alterar a própria conta.',
        },
      });
    }

    if (this.isSuperAdminEmail(target.email)) {
      throw new ForbiddenException({
        error: {
          code: 'forbidden_super_admin',
          message: 'Super admins são definidos pelo ambiente e não podem ser alterados aqui.',
        },
      });
    }

    const involvesAdmin = grantingAdmin || target.roles.includes('admin');

    if (
      involvesAdmin
      && !actor.is_super_admin
    ) {
      throw new ForbiddenException({
        error: {
          code: 'forbidden_admin_scope',
          message: 'Apenas super admins podem gerenciar admins.',
        },
      });
    }
  }

  /**
   * Indica se o e-mail é de um super admin (definido só pelo `auth.adminEmails`/env).
   *
   * @param {string} email - E-mail do usuário.
   * @returns {boolean} `true` se for super admin.
   */
  private isSuperAdminEmail(email: string): boolean {
    return emailInAllowlist(
      email,
      this.config.get<string[]>('auth.adminEmails') ?? [],
    );
  }

  /**
   * Lê um usuário e o mapeia para o shape da tela de admin.
   *
   * @param {string} sub - Id do usuário.
   * @returns {Promise<AdminUserInterface>} Usuário (snake_case).
   * @throws {NotFoundException} Se não existir.
   */
  private async getAdminUser(sub: string): Promise<AdminUserInterface> {
    const user = await this.prisma.user.findUnique({
      where: { id: sub },
      include: { roles: true },
    });

    if (!user) {
      throw new NotFoundException({
        error: {
          code: 'not_found',
          message: 'Usuário não encontrado',
        },
      });
    }

    return this.toAdminUser(user);
  }

  /**
   * Mapeia um registro de usuário (com papéis) para {@link AdminUserInterface}.
   *
   * @param {object} user - Usuário do Prisma (com `roles`).
   * @param {string} user.id - Id (sub).
   * @param {string} user.email - E-mail.
   * @param {string} user.name - Nome.
   * @param {string} user.status - Status.
   * @param {Date | null} user.lastLoginAt - Último login.
   * @param {Date} user.createdAt - Criação.
   * @param {{ role: string }[]} user.roles - Papéis.
   * @returns {AdminUserInterface} Shape da tela de admin.
   */
  private toAdminUser(user: {
    id: string;
    email: string;
    name: string;
    status: string;
    lastLoginAt: Date | null;
    createdAt: Date;
    roles: { role: string }[];
  }): AdminUserInterface {
    return {
      sub: user.id,
      email: user.email,
      name: user.name,
      status: user.status as UserStatusType,
      roles: user.roles.map((entry) => entry.role as RoleType),
      is_super_admin: this.isSuperAdminEmail(user.email),
      last_login_at: user.lastLoginAt
        ? user.lastLoginAt.toISOString()
        : null,
      created_at: user.createdAt.toISOString(),
    };
  }
}
