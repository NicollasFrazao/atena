import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { SupportGateway } from './support.gateway';

/**
 * Módulo de tempo real (Fase 2): gateway socket.io `/ws/support`.
 *
 * Exporta o {@link SupportGateway} para o lifecycle de incidentes (task 2.4) e o
 * detector (task 2.6) empurrarem eventos `incident.*`. `ConfigService` é global;
 * importa o {@link AuthModule} para o gateway validar o cookie de sessão (JWT) no handshake.
 */
@Module({
  imports: [
    AuthModule,
    UsersModule,
  ],
  providers: [SupportGateway],
  exports: [SupportGateway],
})
export class RealtimeModule {}
