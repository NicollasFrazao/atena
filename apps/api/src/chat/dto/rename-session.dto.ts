import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Body de `PATCH /api/chat/sessions/:id` — atualiza a sessão (título e/ou fixação). Campos opcionais;
 * envia-se só o que muda. snake_case na borda.
 *
 * @property {string} [title] - Novo título da sessão (1–200 chars).
 * @property {boolean} [pinned] - Fixa/desafixa a sessão no histórico.
 */
export class RenameSessionDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsBoolean()
  pinned?: boolean;
}
