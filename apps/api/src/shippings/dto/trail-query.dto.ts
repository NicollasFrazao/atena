import { IsISO8601, IsOptional } from 'class-validator';

/**
 * Query de `get_shipping_trail` (GET /api/shippings/:id/trail). Janela opcional (ISO 8601) sobre o
 * instante de envio: idealmente a MESMA do `search_shippings` que produziu o `id`, para cair no cache
 * `/tmp` quente (leitura em ms) e respeitar a guarda de data mínima. Ausente → janela default do motor.
 */
export class TrailQueryDto {
  /** Início da janela (ISO 8601, inclusive). */
  @IsOptional()
  @IsISO8601()
  date_from?: string;

  /** Fim da janela (ISO 8601, exclusivo). */
  @IsOptional()
  @IsISO8601()
  date_to?: string;
}
