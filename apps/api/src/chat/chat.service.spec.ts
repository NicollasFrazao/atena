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
});
