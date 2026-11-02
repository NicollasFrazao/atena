import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Observable, tap } from 'rxjs';
import { AUDIT_KEY, type AuditMetaInterface } from './audit.decorator';
import { AuditService } from './audit.service';
import { routePath } from '../common/route-path';

/**
 * Requisição autenticada — `user.sub` é o subject do JWT.
 * Tipagem mínima: o interceptor só lê o que precisa.
 */
interface AuthenticatedRequestInterface extends Request {
  /** Payload mínimo do usuário autenticado; `sub` é o subject do JWT. */
  user?: { sub?: string };
}

/**
 * Interceptor global de auditoria (princípio: tudo é auditado).
 *
 * Lê a metadata `@Audit(...)` do handler. Se presente, grava uma entrada
 * no audit log APÓS o sucesso da execução (via `tap`). Sem metadata, é um
 * passthrough — nenhum custo adicional.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  /**
   * @param reflector - Lê a metadata `@Audit(...)` do handler/classe.
   * @param audit - Serviço append-only usado para gravar a entrada.
   */
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  /**
   * Intercepta a execução do handler. Sem metadata `@Audit`, é passthrough; com
   * metadata, grava a entrada de auditoria APÓS o sucesso (via `tap`), em best-effort
   * (falha de auditoria nunca derruba a requisição). NUNCA loga PII — apenas rota/IDs.
   *
   * @param context - Contexto de execução do NestJS (handler + request).
   * @param next - Próximo passo da cadeia de execução.
   *
   * @returns Stream do handler, com o efeito colateral de auditoria.
   */
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    const meta = this.reflector.getAllAndOverride<AuditMetaInterface | undefined>(
      AUDIT_KEY,
      [
        context.getHandler(),
        context.getClass(),
      ],
    );

    // Sem metadata de auditoria → passa direto.
    if (!meta) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequestInterface>();
    const userId = request.user?.sub;
    const ipAddress = request.ip;
    const resource = this.resolveResource(request);

    return next.handle().pipe(
      tap(() => {
        // Auditoria é best-effort: nunca deve derrubar a requisição (o `.catch` engole o erro);
        // o promise é fire-and-forget de propósito. NUNCA logar PII em claro aqui — apenas rota/IDs.
        this.audit
          .record({
            userId,
            action: meta.action,
            resource,
            severity: meta.severity ?? 'info',
            ipAddress,
          })
          .catch(() => undefined);
      }),
    );
  }

  /**
   * Deriva o `resource` a partir da rota da requisição (sem query string).
   *
   * @param request - Requisição em curso.
   *
   * @returns Recurso no formato `MÉTODO /caminho` (sem query string).
   */
  private resolveResource(request: AuthenticatedRequestInterface): string {
    const method = request.method;
    // `route.path` é o template (ex.: `/shippings/:id`); fallback p/ `request.path` (SEM query
    // string — `originalUrl`/`url` vazariam PII como `phone=...` no campo `resource` do audit).
    const path = routePath(request);

    return `${method} ${path}`;
  }
}
