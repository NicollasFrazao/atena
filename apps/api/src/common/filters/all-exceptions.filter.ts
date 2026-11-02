import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ApiErrorInterface } from '@atena/types';

/** First status of the 5xx range, as a plain number (the status read from an exception is a number). */
const SERVER_ERROR_STATUS: number = HttpStatus.INTERNAL_SERVER_ERROR;

/** Default error code of each mapped HTTP status. */
const CODE_BY_STATUS: Partial<Record<number, string>> = {
  [HttpStatus.BAD_REQUEST]: 'bad_request',
  [HttpStatus.UNAUTHORIZED]: 'unauthorized',
  [HttpStatus.FORBIDDEN]: 'forbidden',
  [HttpStatus.NOT_FOUND]: 'not_found',
  [HttpStatus.CONFLICT]: 'conflict',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'unprocessable_entity',
};

/**
 * Mapeia status HTTP → code default do erro (quando a exceção não traz um `error.code`).
 *
 * @param status - Código de status HTTP.
 *
 * @returns Code estável correspondente (ex.: 404 → `'not_found'`); para 5xx sem mapeamento
 *   retorna `'internal_error'`, demais não mapeados retornam `'error'`.
 */
function codeFromStatus(status: number): string {
  const fallback = status >= SERVER_ERROR_STATUS
    ? 'internal_error'
    : 'error';

  return CODE_BY_STATUS[status] ?? fallback;
}

/**
 * LOG BOUNDARY + exceptions estruturadas (filtro global de exceções).
 *
 * Captura tudo, responde no shape `{ error: { code, message } }` e LOGA aqui (na borda) —
 * as camadas profundas apenas lançam. Nunca loga PII (apenas `method + path`, sem query string).
 *
 * Erros 5xx são logados como `error` (com stack); demais como `warn`.
 *
 * @see AppException - exceção de domínio que já chega no shape estruturado.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  /**
   * Trata a exceção: resolve status + corpo `{ error: { code, message } }`, loga na borda
   * (sem PII) e envia a resposta JSON.
   *
   * @param exception - Exceção capturada (HttpException, AppException ou erro inesperado).
   * @param host - Contexto de execução do Nest, usado para obter `req`/`res`.
   */
  catch(
    exception: unknown,
    host: ArgumentsHost,
  ): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;

    let body: ApiErrorInterface = {
      error: {
        code: 'internal_error',
        message: 'Erro interno',
      },
    };

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      // Typed `string | object`, but `new HttpException(null, ...)` (code outside this app) yields null.
      const response = exception.getResponse() as string | object | null;

      if (
        typeof response === 'object'
        && response !== null
        && 'error' in response
      ) {
        // Já estruturado (AppException / quem lançou no shape correto).
        body = response as ApiErrorInterface;
      } else {
        const raw =
          typeof response === 'string'
            ? response
            : (response as { message?: string | string[] }).message;

        const message = Array.isArray(raw)
          ? raw.join('; ')
          : (raw ?? 'Erro');

        body = {
          error: {
            code: codeFromStatus(status),
            message,
          },
        };
      }
    }

    // Borda: loga aqui (sem PII — só método + path, sem query string).
    const where = `${req.method} ${req.path}`;

    if (status >= SERVER_ERROR_STATUS) {
      this.logger.error(
        `${where} → ${status} ${body.error.code}`,
        exception instanceof Error
          ? exception.stack
          : undefined,
      );
    } else {
      this.logger.warn(`${where} → ${status} ${body.error.code}`);
    }

    res.status(status).json(body);
  }
}
