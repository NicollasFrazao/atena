import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Put,
} from '@nestjs/common';
import type {
  AdminUserInterface,
  RoleCatalogItemInterface,
} from '@atena/types';
import { Audit } from '../audit/audit.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { Requires } from '../auth/rbac/requires.decorator';
import { roleCatalog } from '../auth/rbac/permissions';
import type { AuthenticatedUserInterface } from '../auth/identity-provider.interface';
import { UsersService } from '../users/users.service';
import { SetRolesDto } from './dto/set-roles.dto';
import { SetStatusDto } from './dto/set-status.dto';

/**
 * Administração de usuários e papéis (`/admin`), restrita a `users:manage` (papel `admin`).
 * As mutações são auditadas (ator = `sub` do admin, lido pelo interceptor).
 *
 * @see UsersService - persistência e cache de papéis/status.
 */
@Requires('users:manage')
@Controller('admin')
export class AdminController {
  /**
   * @param {UsersService} users - Serviço de usuários/papéis.
   */
  constructor(private readonly users: UsersService) {}

  /**
   * `GET /admin/users` — lista todos os usuários (status, papéis, último login).
   *
   * @returns {Promise<AdminUserInterface[]>} Usuários.
   */
  @Get('users')
  listUsers(): Promise<AdminUserInterface[]> {
    return this.users.listUsers();
  }

  /**
   * `GET /admin/roles` — catálogo de papéis e as permissões que cada um concede (para a UI).
   *
   * @returns {RoleCatalogItemInterface[]} Papéis disponíveis.
   */
  @Get('roles')
  roles(): RoleCatalogItemInterface[] {
    return roleCatalog();
  }

  /**
   * `PUT /admin/users/:id/roles` — define o conjunto de papéis de um usuário. Auditado.
   *
   * @param {string} id - `sub` do usuário-alvo.
   * @param {SetRolesDto} body - Papéis a atribuir.
   * @param {AuthenticatedUserInterface} [actor] - Admin autenticado (autoria da mudança).
   * @returns {Promise<AdminUserInterface>} Usuário atualizado.
   */
  @Put('users/:id/roles')
  @Audit('user_role_update', 'info')
  setRoles(
    @Param('id') id: string,
    @Body() body: SetRolesDto,
    @CurrentUser() actor: AuthenticatedUserInterface,
  ): Promise<AdminUserInterface> {
    return this.users.setRoles(
      id,
      body.roles,
      actor,
    );
  }

  /**
   * `PATCH /admin/users/:id/status` — habilita/desabilita um usuário. Auditado.
   *
   * @param {string} id - `sub` do usuário-alvo.
   * @param {SetStatusDto} body - Novo status.
   * @param {AuthenticatedUserInterface} actor - Usuário autenticado que executa a ação (autoria/audit).
   * @returns {Promise<AdminUserInterface>} Usuário atualizado.
   */
  @Patch('users/:id/status')
  @Audit('user_status_update', 'info')
  setStatus(
    @Param('id') id: string,
    @Body() body: SetStatusDto,
    @CurrentUser() actor: AuthenticatedUserInterface,
  ): Promise<AdminUserInterface> {
    return this.users.setStatus(
      id,
      body.status,
      actor,
    );
  }
}
