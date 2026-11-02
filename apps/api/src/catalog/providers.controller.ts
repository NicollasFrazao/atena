import { Controller, Get, Query } from '@nestjs/common';
import { Audit } from '../audit/audit.decorator';
import { Requires } from '../auth/rbac/requires.decorator';
import { CatalogService } from './catalog.service';
import { CatalogQueryDto } from './dto/catalog-query.dto';

/**
 * Endpoint da tool `list_providers`, montado sob `/providers`.
 *
 * Anotado com `@Audit('tool_call')`: toda invocação entra no audit log.
 * RBAC: exige papel de suporte (`@Roles`), aplicado pelos guards globais.
 *
 * @see CatalogService - lógica de catálogo.
 */
@Requires('app:use')
@Controller('providers')
export class ProvidersController {
  /**
   * @param catalog - Serviço com a lógica das tools de catálogo.
   */
  constructor(private readonly catalog: CatalogService) {}

  /**
   * `GET /providers` — lista os provedores com atividade na janela (`list_providers`).
   *
   * Registrada no audit log via `@Audit('tool_call')`.
   *
   * @param query - Janela opcional (`date_from`/`date_to`/`date_range`).
   *
   * @returns Nomes de providers distintos, em ordem ascendente.
   */
  @Get()
  @Audit('tool_call', 'info')
  list(@Query() query: CatalogQueryDto): Promise<string[]> {
    return this.catalog.listProviders(query);
  }
}
