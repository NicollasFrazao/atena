import {
  existsSync,
  mkdirSync,
  readFileSync,
} from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** Datas-chave de um envio (epoch ms) — o bastante p/ derivar a janela ESTREITA da trilha. */
interface IndexEntryInterface {
  requestedAt: number;
  finalizedAt: number | null;
}

/** Janela do ciclo de vida de um envio, p/ estreitar a trilha. */
export interface ShippingDatesInterface {
  requestedAt: Date;
  finalizedAt: Date | null;
}

/** Intervalo (ms) de debounce do flush em disco — agrega as N escritas de uma página de busca em uma. */
const FLUSH_DEBOUNCE_MS = 2000;

/**
 * Índice PERSISTENTE `shipping_id → datas` (envio/desfecho). Versão durável do `recordCache`: o
 * `search`/`getShipping`/`getTrail` registram aqui os ids que o usuário vê, e o `getTrail` consulta
 * ANTES de varrer — assim um id JÁ VISTO (mesmo colado numa nova conversa, ou após restart) abre a
 * trilha com a janela do PRÓPRIO dia, sem cair no scan de ~30 dias. Sobrevive a restart porque grava
 * num JSON no diretório de cache (volume persistido). NÃO é a fonte de verdade — é só um atalho de
 * janela; um id nunca-visto continua exigindo a data (vide o gate da trilha).
 *
 * Limitado a {@link maxEntries} (evita crescer sem teto); o flush é assíncrono e com debounce (não
 * bloqueia o event loop). Sem TTL: a data de um envio não muda.
 */
export class ShippingDateIndex {
  private readonly entries = new Map<string, IndexEntryInterface>();

  private readonly path: string;

  private readonly maxEntries: number;

  private dirty = false;

  private flushScheduled = false;

  private readonly flushDebounceMs: number;

  /**
   * @param {string} cacheDir - Diretório (volume persistido) onde o índice é gravado.
   * @param {number} [maxEntries] - Teto de ids no índice (LRU por inserção). Default 20000.
   * @param {number} [flushDebounceMs] - Debounce do flush em disco (ms). Default {@link FLUSH_DEBOUNCE_MS}.
   */
  constructor(
    cacheDir: string,
    maxEntries = 20000,
    flushDebounceMs = FLUSH_DEBOUNCE_MS,
  ) {
    this.path = join(
      cacheDir,
      'shipping-date-index.json',
    );

    this.maxEntries = maxEntries;
    this.flushDebounceMs = flushDebounceMs;
    this.load();
  }

  /** Carrega o índice do disco no boot (síncrono — é uma vez só). Índice corrompido → começa vazio. */
  private load(): void {
    if (!existsSync(this.path)) {
      return;
    }

    try {
      const raw = JSON.parse(readFileSync(
        this.path,
        'utf8',
      )) as Record<string, IndexEntryInterface>;

      for (const [
        id,
        entry,
      ] of Object.entries(raw)) {
        this.entries.set(
          id,
          entry,
        );
      }
    } catch {
      // arquivo corrompido/parcial — ignora e começa vazio (índice é só um atalho, não fonte de verdade).
    }
  }

  /**
   * Registra (ou atualiza) as datas de um envio. Reinsere p/ manter a ordem ~recência (o Map preserva
   * ordem de inserção → o mais antigo sai ao estourar o teto). Ignora `requested_at` ausente/epoch 0.
   *
   * @param {string} id - Shipping_id (md5).
   * @param {Date | null | undefined} requestedAt - Instante do envio.
   * @param {Date | null | undefined} finalizedAt - Instante do desfecho (ou null se pendente).
   * @returns {void}
   */
  record(
    id: string,
    requestedAt: Date | null | undefined,
    finalizedAt: Date | null | undefined,
  ): void {
    if (
      !id
      || !requestedAt
      || requestedAt.getTime() <= 0
    ) {
      return;
    }

    this.entries.delete(id);

    this.entries.set(
      id,
      {
        requestedAt: requestedAt.getTime(),
        finalizedAt: finalizedAt?.getTime() ?? null,
      },
    );

    if (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;

      if (oldest !== undefined) {
        this.entries.delete(oldest);
      }
    }

    this.scheduleFlush();
  }

  /**
   * Datas de um envio conhecido (do índice), ou `null` se nunca visto.
   *
   * @param {string} id - Shipping_id (md5).
   * @returns {ShippingDatesInterface | null} Datas p/ estreitar a janela, ou `null`.
   */
  get(id: string): ShippingDatesInterface | null {
    const entry = this.entries.get(id);

    if (!entry) {
      return null;
    }

    return {
      requestedAt: new Date(entry.requestedAt),
      finalizedAt: entry.finalizedAt === null
        ? null
        : new Date(entry.finalizedAt),
    };
  }

  /** Agenda um flush com debounce (timer unref'd → não segura o processo nem trava testes). */
  private scheduleFlush(): void {
    this.dirty = true;

    if (this.flushScheduled) {
      return;
    }

    this.flushScheduled = true;

    setTimeout(
      () => {
        this.flush().catch(() => undefined);
      },
      this.flushDebounceMs,
    ).unref();
  }

  /** Grava o índice em disco (assíncrono, best-effort). */
  private async flush(): Promise<void> {
    this.flushScheduled = false;

    if (!this.dirty) {
      return;
    }

    this.dirty = false;

    try {
      mkdirSync(
        dirname(this.path),
        { recursive: true },
      );

      await writeFile(
        this.path,
        JSON.stringify(Object.fromEntries(this.entries)),
      );
    } catch {
      // best-effort: falha de escrita não pode derrubar a consulta; o índice é só um atalho.
    }
  }
}
