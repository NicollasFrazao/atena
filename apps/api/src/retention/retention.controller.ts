import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { Requires } from '../auth/rbac/requires.decorator';
import {
  RetentionService,
  type RetentionRunSummaryInterface,
} from './retention.service';

/**
 * Gatilho de DEV/ops da retenção (`POST /dev/retention`): roda a limpeza do chat sob demanda
 * (independente do `@Cron`/`retention.enabled`). RBAC via `@Requires('ops:run')`.
 *
 * @see RetentionService - lógica de retenção do chat.
 */
@Requires('ops:run')
@Controller('dev')
export class RetentionController {
  /**
   * @param {RetentionService} retention - Serviço de retenção do chat.
   */
  constructor(private readonly retention: RetentionService) {}

  /**
   * `POST /dev/retention` — roda a retenção imediatamente e devolve as contagens removidas.
   *
   * @returns {Promise<RetentionRunSummaryInterface>} Resumo (sessions/messages).
   */
  @Post('retention')
  @HttpCode(HttpStatus.OK)
  run(): Promise<RetentionRunSummaryInterface> {
    return this.retention.run();
  }
}
