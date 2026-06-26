import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Body de `analyze_shipping_content` (POST /api/shippings/analyze). snake_case na borda.
 *
 * Forneça `text` (conteúdo direto) OU `shipping_id` (o serviço resolve o conteúdo
 * via cache `/tmp`↔S3). Se ambos faltarem, o serviço responde `invalid_request`.
 *
 * @property {string} [text] - Texto a analisar (1–4000 chars).
 * @property {string} [shipping_id] - Id do envio cujo conteúdo será analisado.
 */
export class AnalyzeContentDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  text?: string;

  @IsOptional()
  @IsString()
  shipping_id?: string;
}
