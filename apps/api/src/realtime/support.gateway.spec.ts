import type { ConfigService } from '@nestjs/config';
import type { AuthService } from '../auth/auth.service';
import type { UsersService } from '../users/users.service';
import { SupportGateway } from './support.gateway';

/** Socket falso com o mínimo usado pelo gateway. */
function mockSocket(handshake: Record<string, unknown>): {
  handshake: Record<string, unknown>;
  data: Record<string, unknown>;
  emit: jest.Mock;
  disconnect: jest.Mock;
} {
  return {
    handshake,
    data: {},
    emit: jest.fn(),
    disconnect: jest.fn(),
  };
}

/** Handshake vazio (sem cookie). */
const EMPTY_HANDSHAKE = {
  auth: {},
  query: {},
  headers: {},
};

/** ConfigService falso: `auth.devBypass` controlável; nome do cookie fixo. */
function mockConfig(devBypass: boolean): ConfigService {
  return {
    get: jest.fn((key: string) => {
      if (key === 'auth.devBypass') {
        return devBypass;
      }

      if (key === 'auth.session.cookieName') {
        return 'atena_session';
      }

      return undefined;
    }),
  } as unknown as ConfigService;
}

/** AuthService falso: `verifySession` programável. */
function mockAuth(verifySession: jest.Mock): AuthService {
  return { verifySession } as unknown as AuthService;
}

/** UsersService falso: `resolveAccess` programável. */
function mockUsers(resolveAccess: jest.Mock): UsersService {
  return { resolveAccess } as unknown as UsersService;
}

describe('SupportGateway', () => {
  it('aceita conexão com dev-bypass e emite connection.status', async () => {
    const gateway = new SupportGateway(
      mockConfig(true),
      mockAuth(jest.fn()),
      mockUsers(jest.fn()),
    );

    const socket = mockSocket(EMPTY_HANDSHAKE);

    await gateway.handleConnection(socket as never);

    expect(socket.disconnect).not.toHaveBeenCalled();

    expect(socket.emit).toHaveBeenCalledWith(
      'connection.status',
      expect.objectContaining({ ok: true }),
    );
  });

  it('recusa conexão sem cookie e sem dev-bypass', async () => {
    const gateway = new SupportGateway(
      mockConfig(false),
      mockAuth(jest.fn()),
      mockUsers(jest.fn()),
    );

    const socket = mockSocket(EMPTY_HANDSHAKE);

    await gateway.handleConnection(socket as never);

    expect(socket.disconnect).toHaveBeenCalled();
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it('autentica pelo cookie de sessão (JWT válido) + papéis do banco', async () => {
    const verifySession = jest.fn().mockReturnValue({
      sub: 'u-1',
      email: 'ana@example.com',
      name: 'Ana',
    });

    const resolveAccess = jest.fn().mockResolvedValue({
      roles: ['support_analyst'],
      status: 'active',
    });

    const gateway = new SupportGateway(
      mockConfig(false),
      mockAuth(verifySession),
      mockUsers(resolveAccess),
    );

    const socket = mockSocket({
      ...EMPTY_HANDSHAKE,
      headers: { cookie: 'atena_session=jwt-abc; other=1' },
    });

    await gateway.handleConnection(socket as never);

    expect(verifySession).toHaveBeenCalledWith('jwt-abc');
    expect(resolveAccess).toHaveBeenCalledWith('u-1');
    expect(socket.disconnect).not.toHaveBeenCalled();

    expect(socket.data.user).toEqual({
      sub: 'u-1',
      roles: ['support_analyst'],
    });
  });

  it('recusa usuário disabled (mesmo com cookie válido)', async () => {
    const verifySession = jest.fn().mockReturnValue({
      sub: 'u-2',
      email: 'b@example.com',
      name: 'B',
    });

    const resolveAccess = jest.fn().mockResolvedValue({
      roles: ['support_analyst'],
      status: 'disabled',
    });

    const gateway = new SupportGateway(
      mockConfig(false),
      mockAuth(verifySession),
      mockUsers(resolveAccess),
    );

    const socket = mockSocket({
      ...EMPTY_HANDSHAKE,
      headers: { cookie: 'atena_session=jwt-x' },
    });

    await gateway.handleConnection(socket as never);

    expect(socket.disconnect).toHaveBeenCalled();
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it('recusa cookie de sessão inválido (verifySession lança)', async () => {
    const verifySession = jest.fn(() => {
      throw new Error('invalid');
    });

    const gateway = new SupportGateway(
      mockConfig(false),
      mockAuth(verifySession),
      mockUsers(jest.fn()),
    );

    const socket = mockSocket({
      ...EMPTY_HANDSHAKE,
      headers: { cookie: 'atena_session=bad' },
    });

    await gateway.handleConnection(socket as never);

    expect(socket.disconnect).toHaveBeenCalled();
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it('broadcast emite o evento pelo nome do `type`', () => {
    const gateway = new SupportGateway(
      mockConfig(false),
      mockAuth(jest.fn()),
      mockUsers(jest.fn()),
    );

    const emit = jest.fn();

    (gateway as unknown as { server: { emit: jest.Mock } }).server = { emit };

    gateway.broadcast({
      type: 'connection.status',
      ok: true,
    });

    expect(emit).toHaveBeenCalledWith(
      'connection.status',
      {
        type: 'connection.status',
        ok: true,
      },
    );
  });
});
