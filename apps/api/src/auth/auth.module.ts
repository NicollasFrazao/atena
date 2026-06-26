import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthGuard } from './session.guard';
import { IDENTITY_PROVIDER } from './identity-provider.interface';
import { MicrosoftEntraProvider } from './microsoft-entra.provider';
import { RolesGuard } from './rbac/roles.guard';
import { PermissionsGuard } from './rbac/permissions.guard';

/**
 * Módulo de autenticação (login social institucional via OIDC) + RBAC da Atena.
 *
 * O IdP é plugável: o binding abaixo amarra o token {@link IDENTITY_PROVIDER} ao
 * provider concreto ({@link MicrosoftEntraProvider}, default). Para trocar de IdP
 * (Google Workspace, Keycloak, …), basta trocar `useClass: MicrosoftEntraProvider`
 * por outra implementação da interface {@link IdentityProviderInterface}.
 *
 * Importa o {@link UsersModule} (papéis no banco): o `AuthService` persiste o usuário no login e o
 * `AuthGuard` resolve papéis/permissões/status. Guards globais em ordem: `AuthGuard` (autentica +
 * popula `request.user`) → `RolesGuard` (@Roles, legado/passthrough) → `PermissionsGuard` (@Requires).
 */
@Module({
  imports: [UsersModule],
  controllers: [AuthController],
  providers: [
    // IdP plugável — troque `useClass` para mudar de provedor de identidade.
    {
      provide: IDENTITY_PROVIDER,
      useClass: MicrosoftEntraProvider,
    },
    AuthService,
    AuthGuard,
    RolesGuard,
    PermissionsGuard,
    // Guards globais (ordem importa): autenticação → RBAC por papel → RBAC por permissão.
    {
      provide: APP_GUARD,
      useExisting: AuthGuard,
    },
    {
      provide: APP_GUARD,
      useExisting: RolesGuard,
    },
    {
      provide: APP_GUARD,
      useExisting: PermissionsGuard,
    },
  ],
  exports: [
    AuthService,
    AuthGuard,
    RolesGuard,
    PermissionsGuard,
  ],
})
export class AuthModule {}
