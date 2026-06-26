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

/**
 * Filtros de `GET /audit` (todos opcionais). `pii_only` (string "true") atalha para `severity=pii`.
 *
 * @property {AuditActionType} [action] - Filtra por ação.
 * @property {AuditSeverityType} [severity] - Filtra por severidade.
 * @property {string} [pii_only] - "true" → só acessos a PII.
 * @property {string} [search] - Busca textual em `resource`/`detail`.
 * @property {number} [page] - Página (base 1).
 * @property {number} [limit] - Itens por página (≤ 100).
 */
export class ListAuditDto {
  @IsOptional()
  @IsIn(ACTIONS)
  action?: AuditActionType;

  @IsOptional()
  @IsIn(SEVERITIES)
  severity?: AuditSeverityType;

  @IsOptional()
  @IsBooleanString()
  pii_only?: string;

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
