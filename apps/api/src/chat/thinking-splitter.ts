/** Marcadores de raciocínio que alguns modelos (ex.: Amazon Nova) emitem inline no texto. */
const THINKING_OPEN = '<thinking>';
const THINKING_CLOSE = '</thinking>';

/** Porções já classificáveis de um push: raciocínio e texto da resposta. */
export interface ThinkingSplitResultInterface {
  thinking: string;
  text: string;
}

/**
 * Maior `k` tal que o sufixo de `value` (tamanho `k`) seja prefixo de `marker` (com `k < marker.length`).
 * Usado para segurar um possível início de tag partido no fim do buffer (ex.: `"...</think"`).
 *
 * @param {string} value - Buffer atual.
 * @param {string} marker - Marcador esperado a seguir.
 * @returns {number} Tamanho do sufixo a segurar (0 se nenhum).
 */
function partialPrefixLen(
  value: string,
  marker: string,
): number {
  const max = Math.min(
    marker.length - 1,
    value.length,
  );

  for (let size = max; size > 0; size -= 1) {
    if (value.slice(value.length - size) === marker.slice(
      0,
      size,
    )) {
      return size;
    }
  }

  return 0;
}

/**
 * Separa, em STREAMING, o raciocínio do modelo (entre `<thinking>...</thinking>`) do texto da
 * resposta. Stateful: mantém um buffer para tags partidas entre deltas. Modelos como o Amazon Nova
 * emitem o raciocínio inline no texto; isto permite exibi-lo à parte, sem poluir a resposta.
 */
export class ThinkingSplitter {
  private buffer = '';

  private inThinking = false;

  /**
   * Consome um fragmento e devolve as porções já classificáveis; segura um possível início de tag
   * partido no buffer para o próximo push.
   *
   * @param {string} delta - Fragmento de texto do stream.
   * @returns {ThinkingSplitResultInterface} Porções de raciocínio e de resposta deste push.
   */
  push(delta: string): ThinkingSplitResultInterface {
    this.buffer += delta;

    let thinking = '';
    let text = '';

    let marker = this.inThinking
      ? THINKING_CLOSE
      : THINKING_OPEN;

    let idx = this.buffer.indexOf(marker);

    while (idx !== -1) {
      const before = this.buffer.slice(
        0,
        idx,
      );

      if (this.inThinking) {
        thinking += before;
      } else {
        text += before;
      }

      this.buffer = this.buffer.slice(idx + marker.length);
      this.inThinking = !this.inThinking;

      marker = this.inThinking
        ? THINKING_CLOSE
        : THINKING_OPEN;

      idx = this.buffer.indexOf(marker);
    }

    const holdLen = partialPrefixLen(
      this.buffer,
      marker,
    );

    const emit = this.buffer.slice(
      0,
      this.buffer.length - holdLen,
    );

    this.buffer = this.buffer.slice(this.buffer.length - holdLen);

    if (this.inThinking) {
      thinking += emit;
    } else {
      text += emit;
    }

    return {
      thinking,
      text,
    };
  }

  /** Esvazia o buffer remanescente ao fim do stream (tag nunca fechada sai como está). */
  flush(): ThinkingSplitResultInterface {
    const rest = this.buffer;
    this.buffer = '';

    return this.inThinking
      ? {
        thinking: rest,
        text: '',
      }
      : {
        thinking: '',
        text: rest,
      };
  }
}
