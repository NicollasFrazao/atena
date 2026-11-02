/**
 * Cache transitório read-through dos dados brutos de conteúdo/trilha (decisão #8).
 *
 * NÃO é fonte de verdade — é só um cache em `/tmp` para (a) evitar muitas requisições
 * ao S3 num curto período e (b) manter os dados brutos fora do banco. A origem durável
 * é o S3; o `/tmp` é efêmero/rebuildável.
 */
export interface ContentCacheInterface {
  /**
   * Lê o conteúdo bruto: tenta o `/tmp`; se faltar, hidrata do S3 e popula o `/tmp`.
   *
   * @param ref - Ponteiro de conteúdo (ex.: `s3://bucket/key` ou key no bucket de conteúdo).
   *
   * @returns Conteúdo bruto, ou `null` se não encontrado/falha de hidratação.
   */
  get(ref: string): Promise<Buffer | null>;
  /**
   * Conveniência: o mesmo que `get`, decodificado como UTF-8.
   *
   * @param ref - Ponteiro de conteúdo (ver `get`).
   *
   * @returns Conteúdo como texto UTF-8, ou `null` se não encontrado.
   */
  getText(ref: string): Promise<string | null>;
}

/** Token de injeção do NestJS para o `ContentCacheInterface`. */
export const CONTENT_CACHE = Symbol('CONTENT_CACHE');
