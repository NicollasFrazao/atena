import { Module } from '@nestjs/common';
import { UsersService } from './users.service';

/**
 * Módulo de usuários/RBAC. Exporta o {@link UsersService} (upsert de login, resolução de
 * papéis/status com cache, e operações de admin) para o `AuthModule` (guard + login) e o
 * `AdminModule`. `PrismaService` é global.
 */
@Module({
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
