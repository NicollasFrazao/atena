import {
  IsBooleanString,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { AuditActionType, AuditSeverityType } from '@atena/types';
import { MAX_PAGE_SIZE } from '../../common/pagination';

/** Ações válidas (espelha {@link AuditActionType}). */
const ACTIONS: AuditActionType[] = [
  'tool_call',
  'reveal_phone',
  'reveal_content',
  'incident_created',
  'incident_ack',
  'incident_resolve',
  'session_start',
  'export_report',
  'rule_update',
  'user_role_update',
  'user_status_update',
];

/** Severidades válidas (espelha {@link AuditSeverityType}). */
const SEVERITIES: AuditSeverityType[] = [
  'info',
  'warning',
  'pii',
  'config',
];

/** Filtros de `GET /audit` (todos opcionais). `pii_only` (string "true") atalha para `severity=pii`. */
export class ListAuditDto {
  /** Filtra por ação. */
  @IsOptional()
  @IsIn(ACTIONS)
  action?: AuditActionType;

  /** Filtra por severidade. */
  @IsOptional()
  @IsIn(SEVERITIES)
  severity?: AuditSeverityType;

  /** "true" → só acessos a PII. */
  @IsOptional()
  @IsBooleanString()
  pii_only?: string;

  /** Busca textual em `resource`/`detail`. */
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  user_id?: string;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  /** Página (base 1). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  /** Itens por página (≤ 100). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit?: number;
}
