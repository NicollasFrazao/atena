import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Exceção de domínio estruturada. Carrega o shape de erro da API `{ error: { code, message } }`.
 *
 * Camadas profundas LANÇAM isto (ou as exceções do Nest); o logging acontece na borda
 * ({@link AllExceptionsFilter}), nunca aqui — assim a PII não vaza para os logs.
 *
 * @see AllExceptionsFilter - formata a resposta e loga na borda.
 */
export class AppException extends HttpException {
  /**
   * @param code - Código estável do erro (ex.: 'not_found', 'conflict'); compõe `error.code`.
   * @param message - Mensagem legível ao consumidor; compõe `error.message`.
   * @param [status] - Status HTTP da resposta (default 400).
   */
  constructor(
    code: string,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
  ) {
    super(
      {
        error: {
          code,
          message,
        },
      },
      status,
    );
  }
}
