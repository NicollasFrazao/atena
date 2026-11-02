import { Type } from 'class-transformer';
import { IsArray, IsIn, IsISO8601, IsOptional, IsString, ValidateNested } from 'class-validator';

/** Filtros opcionais do relatório de entregabilidade. snake_case na borda. */
export class DeliveryFiltersDto {
  /** Restringe ao cliente. */
  @IsOptional()
  @IsString()
  customer_id?: string;

  /** Restringe ao provedor. */
  @IsOptional()
  @IsString()
  provider?: string;

  /** Restringe ao status final (`delivered` | `failed` | `pending` | `unknown`). */
  @IsOptional()
  @IsString()
  status?: string;
}

/**
 * Body de `generate_delivery_report` (POST /api/reports/delivery). snake_case na borda.
 *
 * Janela: `date_from`/`date_to` (ISO 8601, precisos, têm precedência) OU `date_range` (preset);
 * sem nenhum, default `'24h'`. Janelas largas são mais caras a frio (varrem mais partições no S3).
 */
export class DeliveryReportDto {
  /** Preset: `'24h'` (default) | `'7d'` | `'30d'` | `'all'`. */
  @IsOptional()
  @IsIn([
    '24h',
    '7d',
    '30d',
    'all',
  ])
  date_range?: string;

  /** Início da janela (ISO 8601, inclusive); precedência sobre `date_range`. */
  @IsOptional()
  @IsISO8601()
  date_from?: string;

  /** Fim da janela (ISO 8601, exclusivo); precedência sobre `date_range`. */
  @IsOptional()
  @IsISO8601()
  date_to?: string;

  /** Dimensões de agrupamento (informativo; o relatório sempre quebra por provider). */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  group_by?: string[];

  /** Filtros opcionais (cliente/provider/status). */
  @IsOptional()
  @ValidateNested()
  @Type(() => DeliveryFiltersDto)
  filters?: DeliveryFiltersDto;
}
