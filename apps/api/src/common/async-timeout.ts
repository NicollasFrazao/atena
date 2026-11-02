/**
 * Corre `iterator.next()` contra um timer de `idleMs`; limpa o timer ao resolver/rejeitar para não
 * vazar timer nem rejeição pendente.
 *
 * @param iterator - Iterador da fonte.
 * @param idleMs - Tempo máximo (ms) aguardando o próximo item.
 * @param label - Rótulo usado na mensagem de timeout.
 *
 * @returns O próximo resultado, ou rejeita ao estourar o idle.
 *
 * @template T
 */
async function nextWithTimeout<T>(
  iterator: AsyncIterator<T>,
  idleMs: number,
  label: string,
): Promise<IteratorResult<T>> {
  let handle: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((
    _resolve,
    reject,
  ) => {
    handle = setTimeout(
      () => { reject(new Error(`${label}: sem resposta do stream após ${idleMs}ms`)); },
      idleMs,
    );
  });

  try {
    return await Promise.race([
      iterator.next(),
      timeout,
    ]);
  } finally {
    clearTimeout(handle);
  }
}

/**
 * Envolve um async-iterable com um IDLE timeout: se o próximo item demorar mais que `idleMs`, lança
 * em vez de pendurar pra sempre (ex.: stream do Bedrock que abre mas não emite eventos). Cada item
 * que chega zera o relógio. Fecha a fonte (`iterator.return`) ao sair (timeout, erro ou fim).
 *
 * @param source - Stream de origem.
 * @param idleMs - Tempo máximo (ms) entre itens antes de abortar.
 * @param label - Rótulo no erro de timeout (diagnóstico).
 *
 * @returns Stream que repassa os itens ou lança ao estourar o idle.
 *
 * @template T
 */
export async function* withIdleTimeout<T>(
  source: AsyncIterable<T>,
  idleMs: number,
  label: string,
): AsyncIterable<T> {
  const iterator = source[Symbol.asyncIterator]();

  try {
    let result = await nextWithTimeout(
      iterator,
      idleMs,
      label,
    );

    while (!result.done) {
      yield result.value;

      result = await nextWithTimeout(
        iterator,
        idleMs,
        label,
      );
    }
  } finally {
    await iterator.return?.();
  }
}
