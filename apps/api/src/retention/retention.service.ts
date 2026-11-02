import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MS_PER_DAY } from '../common/units';
import { DEFAULT_CHAT_RETENTION_DAYS } from '../config/configuration';
import { PrismaService } from '../prisma/prisma.service';

/** Resumo de uma execução de retenção. */
export interface RetentionRunSummaryInterface {
  /** Sessões removidas. */
  sessions: number;
  /** Mensagens removidas (das sessões expiradas). */
  messages: number;
}

/**
 * Retenção do chat: apaga sessões (e suas mensagens) inativas há mais que a janela configurada
 * (`retention.chatDays`, default 90), cumprindo o rótulo do Histórico. Roda 1×/dia (gateado por
 * `retention.enabled`) e também sob demanda via `POST /api/dev/retention`.
 *
 * Escopo: SÓ o chat (dado mutável da aplicação). O `audit_log` é append-only por design — sua
 * retenção (1 ano) é responsabilidade de infra/DBA, não do app.
 *
 * @see PrismaService - acesso às tabelas `chat_sessions`/`chat_messages`.
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  /**
   * @param prisma - Acesso ao banco da aplicação.
   * @param config - Flags/janela de retenção.
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Job diário (03:00): roda a retenção do chat se `retention.enabled` estiver ligado.
   *
   * @returns Resolve ao fim (ou imediatamente se desligado).
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async scheduled(): Promise<void> {
    if (this.config.get<boolean>('retention.enabled') === false) {
      return;
    }

    const summary = await this.run();

    if (summary.sessions > 0) {
      this.logger.log(`retenção: ${summary.sessions} sessão(ões) e ${summary.messages} mensagem(ns) removidas`);
    }
  }

  /**
   * Apaga as sessões inativas (por `last_activity`) além da janela e suas mensagens. As mensagens
   * são removidas primeiro (a FK `chat_messages.session_id` é restritiva).
   *
   * @param now - Instante de referência (injetável p/ testes).
   *
   * @returns Contagens removidas.
   */
  async run(now: Date = new Date()): Promise<RetentionRunSummaryInterface> {
    const chatDays = this.config.get<number>('retention.chatDays') ?? DEFAULT_CHAT_RETENTION_DAYS;
    const cutoff = new Date(now.getTime() - chatDays * MS_PER_DAY);

    const messages = await this.prisma.chatMessage.deleteMany({
      where: { session: { lastActivity: { lt: cutoff } } },
    });

    const sessions = await this.prisma.chatSession.deleteMany({
      where: { lastActivity: { lt: cutoff } },
    });

    return {
      sessions: sessions.count,
      messages: messages.count,
    };
  }
}
