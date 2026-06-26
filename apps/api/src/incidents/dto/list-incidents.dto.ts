import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * Query de `GET /api/incidents` (tool `list_incidents`, §C.5). snake_case na borda.
 *
 * @property {string} [status] - Status (CSV): `detected,acknowledged,resolved,auto_resolved`.
 * @property {string} [severity] - Severidade (CSV): `critical,warning,info`.
 * @property {string} [dimension] - Tipo de dimensão: `provider|customer|route|global`.
 * @property {string} [shadow] - `'true'` lista os incidentes em shadow mode (silenciosos); ausente/`'false'` lista os normais.
 * @property {number} [page] - Página (>= 1; default 1).
 * @property {number} [limit] - Itens por página (1–100; default 20).
 */
export class ListIncidentsDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  severity?: string;

  @IsOptional()
  @IsString()
  dimension?: string;

  @IsOptional()
  @IsString()
  shadow?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
