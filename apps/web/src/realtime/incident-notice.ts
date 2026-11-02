import type { IncidentInterface, IncidentSeverityType, WsServerEvent } from '@atena/types';

/**
 * Notificação derivada de um evento do servidor (sem id — o componente atribui a chave).
 *
 * Dois formatos: `incident.created` traz o {@link IncidentInterface} completo (banner rico, com
 * métricas e ações); `incident.auto_resolved` traz só um `text` (faixa simples de informação).
 */
export interface IncidentNoticeInterface {
  severity: IncidentSeverityType;
  /** `true` para crítico: fica até o usuário dispensar (não some sozinho). */
  persist: boolean;
  /** Incidente completo (presente só no `incident.created`) — habilita o banner rico do protótipo. */
  incident?: IncidentInterface;
  /** Texto da faixa simples (presente só no `incident.auto_resolved`). */
  text?: string;
}

/**
 * Mapeia um evento do `/ws/support` em uma notificação de banner — ou `null` quando não há nada a
 * mostrar (`incident.updated` e `connection.status` não viram banner; a conexão vira a faixa).
 *
 * @param event - Evento empurrado pelo servidor.
 *
 * @returns A notificação, ou `null` se o evento não gera banner.
 */
export function eventToNotice(event: WsServerEvent): IncidentNoticeInterface | null {
  if (event.type === 'incident.created') {
    return {
      severity: event.incident.severity,
      persist: event.incident.severity === 'critical',
      incident: event.incident,
    };
  }

  if (event.type === 'incident.auto_resolved') {
    return {
      severity: 'info',
      persist: false,
      text: `Incidente auto-resolvido — ${event.note}`,
    };
  }

  return null;
}

/**
 * Limita a pilha a `max`, descartando as notificações NÃO-persistentes mais antigas primeiro — uma
 * crítica (persistente) nunca é evictada por uma warning/info que chegou depois. Se mesmo só com
 * persistentes ainda exceder `max`, mantém todas (melhor mostrar todos os críticos).
 *
 * @param list - Pilha atual (ordem de chegada).
 * @param max - Teto desejado.
 *
 * @returns A pilha recortada.
 *
 * @template T
 */
export function capNotices<T extends { persist: boolean }>(
  list: T[],
  max: number,
): T[] {
  if (list.length <= max) {
    return list;
  }

  let toDrop = list.length - max;

  return list.filter((notice) => {
    if (
      toDrop > 0
      && !notice.persist
    ) {
      toDrop -= 1;

      return false;
    }

    return true;
  });
}
