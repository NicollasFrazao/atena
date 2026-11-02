import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  AnomalyRule,
  Prisma,
} from '@prisma/client';
import type {
  AnomalyRuleInterface,
  ThresholdUnitType,
} from '@atena/types';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateRuleDto } from './dto/update-rule.dto';

/**
 * Regras de anomalia (Fase 2, task 2.2): leitura e edição da tela de Regras.
 *
 * `rule_type` é imutável; só `threshold`/`dimension`/`window_minutes`/`severity`/
 * `enabled` são editáveis (§02-data-model). Toda edição grava `rule_update` no
 * audit log. Não é tool do LLM — é configuração via UI.
 *
 * @see AuditService - trilha append-only das edições de regra.
 */
@Injectable()
export class RulesService {
  /**
   * @param prisma - Acesso à tabela `anomaly_rules`.
   * @param audit - Gravação no audit log (append-only).
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Lista todas as regras (a tela de Regras carrega o conjunto completo).
   *
   * @returns Regras normalizadas (snake_case).
   */
  async list(): Promise<AnomalyRuleInterface[]> {
    const rows = await this.prisma.anomalyRule.findMany({ orderBy: { id: 'asc' } });

    return rows.map((rule) => this.toRule(rule));
  }

  /**
   * Edita os campos permitidos de uma regra, marca o editor e audita a mudança.
   *
   * @param id - Id da regra.
   * @param dto - Campos a atualizar (parcial; `rule_type` imutável).
   * @param userId - Editor (`sub`).
   *
   * @returns Regra atualizada (snake_case).
   *
   * @throws {NotFoundException} Se a regra não existir.
   */
  async update(
    id: string,
    dto: UpdateRuleDto,
    userId: string | undefined,
  ): Promise<AnomalyRuleInterface> {
    const existing = await this.prisma.anomalyRule.findUnique({ where: { id } });

    if (!existing) {
      throw new NotFoundException({
        error: {
          code: 'not_found',
          message: 'Regra não encontrada',
        },
      });
    }

    const data: Prisma.AnomalyRuleUpdateInput = { updatedBy: userId ?? null };

    if (dto.name !== undefined) {
      data.name = dto.name;
    }

    if (dto.threshold !== undefined) {
      data.threshold = dto.threshold;
    }

    if (dto.dimension !== undefined) {
      data.dimension = dto.dimension;
    }

    if (dto.window_minutes !== undefined) {
      data.windowMinutes = dto.window_minutes;
    }

    if (dto.severity !== undefined) {
      data.severity = dto.severity;
    }

    if (dto.enabled !== undefined) {
      data.enabled = dto.enabled;
    }

    if (dto.shadow_mode !== undefined) {
      data.shadowMode = dto.shadow_mode;
    }

    const updated = await this.prisma.anomalyRule.update({
      where: { id },
      data,
    });

    await this.audit.record({
      userId,
      action: 'rule_update',
      resource: `PUT /rules/${id}`,
      severity: 'config',
      metadata: {
        rule_id: id,
        changes: Object.keys(dto),
      },
    });

    return this.toRule(updated);
  }

  /**
   * Normaliza um `AnomalyRule` do Prisma para o shape de borda (snake_case).
   *
   * @param rule - Registro de regra do Prisma.
   *
   * @returns Regra em snake_case (`threshold` numérico).
   */
  private toRule(rule: AnomalyRule): AnomalyRuleInterface {
    return {
      id: rule.id,
      name: rule.name,
      rule_type: rule.ruleType,
      dimension: rule.dimension,
      enabled: rule.enabled,
      severity: rule.severity,
      threshold: Number(rule.threshold),
      threshold_unit: rule.thresholdUnit as ThresholdUnitType,
      window_minutes: rule.windowMinutes,
      category: rule.category ?? null,
      shadow_mode: rule.shadowMode,
      updated_by: rule.updatedBy ?? null,
      updated_at: rule.updatedAt.toISOString(),
    };
  }
}
