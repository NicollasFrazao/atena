import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
} from 'class-validator';
import type { ActionCategoryType } from '@atena/types';

/** Categorias válidas de ação ao resolver (espelha {@link ActionCategoryType}). */
const ACTION_CATEGORIES: ActionCategoryType[] = [
  'provider_recovered',
  'provider_escalated',
  'internal_escalated',
  'false_positive',
  'customer_communicated',
  'monitoring_only',
  'other',
];

/**
 * Body de `POST /incidents/:id/resolve` (§D). snake_case na borda.
 *
 * As regras de negócio que dependem do estado atual (tamanho mínimo de
 * `action_description` e obrigatoriedade de `escalated_to`) são validadas no
 * serviço, não aqui — este DTO valida só a forma.
 */
export class ResolveIncidentDto {
  /** Categoria da ação tomada. */
  @IsIn(ACTION_CATEGORIES)
  action_category!: ActionCategoryType;

  /** Descrição da ação (regra de tamanho no serviço). */
  @IsString()
  action_description!: string;

  /** Destino do escalonamento (obrigatório se `*_escalated`). */
  @IsOptional()
  @IsString()
  escalated_to?: string;

  /** IDs de envios relacionados. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  related_shipping_ids?: string[];

  /** Tags livres para categorização/auditoria. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}
