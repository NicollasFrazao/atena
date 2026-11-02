import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { ChatService } from './chat.service';

describe('ChatService', () => {
  it('cria sessão e retorna { session_id }', async () => {
    const prisma = {
      chatSession: { create: jest.fn().mockResolvedValue({ id: 's-1' }) },
    } as unknown as PrismaService;

    const service = new ChatService(prisma);

    await expect(service.createSession(
      'u1',
      'Título',
    )).resolves.toEqual({ session_id: 's-1' });
  });

  it('lista sessões com contagens derivadas (tool_count, preview, duration)', async () => {
    const prisma = {
      chatSession: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 's-1',
            title: 'T',
            startedAt: new Date('2026-05-28T14:00:00Z'),
            lastActivity: new Date('2026-05-28T14:05:00Z'),
            pinned: false,
            tags: ['a'],
            _count: { incidents: 1 },
            messages: [
              {
                role: 'user',
                content: { text: 'oi' },
              },
              {
                role: 'assistant',
                content: {
                  text: 'ok',
                  tools: [{ name: 'search_shippings' }],
                },
              },
            ],
          },
        ]),
      },
    } as unknown as PrismaService;

    const service = new ChatService(prisma);
    const list = await service.listSessions('u1');

    expect(list[0]).toMatchObject({
      id: 's-1',
      message_count: 2,
      tool_count: 1,
      preview: 'oi',
      duration: '5m',
      has_incident: true,
    });
  });

  it('getMessages: 404 quando a sessão não existe ou não é do usuário', async () => {
    // findFirst com {id, userId} → null: cobre tanto inexistente quanto de outro dono.
    const findFirst = jest.fn().mockResolvedValue(null);

    const prisma = {
      chatSession: { findFirst },
    } as unknown as PrismaService;

    const service = new ChatService(prisma);

    await expect(service.getMessages(
      's-1',
      'outro-user',
    )).rejects.toBeInstanceOf(NotFoundException);

    // O escopo de autorização entra na query (id + userId).
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 's-1',
        userId: 'outro-user',
      },
    }));
  });

  it('getMessages: devolve as mensagens quando a sessão é do dono', async () => {
    const prisma = {
      chatSession: { findFirst: jest.fn().mockResolvedValue({ id: 's-1' }) },
      chatMessage: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'm-1',
            role: 'user',
            content: { text: 'oi' },
            createdAt: new Date('2026-05-28T14:00:00Z'),
          },
        ]),
      },
    } as unknown as PrismaService;

    const service = new ChatService(prisma);

    const messages = await service.getMessages(
      's-1',
      'dono',
    );

    expect(messages).toHaveLength(1);

    expect(messages[0]).toMatchObject({
      id: 'm-1',
      role: 'user',
    });
  });

  it('updateSession: 404 quando a sessão não é do usuário', async () => {
    const update = jest.fn();

    const prisma = {
      chatSession: {
        findFirst: jest.fn().mockResolvedValue(null),
        update,
      },
    } as unknown as PrismaService;

    const service = new ChatService(prisma);

    await expect(service.updateSession(
      's-1',
      'outro-user',
      { title: 'Novo título' },
    )).rejects.toBeInstanceOf(NotFoundException);

    // Não chega a atualizar uma sessão que não é do usuário.
    expect(update).not.toHaveBeenCalled();
  });

  it('createSession stores a null title when none is given', async () => {
    const create = jest.fn().mockResolvedValue({ id: 's-2' });

    const prisma = {
      chatSession: { create },
    } as unknown as PrismaService;

    const service = new ChatService(prisma);

    await expect(service.createSession('u1')).resolves.toEqual({ session_id: 's-2' });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        userId: 'u1',
        title: null,
      },
    }));
  });

  it('updateSession applies only pinned and falls back to the default title when the session has none', async () => {
    const update = jest.fn().mockResolvedValue({
      id: 's-1',
      title: null,
      pinned: true,
    });

    const prisma = {
      chatSession: {
        findFirst: jest.fn().mockResolvedValue({ id: 's-1' }),
        update,
      },
    } as unknown as PrismaService;

    const service = new ChatService(prisma);

    const result = await service.updateSession(
      's-1',
      'u1',
      { pinned: true },
    );

    expect(result).toEqual({
      session_id: 's-1',
      title: 'Nova conversa',
      pinned: true,
    });

    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 's-1' },
      data: { pinned: true },
    }));
  });

  it('updateSession returns the requested title when the row comes back without one', async () => {
    const update = jest.fn().mockResolvedValue({
      id: 's-1',
      title: null,
      pinned: false,
    });

    const prisma = {
      chatSession: {
        findFirst: jest.fn().mockResolvedValue({ id: 's-1' }),
        update,
      },
    } as unknown as PrismaService;

    const service = new ChatService(prisma);

    const result = await service.updateSession(
      's-1',
      'u1',
      { title: 'Provider D failures' },
    );

    expect(result.title).toBe('Provider D failures');

    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: { title: 'Provider D failures' },
    }));
  });

  it('linkIncident upserts the session-incident pair idempotently', async () => {
    const upsert = jest.fn().mockResolvedValue({});

    const prisma = {
      chatSessionIncident: { upsert },
    } as unknown as PrismaService;

    const service = new ChatService(prisma);

    await service.linkIncident(
      's-1',
      'inc-1',
    );

    expect(upsert).toHaveBeenCalledWith({
      where: {
        sessionId_incidentId: {
          sessionId: 's-1',
          incidentId: 'inc-1',
        },
      },
      create: {
        sessionId: 's-1',
        incidentId: 'inc-1',
      },
      update: {},
    });
  });

  it('listSessions tolerates null content, untitled sessions and missing tags', async () => {
    const prisma = {
      chatSession: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 's-1',
            title: null,
            startedAt: new Date('2026-05-28T14:00:00Z'),
            lastActivity: new Date('2026-05-28T16:05:00Z'),
            pinned: true,
            tags: null,
            _count: { incidents: 0 },
            messages: [
              {
                role: 'user',
                content: null,
              },
              {
                role: 'assistant',
                content: { text: 'answer without tools' },
              },
            ],
          },
        ]),
      },
    } as unknown as PrismaService;

    const service = new ChatService(prisma);
    const [item] = await service.listSessions('u1');

    expect(item).toMatchObject({
      id: 's-1',
      title: 'Nova conversa',
      tags: [],
      tool_count: 0,
      preview: '',
      duration: '2h 5m',
      has_incident: false,
      pinned: true,
    });
  });

  it('listSessions uses the title as preview when no user message has text', async () => {
    const prisma = {
      chatSession: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 's-1',
            title: 'Pinned investigation',
            startedAt: new Date('2026-05-28T14:00:00Z'),
            lastActivity: new Date('2026-05-28T14:00:00Z'),
            pinned: false,
            tags: [],
            _count: { incidents: 0 },
            messages: [],
          },
        ]),
      },
    } as unknown as PrismaService;

    const service = new ChatService(prisma);
    const [item] = await service.listSessions('u1');

    expect(item.preview).toBe('Pinned investigation');
    expect(item.duration).toBe('0m');
  });

  it('getMessages replaces null content with an empty text', async () => {
    const prisma = {
      chatSession: { findFirst: jest.fn().mockResolvedValue({ id: 's-1' }) },
      chatMessage: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'm-1',
            role: 'assistant',
            content: null,
            createdAt: new Date('2026-05-28T14:00:00Z'),
          },
        ]),
      },
    } as unknown as PrismaService;

    const service = new ChatService(prisma);

    const messages = await service.getMessages(
      's-1',
      'u1',
    );

    expect(messages[0]).toEqual({
      id: 'm-1',
      role: 'assistant',
      content: { text: '' },
      created_at: '2026-05-28T14:00:00.000Z',
    });
  });

  it('appendMessage persists the message and bumps the session activity', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'm-9' });
    const update = jest.fn().mockResolvedValue({});

    const prisma = {
      chatMessage: { create },
      chatSession: { update },
    } as unknown as PrismaService;

    const service = new ChatService(prisma);

    await expect(service.appendMessage(
      's-1',
      'assistant',
      { text: 'done' },
    )).resolves.toBe('m-9');

    expect(create).toHaveBeenCalledWith({
      data: {
        sessionId: 's-1',
        role: 'assistant',
        content: { text: 'done' },
      },
      select: { id: true },
    });

    expect(update).toHaveBeenCalledWith({
      where: { id: 's-1' },
      data: { lastActivity: expect.any(Date) },
    });
  });
});
