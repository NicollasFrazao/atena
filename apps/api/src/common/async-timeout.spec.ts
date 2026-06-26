import { withIdleTimeout } from './async-timeout';

/** Async-iterable que emite cada item após `gapMs`. */
async function* delayed<T>(
  items: T[],
  gapMs: number,
): AsyncIterable<T> {
  for (const item of items) {
    await new Promise((resolve) => setTimeout(
      resolve,
      gapMs,
    ));

    yield item;
  }
}

describe('withIdleTimeout', () => {
  it('repassa todos os itens quando chegam dentro do idle', async () => {
    const out: number[] = [];

    for await (const item of withIdleTimeout(
      delayed(
        [
          1,
          2,
          3,
        ],
        5,
      ),
      200,
      'test',
    )) {
      out.push(item);
    }

    expect(out).toEqual([
      1,
      2,
      3,
    ]);
  });

  it('lança quando o próximo item demora mais que o idle', async () => {
    const seen: number[] = [];

    const consume = async (): Promise<void> => {
      for await (const item of withIdleTimeout(
        delayed(
          [1],
          200,
        ),
        40,
        'converseStream',
      )) {
        seen.push(item);
      }
    };

    await expect(consume()).rejects.toThrow(/sem resposta do stream/);
    expect(seen).toEqual([]);
  });
});
