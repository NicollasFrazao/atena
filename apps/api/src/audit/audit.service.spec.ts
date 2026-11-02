import type { PrismaService } from '../prisma/prisma.service';
import { AuditService } from './audit.service';

/** Opaque client address; the service only passes it through. */
const CLIENT_ADDRESS = 'client-address';

const OCCURRED_AT = new Date('2026-06-20T12:30:00Z');

/** Audit row as Prisma returns it (camelCase). */
const AUDIT_ROW = {
  id: 'aud-1',
  occurredAt: OCCURRED_AT,
  userId: 'sub-ana',
  action: 'reveal_phone',
  resource: 'POST /api/shippings/x/reveal',
  detail: 'shipping x',
  severity: 'pii',
  ipAddress: CLIENT_ADDRESS,
  metadata: { shipping_id: 'x' },
};

/** Audit row with no user and no metadata (system event). */
const SYSTEM_ROW = {
  ...AUDIT_ROW,
  id: 'aud-2',
  userId: null,
  ipAddress: null,
  detail: null,
  metadata: null,
};

/**
 * Builds a hand-made Prisma mock with the `auditLog` and `user` delegates used by the service.
 *
 * @param rows - Rows returned by `auditLog.findMany`.
 * @param users - Rows returned by `user.findMany`.
 * @param total - Value returned by `auditLog.count`.
 *
 * @returns The mock and its delegates.
 */
function buildPrisma(
  rows: unknown[] = [],
  users: unknown[] = [],
  total = rows.length,
) {
  const auditLog = {
    create: jest.fn().mockResolvedValue({}),
    findMany: jest.fn().mockResolvedValue(rows),
    count: jest.fn().mockResolvedValue(total),
  };

  const user = { findMany: jest.fn().mockResolvedValue(users) };

  const prisma = {
    auditLog,
    user,
  } as unknown as PrismaService;

  return {
    prisma,
    auditLog,
    user,
  };
}

describe('AuditService', () => {
  describe('record', () => {
    it('inserts the entry as-is into the append-only audit log', async () => {
      const {
        prisma,
        auditLog,
      } = buildPrisma();

      const service = new AuditService(prisma);

      await service.record({
        userId: 'sub-ana',
        action: 'reveal_content',
        resource: 'POST /api/shippings/x/reveal-content',
        severity: 'pii',
        ipAddress: CLIENT_ADDRESS,
        metadata: { shipping_id: 'x' },
      });

      expect(auditLog.create).toHaveBeenCalledWith({
        data: {
          userId: 'sub-ana',
          action: 'reveal_content',
          resource: 'POST /api/shippings/x/reveal-content',
          detail: undefined,
          severity: 'pii',
          ipAddress: CLIENT_ADDRESS,
          metadata: { shipping_id: 'x' },
        },
      });
    });
  });

  describe('list', () => {
    it('defaults to page 1 with 50 items and no filters', async () => {
      const {
        prisma,
        auditLog,
      } = buildPrisma();

      const service = new AuditService(prisma);

      const result = await service.list({});

      expect(auditLog.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: { occurredAt: 'desc' },
        skip: 0,
        take: 50,
      });

      expect(result).toEqual({
        rows: [],
        page: 1,
        total: 0,
        total_pages: 1,
        latency_ms: 0,
      });
    });

    it('maps rows to snake_case and resolves the user name, falling back to the email', async () => {
      const {
        prisma,
        user,
      } = buildPrisma(
        [
          AUDIT_ROW,
          {
            ...AUDIT_ROW,
            id: 'aud-3',
            userId: 'sub-bob',
          },
          SYSTEM_ROW,
        ],
        [
          {
            id: 'sub-ana',
            name: 'Ana',
            email: 'ana@example.com',
          },
          {
            id: 'sub-bob',
            name: '',
            email: 'bob@example.com',
          },
        ],
      );

      const service = new AuditService(prisma);

      const result = await service.list({});

      expect(user.findMany).toHaveBeenCalledWith({
        where: {
          id: {
            in: [
              'sub-ana',
              'sub-bob',
            ],
          },
        },
        select: {
          id: true,
          name: true,
          email: true,
        },
      });

      expect(result.rows[0]).toEqual({
        id: 'aud-1',
        occurred_at: '2026-06-20T12:30:00.000Z',
        user_id: 'sub-ana',
        user_name: 'Ana',
        action: 'reveal_phone',
        resource: 'POST /api/shippings/x/reveal',
        detail: 'shipping x',
        severity: 'pii',
        ip_address: CLIENT_ADDRESS,
        metadata: { shipping_id: 'x' },
      });

      expect(result.rows[1].user_name).toBe('bob@example.com');

      expect(result.rows[2]).toMatchObject({
        user_id: null,
        user_name: null,
        detail: null,
        ip_address: null,
        metadata: null,
      });
    });

    it('keeps user_name null when the sub is not in the users table', async () => {
      const { prisma } = buildPrisma([AUDIT_ROW]);

      const service = new AuditService(prisma);

      const result = await service.list({});

      expect(result.rows[0].user_name).toBeNull();
    });

    it('does not query users when no row has a user id', async () => {
      const {
        prisma,
        user,
      } = buildPrisma([SYSTEM_ROW]);

      const service = new AuditService(prisma);

      await service.list({});

      expect(user.findMany).not.toHaveBeenCalled();
    });

    it('builds the where clause from every filter and paginates', async () => {
      const {
        prisma,
        auditLog,
      } = buildPrisma(
        [],
        [],
        45,
      );

      const service = new AuditService(prisma);

      const result = await service.list({
        action: 'rule_update',
        severity: 'config',
        user_id: 'sub-ana',
        from: '2026-06-01T00:00:00Z',
        to: '2026-06-02T00:00:00Z',
        search: 'rule-7',
        page: 3,
        limit: 20,
      });

      const expectedWhere = {
        action: 'rule_update',
        severity: 'config',
        userId: 'sub-ana',
        occurredAt: {
          gte: new Date('2026-06-01T00:00:00Z'),
          lt: new Date('2026-06-02T00:00:00Z'),
        },
        OR: [
          { resource: { contains: 'rule-7' } },
          { detail: { contains: 'rule-7' } },
        ],
      };

      expect(auditLog.findMany).toHaveBeenCalledWith({
        where: expectedWhere,
        orderBy: { occurredAt: 'desc' },
        skip: 40,
        take: 20,
      });

      expect(auditLog.count).toHaveBeenCalledWith({ where: expectedWhere });

      expect(result).toMatchObject({
        page: 3,
        total: 45,
        total_pages: 3,
      });
    });

    it('pii_only=true overrides the severity filter with pii', async () => {
      const {
        prisma,
        auditLog,
      } = buildPrisma();

      const service = new AuditService(prisma);

      await service.list({
        severity: 'info',
        pii_only: 'true',
      });

      expect(auditLog.findMany.mock.calls[0][0].where).toEqual({ severity: 'pii' });
    });

    it('accepts an open-ended window with only one bound', async () => {
      const {
        prisma,
        auditLog,
      } = buildPrisma();

      const service = new AuditService(prisma);

      await service.list({ from: '2026-06-01T00:00:00Z' });
      await service.list({ to: '2026-06-02T00:00:00Z' });

      expect(auditLog.findMany.mock.calls[0][0].where).toEqual({
        occurredAt: { gte: new Date('2026-06-01T00:00:00Z') },
      });

      expect(auditLog.findMany.mock.calls[1][0].where).toEqual({
        occurredAt: { lt: new Date('2026-06-02T00:00:00Z') },
      });
    });
  });

  describe('exportAll', () => {
    it('returns every matching row (capped at 5000) without pagination', async () => {
      const {
        prisma,
        auditLog,
      } = buildPrisma(
        [AUDIT_ROW],
        [
          {
            id: 'sub-ana',
            name: 'Ana',
            email: 'ana@example.com',
          },
        ],
      );

      const service = new AuditService(prisma);

      const result = await service.exportAll({
        pii_only: 'true',
        page: 9,
      });

      expect(auditLog.findMany).toHaveBeenCalledWith({
        where: { severity: 'pii' },
        orderBy: { occurredAt: 'desc' },
        take: 5000,
      });

      expect(result).toHaveLength(1);
      expect(result[0].user_name).toBe('Ana');
    });
  });

  describe('summary', () => {
    beforeEach(() => {
      jest.useFakeTimers({ now: new Date('2026-06-20T15:45:00Z') });
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('counts today (from UTC midnight), pii accesses, rule changes and total', async () => {
      const {
        prisma,
        auditLog,
      } = buildPrisma();

      auditLog.count
        .mockResolvedValueOnce(7)
        .mockResolvedValueOnce(3)
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(120);

      const service = new AuditService(prisma);

      const result = await service.summary();

      expect(auditLog.count).toHaveBeenCalledWith({
        where: { occurredAt: { gte: new Date('2026-06-20T00:00:00Z') } },
      });

      expect(auditLog.count).toHaveBeenCalledWith({ where: { severity: 'pii' } });
      expect(auditLog.count).toHaveBeenCalledWith({ where: { action: 'rule_update' } });

      expect(result).toEqual({
        today: 7,
        pii: 3,
        rule_changes: 2,
        total: 120,
      });
    });
  });

  describe('users', () => {
    it('lists distinct users with the resolved name, or null when unknown', async () => {
      const {
        prisma,
        auditLog,
      } = buildPrisma(
        [
          { userId: 'sub-ana' },
          { userId: null },
          { userId: 'sub-ghost' },
        ],
        [
          {
            id: 'sub-ana',
            name: 'Ana',
            email: 'ana@example.com',
          },
        ],
      );

      const service = new AuditService(prisma);

      const result = await service.users();

      expect(auditLog.findMany).toHaveBeenCalledWith({
        where: { userId: { not: null } },
        distinct: ['userId'],
        select: { userId: true },
        orderBy: { userId: 'asc' },
      });

      expect(result).toEqual([
        {
          id: 'sub-ana',
          name: 'Ana',
        },
        {
          id: 'sub-ghost',
          name: null,
        },
      ]);
    });
  });
});
