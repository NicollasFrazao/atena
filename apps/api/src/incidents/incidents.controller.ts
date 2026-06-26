import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Audit } from '../audit/audit.decorator';
import { streamCsvDownload } from '../common/csv-download';
import { Requires } from '../auth/rbac/requires.decorator';
import { ListIncidentsDto } from './dto/list-incidents.dto';
import { IncidentsService } from './incidents.service';

/**
 * Endpoints read-only de incidentes (tools `list_incidents`/`get_incident`),
 * montados sob `/incidents`. RBAC via `@Roles`; cada leitura entra no audit log.
 *
 * Mudança de estado (ack/resolve/comment) **não** vive aqui — é UI-only, com
 * validação server-side (ver IncidentLifecycleController). O LLM nunca muda estado.
 *
 * @see IncidentsService - leitura/normalização dos incidentes.
 */
@Requires('incidents:view')
@Controller('incidents')
export class IncidentsController {
  /**
   * @param {IncidentsService} incidents - Serviço de leitura de incidentes.
   */
  constructor(private readonly incidents: IncidentsService) {}

  /**
   * `GET /incidents` — lista paginada de incidentes (`list_incidents`, §C.5).
   *
   * @param {ListIncidentsDto} query - Filtros (status/severity/dimension) e paginação.
   * @returns {Promise<PaginatedEnvelopeInterface<IncidentInterface>>} Envelope paginado.
   */
  @Get()
  @Audit('tool_call', 'info')
  list(@Query() query: ListIncidentsDto) {
    return this.incidents.list(query);
  }

  /**
   * `GET /incidents/:id` — incidente + atividades (`get_incident`).
   *
   * @param {string} id - Id do incidente.
   * @returns {Promise<IncidentInterface & { activities: IncidentActivityInterface[] }>} Incidente e atividades.
   */
  @Get(':id')
  @Audit('tool_call', 'info')
  get(@Param('id') id: string) {
    return this.incidents.get(id);
  }

  /**
   * `GET /incidents/:id/shippings` — amostra REAL de envios relacionados ao incidente
   * (busca escopada pela dimensão + janela de detecção). UI-only (detalhe do incidente).
   * `limit` (opcional) aumenta a amostra para o download CSV sob demanda.
   *
   * @param {string} id - Id do incidente.
   * @param {string} [limit] - Tamanho da amostra (default no serviço; teto 5000).
   * @returns {Promise<IncidentShippingsInterface>} Amostra (rows + total) ou `available: false`.
   */
  @Get(':id/shippings')
  @Audit('tool_call', 'info')
  shippings(
    @Param('id') id: string,
    @Query('limit') limit?: string,
  ) {
    return this.incidents.shippings(
      id,
      limit === undefined
        ? undefined
        : Number(limit),
    );
  }

  /**
   * `GET /incidents/:id/shippings/export` — baixa os envios impactados (EXATAMENTE os ids do
   * detector) como CSV. Telefone **EM CLARO**: auditado como `export_report` (severidade `pii`). O CSV
   * é gerado pelo DuckDB e enviado em stream com BOM UTF-8 (Excel pt-BR); o temporário é removido ao fim.
   *
   * @param {string} id - Id do incidente.
   * @param {Response} res - Resposta Express (stream do arquivo).
   * @returns {Promise<void>}
   */
  @Get(':id/shippings/export')
  // CSV com telefone em claro → exige `pii:reveal` ALÉM de `incidents:view`. O PermissionsGuard usa
  // getAllAndOverride: o @Requires do handler SUBSTITUI o da classe, então repetimos `incidents:view`.
  @Requires('incidents:view', 'pii:reveal')
  @Audit('export_report', 'pii')
  async exportShippings(
    @Param('id') id: string,
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.incidents.exportShippingsCsv(id);

    streamCsvDownload(
      res,
      file,
      `atena-incidente-${id}.csv`,
    );
  }
}
