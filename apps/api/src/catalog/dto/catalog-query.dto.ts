import { IsIn, IsISO8601, IsOptional, IsString } from 'class-validator';

/**
 * Query das tools de catálogo (`GET /providers`, `GET /customers`). Lista quem teve ATIVIDADE numa
 * janela; sem janela, o serviço usa o período recente confiável (clampado à data mínima). snake_case.
 *
 * @property {string} [date_range] - Atalho de janela: `'24h'` | `'7d'` | `'30d'` | `'all'`.
 * @property {string} [date_from] - Início da janela (ISO 8601, inclusive); precedência sobre `date_range`.
 * @property {string} [date_to] - Fim da janela (ISO 8601, exclusivo); precedência sobre `date_range`.
 * @property {string} [search] - Filtro textual do cliente (match parcial); usado só por `/customers`.
 */
export class CatalogQueryDto {
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
  search?: string;
}
