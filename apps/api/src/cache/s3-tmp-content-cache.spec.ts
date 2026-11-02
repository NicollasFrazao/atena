import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  GetObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { S3TmpContentCache } from './s3-tmp-content-cache';

/** ConfigService fake backed by a plain key → value map. */
function configOf(values: Record<string, unknown>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

/** Path the cache uses for a ref (SHA-256 of the ref inside the tmp dir). */
function cachedPath(
  dir: string,
  ref: string,
): string {
  return join(
    dir,
    createHash('sha256').update(ref).digest('hex'),
  );
}

/** S3 GetObject response whose body yields the given text. */
function s3Body(text: string): { Body: { transformToByteArray: () => Promise<Uint8Array> } } {
  return { Body: { transformToByteArray: () => Promise.resolve(new TextEncoder().encode(text)) } };
}

describe('S3TmpContentCache', () => {
  let dir: string;
  let send: jest.SpyInstance;
  let logWarn: jest.SpyInstance;

  beforeEach(() => {
    dir = mkdtempSync(join(
      tmpdir(),
      'atena-content-cache-',
    ));

    send = jest.spyOn(
      S3Client.prototype,
      'send',
    );

    logWarn = jest.spyOn(
      Logger.prototype,
      'warn',
    ).mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();

    rmSync(
      dir,
      {
        recursive: true,
        force: true,
      },
    );
  });

  /** Cache under test, pointed at the per-test tmp dir. */
  function newCache(): S3TmpContentCache {
    return new S3TmpContentCache(configOf({
      'aws.region': 'us-east-1',
      'cache.tmpDir': dir,
      's3.contentBucket': 'content-bucket',
    }));
  }

  it('serves a cached ref from the tmp dir without touching S3', async () => {
    writeFileSync(
      cachedPath(
        dir,
        'cached-key',
      ),
      'from tmp',
    );

    const text = await newCache().getText('cached-key');

    expect(text).toBe('from tmp');
    expect(send).not.toHaveBeenCalled();
  });

  it('hydrates an s3:// ref from its bucket/key and populates the tmp cache', async () => {
    send.mockResolvedValue(s3Body('from s3'));

    const cache = newCache();
    const ref = 's3://audit-bucket/path/to/object.json';

    const first = await cache.get(ref);
    const second = await cache.getText(ref);

    expect(first?.toString('utf-8')).toBe('from s3');
    expect(second).toBe('from s3');
    expect(send).toHaveBeenCalledTimes(1);

    const command = send.mock.calls[0][0] as GetObjectCommand;

    expect(command).toBeInstanceOf(GetObjectCommand);

    expect(command.input).toEqual({
      Bucket: 'audit-bucket',
      Key: 'path/to/object.json',
    });

    expect(readFileSync(
      cachedPath(
        dir,
        ref,
      ),
      'utf-8',
    )).toBe('from s3');
  });

  it('resolves a relative ref against the configured content bucket', async () => {
    send.mockResolvedValue(s3Body('relative'));

    await newCache().get('contents/123.txt');

    expect((send.mock.calls[0][0] as GetObjectCommand).input).toEqual({
      Bucket: 'content-bucket',
      Key: 'contents/123.txt',
    });
  });

  it('caches an empty buffer when the S3 object has no readable body', async () => {
    send.mockResolvedValue({});

    const buffer = await newCache().get('empty-key');

    expect(buffer).toEqual(Buffer.alloc(0));

    expect(readFileSync(cachedPath(
      dir,
      'empty-key',
    ))).toEqual(Buffer.alloc(0));
  });

  it('returns null and logs a warning when the S3 hydration fails', async () => {
    send.mockRejectedValue(new Error('NoSuchKey'));

    const cache = newCache();

    await expect(cache.get('missing-key')).resolves.toBeNull();
    await expect(cache.getText('missing-key')).resolves.toBeNull();
    expect(logWarn).toHaveBeenCalledWith(expect.stringContaining('ref=missing-key: NoSuchKey'));
  });

  it('falls back to an empty content bucket when none is configured', async () => {
    send.mockRejectedValue(new Error('NoSuchBucket'));

    const cache = new S3TmpContentCache(configOf({ 'cache.tmpDir': dir }));

    await expect(cache.get('orphan-key')).resolves.toBeNull();

    expect((send.mock.calls[0][0] as GetObjectCommand).input).toEqual({
      Bucket: '',
      Key: 'orphan-key',
    });
  });

  it('uses the default /tmp/atena-cache dir when cache.tmpDir is not configured', async () => {
    send.mockRejectedValue(new Error('offline'));

    const cache = new S3TmpContentCache(configOf({}));

    await expect(cache.get(`unit-test-never-cached-${Date.now()}`)).resolves.toBeNull();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('rejects an s3:// ref without a key instead of guessing the bucket', async () => {
    await expect(newCache().get('s3://bucket-only')).rejects.toThrow('Ref S3 inválida (sem key): s3://bucket-only');
    expect(send).not.toHaveBeenCalled();
  });
});
