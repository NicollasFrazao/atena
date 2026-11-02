import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { MAX_PAGE_SIZE } from '../../common/pagination';

/** Query de `GET /api/incidents` (tool `list_incidents`, §C.5). snake_case na borda. */
export class ListIncidentsDto {
  /** Status (CSV): `detected,acknowledged,resolved,auto_resolved`. */
  @IsOptional()
  @IsString()
  status?: string;

  /** Severidade (CSV): `critical,warning,info`. */
  @IsOptional()
  @IsString()
  severity?: string;

  /** Tipo de dimensão: `provider|customer|route|global`. */
  @IsOptional()
  @IsString()
  dimension?: string;

  /** `'true'` lista os incidentes em shadow mode (silenciosos); ausente/`'false'` lista os normais. */
  @IsOptional()
  @IsString()
  shadow?: string;

  /** Página (>= 1; default 1). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  /** Itens por página (1–100; default 20). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit?: number;
}
