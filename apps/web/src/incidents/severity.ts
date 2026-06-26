import type { IncidentSeverityType } from '@atena/types';

/** Cor da borda/realce por severidade (paridade com o protótipo). */
export const SEVERITY_COLOR: Record<IncidentSeverityType, string> = {
  critical: '#C12722',
  warning: '#E0A500',
  info: '#0052CC',
};

/** Rótulo PT-BR por severidade. */
export const SEVERITY_LABEL: Record<IncidentSeverityType, string> = {
  critical: 'Crítico',
  warning: 'Atenção',
  info: 'Info',
};
