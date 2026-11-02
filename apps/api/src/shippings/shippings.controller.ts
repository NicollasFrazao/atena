import { Body, Controller, Get, NotFoundException, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { PermissionType } from '@atena/types';
import { resolveWindow } from '../audit-query/window';
import { streamCsvDownload } from '../common/csv-download';
import { Audit } from '../audit/audit.decorator';
import { Requires } from '../auth/rbac/requires.decorator';
import { AnalysisService } from './analysis.service';
import { AnalyzeContentDto } from './dto/analyze-content.dto';
import { SearchShippingsDto } from './dto/search-shippings.dto';
import { TrailQueryDto } from './dto/trail-query.dto';
import { ShippingsService } from './shippings.service';
import { RevealService } from './reveal.service';

/** Permission of the endpoints that return the phone in clear (export and reveal). */
const PII_REVEAL: PermissionType = 'pii:reveal';

/**
 * Endpoints das tools de envios (espelham as tools do LLM), montados sob `/shippings`.
 *
 * Cada handler é anotado com `@Audit('tool_call')`, então toda invocação entra no audit log.
 * As respostas seguem o contrato de borda: snake_case e PII (telefone) mascarada.
 * RBAC: exige papel de suporte (`@Roles`), aplicado pelos guards globais.
 *
 * @see ShippingsService - lógica de busca e trilha.
 * @see AnalysisService - lógica de análise de risco de conteúdo.
 */
@Controller('shippings')
export class ShippingsController {
  /**
   * @param shippings - Serviço com a lógica das tools de busca/trilha.
   * @param analysis - Serviço da tool `analyze_shipping_content`.
   * @param reveal - Serviço de reveal de PII (telefone/conteúdo).
   */
  constructor(
    private readonly shippings: ShippingsService,
    private readonly analysis: AnalysisService,
    private readonly reveal: RevealService,
  ) {}

  /**
   * `GET /shippings/search` — busca paginada de envios (`search_shippings`).
   *
   * Registrada no audit log via `@Audit('tool_call')`.
   *
   * @param query - Filtros e paginação (validados server-side).
   *
   * @returns Envelope paginado de resultados.
   */
  @Get('search')
  @Requires('messages:search')
  @Audit('tool_call', 'info')
  search(@Query() query: SearchShippingsDto) {
    return this.shippings.search(query);
  }

  /**
   * `GET /shippings/export` — exporta TODOS os envios do filtro como CSV (download).
   *
   * Diferente do `search`, o telefone sai **EM CLARO** (export auditado): registrado como
   * `export_report` com severidade `pii`. O CSV é gerado pelo DuckDB (`COPY`, sem teto de linhas) e
   * enviado em stream com BOM UTF-8 (Excel pt-BR) — o arquivo temporário é removido ao fim.
   *
   * @param query - Mesmos filtros do search (paginação ignorada).
   * @param token - Snapshot token of a previous search (`export_token`): while it is valid, the export
   *   reads that exact set; otherwise it falls back to the filter.
   * @param res - Resposta Express (stream do arquivo).
   */
  @Get('export')
  @Requires(PII_REVEAL)
  @Audit('export_report', 'pii')
  async export(
    @Query() query: SearchShippingsDto,
    @Query('token') token: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.shippings.exportCsvFile(
      query,
      token,
    );

    streamCsvDownload(
      res,
      file,
      'atena-envios.csv',
    );
  }

  /**
   * `GET /shippings/:id/trail` — trilha completa de um envio (`get_shipping_trail`).
   *
   * Registrada no audit log via `@Audit('tool_call')`.
   *
   * @param id - Identificador (PK `id`) do envio.
   * @param query - Janela opcional (`date_from`/`date_to`); idealmente a mesma do search
   *   que produziu o `id` (reusa o cache quente e respeita a guarda de data mínima).
   *
   * @returns A trilha do envio (PII mascarada, sem `content_preview`).
   *
   * @throws {NotFoundException} Se o envio não existir; corpo no shape `{ error: { code: 'not_found', message } }`.
   */
  @Get(':id/trail')
  @Requires('messages:trail')
  @Audit('tool_call', 'info')
  async trail(
    @Param('id') id: string,
    @Query() query: TrailQueryDto,
  ) {
    const trail = await this.shippings.getTrail(
      id,
      resolveWindow(query),
    );

    if (!trail) {
      throw new NotFoundException({
        error: {
          code: 'not_found',
          message: 'Mensagem não encontrada',
        },
      });
    }

    return trail;
  }

  /**
   * `POST /shippings/analyze` — análise de risco de conteúdo (`analyze_shipping_content`).
   *
   * Aceita `text` (direto) ou `shipping_id` (resolve o conteúdo via cache `/tmp`↔S3).
   * Registrada no audit log via `@Audit('tool_call')`.
   *
   * @param body - `text` OU `shipping_id` (validado server-side).
   *
   * @returns Score, veredito, categorias e explicação (§C.3).
   */
  @Post('analyze')
  @Requires('messages:search')
  @Audit('tool_call', 'info')
  analyze(@Body() body: AnalyzeContentDto) {
    return this.analysis.analyze(body);
  }

  /**
   * `POST /shippings/:id/reveal-phone` — revela o telefone completo (PII).
   *
   * Auditado como `reveal_phone` (severidade `pii`); o valor vai só na resposta,
   * nunca no audit log.
   *
   * @param id - Id (PK) do envio.
   * @param query - Janela opcional (`date_from`/`date_to`); idealmente a mesma do
   *   search/trilha que produziu o `id` — sem ela, o lookup pontual cai na janela default (~30 dias)
   *   e a varredura fria pode estourar timeout.
   *
   * @returns `{ shipping_id, phone_full }` (não mascarado).
   */
  @Post(':id/reveal-phone')
  @Requires(PII_REVEAL)
  @Audit('reveal_phone', 'pii')
  revealPhone(
    @Param('id') id: string,
    @Query() query: TrailQueryDto,
  ) {
    return this.reveal.revealPhone(
      id,
      resolveWindow(query),
    );
  }

  /**
   * `POST /shippings/:id/reveal-content` — revela o conteúdo bruto (PII), do S3 via `content_ref`.
   *
   * Auditado como `reveal_content` (severidade `pii`).
   *
   * @param id - Id (PK) do envio.
   * @param query - Janela opcional (`date_from`/`date_to`); idealmente a mesma do
   *   search/trilha que produziu o `id` — sem ela, o lookup pontual cai na janela default (~30 dias)
   *   e a varredura fria pode estourar timeout.
   *
   * @returns `{ shipping_id, content_preview }`.
   */
  @Post(':id/reveal-content')
  @Requires(PII_REVEAL)
  @Audit('reveal_content', 'pii')
  revealContent(
    @Param('id') id: string,
    @Query() query: TrailQueryDto,
  ) {
    return this.reveal.revealContent(
      id,
      resolveWindow(query),
    );
  }
}
