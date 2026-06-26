import { NotFoundException } from '@nestjs/common';
import type { AuditService } from '../audit/audit.service';
import { AppException } from '../common/exceptions/app.exception';
import type { PrismaService } from '../prisma/prisma.service';
import type { SupportGateway } from '../realtime/support.gateway';
import type { ResolveIncidentDto } from './dto/resolve-incident.dto';
import { IncidentLifecycleService } from './incident-lifecycle.service';
import type { IncidentsService } from './incidents.service';

/** Monta o serviço com Prisma/Audit/Incidents/Gateway mockados a partir de um incidente. */
function buildService(incidentRow: Record<string, unknown> | null): {
  service: IncidentLifecycleService;
  prisma: PrismaService;
  audit: AuditService;
  incidents: IncidentsService;
  realtime: SupportGateway;
} {
  const prisma = {
    incident: {
      findUnique: jest.fn().mockResolvedValue(incidentRow),
      update: jest.fn().mockResolvedValue({}),
    },
    incidentActivity: {
      create: jest.fn().mockResolvedValue({
        id: 'act-1',
        userId: 'rafael',
        occurredAt: new Date('2026-06-17T12:00:00Z'),
      }),
    },
  } as unknown as PrismaService;

  const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;

  const incidents = {
    get: jest.fn().mockResolvedValue({
      id: 'INC-1',
      status: 'acknowledged',
      activities: [],
    }),
  } as unknown as IncidentsService;

  const realtime = { broadcast: jest.fn() } as unknown as SupportGateway;

  const service = new IncidentLifecycleService(
    prisma,
    audit,
    incidents,
    realtime,
  );

  return {
    service,
    prisma,
    audit,
    incidents,
    realtime,
  };
}

/** Payload de resolução válido (descrição ≥ 20 chars, categoria sem escalonamento). */
const VALID_RESOLVE: ResolveIncidentDto = {
  action_category: 'provider_recovered',
  action_description: 'Provedor normalizou a entrega após o reroteamento.',
};

describe('IncidentLifecycleService', () => {
  describe('acknowledge', () => {
    it('detected → acknowledged: atualiza, registra atividade e audita', async () => {
      const {
        service,
        prisma,
        audit,
        incidents,
        realtime,
      } = buildService({
        id: 'INC-1',
        status: 'detected',
      });

      await service.acknowledge(
        'INC-1',
        'rafael',
      );

      expect(realtime.broadcast).toHaveBeenCalledWith(expect.objectContaining({
        type: 'incident.updated',
        status: 'acknowledged',
      }));

      expect(prisma.incident.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'INC-1' },
        data: expect.objectContaining({
          status: 'acknowledged',
          acknowledgedBy: 'rafael',
        }),
      }));

      expect(prisma.incidentActivity.create).toHaveBeenCalled();

      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'incident_ack' }));

      expect(incidents.get).toHaveBeenCalledWith('INC-1');
    });

    it('recusa reconhecer fora de "detected"', async () => {
      const {
        service,
        prisma,
      } = buildService({
        id: 'INC-1',
        status: 'resolved',
      });

      await expect(service.acknowledge(
        'INC-1',
        'rafael',
      )).rejects.toBeInstanceOf(AppException);

      expect(prisma.incident.update).not.toHaveBeenCalled();
    });

    it('404 quando o incidente não existe', async () => {
      const { service } = buildService(null);

      await expect(service.acknowledge(
        'nope',
        'rafael',
      )).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('resolve', () => {
    it('resolve válido: status resolved + atividade + audit incident_resolve', async () => {
      const {
        service,
        prisma,
        audit,
        realtime,
      } = buildService({
        id: 'INC-1',
        status: 'acknowledged',
      });

      await service.resolve(
        'INC-1',
        VALID_RESOLVE,
        'rafael',
      );

      expect(prisma.incident.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          status: 'resolved',
          resolvedBy: 'rafael',
        }),
      }));

      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'incident_resolve' }));

      expect(realtime.broadcast).toHaveBeenCalledWith(expect.objectContaining({
        type: 'incident.updated',
        status: 'resolved',
      }));
    });

    it('recusa resolver um incidente já resolvido', async () => {
      const {
        service,
        prisma,
      } = buildService({
        id: 'INC-1',
        status: 'resolved',
      });

      await expect(service.resolve(
        'INC-1',
        VALID_RESOLVE,
        'rafael',
      )).rejects.toBeInstanceOf(AppException);

      expect(prisma.incident.update).not.toHaveBeenCalled();
    });

    it('exige action_description com ao menos 20 chars', async () => {
      const { service } = buildService({
        id: 'INC-1',
        status: 'detected',
      });

      await expect(service.resolve(
        'INC-1',
        {
          action_category: 'other',
          action_description: 'curto',
        },
        'rafael',
      )).rejects.toBeInstanceOf(AppException);
    });

    it('exige escalated_to quando a categoria é de escalonamento', async () => {
      const { service } = buildService({
        id: 'INC-1',
        status: 'detected',
      });

      await expect(service.resolve(
        'INC-1',
        {
          action_category: 'provider_escalated',
          action_description: 'Abri ticket no provedor e acompanhei a normalização.',
        },
        'rafael',
      )).rejects.toBeInstanceOf(AppException);
    });

    it('auto_resolved aceita descrição com ao menos 10 chars', async () => {
      const {
        service,
        prisma,
      } = buildService({
        id: 'INC-1',
        status: 'auto_resolved',
      });

      await service.resolve(
        'INC-1',
        {
          action_category: 'monitoring_only',
          action_description: 'normalizou',
        },
        'rafael',
      );

      expect(prisma.incident.update).toHaveBeenCalled();
    });
  });

  describe('addComment', () => {
    it('grava incident_activity do tipo comment', async () => {
      const {
        service,
        prisma,
      } = buildService({
        id: 'INC-1',
        status: 'detected',
      });

      const activity = await service.addComment(
        'INC-1',
        'Investigando com o provedor.',
        'rafael',
      );

      expect(prisma.incidentActivity.create).toHaveBeenCalled();
      expect(activity.type).toBe('comment');
    });

    it('404 quando o incidente não existe', async () => {
      const { service } = buildService(null);

      await expect(service.addComment(
        'nope',
        'oi',
        'rafael',
      )).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
