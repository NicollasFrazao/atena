import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { SESSION_TITLE_MAX_LENGTH } from './create-session.dto';

/**
 * Body de `PATCH /api/chat/sessions/:id` — atualiza a sessão (título e/ou fixação). Campos opcionais;
 * envia-se só o que muda. snake_case na borda.
 */
export class RenameSessionDto {
  /** Novo título da sessão (1–200 chars). */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(SESSION_TITLE_MAX_LENGTH)
  title?: string;

  /** Fixa/desafixa a sessão no histórico. */
  @IsOptional()
  @IsBoolean()
  pinned?: boolean;
}
