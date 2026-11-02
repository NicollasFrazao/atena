import { Body, Controller, Get, HttpStatus, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Audit } from '../audit/audit.decorator';
import { streamCsvDownload } from '../common/csv-download';
import { Requires } from '../auth/rbac/requires.decorator';
import { DeliveryExportDto } from './dto/delivery-export.dto';
import { DeliveryReportDto } from './dto/delivery-report.dto';
import { IncidentReportDto } from './dto/incident-report.dto';
import { ReportsService } from './reports.service';

/**
 * Endpoint da tool `generate_delivery_report`, montado sob `/reports`.
 *
 * Anotado com `@Audit('tool_call')`: toda invocação entra no audit log.
 * Resposta em snake_case (contrato §C.4). RBAC via `@Roles` (guards globais).
 *
 * @see ReportsService - lógica de agregação.
 */
@Requires('reports:view')
@Controller('reports')
export class ReportsController {
  /**
   * @param reports - Serviço com a lógica do relatório.
   */
  constructor(private readonly reports: ReportsService) {}

  /**
   * `POST /reports/delivery` — gera o relatório de entregabilidade (`generate_delivery_report`).
   *
   * Registrada no audit log via `@Audit('tool_call')`.
   *
   * @param body - Janela, agrupamento e filtros (validados server-side).
   *
   * @returns Relatório agregado (§C.4).
   */
  @Post('delivery')
  @Audit('tool_call', 'info')
  delivery(@Body() body: DeliveryReportDto) {
    return this.reports.generateDelivery(body);
  }

  /**
   * `POST /reports/delivery/stream` — igual ao `delivery`, mas em **stream SSE**: emite `progress`
   * (etapas da varredura no S3: `mapping` → `reading` X/Y → `querying`) e, ao fim, `result` com o
   * relatório (ou `error`). A tela de Relatórios consome isto para mostrar o progresso em tempo real.
   *
   * @param body - Janela, agrupamento e filtros (validados server-side).
   * @param res - Resposta Express (frames `text/event-stream`).
   *
   * @returns Resolve quando o stream encerra.
   */
  @Post('delivery/stream')
  @Audit('tool_call', 'info')
  async deliveryStream(
    @Body() body: DeliveryReportDto,
    @Res() res: Response,
  ): Promise<void> {
    res.status(HttpStatus.OK);

    res.setHeader(
      'Content-Type',
      'text/event-stream',
    );

    res.setHeader(
      'Cache-Control',
      'no-cache, no-transform',
    );

    res.setHeader(
      'Connection',
      'keep-alive',
    );

    // The frames are JSON inside text/event-stream, never HTML; nosniff keeps a browser from
    // guessing otherwise.
    res.setHeader(
      'X-Content-Type-Options',
      'nosniff',
    );

    res.flushHeaders();

    // Cliente desconectou (fechou a aba, trocou a janela na tela): aborta a varredura no S3 no meio,
    // evitando trabalho desperdiçado no servidor. Após o término normal, o abort é inócuo.
    const controller = new AbortController();

    res.on(
      'close',
      () => { controller.abort(); },
    );

    try {
      const report = await this.reports.generateDelivery(
        body,
        (event) => res.write(`event: progress\ndata: ${JSON.stringify(event)}\n\n`),
        controller.signal,
      );

      res.write(`event: result\ndata: ${JSON.stringify(report)}\n\n`);
    } catch {
      res.write(`event: error\ndata: ${JSON.stringify({
        error: {
          code: 'internal',
          message: 'Falha ao gerar o relatório',
        },
      })}\n\n`);
    } finally {
      res.end();
    }
  }

  /**
   * `GET /reports/delivery/export` — baixa as mensagens do recorte do relatório como CSV.
   *
   * Telefone **EM CLARO**: auditado como `export_report` (severidade `pii`). O CSV é gerado pelo
   * DuckDB (sem teto) e enviado em stream com BOM UTF-8 (Excel pt-BR); o temporário é removido ao fim.
   *
   * @param query - Janela + filtros (mesmos do relatório), flat na query string.
   * @param res - Resposta Express (stream do arquivo).
   */
  @Get('delivery/export')
  // CSV com telefone em claro → exige `pii:reveal` ALÉM de `reports:view`. O PermissionsGuard usa
  // getAllAndOverride: o @Requires do handler SUBSTITUI o da classe, então repetimos `reports:view`.
  @Requires('reports:view', 'pii:reveal')
  @Audit('export_report', 'pii')
  async deliveryExport(
    @Query() query: DeliveryExportDto,
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.reports.exportDelivery(query);

    streamCsvDownload(
      res,
      file,
      'atena-relatorio-entregabilidade.csv',
    );
  }

  /**
   * `POST /reports/incidents` — relatório de incidentes resolvidos (`generate_incident_report`, §C.6).
   *
   * Registrada no audit log via `@Audit('tool_call')`.
   *
   * @param body - Janela e filtros opcionais (validados server-side).
   *
   * @returns Relatório de incidentes (§C.6).
   */
  @Post('incidents')
  @Audit('tool_call', 'info')
  incidents(@Body() body: IncidentReportDto) {
    return this.reports.generateIncident(body);
  }
}
