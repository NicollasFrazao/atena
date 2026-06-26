import { IsISO8601, IsOptional } from 'class-validator';

/**
 * Query de `get_shipping_trail` (GET /api/shippings/:id/trail). Janela opcional (ISO 8601) sobre o
 * instante de envio: idealmente a MESMA do `search_shippings` que produziu o `id`, para cair no cache
 * `/tmp` quente (leitura em ms) e respeitar a guarda de data mínima. Ausente → janela default do motor.
 *
 * @property {string} [date_from] - Início da janela (ISO 8601, inclusive).
 * @property {string} [date_to] - Fim da janela (ISO 8601, exclusivo).
 */
export class TrailQueryDto {
  @IsOptional()
  @IsISO8601()
  date_from?: string;

  @IsOptional()
  @IsISO8601()
  date_to?: string;
}
