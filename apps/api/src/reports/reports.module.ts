import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

/**
 * Módulo de relatórios: agrupa a tool `generate_delivery_report`.
 *
 * Expõe o {@link ReportsController} (endpoints sob `/reports`) e exporta o
 * {@link ReportsService} para reúso (ex.: futura exportação CSV).
 */
@Module({
  controllers: [ReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
