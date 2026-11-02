import { FakeLlmProvider } from './fake-llm.provider';
import type { LlmStreamChunkType } from './llm-provider.interface';

async function collect(stream: AsyncIterable<LlmStreamChunkType>): Promise<LlmStreamChunkType[]> {
  const out: LlmStreamChunkType[] = [];

  for await (const chunk of stream) {
    out.push(chunk);
  }

  return out;
}

describe('FakeLlmProvider', () => {
  const provider = new FakeLlmProvider();

  it('pede search_shippings quando a mensagem traz um telefone', async () => {
    const chunks = await collect(
      provider.converseStream({
        messages: [{
          role: 'user',
          content: 'status do telefone +55 11 98765-1234 nas últimas 4h',
        }],
      }),
    );

    expect(chunks.find((chunk) => chunk.type === 'tool_use')).toMatchObject({
      type: 'tool_use',
      name: 'search_shippings',
    });

    expect(chunks.at(-1)).toEqual({
      type: 'stop',
      reason: 'tool_use',
    });
  });

  it('recusa (refusal) quando nenhuma tool se aplica', async () => {
    const chunks = await collect(
      provider.converseStream({
        messages: [{
          role: 'user',
          content: 'qual a capital da França?',
        }],
      }),
    );

    expect(chunks.at(-1)).toEqual({
      type: 'stop',
      reason: 'refusal',
    });

    expect(chunks.some((chunk) => chunk.type === 'usage')).toBe(true);
  });

  it('redige resposta final quando já há resultado de tool', async () => {
    const chunks = await collect(
      provider.converseStream({
        messages: [
          {
            role: 'user',
            content: 'status do telefone +5511987651234',
          },
          {
            role: 'tool',
            content: { rows: [] },
          },
        ],
      }),
    );

    expect(chunks.some((chunk) => chunk.type === 'text_delta')).toBe(true);

    expect(chunks.at(-1)).toEqual({
      type: 'stop',
      reason: 'end_turn',
    });
  });

  it('describes itself as the simulated fake provider', () => {
    expect(provider.describe()).toEqual({
      provider: 'fake',
      model: 'Simulado',
    });
  });

  it('refuses when the conversation has no user message', async () => {
    const chunks = await collect(
      provider.converseStream({
        messages: [{
          role: 'assistant',
          content: 'status do telefone +5511987651234',
        }],
      }),
    );

    expect(chunks.some((chunk) => chunk.type === 'tool_use')).toBe(false);

    expect(chunks.at(-1)).toEqual({
      type: 'stop',
      reason: 'refusal',
    });
  });

  it('reads a structured user message through its JSON serialization', async () => {
    const chunks = await collect(
      provider.converseStream({
        messages: [{
          role: 'user',
          content: { text: 'status do telefone +5511987651234' },
        }],
      }),
    );

    expect(chunks.find((chunk) => chunk.type === 'tool_use')).toMatchObject({
      type: 'tool_use',
      name: 'search_shippings',
    });
  });
});
