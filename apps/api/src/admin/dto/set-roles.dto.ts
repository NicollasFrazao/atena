import { ArrayUnique, IsArray, IsIn } from 'class-validator';
import type { RoleType } from '@atena/types';

/** Papéis válidos do catálogo (validação de entrada). */
const VALID_ROLES: RoleType[] = [
  'admin',
  'support_lead',
  'support_analyst',
  'viewer',
];

/** Body de `PUT /api/admin/users/:id/roles` — define o conjunto de papéis do usuário. */
export class SetRolesDto {
  /** Papéis a atribuir (subconjunto do catálogo; pode ser vazio = revoga tudo). */
  @IsArray()
  @ArrayUnique()
  @IsIn(
    VALID_ROLES,
    { each: true },
  )
  roles!: RoleType[];
}
