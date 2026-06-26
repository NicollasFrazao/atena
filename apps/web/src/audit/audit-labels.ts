import type {
  AuditActionType,
  AuditSeverityType,
} from '@atena/types';

/** Rótulo PT-BR por ação auditada. */
export const ACTION_LABEL: Record<AuditActionType, string> = {
  tool_call: 'Ferramenta executada',
  reveal_phone: 'Telefone revelado',
  reveal_content: 'Conteúdo revelado',
  incident_created: 'Incidente criado',
  incident_ack: 'Incidente reconhecido',
  incident_resolve: 'Incidente resolvido',
  session_start: 'Sessão iniciada',
  export_report: 'Relatório exportado',
  rule_update: 'Regra alterada',
  user_role_update: 'Papéis de usuário alterados',
  user_status_update: 'Status de usuário alterado',
};

/** Ações para o filtro TIPO (com a opção "Todos" tratada à parte). */
export const FILTERABLE_ACTIONS: AuditActionType[] = [
  'tool_call',
  'reveal_phone',
  'reveal_content',
  'incident_created',
  'incident_ack',
  'incident_resolve',
  'session_start',
  'export_report',
  'rule_update',
  'user_role_update',
  'user_status_update',
];

/** Cor de realce por severidade do evento. */
export const SEVERITY_COLOR: Record<AuditSeverityType, string> = {
  info: 'var(--at-fg-muted)',
  warning: '#E0A500',
  pii: '#C12722',
  config: '#0052CC',
};
