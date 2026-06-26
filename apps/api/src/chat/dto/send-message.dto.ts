import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * Body de `POST /api/chat/sessions/{id}/messages`. snake_case na borda.
 *
 * @property {string} text - Texto da mensagem do usuário (1–4000 chars).
 */
export class SendMessageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  text!: string;
}
