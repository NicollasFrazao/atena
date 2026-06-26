import { Type } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  ValidateNested,
} from 'class-validator';
import type {
  DimensionType,
  IncidentSeverityType,
} from '@atena/types';

/**
 * Filtros opcionais do relatório de incidentes. snake_case na borda.
 *
 * @property {IncidentSeverityType} [severity] - Restringe à severidade.
 * @property {DimensionType} [dimension] - Restringe ao tipo de dimensão.
 */
export class IncidentReportFiltersDto {
  @IsOptional()
  @IsIn([
    'info',
    'warning',
    'critical',
  ])
  severity?: IncidentSeverityType;

  @IsOptional()
  @IsIn([
    'provider',
    'customer',
    'route',
    'global',
  ])
  dimension?: DimensionType;
}

/**
 * Body de `generate_incident_report` (POST /api/reports/incidents). snake_case na borda.
 *
 * @property {string} [date_range] - Janela: `'24h'` (default) | `'7d'` | `'30d'` | `'all'`.
 * @property {IncidentReportFiltersDto} [filters] - Filtros opcionais (severidade/dimensão).
 */
export class IncidentReportDto {
  @IsOptional()
  @IsIn([
    '24h',
    '7d',
    '30d',
    'all',
  ])
  date_range?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => IncidentReportFiltersDto)
  filters?: IncidentReportFiltersDto;
}
