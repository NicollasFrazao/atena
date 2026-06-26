import { Module } from '@nestjs/common';
import { RetentionController } from './retention.controller';
import { RetentionService } from './retention.service';

/**
 * Módulo de retenção do chat. O `@Cron` exige `ScheduleModule.forRoot()` no `AppModule`;
 * `PrismaService`/`ConfigService` são globais.
 */
@Module({
  controllers: [RetentionController],
  providers: [RetentionService],
  exports: [RetentionService],
})
export class RetentionModule {}
