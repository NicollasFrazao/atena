import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Body de `POST /api/chat/sessions`. snake_case na borda.
 *
 * @property {string} [title] - Título inicial opcional da sessão (até 200 chars).
 */
export class CreateSessionDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;
}
