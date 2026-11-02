import {
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/** Longest incident comment accepted, in characters. */
const COMMENT_TEXT_MAX_LENGTH = 2000;

/** Body de `POST /incidents/:id/comment`. */
export class AddCommentDto {
  /** Texto do comentário (1–2000 chars). */
  @IsString()
  @MinLength(1)
  @MaxLength(COMMENT_TEXT_MAX_LENGTH)
  text!: string;
}
