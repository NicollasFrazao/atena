import { IsOptional, IsString, MaxLength } from 'class-validator';

/** Longest session title accepted on creation and rename, in characters. */
export const SESSION_TITLE_MAX_LENGTH = 200;

/** Body de `POST /api/chat/sessions`. snake_case na borda. */
export class CreateSessionDto {
  /** Título inicial opcional da sessão (até 200 chars). */
  @IsOptional()
  @IsString()
  @MaxLength(SESSION_TITLE_MAX_LENGTH)
  title?: string;
}
