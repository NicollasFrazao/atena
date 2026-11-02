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

/** Filtros opcionais do relatório de incidentes. snake_case na borda. */
export class IncidentReportFiltersDto {
  /** Restringe à severidade. */
  @IsOptional()
  @IsIn([
    'info',
    'warning',
    'critical',
  ])
  severity?: IncidentSeverityType;

  /** Restringe ao tipo de dimensão. */
  @IsOptional()
  @IsIn([
    'provider',
    'customer',
    'route',
    'global',
  ])
  dimension?: DimensionType;
}

/** Body de `generate_incident_report` (POST /api/reports/incidents). snake_case na borda. */
export class IncidentReportDto {
  /** Janela: `'24h'` (default) | `'7d'` | `'30d'` | `'all'`. */
  @IsOptional()
  @IsIn([
    '24h',
    '7d',
    '30d',
    'all',
  ])
  date_range?: string;

  /** Filtros opcionais (severidade/dimensão). */
  @IsOptional()
  @ValidateNested()
  @Type(() => IncidentReportFiltersDto)
  filters?: IncidentReportFiltersDto;
}
