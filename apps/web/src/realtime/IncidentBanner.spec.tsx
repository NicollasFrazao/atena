import { describe, expect, it } from 'vitest';
import type { IncidentInterface, WsServerEvent } from '@atena/types';
import { capNotices, eventToNotice } from './incident-notice';

/** IncidentInterface mínimo para o mapeamento (só severity/summary/dimension_value importam aqui). */
function incident(
  severity: IncidentInterface['severity'],
  summary: string,
  dimensionValue: string,
): IncidentInterface {
  return {
    severity,
    summary,
    dimension_value: dimensionValue,
  } as unknown as IncidentInterface;
}

describe('eventToNotice', () => {
  it('incident.created crítico → banner que PERSISTE, com o incidente completo', () => {
    const created = incident(
      'critical',
      'Queda de entrega',
      'sinch',
    );

    const notice = eventToNotice({
      type: 'incident.created',
      incident: created,
    });

    expect(notice?.severity).toBe('critical');
    expect(notice?.persist).toBe(true);
    expect(notice?.incident).toBe(created); // banner rico recebe o IncidentInterface inteiro
    expect(notice?.text).toBeUndefined();
  });

  it('incident.created warning → não persiste (auto-some)', () => {
    const notice = eventToNotice({
      type: 'incident.created',
      incident: incident(
        'warning',
        'Latência alta',
        'cliente 8349',
      ),
    });

    expect(notice?.severity).toBe('warning');
    expect(notice?.persist).toBe(false);
  });

  it('incident.auto_resolved → info não persistente', () => {
    const notice = eventToNotice({
      type: 'incident.auto_resolved',
      incident_id: 'inc_1',
      resolved_at: '2026-06-19T00:00:00Z',
      note: 'normalizou',
    });

    expect(notice).toEqual({
      severity: 'info',
      text: 'Incidente auto-resolvido — normalizou',
      persist: false,
    });
  });

  it('incident.updated e connection.status NÃO viram banner', () => {
    const updated = eventToNotice({
      type: 'incident.updated',
      incident_id: 'inc_1',
      status: 'acknowledged',
      at: '2026-06-19T00:00:00Z',
    } as WsServerEvent);

    const conn = eventToNotice({
      type: 'connection.status',
      ok: false,
    });

    expect(updated).toBeNull();
    expect(conn).toBeNull();
  });
});

describe('capNotices', () => {
  it('descarta as não-persistentes mais antigas, preservando as críticas', () => {
    const list = [
      {
        key: 1,
        persist: true,
      }, // crítica (chegou primeiro)
      {
        key: 2,
        persist: false,
      },
      {
        key: 3,
        persist: false,
      },
      {
        key: 4,
        persist: false,
      },
    ];

    // teto 2: deve manter a crítica (key 1) + a transiente mais recente (key 4)
    expect(capNotices(
      list,
      2,
    ).map((notice) => notice.key)).toEqual([
      1,
      4,
    ]);
  });

  it('mantém todas se só houver persistentes acima do teto (não evicta crítico)', () => {
    const list = [
      {
        key: 1,
        persist: true,
      },
      {
        key: 2,
        persist: true,
      },
      {
        key: 3,
        persist: true,
      },
    ];

    expect(capNotices(
      list,
      2,
    )).toHaveLength(3);
  });
});
