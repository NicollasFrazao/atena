import { IsIn, IsISO8601, IsOptional, IsString } from 'class-validator';

/**
 * Query de `GET /reports/delivery/export` — janela + filtros do relatório (flat, p/ query string).
 * Espelha a janela/filtros do `generate_delivery_report`; o export traz as mensagens (row-level) do
 * recorte, com o telefone EM CLARO (endpoint auditado, severidade `pii`).
 */
export class DeliveryExportDto {
  /** Preset: `'24h'` (default) | `'7d'` | `'30d'` | `'all'`. */
  @IsOptional()
  @IsIn([
    '24h',
    '7d',
    '30d',
    'all',
  ])
  date_range?: string;

  /** Início (ISO 8601, inclusive); precedência sobre `date_range`. */
  @IsOptional()
  @IsISO8601()
  date_from?: string;

  /** Fim (ISO 8601, exclusivo); precedência sobre `date_range`. */
  @IsOptional()
  @IsISO8601()
  date_to?: string;

  /** Restringe ao cliente. */
  @IsOptional()
  @IsString()
  customer_id?: string;

  /** Restringe ao provedor. */
  @IsOptional()
  @IsString()
  provider?: string;

  /** Restringe ao status final. */
  @IsOptional()
  @IsString()
  status?: string;
}
