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

/**
 * Mapeia status HTTP → code default do erro (quando a exceção não traz um `error.code`).
 *
 * @param {number} status - Código de status HTTP.
 * @returns {string} Code estável correspondente (ex.: 404 → `'not_found'`); para 5xx sem mapeamento
 *   retorna `'internal_error'`, demais não mapeados retornam `'error'`.
 */
function codeFromStatus(status: number): string {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return 'bad_request';
    case HttpStatus.UNAUTHORIZED:
      return 'unauthorized';
    case HttpStatus.FORBIDDEN:
      return 'forbidden';
    case HttpStatus.NOT_FOUND:
      return 'not_found';
    case HttpStatus.CONFLICT:
      return 'conflict';
    case HttpStatus.UNPROCESSABLE_ENTITY:
      return 'unprocessable_entity';
    default:
      return status >= 500
        ? 'internal_error'
        : 'error';
  }
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
   * @param {unknown} exception - Exceção capturada (HttpException, AppException ou erro inesperado).
   * @param {ArgumentsHost} host - Contexto de execução do Nest, usado para obter `req`/`res`.
   * @returns {void}
   */
  catch(
    exception: unknown,
    host: ArgumentsHost,
  ): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;

    let body: ApiErrorInterface = {
      error: {
        code: 'internal_error',
        message: 'Erro interno',
      },
    };

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const response = exception.getResponse();

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

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
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
