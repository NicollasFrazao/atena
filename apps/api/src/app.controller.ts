import { Controller, Get } from '@nestjs/common';
import { Public } from './common/public.decorator';

/**
 * Controller raiz da API.
 *
 * Expõe o endpoint de healthcheck. Por estar fora do prefixo global `/api`
 * (excluído em {@link bootstrap}), responde em `/health` para sondas de infra.
 */
@Public()
@Controller()
export class AppController {
  /**
   * Healthcheck simples da aplicação.
   *
   * @returns {{ status: string; service: string }} Status fixo `'ok'` e o nome do serviço.
   */
  @Get('health')
  health(): {
    status: string;
    service: string
  } {
    return {
      status: 'ok',
      service: 'atena-api',
    };
  }
}
