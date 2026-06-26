import { describe, expect, it } from 'vitest';
import { appendText, patchLastRunningTool, type DisplayPartInterface } from './useChat';

/** Parte de tool mínima para os testes (só name/status/args importam aqui). */
function toolPart(
  name: string,
  status: 'running' | 'success' | 'error',
): DisplayPartInterface {
  return {
    kind: 'tool',
    tool: {
      name,
      args: {},
      status,
    },
  } as DisplayPartInterface;
}

describe('appendText', () => {
  it('abre uma nova parte quando não há nada', () => {
    expect(appendText(
      [],
      'text',
      'oi',
    )).toEqual([{
      kind: 'text',
      text: 'oi',
    }]);
  });

  it('estende a última parte do MESMO tipo (streaming token a token)', () => {
    expect(appendText(
      [{
        kind: 'text',
        text: 'oi ',
      }],
      'text',
      'mundo',
    )).toEqual([{
      kind: 'text',
      text: 'oi mundo',
    }]);
  });

  it('abre nova parte quando o tipo difere da última (thinking → text)', () => {
    expect(appendText(
      [{
        kind: 'thinking',
        text: 'pensando',
      }],
      'text',
      'resposta',
    )).toEqual([
      {
        kind: 'thinking',
        text: 'pensando',
      },
      {
        kind: 'text',
        text: 'resposta',
      },
    ]);
  });

  it('não funde através de uma tool (última parte é tool → texto abre parte nova)', () => {
    const parts: DisplayPartInterface[] = [
      {
        kind: 'text',
        text: 'a',
      },
      toolPart(
        'search_shippings',
        'running',
      ),
    ];

    expect(appendText(
      parts,
      'text',
      'b',
    )).toHaveLength(3);
  });
});

describe('patchLastRunningTool', () => {
  it('aplica o patch na tool running com o nome dado', () => {
    const out = patchLastRunningTool(
      [toolPart(
        'search_shippings',
        'running',
      )],
      'search_shippings',
      {
        status: 'success',
        result: { total: 1 },
      },
    );

    expect(out[0]).toMatchObject({
      kind: 'tool',
      tool: {
        status: 'success',
        result: { total: 1 },
      },
    });
  });

  it('não toca tools já concluídas nem de outro nome', () => {
    const out = patchLastRunningTool(
      [
        toolPart(
          'search_shippings',
          'success',
        ),
        toolPart(
          'get_shipping_trail',
          'running',
        ),
      ],
      'search_shippings',
      { status: 'error' },
    );

    expect(out[0].kind === 'tool' && out[0].tool.status).toBe('success');
    expect(out[1].kind === 'tool' && out[1].tool.status).toBe('running');
  });

  it('preserva a ordem das partes', () => {
    const parts: DisplayPartInterface[] = [
      {
        kind: 'text',
        text: 'a',
      },
      toolPart(
        'x',
        'running',
      ),
      {
        kind: 'text',
        text: 'b',
      },
    ];

    const out = patchLastRunningTool(
      parts,
      'x',
      { status: 'success' },
    );

    expect(out.map((part) => part.kind)).toEqual([
      'text',
      'tool',
      'text',
    ]);
  });
});
