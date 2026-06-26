import { IsIn, IsISO8601, IsOptional, IsString } from 'class-validator';

/**
 * Query de `GET /reports/delivery/export` — janela + filtros do relatório (flat, p/ query string).
 * Espelha a janela/filtros do `generate_delivery_report`; o export traz as mensagens (row-level) do
 * recorte, com o telefone EM CLARO (endpoint auditado, severidade `pii`).
 *
 * @property {string} [date_range] - Preset: `'24h'` (default) | `'7d'` | `'30d'` | `'all'`.
 * @property {string} [date_from] - Início (ISO 8601, inclusive); precedência sobre `date_range`.
 * @property {string} [date_to] - Fim (ISO 8601, exclusivo); precedência sobre `date_range`.
 * @property {string} [customer_id] - Restringe ao cliente.
 * @property {string} [provider] - Restringe ao provedor.
 * @property {string} [status] - Restringe ao status final.
 */
export class DeliveryExportDto {
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
  @IsString()
  customer_id?: string;

  @IsOptional()
  @IsString()
  provider?: string;

  @IsOptional()
  @IsString()
  status?: string;
}
