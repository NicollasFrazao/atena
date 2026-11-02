import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '@prisma/client';

/** Default MySQL port, used when `DATABASE_URL` names none. */
const MYSQL_DEFAULT_PORT = 3306;

/**
 * Turns `DATABASE_URL` (`mysql://user:password@host:port/database`) into the pool options of the
 * MariaDB driver, which Prisma 7 needs as a driver adapter (MySQL wire protocol).
 *
 * @param databaseUrl - Connection URL.
 *
 * @returns Host, port, credentials and database for the pool.
 */
export function poolConfigFrom(databaseUrl: string): {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
} {
  const url = new URL(databaseUrl);

  return {
    host: url.hostname,
    port: url.port
      ? Number(url.port)
      : MYSQL_DEFAULT_PORT,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1)),
  };
}

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
  /** Connects through the MariaDB driver adapter, which Prisma 7 requires for MySQL. */
  constructor() {
    super({ adapter: new PrismaMariaDb(poolConfigFrom(process.env.DATABASE_URL ?? 'mysql://localhost/atena')) });
  }

  /**
   * Abre a conexão com o banco quando o módulo é inicializado.
   *
   * @returns Resolve após `$connect()`.
   */
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  /**
   * Encerra a conexão com o banco no shutdown do módulo.
   *
   * @returns Resolve após `$disconnect()`.
   */
  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
