import { IsIn } from 'class-validator';
import type { UserStatusType } from '@atena/types';

/**
 * Body de `PATCH /api/admin/users/:id/status` — habilita/desabilita o usuário.
 *
 * @property {UserStatusType} status - `active` | `disabled`.
 */
export class SetStatusDto {
  @IsIn([
    'active',
    'disabled',
  ])
  status!: UserStatusType;
}
