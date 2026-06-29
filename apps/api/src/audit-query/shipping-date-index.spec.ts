import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ShippingDateIndex } from './shipping-date-index';

/** Pausa curta p/ deixar o flush debounced (assíncrono) gravar o índice em disco. */
const sleep = (ms: number): Promise<void> => new Promise((resolve) => {
  setTimeout(
    resolve,
    ms,
  );
});

describe('ShippingDateIndex', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(
      tmpdir(),
      'atena-idx-',
    ));
  });

  afterEach(() => {
    rmSync(
      dir,
      {
        recursive: true,
        force: true,
      },
    );
  });

  it('record/get: devolve as datas do envio', () => {
    const index = new ShippingDateIndex(dir);
    const req = new Date('2026-06-26T13:00:00Z');
    const fin = new Date('2026-06-26T13:05:00Z');

    index.record(
      'abc',
      req,
      fin,
    );

    const got = index.get('abc');

    expect(got?.requestedAt.toISOString()).toBe(req.toISOString());
    expect(got?.finalizedAt?.toISOString()).toBe(fin.toISOString());
  });

  it('get: id nunca visto → null; requested_at ausente/epoch 0 → não registra', () => {
    const index = new ShippingDateIndex(dir);

    expect(index.get('inexistente')).toBeNull();

    index.record(
      'sem-data',
      null,
      null,
    );

    expect(index.get('sem-data')).toBeNull();

    index.record(
      'epoch',
      new Date(0),
      null,
    );

    expect(index.get('epoch')).toBeNull();
  });

  it('pendente (finalized_at null) é registrado com finalizedAt null', () => {
    const index = new ShippingDateIndex(dir);

    index.record(
      'pend',
      new Date('2026-06-26T13:00:00Z'),
      null,
    );

    expect(index.get('pend')?.finalizedAt).toBeNull();
  });

  it('eviction: estoura o teto → o mais antigo sai', () => {
    const index = new ShippingDateIndex(
      dir,
      2,
    );

    const at = new Date('2026-06-26T13:00:00Z');

    index.record(
      'a',
      at,
      null,
    );

    index.record(
      'b',
      at,
      null,
    );

    index.record(
      'c',
      at,
      null,
    ); // estoura (teto 2) → 'a' sai

    expect(index.get('a')).toBeNull();
    expect(index.get('b')).not.toBeNull();
    expect(index.get('c')).not.toBeNull();
  });

  it('persistência: grava em disco e uma NOVA instância (mesmo dir) recarrega — sobrevive a restart', async () => {
    const writer = new ShippingDateIndex(
      dir,
      20000,
      5, // debounce curto p/ o teste
    );

    const req = new Date('2026-06-26T13:00:00Z');

    writer.record(
      'persist-me',
      req,
      null,
    );

    await sleep(40); // deixa o flush debounced gravar

    const reader = new ShippingDateIndex(dir);

    expect(reader.get('persist-me')?.requestedAt.toISOString()).toBe(req.toISOString());
  });
});
