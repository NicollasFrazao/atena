import { Type } from 'class-transformer';
import { IsArray, IsIn, IsISO8601, IsOptional, IsString, ValidateNested } from 'class-validator';

/**
 * Filtros opcionais do relatório de entregabilidade. snake_case na borda.
 *
 * @property {string} [customer_id] - Restringe ao cliente.
 * @property {string} [provider] - Restringe ao provedor.
 * @property {string} [status] - Restringe ao status final (`delivered` | `failed` | `pending` | `unknown`).
 */
export class DeliveryFiltersDto {
  @IsOptional()
  @IsString()
  customer_id?: string;

  @IsOptional()
  @IsString()
  provider?: string;

  @IsOptional()
  @IsString()
  status?: string;
}

/**
 * Body de `generate_delivery_report` (POST /api/reports/delivery). snake_case na borda.
 *
 * Janela: `date_from`/`date_to` (ISO 8601, precisos, têm precedência) OU `date_range` (preset);
 * sem nenhum, default `'24h'`. Janelas largas são mais caras a frio (varrem mais partições no S3).
 *
 * @property {string} [date_range] - Preset: `'24h'` (default) | `'7d'` | `'30d'` | `'all'`.
 * @property {string} [date_from] - Início da janela (ISO 8601, inclusive); precedência sobre `date_range`.
 * @property {string} [date_to] - Fim da janela (ISO 8601, exclusivo); precedência sobre `date_range`.
 * @property {string[]} [group_by] - Dimensões de agrupamento (informativo; o relatório sempre quebra por provider).
 * @property {DeliveryFiltersDto} [filters] - Filtros opcionais (cliente/provider/status).
 */
export class DeliveryReportDto {
  @IsOptional()
  @IsIn([
    '24h',
    '7d',
    '30d',
    'all',
  ])
  date_range?: string;

  @IsOptional()
  @IsISO8601()
  date_from?: string;

  @IsOptional()
  @IsISO8601()
  date_to?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  group_by?: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => DeliveryFiltersDto)
  filters?: DeliveryFiltersDto;
}
