import { ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { AuthenticatedUserInterface } from '../auth/identity-provider.interface';
import type { PrismaService } from '../prisma/prisma.service';
import { UsersService } from './users.service';

const USER_ROW = {
  id: 'u-1',
  email: 'ana@example.com',
  name: 'Ana',
  status: 'active',
  lastLoginAt: new Date('2026-06-21T10:00:00Z'),
  createdAt: new Date('2026-06-01T10:00:00Z'),
  roles: [{ role: 'support_analyst' }],
};

/** ConfigService falso com a allowlist de super admins. */
function config(adminEmails: string[] = []): ConfigService {
  return {
    get: jest.fn((key: string) => (key === 'auth.adminEmails'
      ? adminEmails
      : undefined)),
  } as unknown as ConfigService;
}

/** Ator de teste (super admin ou admin comum). */
function actor(
  sub: string,
  isSuperAdmin: boolean,
): AuthenticatedUserInterface {
  return {
    sub,
    email: `${sub}@example.com`,
    name: sub,
    roles: ['admin'],
    permissions: [],
    status: 'active',
    is_super_admin: isSuperAdmin,
  };
}

const SUPER = actor(
  'super-1',
  true,
);

const ADMIN = actor(
  'adm-1',
  false,
);

describe('UsersService', () => {
  it('upsertOnLogin apenas persiste o usuário (super admin é derivado do env, não papel)', async () => {
    const userUpsert = jest.fn().mockResolvedValue({ id: 'u-1' });
    const roleUpsert = jest.fn();

    const prisma = {
      user: { upsert: userUpsert },
      userRole: { upsert: roleUpsert },
    } as unknown as PrismaService;

    const service = new UsersService(
      prisma,
      config(['boss@example.com']),
    );

    await service.upsertOnLogin({
      sub: 'u-1',
      email: 'boss@example.com',
      name: 'Boss',
    });

    expect(userUpsert).toHaveBeenCalled();
    expect(roleUpsert).not.toHaveBeenCalled(); // não concede papel no banco
  });

  it('resolveAccess mapeia papéis/status e usa cache na 2ª chamada', async () => {
    const findUnique = jest.fn().mockResolvedValue(USER_ROW);
    const prisma = { user: { findUnique } } as unknown as PrismaService;

    const service = new UsersService(
      prisma,
      config(),
    );

    const first = await service.resolveAccess('u-1');
    const second = await service.resolveAccess('u-1');

    expect(first).toEqual({
      roles: ['support_analyst'],
      status: 'active',
    });

    expect(second).toEqual(first);
    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it('listUsers marca is_super_admin pelos e-mails do env', async () => {
    const findMany = jest.fn().mockResolvedValue([
      USER_ROW,
      {
        ...USER_ROW,
        id: 'u-2',
        email: 'boss@example.com',
        roles: [],
      },
    ]);

    const prisma = { user: { findMany } } as unknown as PrismaService;

    const service = new UsersService(
      prisma,
      config(['boss@example.com']),
    );

    const list = await service.listUsers();

    expect(list[0].is_super_admin).toBe(false);
    expect(list[1].is_super_admin).toBe(true);
  });

  it('setRoles: super admin atribui papéis (delete+create) e invalida o cache', async () => {
    const deleteMany = jest.fn().mockReturnValue({ op: 'del' });
    const createMany = jest.fn().mockReturnValue({ op: 'create' });
    const transaction = jest.fn().mockResolvedValue([]);
    const findUnique = jest.fn().mockResolvedValue(USER_ROW);

    const prisma = {
      user: { findUnique },
      userRole: {
        deleteMany,
        createMany,
      },
      $transaction: transaction,
    } as unknown as PrismaService;

    const service = new UsersService(
      prisma,
      config(),
    );

    const result = await service.setRoles(
      'u-1',
      ['support_lead'],
      SUPER,
    );

    expect(createMany).toHaveBeenCalledWith({
      data: [{
        userId: 'u-1',
        role: 'support_lead',
        assignedBy: 'super-1',
      }],
    });

    expect(result.sub).toBe('u-1');
  });

  it('setRoles: bloqueia auto-modificação', async () => {
    const findUnique = jest.fn().mockResolvedValue({
      ...USER_ROW,
      id: 'adm-1',
      email: 'adm-1@example.com',
    });

    const prisma = { user: { findUnique } } as unknown as PrismaService;

    const service = new UsersService(
      prisma,
      config(),
    );

    await expect(service.setRoles(
      'adm-1',
      ['support_lead'],
      ADMIN,
    )).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('setRoles: admin comum NÃO pode conceder o papel admin', async () => {
    const findUnique = jest.fn().mockResolvedValue(USER_ROW);
    const prisma = { user: { findUnique } } as unknown as PrismaService;

    const service = new UsersService(
      prisma,
      config(),
    );

    await expect(service.setRoles(
      'u-1',
      ['admin'],
      ADMIN,
    )).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('setRoles: admin comum NÃO pode alterar quem já é admin', async () => {
    const findUnique = jest.fn().mockResolvedValue({
      ...USER_ROW,
      roles: [{ role: 'admin' }],
    });

    const prisma = { user: { findUnique } } as unknown as PrismaService;

    const service = new UsersService(
      prisma,
      config(),
    );

    await expect(service.setRoles(
      'u-1',
      ['viewer'],
      ADMIN,
    )).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('setStatus: super admin (alvo no env) é imutável, mesmo para outro super admin', async () => {
    const update = jest.fn();

    const findUnique = jest.fn().mockResolvedValue({
      ...USER_ROW,
      id: 'u-2',
      email: 'boss@example.com',
    });

    const prisma = {
      user: {
        findUnique,
        update,
      },
    } as unknown as PrismaService;

    const service = new UsersService(
      prisma,
      config(['boss@example.com']),
    );

    await expect(service.setStatus(
      'u-2',
      'disabled',
      SUPER,
    )).rejects.toBeInstanceOf(ForbiddenException);

    expect(update).not.toHaveBeenCalled();
  });

  it('setStatus: super admin desabilita um usuário comum', async () => {
    const update = jest.fn().mockResolvedValue({});

    const findUnique = jest.fn().mockResolvedValue({
      ...USER_ROW,
      status: 'disabled',
    });

    const prisma = {
      user: {
        findUnique,
        update,
      },
    } as unknown as PrismaService;

    const service = new UsersService(
      prisma,
      config(),
    );

    const result = await service.setStatus(
      'u-1',
      'disabled',
      SUPER,
    );

    expect(update).toHaveBeenCalledWith({
      where: { id: 'u-1' },
      data: { status: 'disabled' },
    });

    expect(result.status).toBe('disabled');
  });
});
