import { SetMetadata, type CustomDecorator } from '@nestjs/common';

/** Chave de metadados que marca um handler/controller como público (sem auth). */
export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marca um handler/controller como **público**: o `AuthGuard` global o libera
 * sem exigir sessão (ex.: `/health`, fluxo de login `/auth/*`).
 *
 * @returns {CustomDecorator} Decorator que grava a marca de rota pública.
 */
export const Public = (): CustomDecorator => SetMetadata(
  IS_PUBLIC_KEY,
  true,
);
