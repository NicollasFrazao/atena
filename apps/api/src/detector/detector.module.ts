import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module';
import { DetectorController } from './detector.controller';
import { DetectorService } from './detector.service';

/**
 * Módulo do detector de anomalias (Fase 2).
 *
 * Importa o {@link RealtimeModule} para empurrar `incident.created`/`auto_resolved`
 * pelo `SupportGateway`. O `@Interval` exige `ScheduleModule.forRoot()` registrado
 * no `AppModule`. `PrismaService`/`ConfigService` são globais.
 */
@Module({
  imports: [RealtimeModule],
  controllers: [DetectorController],
  providers: [DetectorService],
  exports: [DetectorService],
})
export class DetectorModule {}
