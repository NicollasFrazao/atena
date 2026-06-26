import {
  Global,
  Module,
} from '@nestjs/common';
import { MetricsService } from './metrics.service';

/**
 * Módulo GLOBAL de métricas (DogStatsD). Exporta {@link MetricsService} para emissão
 * best-effort de métricas custom de qualquer feature, sem reimportar o módulo.
 */
@Global()
@Module({
  providers: [MetricsService],
  exports: [MetricsService],
})
export class MetricsModule {}
