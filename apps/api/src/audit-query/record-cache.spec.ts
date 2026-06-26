import type { DeliveryRecordInterface } from './audit-query.types';
import { RecordCache } from './record-cache';

/** Registro mínimo para os testes (só o `id` importa aqui). */
function record(id: string): DeliveryRecordInterface {
  return { id } as unknown as DeliveryRecordInterface;
}

describe('RecordCache', () => {
  it('devolve o registro quente por id (hit)', () => {
    const cache = new RecordCache(
      1000,
      10,
      () => 0,
    );

    cache.set(record('m1'));

    expect(cache.get('m1')?.id).toBe('m1');
    expect(cache.get('ausente')).toBeNull();
  });

  it('expira a entrada após o TTL', () => {
    let clock = 0;

    const cache = new RecordCache(
      1000,
      10,
      () => clock,
    );

    cache.set(record('m1')); // expira em t=1000

    clock = 999;
    expect(cache.get('m1')?.id).toBe('m1'); // ainda vivo

    clock = 1000;
    expect(cache.get('m1')).toBeNull(); // expirou (<=)
  });

  it('respeita o teto descartando o mais antigo (FIFO)', () => {
    const cache = new RecordCache(
      1000,
      2,
      () => 0,
    );

    cache.set(record('m1'));
    cache.set(record('m2'));
    cache.set(record('m3')); // estoura o teto → m1 sai

    expect(cache.get('m1')).toBeNull();
    expect(cache.get('m2')?.id).toBe('m2');
    expect(cache.get('m3')?.id).toBe('m3');
  });

  it('re-set renova a posição (não é descartado como mais antigo)', () => {
    const cache = new RecordCache(
      1000,
      2,
      () => 0,
    );

    cache.set(record('m1'));
    cache.set(record('m2'));
    cache.set(record('m1')); // m1 volta ao fim → agora m2 é o mais antigo
    cache.set(record('m3')); // estoura → m2 sai

    expect(cache.get('m1')?.id).toBe('m1');
    expect(cache.get('m2')).toBeNull();
    expect(cache.get('m3')?.id).toBe('m3');
  });
});
