import { Body, Controller, Get, HttpStatus, Logger, Param, Patch, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Audit } from '../audit/audit.decorator';
import { Requires } from '../auth/rbac/requires.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUserInterface } from '../auth/identity-provider.interface';
import { ChatService, STUB_USER_ID } from './chat.service';
import { CreateSessionDto } from './dto/create-session.dto';
import { RenameSessionDto } from './dto/rename-session.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { OrchestratorService } from './orchestrator.service';

/**
 * Endpoints de sessões/mensagens de chat, montados sob `/chat/sessions`.
 *
 * As sessões são **donas de um usuário**: criação/listagem usam o `sub` do usuário autenticado
 * ({@link CurrentUser}), com fallback {@link STUB_USER_ID} (= `sub` do usuário de dev). O envio de
 * mensagem propaga o `sub` ao orquestrador para a atribuição do audit dos tool calls.
 *
 * @see ChatService - persistência e leitura de sessões/mensagens.
 * @see OrchestratorService - loop LLM + tool routing do envio de mensagem (SSE).
 */
@Requires('app:use')
@Controller('chat/sessions')
export class ChatController {
  private readonly logger = new Logger(ChatController.name);

  /**
   * @param chat - Serviço de sessões/mensagens de chat.
   * @param orchestrator - Orquestrador do stream de resposta.
   */
  constructor(
    private readonly chat: ChatService,
    private readonly orchestrator: OrchestratorService,
  ) {}

  /**
   * `POST /chat/sessions` — cria uma sessão de chat do usuário logado. Auditado como `session_start`.
   *
   * @param body - Título inicial opcional.
   * @param [user] - Usuário autenticado (dono da sessão).
   *
   * @returns Id da sessão criada.
   */
  @Post()
  @Audit('session_start', 'info')
  create(
    @Body() body: CreateSessionDto,
    @CurrentUser() user?: AuthenticatedUserInterface,
  ) {
    return this.chat.createSession(
      user?.sub ?? STUB_USER_ID,
      body.title,
    );
  }

  /**
   * `GET /chat/sessions` — lista as sessões do usuário logado (histórico).
   *
   * @param [user] - Usuário autenticado (dono das sessões).
   *
   * @returns Sessões mais recentes primeiro.
   */
  @Get()
  list(@CurrentUser() user?: AuthenticatedUserInterface) {
    return this.chat.listSessions(user?.sub ?? STUB_USER_ID);
  }

  /**
   * `PATCH /chat/sessions/:id` — renomeia a sessão (título do cabeçalho/histórico) do usuário logado.
   *
   * @param id - Id da sessão.
   * @param body - Novo título (1–200 chars).
   * @param [user] - Usuário autenticado (dono da sessão).
   *
   * @returns Sessão renomeada.
   */
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() body: RenameSessionDto,
    @CurrentUser() user?: AuthenticatedUserInterface,
  ) {
    return this.chat.updateSession(
      id,
      user?.sub ?? STUB_USER_ID,
      {
        title: body.title,
        pinned: body.pinned,
      },
    );
  }

  /**
   * `GET /chat/sessions/:id/messages` — histórico de mensagens de uma sessão do usuário logado.
   *
   * @param id - Id da sessão.
   * @param [user] - Usuário autenticado (dono da sessão).
   *
   * @returns Mensagens em ordem cronológica.
   */
  @Get(':id/messages')
  messages(
    @Param('id') id: string,
    @CurrentUser() user?: AuthenticatedUserInterface,
  ) {
    return this.chat.getMessages(
      id,
      user?.sub ?? STUB_USER_ID,
    );
  }

  /**
   * `POST /chat/sessions/:id/messages` — envia a mensagem do usuário e devolve a
   * resposta em **stream SSE** (`tool_call` → (`tool_progress`*) → `tool_result` →
   * `text_delta` → `done`, ou `refusal`). As tools executadas pelo orquestrador são auditadas
   * internamente.
   *
   * Usa resposta library-specific (`@Res`) para escrever os frames SSE; a sessão é
   * validada antes de abrir o stream (404 estruturado se não existir).
   *
   * @param id - Id da sessão.
   * @param body - Texto da mensagem do usuário.
   * @param res - Resposta Express (frames `text/event-stream`).
   *
   * @returns Resolve quando o stream é encerrado.
   *
   * @throws {NotFoundException} Se a sessão não existir (antes de abrir o stream).
   */
  @Post(':id/messages')
  async sendMessage(
    @Param('id') id: string,
    @Body() body: SendMessageDto,
    @Res() res: Response,
    @CurrentUser() user?: AuthenticatedUserInterface,
  ): Promise<void> {
    await this.chat.assertSession(
      id,
      user?.sub ?? STUB_USER_ID,
    );

    // Stream SSE: 200 (não 201; o @Post default não se aplica bem ao streaming).
    res.status(HttpStatus.OK);

    res.setHeader(
      'Content-Type',
      'text/event-stream',
    );

    res.setHeader(
      'Cache-Control',
      'no-cache, no-transform',
    );

    res.setHeader(
      'Connection',
      'keep-alive',
    );

    res.flushHeaders();

    try {
      for await (const ev of this.orchestrator.run(
        id,
        body.text,
        user?.sub ?? STUB_USER_ID,
      )) {
        res.write(`event: ${ev.event}\ndata: ${JSON.stringify(ev.data)}\n\n`);
      }
    } catch (err) {
      // NÃO mascarar em silêncio: loga a causa real (idle-timeout do LLM, erro de tool, etc.) — sem
      // isto o erro é invisível e impossível de diagnosticar. O cliente segue recebendo a msg genérica.
      this.logger.error(
        `stream da mensagem da sessão ${id} falhou: ${err instanceof Error
          ? err.message
          : String(err)}`,
        err instanceof Error
          ? err.stack
          : undefined,
      );

      res.write(`event: error\ndata: ${JSON.stringify({
        error: {
          code: 'internal',
          message: 'Falha ao processar a mensagem',
        },
      })}\n\n`);
    } finally {
      res.end();
    }
  }
}
