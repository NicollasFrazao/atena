import type { DeliveryRecordInterface } from './audit-query.types';

/** Entrada do cache: o registro + o instante de expiração (epoch ms). */
interface RecordCacheEntryInterface {
  record: DeliveryRecordInterface;
  expiresAt: number;
}

/**
 * Cache em memória de registros de entrega por id (TTL curto + teto de tamanho).
 *
 * Populado quando o motor materializa registros (search / trilha / getShipping); o reveal de PII e a
 * análise de conteúdo leem aqui ANTES de varrer o S3. Como o analista quase sempre revela logo após
 * ver o resultado, o registro está quente → reveal O(1) em vez de re-varrer o dia (~6s). Ao estourar
 * o teto, descarta o mais antigo (FIFO); entradas expiradas saem na leitura.
 *
 * Não guarda PII em log: o valor sensível vive só aqui em memória e some no TTL/eviction.
 */
export class RecordCache {
  /** Entradas por id (Map preserva ordem de inserção → base do FIFO). */
  private readonly entries = new Map<string, RecordCacheEntryInterface>();

  /**
   * @param {number} ttlMs - Tempo de vida de cada entrada (ms).
   * @param {number} maxSize - Teto de entradas; ao exceder, remove as mais antigas (FIFO).
   * @param {() => number} [now] - Fonte do tempo (injetável para teste); default `Date.now`.
   */
  constructor(
    private readonly ttlMs: number,
    private readonly maxSize: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /**
   * Insere/atualiza um registro (renovando o TTL e a posição). Aplica o teto por FIFO.
   *
   * @param {DeliveryRecordInterface} record - Registro a cachear (chaveado por `record.id`).
   * @returns {void}
   */
  set(record: DeliveryRecordInterface): void {
    // Reinsere no fim para renovar a ordem (a chave mais antiga é a primeira da Map).
    this.entries.delete(record.id);

    this.entries.set(
      record.id,
      {
        record,
        expiresAt: this.now() + this.ttlMs,
      },
    );

    while (this.entries.size > this.maxSize) {
      const oldest = this.entries.keys().next().value;

      if (oldest === undefined) {
        break;
      }

      this.entries.delete(oldest);
    }
  }

  /**
   * Lê um registro por id; `null` se ausente ou expirado (expirado é removido na leitura).
   *
   * @param {string} id - Id da mensagem.
   * @returns {DeliveryRecordInterface | null} O registro quente, ou `null`.
   */
  get(id: string): DeliveryRecordInterface | null {
    const hit = this.entries.get(id);

    if (!hit) {
      return null;
    }

    if (hit.expiresAt <= this.now()) {
      this.entries.delete(id);

      return null;
    }

    return hit.record;
  }
}
