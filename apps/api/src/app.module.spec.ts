import { Test } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppModule } from './app.module';
import { PrismaService } from './prisma/prisma.service';

/**
 * Integração: sobe o grafo completo de módulos (Config/Prisma/Auth/Audit/Llm/Cache)
 * com o Prisma mockado (sem banco) e confirma que a DI resolve e o /health responde.
 */
describe('AppModule (integração)', () => {
  it('compila o grafo de módulos e o /health responde ok', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({
        $connect: jest.fn(),
        $disconnect: jest.fn(),
        onModuleInit: jest.fn(),
        onModuleDestroy: jest.fn(),
      })
      .compile();

    const controller = moduleRef.get(AppController);

    expect(controller.health()).toEqual({
      status: 'ok',
      service: 'atena-api',
    });

    await moduleRef.close();
  });
});
