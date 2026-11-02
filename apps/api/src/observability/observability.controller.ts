import {
  Controller,
  Get,
  Query,
} from '@nestjs/common';
import type { ObservabilityInterface } from '@atena/types';
import { Requires } from '../auth/rbac/requires.decorator';
import { ObservabilityService } from './observability.service';

/**
 * Endpoint de observabilidade do assistente (`GET /observability`, página admin).
 * Só leitura de métricas agregadas (sem PII); RBAC via `@Roles`.
 *
 * @see ObservabilityService - agregação a partir do audit log / sessões / WS.
 */
@Requires('observability:view')
@Controller('observability')
export class ObservabilityController {
  /**
   * @param observability - Serviço de métricas do assistente.
   */
  constructor(private readonly observability: ObservabilityService) {}

  /**
   * `GET /observability` — snapshot de métricas básicas do assistente, por janela temporal.
   *
   * @param [window] - Janela (`24h`/`7d`/`30d`/`all`; default `all`).
   *
   * @returns Métricas agregadas (§E, básica).
   */
  @Get()
  snapshot(@Query('window') window?: string): Promise<ObservabilityInterface> {
    return this.observability.snapshot(window);
  }
}
