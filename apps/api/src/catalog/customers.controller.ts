import { Controller, Get, Query } from '@nestjs/common';
import { Audit } from '../audit/audit.decorator';
import { Requires } from '../auth/rbac/requires.decorator';
import { CatalogService } from './catalog.service';
import { CatalogQueryDto } from './dto/catalog-query.dto';

/**
 * Endpoint da tool `list_customers`, montado sob `/customers`.
 *
 * Anotado com `@Audit('tool_call')`: toda invocação entra no audit log.
 * RBAC: exige papel de suporte (`@Roles`), aplicado pelos guards globais.
 *
 * @see CatalogService - lógica de catálogo.
 */
@Requires('app:use')
@Controller('customers')
export class CustomersController {
  /**
   * @param catalog - Serviço com a lógica das tools de catálogo.
   */
  constructor(private readonly catalog: CatalogService) {}

  /**
   * `GET /customers` — lista os clientes com atividade na janela (`list_customers`).
   *
   * Registrada no audit log via `@Audit('tool_call')`.
   *
   * @param query - Janela opcional (`date_from`/`date_to`/`date_range`) + `search`.
   *
   * @returns Top-N clientes por
   *   volume (`id === name` por ora) + total distinto na janela.
   */
  @Get()
  @Audit('tool_call', 'info')
  list(@Query() query: CatalogQueryDto): Promise<{
    items: {
      id: string;
      name: string
    }[];
    total: number
  }> {
    return this.catalog.listCustomers(query);
  }
}
