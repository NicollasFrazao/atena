import { SetMetadata } from '@nestjs/common';
import type { AuditActionType, AuditSeverityType } from '@atena/types';

/** Chave de metadata usada pelo AuditInterceptor para localizar a config de auditoria. */
export const AUDIT_KEY = 'audit';

/**
 * Metadata anexada a um handler para indicar que ele deve ser auditado.
 *
 * @property {AuditActionType} action - Ação auditada quando o handler é executado.
 * @property {AuditSeverityType} [severity] - Severidade do evento; o interceptor assume `info` se ausente.
 */
export interface AuditMetaInterface {
  action: AuditActionType;
  severity?: AuditSeverityType;
}

/**
 * Marca um handler (ou classe) para auditoria, anexando a {@link AuditMetaInterface}
 * lida depois pelo `AuditInterceptor`.
 *
 * @param {AuditActionType} action - Ação a registrar quando o handler executa com sucesso.
 * @param {AuditSeverityType} [severity='info'] - Severidade do evento (use `'pii'` para acessos a dados sensíveis).
 * @returns {MethodDecorator & ClassDecorator} Decorator que anexa a metadata de auditoria.
 *
 * @example
 *   @Audit('reveal_phone', 'pii')
 *   revealPhone() { ... }
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
