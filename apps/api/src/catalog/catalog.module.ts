import { Module } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { CustomersController } from './customers.controller';
import { ProvidersController } from './providers.controller';

/**
 * Módulo de catálogo: agrupa as tools `list_providers` e `list_customers`.
 *
 * Expõe os controllers {@link ProvidersController} (`/providers`) e
 * {@link CustomersController} (`/customers`), e exporta o {@link CatalogService}
 * para reúso por outros módulos.
 */
@Module({
  controllers: [
    ProvidersController,
    CustomersController,
  ],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
