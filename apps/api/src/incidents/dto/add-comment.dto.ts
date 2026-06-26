import {
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Body de `POST /incidents/:id/comment`.
 *
 * @property {string} text - Texto do comentário (1–2000 chars).
 */
export class AddCommentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  text!: string;
}
