import { normalizeDimensions, normalizeSeverities, normalizeStatuses } from './incident-filters';

describe('incident-filters', () => {
  describe('normalizeStatuses', () => {
    it('traduz "open"/"aberto" para detected+acknowledged', () => {
      expect(normalizeStatuses('open')).toEqual([
        'detected',
        'acknowledged',
      ]);

      expect(normalizeStatuses('abertos')).toEqual([
        'detected',
        'acknowledged',
      ]);
    });

    it('mantém valores válidos do enum (CSV) e deduplica', () => {
      expect(normalizeStatuses('resolved,auto_resolved')).toEqual([
        'resolved',
        'auto_resolved',
      ]);

      expect(normalizeStatuses('detected,detected')).toEqual(['detected']);
    });

    it('descarta valores inválidos (não estoura no Prisma) → vazio', () => {
      expect(normalizeStatuses('xpto')).toEqual([]);

      // "open" expande e o inválido é ignorado
      expect(normalizeStatuses('open,xpto')).toEqual([
        'detected',
        'acknowledged',
      ]);
    });

    it('é case-insensitive e ignora espaços', () => {
      expect(normalizeStatuses(' Resolved , OPEN ')).toEqual([
        'resolved',
        'detected',
        'acknowledged',
      ]);
    });
  });

  describe('normalizeSeverities', () => {
    it('mantém só severidades válidas', () => {
      expect(normalizeSeverities('critical,foo,info')).toEqual([
        'critical',
        'info',
      ]);

      expect(normalizeSeverities('grave')).toEqual([]);
    });
  });

  describe('normalizeDimensions', () => {
    it('mantém só dimensões válidas', () => {
      expect(normalizeDimensions('customer')).toEqual(['customer']);
      expect(normalizeDimensions('cliente')).toEqual([]);
    });
  });
});
