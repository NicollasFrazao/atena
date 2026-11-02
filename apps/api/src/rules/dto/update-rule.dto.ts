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

/** Longest rule name accepted, in characters. */
const RULE_NAME_MAX_LENGTH = 120;

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
 */
export class UpdateRuleDto {
  @IsOptional()
  @IsString()
  @Length(
    1,
    RULE_NAME_MAX_LENGTH,
  )
  name?: string;

  /** Novo limiar (≥ 0). */
  @IsOptional()
  @IsNumber()
  @Min(0)
  threshold?: number;

  /** Nova dimensão de agregação. */
  @IsOptional()
  @IsIn(DIMENSIONS)
  dimension?: DimensionType;

  /** Nova janela em minutos (≥ 1). */
  @IsOptional()
  @IsInt()
  @Min(1)
  window_minutes?: number;

  /** Nova severidade. */
  @IsOptional()
  @IsIn(SEVERITIES)
  severity?: IncidentSeverityType;

  /** Ativa/desativa a regra. */
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  shadow_mode?: boolean;
}
