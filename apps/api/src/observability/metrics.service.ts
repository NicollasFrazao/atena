import {
  Injectable,
  Logger,
  type OnModuleDestroy,
} from '@nestjs/common';
import { StatsD } from 'hot-shots';

/**
 * Cliente DogStatsD (hot-shots) para métricas custom da Atena no Datadog (via Agent).
 *
 * Best-effort: erros de envio (UDP, agent ausente) são logados em `debug` e NUNCA propagados —
 * não derrubam a request. Métricas levam só contagens/latências e tags não-PII (`tool`/`reason`);
 * o prefixo `atena.` agrupa tudo no Datadog. Host/porta do agent via `DD_AGENT_HOST`/8125.
 */
@Injectable()
export class MetricsService implements OnModuleDestroy {
  private readonly logger = new Logger(MetricsService.name);

  private readonly client = new StatsD({
    host: process.env.DD_AGENT_HOST ?? 'localhost',
    port: 8125,
    prefix: 'atena.',
    globalTags: {
      env: process.env.DD_ENV ?? 'local',
      service: process.env.DD_SERVICE ?? 'atena-api',
    },
    errorHandler: (error) => {
      this.logger.debug(`dogstatsd indisponível: ${error.message}`);
    },
  });

  /**
   * Incrementa um contador (best-effort).
   *
   * @param metric - Nome da métrica (sem o prefixo `atena.`).
   * @param [tags] - Tags não-PII.
   */
  increment(
    metric: string,
    tags?: Record<string, string>,
  ): void {
    this.client.increment(
      metric,
      1,
      tags,
    );
  }

  /**
   * Registra um valor em um histograma (best-effort).
   *
   * @param metric - Nome da métrica (sem o prefixo `atena.`).
   * @param value - Valor observado.
   * @param [tags] - Tags não-PII.
   */
  histogram(
    metric: string,
    value: number,
    tags?: Record<string, string>,
  ): void {
    this.client.histogram(
      metric,
      value,
      tags,
    );
  }

  /**
   * Atualiza um gauge (best-effort).
   *
   * @param metric - Nome da métrica (sem o prefixo `atena.`).
   * @param value - Valor atual.
   * @param [tags] - Tags não-PII.
   */
  gauge(
    metric: string,
    value: number,
    tags?: Record<string, string>,
  ): void {
    this.client.gauge(
      metric,
      value,
      tags,
    );
  }

  /**
   * Fecha o socket UDP do cliente ao destruir o módulo (evita handle pendente em testes).
   */
  onModuleDestroy(): void {
    this.client.close(() => undefined);
  }
}
