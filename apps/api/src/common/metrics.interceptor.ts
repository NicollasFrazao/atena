import {
  Injectable,
  Logger,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { type Observable, tap } from 'rxjs';
import { routePath } from './route-path';

/**
 * Interceptor global de observabilidade: registra latência e desfecho (ok/erro)
 * de cada requisição HTTP, sem PII.
 *
 * Loga apenas `MÉTODO /rota` (o template da rota, sem query string nem corpo) e a
 * duração em ms — complementando o audit log (compliance) com sinal operacional.
 */
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  private readonly logger = new Logger('Metrics');

  /**
   * Mede a duração do handler e loga o desfecho (sucesso/erro) com a rota e o tempo.
   *
   * @param context - Contexto de execução do NestJS (request HTTP).
   * @param next - Próximo passo da cadeia de execução.
   *
   * @returns Stream do handler, com o efeito colateral de log de métrica.
   */
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    const startedAt = Date.now();
    const request = context.switchToHttp().getRequest<Request>();
    // `route.path` é o template (ex.: `/incidents/:id`); fallback p/ `request.path` (sem query
    // string — `request.url` vazaria parâmetros sensíveis para o log).
    const route = `${request.method} ${routePath(request)}`;

    return next.handle().pipe(
      tap({
        next: () => { this.logger.log(`${route} ${Date.now() - startedAt}ms`); },
        error: () => { this.logger.warn(`${route} erro ${Date.now() - startedAt}ms`); },
      }),
    );
  }
}
