import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type {
  ChatMessageContentInterface,
  ChatMessageInterface,
  ChatSessionListItemInterface,
} from '@atena/types';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Usuário stub enquanto o login OIDC real não está ligado.
 *
 * @todo (auth) obter o `sub` do usuário autenticado (CurrentUser) quando o login real existir.
 */
export const STUB_USER_ID = 'dev-user';

/**
 * Sessões e mensagens de chat (Fase 1, task 2.7): criação, listagem (histórico)
 * e leitura do histórico de mensagens.
 *
 * O envio de mensagem com resposta em stream (SSE) é o orquestrador (task 2.9),
 * em serviço separado, que reaproveita este serviço para persistir as mensagens.
 *
 * @see PrismaService - persistência de `chat_sessions` / `chat_messages`.
 */
@Injectable()
export class ChatService {
  /**
   * @param {PrismaService} prisma - Cliente Prisma para sessões e mensagens de chat.
   */
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Cria uma sessão de chat para o usuário.
   *
   * @param {string} userId - Subject do usuário dono da sessão.
   * @param {string} [title] - Título inicial opcional.
   * @returns {Promise<{ session_id: string }>} Id da sessão criada.
   */
  async createSession(
    userId: string,
    title?: string,
  ): Promise<{ session_id: string }> {
    const session = await this.prisma.chatSession.create({
      data: {
        userId,
        title: title ?? null,
      },
      select: { id: true },
    });

    return { session_id: session.id };
  }

  /**
   * Atualiza uma sessão de chat: título (cabeçalho/histórico) e/ou fixação (`pinned`). Aplica só os
   * campos informados. Só age sobre uma sessão do próprio usuário.
   *
   * @param {string} sessionId - Id da sessão.
   * @param {string} userId - Subject do usuário dono (escopo de autorização).
   * @param {{ title?: string; pinned?: boolean }} changes - Campos a atualizar (parciais).
   * @returns {Promise<{ session_id: string; title: string; pinned: boolean }>} Sessão atualizada.
   * @throws {NotFoundException} Se a sessão não existir ou não pertencer ao usuário.
   */
  async updateSession(
    sessionId: string,
    userId: string,
    changes: {
      title?: string;
      pinned?: boolean
    },
  ): Promise<{
    session_id: string;
    title: string;
    pinned: boolean
  }> {
    await this.assertSession(
      sessionId,
      userId,
    );

    const data: {
      title?: string;
      pinned?: boolean
    } = {};

    if (changes.title !== undefined) {
      data.title = changes.title;
    }

    if (changes.pinned !== undefined) {
      data.pinned = changes.pinned;
    }

    const updated = await this.prisma.chatSession.update({
      where: { id: sessionId },
      data,
      select: {
        id: true,
        title: true,
        pinned: true,
      },
    });

    return {
      session_id: updated.id,
      // Mesmo fallback do listSessions: sessão sem título (NULL) num PATCH só de `pinned` não pode
      // devolver título vazio (o front renderizaria em branco em vez de "Nova conversa").
      title: updated.title ?? changes.title ?? 'Nova conversa',
      pinned: updated.pinned,
    };
  }

  /**
   * Vincula (idempotente) uma sessão a um incidente — many-to-many. Chamado quando o chat referencia
   * um incidente (ex.: tool `get_incident`). A PK composta evita duplicar o par.
   *
   * @param {string} sessionId - Id da sessão.
   * @param {string} incidentId - Id do incidente referenciado.
   * @returns {Promise<void>}
   */
  async linkIncident(
    sessionId: string,
    incidentId: string,
  ): Promise<void> {
    await this.prisma.chatSessionIncident.upsert({
      where: {
        sessionId_incidentId: {
          sessionId,
          incidentId,
        },
      },
      create: {
        sessionId,
        incidentId,
      },
      update: {},
    });
  }

  /**
   * Lista as sessões do usuário (histórico), mais recentes primeiro.
   *
   * @param {string} userId - Subject do usuário.
   * @returns {Promise<ChatSessionListItemInterface[]>} Itens de sessão (snake_case) com contagens derivadas.
   */
  async listSessions(userId: string): Promise<ChatSessionListItemInterface[]> {
    const sessions = await this.prisma.chatSession.findMany({
      where: { userId },
      orderBy: { lastActivity: 'desc' },
      include: {
        messages: {
          select: {
            role: true,
            content: true,
          },
        },
        _count: { select: { incidents: true } },
      },
    });

    return sessions.map((session) => {
      let toolCount = 0;
      let preview = '';

      for (const msg of session.messages) {
        const content = msg.content as unknown as ChatMessageContentInterface;

        if (Array.isArray(content?.tools)) {
          toolCount += content.tools.length;
        }

        if (
          !preview
          && msg.role === 'user'
          && content?.text
        ) {
          preview = content.text;
        }
      }

      return {
        id: session.id,
        title: session.title ?? 'Nova conversa',
        started_at: session.startedAt.toISOString(),
        message_count: session.messages.length,
        tool_count: toolCount,
        pinned: session.pinned,
        tags: Array.isArray(session.tags)
          ? (session.tags as string[])
          : [],
        preview: preview || (session.title ?? ''),
        duration: this.formatDuration(
          session.startedAt,
          session.lastActivity,
        ),
        has_incident: session._count.incidents > 0,
      };
    });
  }

  /**
   * Lê o histórico de mensagens de uma sessão do próprio usuário, em ordem cronológica.
   *
   * @param {string} sessionId - Id da sessão.
   * @param {string} userId - Subject do usuário dono (escopo de autorização).
   * @returns {Promise<ChatMessageInterface[]>} Mensagens da sessão (snake_case).
   * @throws {NotFoundException} Se a sessão não existir ou não pertencer ao usuário.
   */
  async getMessages(
    sessionId: string,
    userId: string,
  ): Promise<ChatMessageInterface[]> {
    await this.assertSession(
      sessionId,
      userId,
    );

    const messages = await this.prisma.chatMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
    });

    return messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: (message.content as unknown as ChatMessageContentInterface) ?? { text: '' },
      created_at: message.createdAt.toISOString(),
    }));
  }

  /**
   * Anexa uma mensagem à sessão e atualiza `last_activity` (usado pelo orquestrador).
   *
   * @param {string} sessionId - Id da sessão.
   * @param {'user' | 'assistant'} role - Autor da mensagem.
   * @param {ChatMessageContentInterface} content - Conteúdo estruturado a persistir.
   * @returns {Promise<string>} Id da mensagem criada.
   */
  async appendMessage(
    sessionId: string,
    role: 'user' | 'assistant',
    content: ChatMessageContentInterface,
  ): Promise<string> {
    const message = await this.prisma.chatMessage.create({
      data: {
        sessionId,
        role,
        content: content as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });

    await this.prisma.chatSession.update({
      where: { id: sessionId },
      data: { lastActivity: new Date() },
    });

    return message.id;
  }

  /**
   * Garante que a sessão existe **e pertence ao usuário** (fronteira de autorização por dono;
   * chamado antes de ler mensagens, renomear ou iniciar o stream SSE). Devolve 404 tanto para
   * sessão inexistente quanto para sessão de outro usuário (não vaza a existência).
   *
   * @param {string} sessionId - Id da sessão.
   * @param {string} userId - Subject do usuário dono.
   * @returns {Promise<void>} Resolve se a sessão existir e for do usuário.
   * @throws {NotFoundException} Se a sessão não existir ou não pertencer ao usuário.
   */
  async assertSession(
    sessionId: string,
    userId: string,
  ): Promise<void> {
    const session = await this.prisma.chatSession.findFirst({
      where: {
        id: sessionId,
        userId,
      },
      select: { id: true },
    });

    if (!session) {
      throw new NotFoundException({
        error: {
          code: 'not_found',
          message: 'Sessão não encontrada',
        },
      });
    }
  }

  /**
   * Formata a duração entre dois instantes como `"Xm"` ou `"Xh Ym"`.
   *
   * @param {Date} start - Instante inicial.
   * @param {Date} end - Instante final.
   * @returns {string} Duração legível.
   */
  private formatDuration(
    start: Date,
    end: Date,
  ): string {
    const minutes = Math.max(
      0,
      Math.round((end.getTime() - start.getTime()) / 60_000),
    );

    if (minutes < 60) {
      return `${minutes}m`;
    }

    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  }
}
