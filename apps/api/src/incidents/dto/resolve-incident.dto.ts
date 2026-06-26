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
 *
 * @property {ActionCategoryType} action_category - Categoria da ação tomada.
 * @property {string} action_description - Descrição da ação (regra de tamanho no serviço).
 * @property {string} [escalated_to] - Destino do escalonamento (obrigatório se `*_escalated`).
 * @property {string[]} [related_shipping_ids] - IDs de envios relacionados.
 * @property {string[]} [tags] - Tags livres para categorização/auditoria.
 */
export class ResolveIncidentDto {
  @IsIn(ACTION_CATEGORIES)
  action_category!: ActionCategoryType;

  @IsString()
  action_description!: string;

  @IsOptional()
  @IsString()
  escalated_to?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  related_shipping_ids?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}
