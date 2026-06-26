import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Cliente Prisma (MySQL) — hot store de metadados + audit log.
 *
 * Estende `PrismaClient` e gerencia o ciclo de vida da conexão via hooks do Nest.
 *
 * Invariante: o orquestrador LLM NUNCA usa este serviço diretamente — só a
 * aplicação (tools/serviços) toca o banco.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  /**
   * Abre a conexão com o banco quando o módulo é inicializado.
   *
   * @returns {Promise<void>} Resolve após `$connect()`.
   */
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  /**
   * Encerra a conexão com o banco no shutdown do módulo.
   *
   * @returns {Promise<void>} Resolve após `$disconnect()`.
   */
  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
