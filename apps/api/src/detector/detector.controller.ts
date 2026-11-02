import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { Requires } from '../auth/rbac/requires.decorator';
import {
  DetectorService,
  type DetectorRunSummaryInterface,
} from './detector.service';

/**
 * Gatilho de DEV do detector (`POST /dev/detect`). Roda um scan sob demanda
 * (independente do `@Interval`/`detect.enabled`) para exercitar o fluxo
 * detectar → criar incidente → push WS em desenvolvimento. RBAC via `@Requires('ops:run')`.
 *
 * @see DetectorService - lógica de detecção e reconciliação.
 */
@Requires('ops:run')
@Controller('dev')
export class DetectorController {
  /**
   * @param detector - Serviço de detecção de anomalias.
   */
  constructor(private readonly detector: DetectorService) {}

  /**
   * `POST /dev/detect` — dispara um scan imediato e devolve as contagens.
   *
   * @returns Resumo (detected/created/auto_resolved).
   */
  @Post('detect')
  @HttpCode(HttpStatus.OK)
  run(): Promise<DetectorRunSummaryInterface> {
    return this.detector.run();
  }
}
