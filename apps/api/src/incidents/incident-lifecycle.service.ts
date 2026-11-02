import {
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type Incident } from '@prisma/client';
import type {
  ActionCategoryType,
  IncidentActivityInterface,
  IncidentInterface,
  IncidentStatusType,
} from '@atena/types';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/exceptions/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import { SupportGateway } from '../realtime/support.gateway';
import { ResolveIncidentDto } from './dto/resolve-incident.dto';
import { IncidentsService } from './incidents.service';

/** Incidente com a trilha de atividades (shape de saída do lifecycle). */
type IncidentWithActivitiesType = IncidentInterface & { activities: IncidentActivityInterface[] };

/** Categorias de ação que exigem `escalated_to` (§D). */
const ESCALATED_CATEGORIES = new Set<ActionCategoryType>([
  'provider_escalated',
  'internal_escalated',
]);

/** Estados a partir dos quais um incidente pode ser resolvido (§D). */
const RESOLVABLE_FROM = new Set<IncidentStatusType>([
  'detected',
  'acknowledged',
  'auto_resolved',
]);

/** Tamanho mínimo de `action_description` (§D): normal vs. fluxo `auto_resolved`. */
const MIN_DESCRIPTION = 20;
const MIN_DESCRIPTION_AUTO = 10;

/**
 * Lifecycle de incidentes (Fase 2, task 2.4): acknowledge / resolve / comment.
 *
 * É **UI-only** (nunca tool do LLM): muda estado com validação server-side (§D),
 * escreve `incident_activity` (status_change/comment) e grava o audit log. O LLM
 * só LÊ incidentes ({@link IncidentsService}); jamais muda estado (princípio 3).
 *
 * @see IncidentsService - releitura/normalização do incidente atualizado.
 * @see AuditService - trilha append-only das mudanças de estado.
 */
@Injectable()
export class IncidentLifecycleService {
  /**
   * @param prisma - Acesso a incidentes/atividades.
   * @param audit - Gravação no audit log (append-only).
   * @param incidents - Releitura/normalização do incidente atualizado.
   * @param realtime - Push de `incident.updated` aos conectados (/ws/support).
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly incidents: IncidentsService,
    private readonly realtime: SupportGateway,
  ) {}

  /**
   * Reconhece um incidente (`detected` → `acknowledged`).
   *
   * @param id - Id do incidente.
   * @param userId - Operador que reconhece (`sub`).
   *
   * @returns Incidente atualizado + atividades.
   *
   * @throws {NotFoundException} Se o incidente não existir.
   * @throws {AppException} Se a transição de estado for inválida.
   */
  async acknowledge(
    id: string,
    userId: string | undefined,
  ): Promise<IncidentWithActivitiesType> {
    const incident = await this.findOrThrow(id);

    if (incident.status !== 'detected') {
      throw new AppException(
        'invalid_state_transition',
        `Não é possível reconhecer um incidente com status "${incident.status}"`,
        HttpStatus.CONFLICT,
      );
    }

    const now = new Date();

    await this.prisma.incident.update({
      where: { id },
      data: {
        status: 'acknowledged',
        acknowledgedAt: now,
        acknowledgedBy: userId ?? null,
      },
    });

    await this.recordActivity(
      id,
      userId,
      {
        from_status: incident.status,
        to_status: 'acknowledged',
      },
      now,
    );

    await this.audit.record({
      userId,
      action: 'incident_ack',
      resource: `POST /incidents/${id}/acknowledge`,
      severity: 'info',
      metadata: { incident_id: id },
    });

    this.realtime.broadcast({
      type: 'incident.updated',
      incident_id: id,
      status: 'acknowledged',
      acknowledged_by: userId,
      at: now.toISOString(),
    });

    return this.incidents.get(id);
  }

  /**
   * Resolve um incidente manualmente (§D): valida transição + payload, persiste a
   * resolução, registra a atividade e audita.
   *
   * @param id - Id do incidente.
   * @param dto - Categoria/descrição da ação (+ escalonamento/tags).
   * @param userId - Operador que resolve (`sub`).
   *
   * @returns Incidente resolvido + atividades.
   *
   * @throws {NotFoundException} Se o incidente não existir.
   * @throws {AppException} Se a transição for inválida ou o payload não cumprir §D.
   */
  async resolve(
    id: string,
    dto: ResolveIncidentDto,
    userId: string | undefined,
  ): Promise<IncidentWithActivitiesType> {
    const incident = await this.findOrThrow(id);

    if (!RESOLVABLE_FROM.has(incident.status)) {
      throw new AppException(
        'invalid_state_transition',
        `Não é possível resolver um incidente com status "${incident.status}"`,
        HttpStatus.CONFLICT,
      );
    }

    this.validateResolvePayload(
      dto,
      incident.status,
    );

    const now = new Date();

    const data: Prisma.IncidentUpdateInput = {
      status: 'resolved',
      resolvedAt: now,
      resolvedBy: userId ?? null,
      actionCategory: dto.action_category,
      actionDescription: dto.action_description,
      escalatedTo: dto.escalated_to ?? null,
    };

    if (dto.related_shipping_ids) {
      data.relatedShippingIds = dto.related_shipping_ids;
    }

    if (dto.tags) {
      data.tags = dto.tags;
    }

    await this.prisma.incident.update({
      where: { id },
      data,
    });

    await this.recordActivity(
      id,
      userId,
      {
        from_status: incident.status,
        to_status: 'resolved',
        action_category: dto.action_category,
        action_description: dto.action_description,
      },
      now,
    );

    await this.audit.record({
      userId,
      action: 'incident_resolve',
      resource: `POST /incidents/${id}/resolve`,
      severity: 'info',
      metadata: {
        incident_id: id,
        action_category: dto.action_category,
      },
    });

    this.realtime.broadcast({
      type: 'incident.updated',
      incident_id: id,
      status: 'resolved',
      at: now.toISOString(),
    });

    return this.incidents.get(id);
  }

  /**
   * Adiciona um comentário ao incidente (não muda estado).
   *
   * @param id - Id do incidente.
   * @param text - Texto do comentário.
   * @param userId - Autor do comentário (`sub`).
   *
   * @returns Atividade de comentário criada.
   *
   * @throws {NotFoundException} Se o incidente não existir.
   */
  async addComment(
    id: string,
    text: string,
    userId: string | undefined,
  ): Promise<IncidentActivityInterface> {
    await this.findOrThrow(id);

    const now = new Date();

    const activity = await this.prisma.incidentActivity.create({
      data: {
        incidentId: id,
        userId: userId ?? null,
        activityType: 'comment',
        occurredAt: now,
        payload: { text },
      },
    });

    return {
      id: activity.id,
      user_id: activity.userId ?? undefined,
      type: 'comment',
      at: activity.occurredAt.toISOString(),
      payload: { text },
    };
  }

  /**
   * Valida o payload de resolução conforme §D, considerando o estado atual.
   *
   * @param dto - Payload a validar.
   * @param status - Estado atual do incidente.
   *
   * @throws {AppException} Se a descrição for curta ou faltar `escalated_to`.
   */
  private validateResolvePayload(
    dto: ResolveIncidentDto,
    status: IncidentStatusType,
  ): void {
    const minLength = status === 'auto_resolved'
      ? MIN_DESCRIPTION_AUTO
      : MIN_DESCRIPTION;

    if (dto.action_description.trim().length < minLength) {
      throw new AppException(
        'validation_error',
        `action_description deve ter ao menos ${minLength} caracteres`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    if (
      ESCALATED_CATEGORIES.has(dto.action_category)
      && !dto.escalated_to?.trim()
    ) {
      throw new AppException(
        'validation_error',
        'escalated_to é obrigatório quando a categoria é de escalonamento',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
  }

  /**
   * Busca um incidente ou lança 404 (mesmo shape de erro do read).
   *
   * @param id - Id do incidente.
   *
   * @returns Registro do incidente.
   *
   * @throws {NotFoundException} Se não existir.
   */
  private async findOrThrow(id: string): Promise<Incident> {
    const incident = await this.prisma.incident.findUnique({ where: { id } });

    if (!incident) {
      throw new NotFoundException({
        error: {
          code: 'not_found',
          message: 'Incidente não encontrado',
        },
      });
    }

    return incident;
  }

  /**
   * Registra uma atividade de mudança de estado (`status_change`) no incidente.
   *
   * @param incidentId - Id do incidente.
   * @param userId - Operador que gerou a atividade.
   * @param payload - Detalhe (from/to status, ação).
   * @param occurredAt - Instante da atividade.
   *
   * @returns Resolve quando a atividade é gravada.
   */
  private async recordActivity(
    incidentId: string,
    userId: string | undefined,
    payload: Record<string, unknown>,
    occurredAt: Date,
  ): Promise<void> {
    await this.prisma.incidentActivity.create({
      data: {
        incidentId,
        userId: userId ?? null,
        activityType: 'status_change',
        occurredAt,
        payload: payload as Prisma.InputJsonValue,
      },
    });
  }
}
