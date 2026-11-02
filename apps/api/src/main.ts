import './tracing'; // dd-trace ANTES de tudo: auto-instrumenta HTTP/Nest/Prisma (APM Datadog)
import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { DEFAULT_APP_PORT } from './config/configuration';

/**
 * Sobe a aplicação NestJS da Atena.
 *
 * Configura o app HTTP e inicia a escuta na porta resolvida da config:
 * - `setGlobalPrefix('api')`: todos os endpoints ficam sob `/api/...` (contrato),
 *   exceto `/health`, que permanece na raiz para healthchecks de infra.
 * - `ValidationPipe` global com `whitelist` (remove campos não declarados) e
 *   `transform` (converte payloads para os tipos dos DTOs).
 * - `cookie-parser` (lê o cookie de sessão JWT no `AuthGuard`).
 * - CORS com `credentials: true` e allowlist explícita de origins do frontend
 *   (o cookie de sessão é cross-origin; `*` não é válido com credenciais).
 *
 * A porta vem de `app.port` (lido do `.env` único em runtime), com fallback 3000.
 *
 * @returns Resolve quando o servidor está escutando.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  // Endpoints da API sob /api (o contrato usa /api/...); /health fica fora p/ healthchecks.
  app.setGlobalPrefix(
    'api',
    { exclude: ['health'] },
  );

  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    transform: true,
  }));

  app.use(cookieParser());

  const config = app.get(ConfigService);

  app.enableCors({
    origin: config.get<string[]>('auth.corsOrigins') ?? true,
    credentials: true,
  });

  const port = config.get<number>('app.port') ?? DEFAULT_APP_PORT;
  await app.listen(port);
}

void bootstrap();
