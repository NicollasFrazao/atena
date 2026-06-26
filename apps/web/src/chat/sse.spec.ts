import { describe, expect, it } from 'vitest';
import { parseSseFrames } from './sse';

describe('parseSseFrames', () => {
  it('parseia frames completos e guarda o frame incompleto em rest', () => {
    const buffer = [
      'event: tool_call',
      'data: {"name":"search_shippings","args":{"phone":"+55"},"status":"running"}',
      '',
      'event: text_delta',
      'data: {"delta":"Olá"}',
      '',
      'event: text_de', // frame incompleto (sem \n\n)
    ].join('\n');

    const {
      events,
      rest,
    } = parseSseFrames(buffer);

    expect(events).toHaveLength(2);

    expect(events[0]).toEqual({
      event: 'tool_call',
      data: {
        name: 'search_shippings',
        args: { phone: '+55' },
        status: 'running',
      },
    });

    expect(events[1]).toEqual({
      event: 'text_delta',
      data: { delta: 'Olá' },
    });

    expect(rest).toBe('event: text_de');
  });

  it('parseia done e refusal; ignora frame sem data', () => {
    const done = parseSseFrames('event: done\ndata: {"message_id":"m1","refusal":null}\n\n');

    expect(done.events[0]).toEqual({
      event: 'done',
      data: {
        message_id: 'm1',
        refusal: null,
      },
    });

    const refusal = parseSseFrames('event: refusal\ndata: {"reason":"fora_escopo","explanation":"x","can_do":[]}\n\n');

    expect(refusal.events[0].event).toBe('refusal');

    // frame sem `data:` é ignorado
    const empty = parseSseFrames('event: ping\n\n');

    expect(empty.events).toHaveLength(0);
  });

  it('descarta JSON inválido sem quebrar', () => {
    const { events } = parseSseFrames('event: text_delta\ndata: {quebrado\n\n');

    expect(events).toHaveLength(0);
  });
});
