import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { AdminController } from './admin.controller';

/**
 * Módulo de administração (`/admin`): gestão de usuários e papéis (RBAC). Reaproveita o
 * {@link UsersService} do {@link UsersModule}. As rotas exigem `users:manage` (papel `admin`).
 */
@Module({
  imports: [UsersModule],
  controllers: [AdminController],
})
export class AdminModule {}
