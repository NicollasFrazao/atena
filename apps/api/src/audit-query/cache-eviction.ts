import {
  existsSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import {
  basename,
  dirname,
  join,
} from 'node:path';

/** Resultado de uma passada de eviction. */
export interface CacheEvictionResultInterface {
  removed: number;
  freedBytes: number;
}

/** Arquivo candidato do cache (Parquet de evento ou `.tmp` órfão de escrita interrompida). */
interface CacheEntryInterface {
  path: string;
  size: number;
  mtimeMs: number;
  alive: boolean;
}

/**
 * Evicção do cache de eventos (`audit-ev-vN`): remove Parquets (e `.tmp` órfãos) por **idade**
 * (mtime mais velho que `maxAgeMs`) e depois por **tamanho** (LRU por mtime, até ficar sob o teto).
 * Cada limite é opcional (`<= 0` = desligado). O cache é rebuildável do S3, então remover é seguro.
 *
 * @param {string} dir - Diretório do cache (`.../audit-ev-vN`).
 * @param {number} maxBytes - Teto de tamanho em bytes (`<= 0` = sem teto).
 * @param {number} maxAgeMs - Idade máxima em ms (`<= 0` = sem idade).
 * @param {number} now - Epoch atual (ms) — injetável para testes.
 * @returns {CacheEvictionResultInterface} Quantos arquivos removidos e bytes liberados.
 */
export function evictCacheDir(
  dir: string,
  maxBytes: number,
  maxAgeMs: number,
  now: number,
): CacheEvictionResultInterface {
  if (
    (maxBytes <= 0
    && maxAgeMs <= 0)
    || !existsSync(dir)
  ) {
    return {
      removed: 0,
      freedBytes: 0,
    };
  }

  const entries: CacheEntryInterface[] = readdirSync(dir)
    .filter((name) => name.endsWith('.parquet') || name.includes('.tmp'))
    .map((name) => {
      const path = join(
        dir,
        name,
      );

      const stat = statSync(path);

      return {
        path,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        alive: true,
      };
    });

  const result: CacheEvictionResultInterface = {
    removed: 0,
    freedBytes: 0,
  };

  const drop = (entry: CacheEntryInterface): void => {
    rmSync(
      entry.path,
      { force: true },
    );

    entry.alive = false;
    result.removed += 1;
    result.freedBytes += entry.size;
  };

  // 1. Por idade.
  if (maxAgeMs > 0) {
    for (const entry of entries) {
      if (now - entry.mtimeMs > maxAgeMs) {
        drop(entry);
      }
    }
  }

  // 2. Por tamanho (LRU: remove os mais velhos primeiro até ficar sob o teto).
  if (maxBytes > 0) {
    const alive = entries
      .filter((entry) => entry.alive)
      .sort((
        left,
        right,
      ) => left.mtimeMs - right.mtimeMs);

    let total = alive.reduce(
      (
        sum,
        entry,
      ) => sum + entry.size,
      0,
    );

    for (const entry of alive) {
      if (total <= maxBytes) {
        break;
      }

      total -= entry.size;
      drop(entry);
    }
  }

  return result;
}

/**
 * Remove dirs de versão de cache ÓRFÃOS (irmãos `audit-ev-*` != o atual) — peso morto deixado por
 * bumps de `EV_CACHE_VERSION`. Só remove subdiretórios.
 *
 * @param {string} currentCacheDir - Caminho do dir de cache atual (ex.: `.../audit-ev-v6`).
 * @returns {string[]} Nomes dos dirs órfãos removidos.
 */
export function cleanOrphanCacheVersions(currentCacheDir: string): string[] {
  const parent = dirname(currentCacheDir);
  const current = basename(currentCacheDir);

  if (!existsSync(parent)) {
    return [];
  }

  const removed: string[] = [];

  for (const entry of readdirSync(
    parent,
    { withFileTypes: true },
  )) {
    if (
      entry.isDirectory()
      && entry.name.startsWith('audit-ev-')
      && entry.name !== current
    ) {
      rmSync(
        join(
          parent,
          entry.name,
        ),
        {
          recursive: true,
          force: true,
        },
      );

      removed.push(entry.name);
    }
  }

  return removed;
}
