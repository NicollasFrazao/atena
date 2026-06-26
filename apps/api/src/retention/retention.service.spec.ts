import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../prisma/prisma.service';
import { RetentionService } from './retention.service';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('RetentionService', () => {
  it('apaga mensagens (antes) e sessões inativas além da janela, pelo mesmo cutoff', async () => {
    const chatMessage = { deleteMany: jest.fn().mockResolvedValue({ count: 12 }) };
    const chatSession = { deleteMany: jest.fn().mockResolvedValue({ count: 3 }) };

    const prisma = {
      chatMessage,
      chatSession,
    } as unknown as PrismaService;

    const config = {
      get: jest.fn((key: string) => (key === 'retention.chatDays'
        ? 90
        : undefined)),
    } as unknown as ConfigService;

    const service = new RetentionService(
      prisma,
      config,
    );

    const now = new Date('2026-06-21T00:00:00Z');
    const summary = await service.run(now);

    expect(summary).toEqual({
      sessions: 3,
      messages: 12,
    });

    const cutoff = new Date(now.getTime() - 90 * DAY_MS);

    // Mensagens removidas pela relação (sessão inativa) ANTES das sessões — a FK é restritiva.
    expect(chatMessage.deleteMany).toHaveBeenCalledWith({
      where: { session: { lastActivity: { lt: cutoff } } },
    });

    expect(chatSession.deleteMany).toHaveBeenCalledWith({
      where: { lastActivity: { lt: cutoff } },
    });

    const messageCall = chatMessage.deleteMany.mock.invocationCallOrder[0];
    const sessionCall = chatSession.deleteMany.mock.invocationCallOrder[0];
    expect(messageCall).toBeLessThan(sessionCall);
  });
});
