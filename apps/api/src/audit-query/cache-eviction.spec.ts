import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanOrphanCacheVersions, evictCacheDir } from './cache-eviction';

const NOW = new Date('2026-06-18T00:00:00Z').getTime();
const HOUR_MS = 60 * 60 * 1000;

describe('evictCacheDir', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(
      tmpdir(),
      'atena-evict-',
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

  /** Escreve um arquivo de `bytes` de tamanho com mtime de `ageHours` atrás de NOW. */
  function writeAged(
    name: string,
    bytes: number,
    ageHours: number,
  ): string {
    const path = join(
      dir,
      name,
    );

    writeFileSync(
      path,
      Buffer.alloc(bytes),
    );

    const mtime = new Date(NOW - ageHours * HOUR_MS);

    utimesSync(
      path,
      mtime,
      mtime,
    );

    return path;
  }

  it('no-op quando ambos os limites estão desligados', () => {
    const file = writeAged(
      'a.parquet',
      100,
      999,
    );

    const result = evictCacheDir(
      dir,
      0,
      0,
      NOW,
    );

    expect(result).toEqual({
      removed: 0,
      freedBytes: 0,
    });

    expect(existsSync(file)).toBe(true);
  });

  it('no-op quando o diretório não existe', () => {
    const result = evictCacheDir(
      join(
        dir,
        'inexistente',
      ),
      1,
      1,
      NOW,
    );

    expect(result).toEqual({
      removed: 0,
      freedBytes: 0,
    });
  });

  it('remove por idade os Parquets mais velhos que maxAgeMs', () => {
    const old = writeAged(
      'old.parquet',
      100,
      48,
    );

    const fresh = writeAged(
      'fresh.parquet',
      100,
      1,
    );

    const result = evictCacheDir(
      dir,
      0,
      24 * HOUR_MS,
      NOW,
    );

    expect(result.removed).toBe(1);
    expect(result.freedBytes).toBe(100);
    expect(existsSync(old)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
  });

  it('remove por tamanho os mais antigos (LRU por mtime) até caber no teto', () => {
    const oldest = writeAged(
      'oldest.parquet',
      10,
      3,
    );

    const middle = writeAged(
      'middle.parquet',
      10,
      2,
    );

    const newest = writeAged(
      'newest.parquet',
      10,
      1,
    );

    // Teto 15B: total 30B → derruba os 2 mais antigos (sobra 10B <= 15B).
    const result = evictCacheDir(
      dir,
      15,
      0,
      NOW,
    );

    expect(result.removed).toBe(2);
    expect(existsSync(oldest)).toBe(false);
    expect(existsSync(middle)).toBe(false);
    expect(existsSync(newest)).toBe(true);
  });

  it('remove .tmp órfãos (escrita interrompida) e ignora arquivos não-cache', () => {
    const stale = writeAged(
      'part.abc.tmp',
      50,
      48,
    );

    const other = writeAged(
      'notas.txt',
      50,
      48,
    );

    const result = evictCacheDir(
      dir,
      0,
      24 * HOUR_MS,
      NOW,
    );

    expect(result.removed).toBe(1);
    expect(existsSync(stale)).toBe(false);
    expect(existsSync(other)).toBe(true);
  });
});

describe('cleanOrphanCacheVersions', () => {
  let parent: string;

  beforeEach(() => {
    parent = mkdtempSync(join(
      tmpdir(),
      'atena-orphan-',
    ));
  });

  afterEach(() => {
    rmSync(
      parent,
      {
        recursive: true,
        force: true,
      },
    );
  });

  function mkdir(name: string): string {
    const path = join(
      parent,
      name,
    );

    mkdirSync(path);

    return path;
  }

  it('remove só dirs de versão irmãos != o atual; preserva o atual e outros dirs', () => {
    const current = mkdir('audit-ev-v6');
    const orphan = mkdir('audit-ev-v5');
    const ext = mkdir('duckdb-ext');

    const stray = join(
      parent,
      'audit-ev-stray.txt',
    );

    writeFileSync(
      stray,
      'x',
    );

    const removed = cleanOrphanCacheVersions(current);

    expect(removed).toEqual(['audit-ev-v5']);
    expect(existsSync(current)).toBe(true);
    expect(existsSync(orphan)).toBe(false);
    expect(existsSync(ext)).toBe(true);
    expect(existsSync(stray)).toBe(true); // arquivo, não dir → preservado
  });

  it('retorna [] quando o diretório pai não existe', () => {
    const removed = cleanOrphanCacheVersions(join(
      parent,
      'sumiu',
      'audit-ev-v6',
    ));

    expect(removed).toEqual([]);
  });
});
