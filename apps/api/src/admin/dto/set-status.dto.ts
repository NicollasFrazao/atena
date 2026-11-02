import { IsIn } from 'class-validator';
import type { UserStatusType } from '@atena/types';

/** Body de `PATCH /api/admin/users/:id/status` — habilita/desabilita o usuário. */
export class SetStatusDto {
  /** `active` | `disabled`. */
  @IsIn([
    'active',
    'disabled',
  ])
  status!: UserStatusType;
}
