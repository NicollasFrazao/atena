import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Módulo global que provê e exporta o {@link PrismaService}.
 *
 * Marcado com `@Global()`: o `PrismaService` fica disponível para injeção em
 * qualquer módulo da aplicação sem precisar reimportar `PrismaModule`.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
