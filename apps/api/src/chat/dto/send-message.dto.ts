import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Longest chat message accepted, in characters. */
const MESSAGE_TEXT_MAX_LENGTH = 4000;

/** Body de `POST /api/chat/sessions/{id}/messages`. snake_case na borda. */
export class SendMessageDto {
  /** Texto da mensagem do usuário (1–4000 chars). */
  @IsString()
  @IsNotEmpty()
  @MaxLength(MESSAGE_TEXT_MAX_LENGTH)
  text!: string;
}
