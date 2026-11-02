import { Logger } from '@nestjs/common';
import type { Response } from 'express';
import type { ChatStreamEvent } from '@atena/types';
import type { AuthenticatedUserInterface } from '../auth/identity-provider.interface';
import { ChatController } from './chat.controller';
import { STUB_USER_ID, type ChatService } from './chat.service';
import type { OrchestratorService } from './orchestrator.service';

/** Authenticated user whose `sub` owns the sessions in these tests. */
const USER = { sub: 'user-42' } as AuthenticatedUserInterface;

/** Builds a ChatService mock with every method the controller delegates to. */
function buildChat() {
  return {
    createSession: jest.fn().mockResolvedValue({ session_id: 's-1' }),
    listSessions: jest.fn().mockResolvedValue([]),
    updateSession: jest.fn().mockResolvedValue({
      session_id: 's-1',
      title: 'Renamed',
      pinned: true,
    }),
    getMessages: jest.fn().mockResolvedValue([]),
    assertSession: jest.fn().mockResolvedValue(undefined),
  };
}

/** Builds an Express Response mock that records the SSE frames written to it. */
function buildResponse() {
  const frames: string[] = [];

  const res = {
    status: jest.fn(),
    setHeader: jest.fn(),
    flushHeaders: jest.fn(),
    write: jest.fn((frame: string) => {
      frames.push(frame);

      return true;
    }),
    end: jest.fn(),
  };

  return {
    res,
    frames,
  };
}

/** Builds an orchestrator whose `run` yields the given events and then optionally throws. */
function buildOrchestrator(
  events: ChatStreamEvent[],
  failure?: unknown,
) {
  const run = jest.fn(async function* fakeRun() {
    for (const event of events) {
      yield await Promise.resolve(event);
    }

    if (failure !== undefined) {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- the controller must also handle non-Error rejections
      throw failure;
    }
  });

  return { run } as unknown as OrchestratorService & { run: jest.Mock };
}

describe('ChatController', () => {
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    errorSpy = jest.spyOn(
      Logger.prototype,
      'error',
    ).mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('creates the session for the authenticated user', async () => {
    const chat = buildChat();

    const controller = new ChatController(
      chat as unknown as ChatService,
      buildOrchestrator([]),
    );

    await expect(controller.create(
      { title: 'Investigation' },
      USER,
    )).resolves.toEqual({ session_id: 's-1' });

    expect(chat.createSession).toHaveBeenCalledWith(
      'user-42',
      'Investigation',
    );
  });

  it('falls back to the stub user on every route when there is no authenticated user', async () => {
    const chat = buildChat();

    const controller = new ChatController(
      chat as unknown as ChatService,
      buildOrchestrator([]),
    );

    await controller.create({});
    await controller.list();

    await controller.update(
      's-1',
      { title: 'Renamed' },
    );

    await controller.messages('s-1');

    expect(chat.createSession).toHaveBeenCalledWith(
      STUB_USER_ID,
      undefined,
    );

    expect(chat.listSessions).toHaveBeenCalledWith(STUB_USER_ID);

    expect(chat.updateSession).toHaveBeenCalledWith(
      's-1',
      STUB_USER_ID,
      {
        title: 'Renamed',
        pinned: undefined,
      },
    );

    expect(chat.getMessages).toHaveBeenCalledWith(
      's-1',
      STUB_USER_ID,
    );
  });

  it('scopes list, rename and history to the authenticated user', async () => {
    const chat = buildChat();

    const controller = new ChatController(
      chat as unknown as ChatService,
      buildOrchestrator([]),
    );

    await controller.list(USER);

    const renamed = await controller.update(
      's-1',
      {
        title: 'Renamed',
        pinned: true,
      },
      USER,
    );

    await controller.messages(
      's-1',
      USER,
    );

    expect(renamed).toEqual({
      session_id: 's-1',
      title: 'Renamed',
      pinned: true,
    });

    expect(chat.listSessions).toHaveBeenCalledWith('user-42');

    expect(chat.updateSession).toHaveBeenCalledWith(
      's-1',
      'user-42',
      {
        title: 'Renamed',
        pinned: true,
      },
    );

    expect(chat.getMessages).toHaveBeenCalledWith(
      's-1',
      'user-42',
    );
  });

  it('streams every orchestrator event as an SSE frame and closes the response', async () => {
    const chat = buildChat();

    const orchestrator = buildOrchestrator([
      {
        event: 'text_delta',
        data: { delta: 'Hello' },
      },
      {
        event: 'done',
        data: {
          message_id: 'asst-1',
          refusal: null,
        },
      },
    ]);

    const {
      res,
      frames,
    } = buildResponse();

    const controller = new ChatController(
      chat as unknown as ChatService,
      orchestrator,
    );

    await controller.sendMessage(
      's-1',
      { text: 'hi' },
      res as unknown as Response,
      USER,
    );

    expect(chat.assertSession).toHaveBeenCalledWith(
      's-1',
      'user-42',
    );

    expect(orchestrator.run).toHaveBeenCalledWith(
      's-1',
      'hi',
      'user-42',
    );

    expect(res.status).toHaveBeenCalledWith(200);

    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'text/event-stream',
    );

    expect(res.flushHeaders).toHaveBeenCalled();

    expect(frames).toEqual([
      'event: text_delta\ndata: {"delta":"Hello"}\n\n',
      'event: done\ndata: {"message_id":"asst-1","refusal":null}\n\n',
    ]);

    expect(res.end).toHaveBeenCalledTimes(1);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('turns a stream failure into a generic error frame, logs the real cause and still closes', async () => {
    const chat = buildChat();
    const failure = new Error('LLM idle timeout');

    const {
      res,
      frames,
    } = buildResponse();

    const controller = new ChatController(
      chat as unknown as ChatService,
      buildOrchestrator(
        [
          {
            event: 'text_delta',
            data: { delta: 'partial' },
          },
        ],
        failure,
      ),
    );

    await controller.sendMessage(
      's-1',
      { text: 'hi' },
      res as unknown as Response,
    );

    expect(chat.assertSession).toHaveBeenCalledWith(
      's-1',
      STUB_USER_ID,
    );

    expect(frames).toHaveLength(2);

    expect(frames[1]).toBe(
      'event: error\ndata: {"error":{"code":"internal","message":"Falha ao processar a mensagem"}}\n\n',
    );

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('LLM idle timeout'),
      failure.stack,
    );

    expect(res.end).toHaveBeenCalledTimes(1);
  });

  it('logs a non-Error rejection as text without a stack', async () => {
    const {
      res,
      frames,
    } = buildResponse();

    const controller = new ChatController(
      buildChat() as unknown as ChatService,
      buildOrchestrator(
        [],
        'socket closed',
      ),
    );

    await controller.sendMessage(
      's-1',
      { text: 'hi' },
      res as unknown as Response,
      USER,
    );

    expect(frames).toEqual([expect.stringContaining('event: error')]);

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('socket closed'),
      undefined,
    );

    expect(res.end).toHaveBeenCalledTimes(1);
  });

  it('does not open the stream when the session is not the user\'s', async () => {
    const chat = buildChat();
    const orchestrator = buildOrchestrator([]);
    chat.assertSession.mockRejectedValue(new Error('not found'));
    const { res } = buildResponse();

    const controller = new ChatController(
      chat as unknown as ChatService,
      orchestrator,
    );

    await expect(controller.sendMessage(
      's-9',
      { text: 'hi' },
      res as unknown as Response,
      USER,
    )).rejects.toThrow('not found');

    expect(res.flushHeaders).not.toHaveBeenCalled();
    expect(orchestrator.run).not.toHaveBeenCalled();
  });
});
