import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Max, Min } from 'class-validator';

/** Presets de janela aceitos em `date_range` (atalho; `date_from`/`date_to` têm precedência). */
export const SEARCH_DATE_RANGES = [
  '24h',
  '7d',
  '30d',
  'all',
] as const;

/**
 * Query de `search_shippings` (GET /api/shippings/search). Validada server-side via class-validator.
 *
 * Todos os campos são opcionais; os filtros ausentes não restringem a busca.
 * Os nomes seguem snake_case (contrato de borda da API).
 *
 * Janela temporal (sobre o instante de envio): `date_from`/`date_to` (ISO 8601, precisos) têm
 * precedência sobre `date_range` (atalho); sem nenhum, o motor usa a janela default. Estreitar a
 * janela também deixa a consulta mais barata (varre menos partições no S3).
 *
 * @property {string} [phone] - Telefone em formato E.164 para filtrar (match exato).
 * @property {string} [status] - Status final do envio (`delivered`/`failed`/`blocked`/`pending`).
 * @property {string} [provider] - Provedor de envio (filtra por nome do provider).
 * @property {string} [channel] - Canal do envio: `sms` (SMS Short) ou `sms_flash` (SMS Flash).
 * @property {string} [error_hint] - Categoria da falha (`invalid_number`/`unreachable`/`generic_error`/`request_error`/…); casa só envios com falha.
 * @property {string} [customer_id] - Identificador do cliente (match exato).
 * @property {string} [campaign_id] - Id da campanha (match exato); devolve os destinatários daquela campanha. Interno: `correlation_id`.
 * @property {string} [incident_id] - Id de um incidente. **Aplicado pelo fluxo do assistente** (o orquestrador detecta `incident_id` e roteia para os ids EXATOS de envios impactados que o detector persistiu — mesma contagem do card do incidente, ignorando janela/dimensão). A busca REST genérica (`ShippingsService.search`) NÃO filtra por ele.
 * @property {string} [date_from] - Início da janela (ISO 8601, inclusive); filtra por instante de envio.
 * @property {string} [date_to] - Fim da janela (ISO 8601, exclusivo); filtra por instante de envio.
 * @property {string} [date_range] - Atalho de janela (`24h`/`7d`/`30d`/`all`); ignorado se `date_from`/`date_to` vierem.
 * @property {number} [page] - Página (inteiro >= 1; default 1 no serviço).
 * @property {number} [limit] - Itens por página (inteiro entre 1 e 100; default 50 no serviço).
 */
export class SearchShippingsDto {
  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  provider?: string;

  @IsOptional()
  @IsString()
  channel?: string;

  @IsOptional()
  @IsString()
  error_hint?: string;

  @IsOptional()
  @IsString()
  customer_id?: string;

  @IsOptional()
  @IsString()
  campaign_id?: string;

  @IsOptional()
  @IsString()
  incident_id?: string;

  @IsOptional()
  @IsISO8601()
  date_from?: string;

  @IsOptional()
  @IsISO8601()
  date_to?: string;

  @IsOptional()
  @IsIn(SEARCH_DATE_RANGES)
  date_range?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
