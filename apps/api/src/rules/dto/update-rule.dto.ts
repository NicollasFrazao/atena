import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator';
import type { DimensionType, IncidentSeverityType } from '@atena/types';

/** Dimensões válidas (espelha {@link DimensionType}). */
const DIMENSIONS: DimensionType[] = [
  'provider',
  'customer',
  'route',
  'global',
];

/** Severidades válidas (espelha {@link IncidentSeverityType}). */
const SEVERITIES: IncidentSeverityType[] = [
  'info',
  'warning',
  'critical',
];

/**
 * Body de `PUT /rules/:id` — campos editáveis na tela de Regras. `rule_type` é
 * imutável (não aceito aqui); todos os campos são opcionais (atualização parcial).
 *
 * @property {number} [threshold] - Novo limiar (≥ 0).
 * @property {DimensionType} [dimension] - Nova dimensão de agregação.
 * @property {number} [window_minutes] - Nova janela em minutos (≥ 1).
 * @property {IncidentSeverityType} [severity] - Nova severidade.
 * @property {boolean} [enabled] - Ativa/desativa a regra.
 */
export class UpdateRuleDto {
  @IsOptional()
  @IsString()
  @Length(
    1,
    120,
  )
  name?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  threshold?: number;

  @IsOptional()
  @IsIn(DIMENSIONS)
  dimension?: DimensionType;

  @IsOptional()
  @IsInt()
  @Min(1)
  window_minutes?: number;

  @IsOptional()
  @IsIn(SEVERITIES)
  severity?: IncidentSeverityType;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  shadow_mode?: boolean;
}
