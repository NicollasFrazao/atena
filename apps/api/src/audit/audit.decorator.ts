import { SetMetadata } from '@nestjs/common';
import type { AuditActionType, AuditSeverityType } from '@atena/types';

/** Chave de metadata usada pelo AuditInterceptor para localizar a config de auditoria. */
export const AUDIT_KEY = 'audit';

/** Metadata anexada a um handler para indicar que ele deve ser auditado. */
export interface AuditMetaInterface {
  /** Ação auditada quando o handler é executado. */
  action: AuditActionType;
  /** Severidade do evento; o interceptor assume `info` se ausente. */
  severity?: AuditSeverityType;
}

/**
 * Marca um handler (ou classe) para auditoria, anexando a {@link AuditMetaInterface}
 * lida depois pelo `AuditInterceptor`.
 *
 * @param action - Ação a registrar quando o handler executa com sucesso.
 * @param [severity] - Severidade do evento (use `'pii'` para acessos a dados sensíveis).
 *
 * @returns Decorator que anexa a metadata de auditoria.
 *
 * @example
 * ```ts
 * @Audit('reveal_phone', 'pii')
 * revealPhone() { ... }
 * ```
 */
export const Audit = (
  action: AuditActionType,
  severity: AuditSeverityType = 'info',
): MethodDecorator & ClassDecorator =>
  SetMetadata<string, AuditMetaInterface>(
    AUDIT_KEY,
    {
      action,
      severity,
    },
  );
