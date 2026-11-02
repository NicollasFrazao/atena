import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Longest text accepted for analysis, in characters. */
const CONTENT_TEXT_MAX_LENGTH = 4000;

/**
 * Body de `analyze_shipping_content` (POST /api/shippings/analyze). snake_case na borda.
 *
 * Forneça `text` (conteúdo direto) OU `shipping_id` (o serviço resolve o conteúdo
 * via cache `/tmp`↔S3). Se ambos faltarem, o serviço responde `invalid_request`.
 */
export class AnalyzeContentDto {
  /** Texto a analisar (1–4000 chars). */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(CONTENT_TEXT_MAX_LENGTH)
  text?: string;

  /** Id do envio cujo conteúdo será analisado. */
  @IsOptional()
  @IsString()
  shipping_id?: string;
}
