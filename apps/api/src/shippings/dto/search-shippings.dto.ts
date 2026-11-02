import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Max, Min } from 'class-validator';
import { MAX_PAGE_SIZE } from '../../common/pagination';

/** Presets de janela aceitos em `date_range` (atalho; `date_from`/`date_to` têm precedência). */
const SEARCH_DATE_RANGES = [
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
 */
export class SearchShippingsDto {
  /** Telefone em formato E.164 para filtrar (match exato). */
  @IsOptional()
  @IsString()
  phone?: string;

  /** Status final do envio (`delivered`/`failed`/`blocked`/`pending`). */
  @IsOptional()
  @IsString()
  status?: string;

  /** Provedor de envio (filtra por nome do provider). */
  @IsOptional()
  @IsString()
  provider?: string;

  /** Canal do envio: `sms` (SMS Short) ou `sms_flash` (SMS Flash). */
  @IsOptional()
  @IsString()
  channel?: string;

  /**
   * Categoria da falha (`invalid_number`/`unreachable`/`generic_error`/`request_error`/…); casa só envios com falha.
   */
  @IsOptional()
  @IsString()
  error_hint?: string;

  /** Identificador do cliente (match exato). */
  @IsOptional()
  @IsString()
  customer_id?: string;

  /** Id da campanha (match exato); devolve os destinatários daquela campanha. Interno: `correlation_id`. */
  @IsOptional()
  @IsString()
  campaign_id?: string;

  /**
   * Id de um incidente. **Aplicado pelo fluxo do assistente** (o orquestrador detecta `incident_id` e roteia para os ids EXATOS de envios impactados que o detector persistiu — mesma contagem do card do incidente, ignorando janela/dimensão). A busca REST genérica (`ShippingsService.search`) NÃO filtra por ele.
   */
  @IsOptional()
  @IsString()
  incident_id?: string;

  /** Início da janela (ISO 8601, inclusive); filtra por instante de envio. */
  @IsOptional()
  @IsISO8601()
  date_from?: string;

  /** Fim da janela (ISO 8601, exclusivo); filtra por instante de envio. */
  @IsOptional()
  @IsISO8601()
  date_to?: string;

  /** Atalho de janela (`24h`/`7d`/`30d`/`all`); ignorado se `date_from`/`date_to` vierem. */
  @IsOptional()
  @IsIn(SEARCH_DATE_RANGES)
  date_range?: string;

  /** Página (inteiro >= 1; default 1 no serviço). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  /** Itens por página (inteiro entre 1 e 100; default 50 no serviço). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit?: number;
}
