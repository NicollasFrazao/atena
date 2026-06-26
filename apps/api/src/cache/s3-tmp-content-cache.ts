import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ContentCacheInterface } from './content-cache.interface';

/**
 * Implementação read-through do ContentCacheInterface: `/tmp` (cache efêmero) ↔ S3 (origem durável).
 * `ref` é um ponteiro de conteúdo (ex.: `s3://bucket/key` ou uma key no bucket de conteúdo).
 */
@Injectable()
export class S3TmpContentCache implements ContentCacheInterface {
  private readonly logger = new Logger(S3TmpContentCache.name);

  private readonly s3: S3Client;

  private readonly tmpDir: string;

  private readonly contentBucket: string;

  /**
   * @param {ConfigService} config - Fonte de `aws.region`, `cache.tmpDir` e `s3.contentBucket`.
   */
  constructor(config: ConfigService) {
    this.s3 = new S3Client({ region: config.get<string>('aws.region') });
    // eslint-disable-next-line sonarjs/publicly-writable-directories -- /tmp = cache transitório read-through por design (decisão #8); sobrescrevível via ATENA_TMP_CACHE_DIR.
    this.tmpDir = config.get<string>('cache.tmpDir') ?? '/tmp/atena-cache';
    this.contentBucket = config.get<string>('s3.contentBucket') ?? '';
  }

  /**
   * Lê o conteúdo bruto read-through: tenta o cache `/tmp`; em miss, hidrata do S3
   * (origem durável) e popula o `/tmp`. Falha de hidratação é logada e retorna `null`
   * (o `/tmp` é efêmero/rebuildável; o cache não é fonte de verdade).
   *
   * @param {string} ref - Ponteiro de conteúdo (`s3://bucket/key` ou key no bucket de conteúdo).
   * @returns {Promise<Buffer | null>} Conteúdo bruto, ou `null` se não encontrado/falha de hidratação.
   */
  async get(ref: string): Promise<Buffer | null> {
    const localPath = this.localPathFor(ref);

    // 1) tenta o cache /tmp
    try {
      return await readFile(localPath);
    } catch {
      // miss — segue para hidratar do S3
    }

    // 2) hidrata do S3 (origem durável) e popula o /tmp
    const {
      bucket,
      key,
    } = this.parseRef(ref);

    try {
      const res = await this.s3.send(new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      }));

      const body = res.Body as { transformToByteArray?: () => Promise<Uint8Array> } | undefined;

      // @todo tratar streaming grande sem carregar tudo em memória
      const bytes = body?.transformToByteArray
        ? await body.transformToByteArray()
        : new Uint8Array();

      const buffer = Buffer.from(bytes);

      await mkdir(
        this.tmpDir,
        { recursive: true },
      );

      await writeFile(
        localPath,
        buffer,
      );

      return buffer;
    } catch (err) {
      this.logger.warn(`Falha ao hidratar conteúdo do S3 para ref=${ref}: ${(err as Error).message}`);

      return null;
    }
  }

  /**
   * Conveniência: o mesmo que `get`, decodificado como UTF-8.
   *
   * @param {string} ref - Ponteiro de conteúdo (ver `get`).
   * @returns {Promise<string | null>} Conteúdo como texto UTF-8, ou `null` se não encontrado.
   */
  async getText(ref: string): Promise<string | null> {
    const buf = await this.get(ref);

    return buf
      ? buf.toString('utf-8')
      : null;
  }

  /**
   * Caminho determinístico no /tmp para um ref (hash para não vazar key no filesystem).
   *
   * @param {string} ref - Ponteiro de conteúdo.
   * @returns {string} Caminho local no `tmpDir`, nomeado pelo SHA-256 hex do `ref`.
   */
  private localPathFor(ref: string): string {
    const safe = createHash('sha256').update(ref).digest('hex');

    return join(
      this.tmpDir,
      safe,
    );
  }

  /**
   * Resolve `s3://bucket/key` ou uma key relativa ao bucket de conteúdo configurado.
   *
   * @param {string} ref - Ponteiro de conteúdo (`s3://bucket/key` ou key relativa).
   * @returns {{ bucket: string; key: string }} Bucket e key do S3 a usar no `GetObjectCommand`.
   */
  private parseRef(ref: string): {
    bucket: string;
    key: string
  } {
    if (ref.startsWith('s3://')) {
      const without = ref.slice('s3://'.length);
      const slash = without.indexOf('/');

      // `s3://bucket` sem `/key`: `slice(0, -1)` mutilaria o bucket e a key viraria o bucket
      // inteiro (GetObject incorreto e difícil de diagnosticar). Falha explícita.
      if (slash === -1) {
        throw new Error(`Ref S3 inválida (sem key): ${ref}`);
      }

      return {
        bucket: without.slice(
          0,
          slash,
        ),
        key: without.slice(slash + 1),
      };
    }

    return {
      bucket: this.contentBucket,
      key: ref,
    };
  }
}
