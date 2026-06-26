import { Global, Module } from '@nestjs/common';
import { CONTENT_CACHE } from './content-cache.interface';
import { S3TmpContentCache } from './s3-tmp-content-cache';

/**
 * Cache transitório de conteúdo/trilha (`/tmp` ↔ S3). Read-through e efêmero/rebuildável:
 * NÃO é fonte de verdade (a origem durável é o S3). `@Global` para injeção sem reimportar.
 * Trocável: basta prover outra implementação de `ContentCacheInterface` no token `CONTENT_CACHE`.
 *
 * @module CacheModule
 */
@Global()
@Module({
  providers: [{
    provide: CONTENT_CACHE,
    useClass: S3TmpContentCache,
  }],
  exports: [CONTENT_CACHE],
})
export class CacheModule {}
