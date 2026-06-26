import { Module } from '@nestjs/common';
import { AnalysisService } from './analysis.service';
import { ShippingsController } from './shippings.controller';
import { ShippingsService } from './shippings.service';
import { RevealService } from './reveal.service';

/**
 * Módulo de envios: agrupa as tools `search_shippings`, `get_shipping_trail`
 * e `analyze_shipping_content`, além do reveal de PII (telefone/conteúdo).
 *
 * Expõe o {@link ShippingsController} (endpoints sob `/shippings`) e exporta os
 * serviços ({@link ShippingsService}, {@link AnalysisService}, {@link RevealService})
 * para reúso por outros módulos.
 */
@Module({
  controllers: [ShippingsController],
  providers: [
    ShippingsService,
    AnalysisService,
    RevealService,
  ],
  exports: [
    ShippingsService,
    AnalysisService,
    RevealService,
  ],
})
export class ShippingsModule {}
