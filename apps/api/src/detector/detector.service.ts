import {
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { Prisma, type AnomalyRule, type Incident } from '@prisma/client';
import type { IncidentInterface } from '@atena/types';
import { AUDIT_QUERY, type AuditQueryServiceInterface } from '../audit-query/audit-query.interface';
import { appTimeZone } from '../audit-query/tz';
import { MS_PER_MINUTE, MS_PER_SECOND } from '../common/units';
import { DEFAULT_DETECT_BASELINE_WINDOWS, DEFAULT_DETECT_MIN_TERMINAL_VOLUME } from '../config/configuration';
import { PrismaService } from '../prisma/prisma.service';
import { SupportGateway } from '../realtime/support.gateway';
import { detectDeliveryRateDrop } from './delivery-rate-drop.detector';
import { detectFailureSpike } from './failure-spike.detector';
import { detectConsistentError } from './consistent-error.detector';
import { detectWebhookSilence } from './webhook-silence.detector';
import type {
  DetectionInterface,
  DetectorOptionsInterface,
  DetectorRuleInterface,
  ShippingSampleInterface,
} from './detection.types';

/**
 * Periodicidade do scan agendado (gate por `detect.enabled`), em segundos via env. Default 180s
 * (3min): o detector compete com as buscas do usuário pela única instância DuckDB, então rodar a
 * cada 60s mantinha o motor ocupado boa parte do tempo (e atrasava o stream do chat). 3min ainda é
 * pronto o bastante p/ anomalias de janela de 15min; o trigger manual `POST /api/dev/detect` é imediato.
 * Lido do `process.env` (a env do container já está disponível na carga do módulo, antes do `@Interval`).
 */
const DETECT_INTERVAL_MS = Number.parseInt(
  process.env.DETECT_INTERVAL_SECONDS ?? '180',
  10,
) * MS_PER_SECOND;

/** Nota registrada ao auto-resolver um incidente. */
const AUTO_RESOLVE_NOTE = 'Métrica voltou à baseline sem intervenção.';

/** Teto de ids de mensagens impactadas persistidos no incidente (evita payload gigante). */
const RELATED_IDS_CAP = 5000;

/** Tipos de regra com detector real (qualquer tipo futuro fora deste set é stub e não reconcilia). */
const IMPLEMENTED_RULE_TYPES: ReadonlySet<string> = new Set([
  'delivery_rate_drop',
  'failure_spike',
  'consistent_error',
  'webhook_silence',
]);

/** Resumo de uma execução do detector. */
export interface DetectorRunSummaryInterface {
  detected: number;
  created: number;
  auto_resolved: number;
}

/** Amostras materializadas UMA vez por ciclo (reusadas por todas as regras; recorte por detector). */
interface DetectorSamplesInterface {
  terminals: ShippingSampleInterface[];
  sends: ShippingSampleInterface[];
}

/**
 * Formata a janela de detecção como rótulo legível **no fuso de exibição do operador** (ex.:
 * `23/06 16:40 → 16:55 GMT-3 (15 min)`), via `Intl` — igual ao resto do app (relatórios/observabilidade).
 * Exibido no card do incidente (chat), na lista e no detalhe. O instante canônico (UTC) continua nas
 * colunas estruturadas e em `window_from`/`window_to` (consumo por máquina).
 *
 * @param start - Início da janela (instante UTC).
 * @param end - Fim da janela (≈ instante da detecção, UTC).
 *
 * @returns Rótulo legível da janela no fuso de exibição.
 */
function formatDetectionWindow(
  start: Date,
  end: Date,
): string {
  const timeZone = appTimeZone();

  const hhmm = (date: Date): string => new Intl.DateTimeFormat(
    'pt-BR',
    {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    },
  ).format(date);

  const dayMonth = new Intl.DateTimeFormat(
    'pt-BR',
    {
      timeZone,
      day: '2-digit',
      month: '2-digit',
    },
  ).format(end);

  let tzLabel: string;

  try {
    const named = new Intl.DateTimeFormat(
      'pt-BR',
      {
        timeZone,
        timeZoneName: 'shortOffset',
      },
    ).formatToParts(end).find((part) => part.type === 'timeZoneName');

    tzLabel = named?.value ?? timeZone;
  } catch {
    tzLabel = timeZone;
  }

  const minutes = Math.max(
    1,
    Math.round((end.getTime() - start.getTime()) / MS_PER_MINUTE),
  );

  return `${dayMonth} ${hhmm(start)} → ${hhmm(end)} ${tzLabel} (${minutes} min)`;
}

/**
 * Detector de anomalias (Fase 2). Motor plugável por tipo de regra, todos reais:
 * `delivery_rate_drop` (queda de entrega σ vs baseline), `failure_spike` (piso de taxa de
 * falha), `consistent_error` (categoria de falha dominante) — por cliente — e `webhook_silence`
 * (silêncio de callbacks por X min apesar de envios) — por provider.
 *
 * Reconciliação idempotente: cria `incident` (status `detected`) sem duplicar a
 * mesma dimensão e **auto-resolve** os incidentes abertos cuja anomalia sumiu —
 * empurrando `incident.created`/`incident.auto_resolved` pelo {@link SupportGateway}.
 * Roda no `@Interval` (se `detect.enabled`) e no gatilho dev `POST /api/dev/detect`.
 */
@Injectable()
export class DetectorService {
  private readonly logger = new Logger(DetectorService.name);

  /**
   * @param audit - Amostras de entrega (terminais/envios) do S3.
   * @param prisma - Incidentes e atividades (dado da aplicação).
   * @param realtime - Push de `incident.created`/`auto_resolved`.
   * @param config - Flags/calibração do detector (`detect.*`).
   */
  constructor(
    @Inject(AUDIT_QUERY) private readonly audit: AuditQueryServiceInterface,
    private readonly prisma: PrismaService,
    private readonly realtime: SupportGateway,
    private readonly config: ConfigService,
  ) {}

  /**
   * Scan agendado: roda o detector se `detect.enabled` estiver ligado.
   *
   * @returns Resolve ao fim do scan (ou imediatamente se desligado).
   */
  @Interval(DETECT_INTERVAL_MS)
  async scheduled(): Promise<void> {
    if (!this.config.get<boolean>('detect.enabled')) {
      return;
    }

    const summary = await this.run();

    this.logger.log(`scan: detected=${summary.detected} created=${summary.created} auto_resolved=${summary.auto_resolved}`);
  }

  /**
   * Executa o detector sobre todas as regras habilitadas e reconcilia incidentes.
   *
   * @param now - Instante de referência (injetável p/ testes).
   *
   * @returns Contagens da execução.
   */
  async run(now: Date = new Date()): Promise<DetectorRunSummaryInterface> {
    // Só regras com detector real: um stub (detecção vazia) não pode auto-resolver incidentes.
    const rules = (await this.prisma.anomalyRule.findMany({ where: { enabled: true } }))
      .filter((rule) => IMPLEMENTED_RULE_TYPES.has(rule.ruleType));

    const opts = this.options();

    // Materializa o S3 UMA vez por tipo de amostra (janela mais larga entre as regras) e reusa em
    // todas as regras — antes cada regra fazia seu próprio scan (N materializações/ciclo, competindo
    // com as buscas do usuário). Os detectores são puros e recortam a própria janela das amostras.
    const samples = await this.collectSamples(
      rules,
      now,
      opts,
    );

    const summary: DetectorRunSummaryInterface = {
      detected: 0,
      created: 0,
      auto_resolved: 0,
    };

    for (const rule of rules) {
      const detections = this.runDetector(
        rule,
        samples,
        now,
        opts,
      );

      summary.detected += detections.length;

      const reconciled = await this.reconcile(
        rule,
        detections,
        now,
      );

      summary.created += reconciled.created;
      summary.auto_resolved += reconciled.auto_resolved;
    }

    return summary;
  }

  /** Calibração lida da config (defaults amigáveis a dev). */
  private options(): DetectorOptionsInterface {
    return {
      minTerminalVolume: this.config.get<number>('detect.minTerminalVolume') ?? DEFAULT_DETECT_MIN_TERMINAL_VOLUME,
      baselineWindows: this.config.get<number>('detect.baselineWindows') ?? DEFAULT_DETECT_BASELINE_WINDOWS,
    };
  }

  /**
   * Materializa as amostras do S3 UMA vez por tipo, na janela mais LARGA entre as regras daquele tipo
   * (cada detector recorta a própria janela depois). `webhook_silence` usa ENVIOS (por provider); os
   * demais usam TERMINAIS. Colapsa N materializações/ciclo (uma por regra) em no máx. duas.
   *
   * @param rules - Regras habilitadas (já filtradas p/ tipos implementados).
   * @param now - Instante de referência.
   * @param opts - Calibração (janelas de baseline).
   *
   * @returns Amostras terminais + de envio do lookback.
   */
  private async collectSamples(
    rules: AnomalyRule[],
    now: Date,
    opts: DetectorOptionsInterface,
  ): Promise<DetectorSamplesInterface> {
    const lookbackStart = (subset: AnomalyRule[]): Date => {
      const maxWindow = subset.reduce(
        (
          max,
          rule,
        ) => Math.max(
          max,
          rule.windowMinutes,
        ),
        0,
      );

      return new Date(now.getTime() - maxWindow * MS_PER_MINUTE * (opts.baselineWindows + 1));
    };

    const terminalRules = rules.filter((rule) => rule.ruleType !== 'webhook_silence');
    const webhookRules = rules.filter((rule) => rule.ruleType === 'webhook_silence');

    const terminals = terminalRules.length > 0
      ? await this.terminalSamples(
        lookbackStart(terminalRules),
        now,
      )
      : [];

    const sends = webhookRules.length > 0
      ? await this.sendSamples(
        lookbackStart(webhookRules),
        now,
      )
      : [];

    return {
      terminals,
      sends,
    };
  }

  /**
   * Roda o detector PURO da regra sobre as amostras já materializadas (sem I/O). `webhook_silence`
   * usa as amostras de ENVIOS; os demais usam as TERMINAIS. Cada detector recorta a própria janela.
   *
   * @param rule - Regra habilitada.
   * @param samples - Amostras compartilhadas do ciclo.
   * @param now - Instante de referência.
   * @param opts - Calibração.
   *
   * @returns Anomalias detectadas pela regra.
   */
  private runDetector(
    rule: AnomalyRule,
    samples: DetectorSamplesInterface,
    now: Date,
    opts: DetectorOptionsInterface,
  ): DetectionInterface[] {
    const detectorRule = this.toDetectorRule(rule);

    if (rule.ruleType === 'webhook_silence') {
      return detectWebhookSilence(
        detectorRule,
        samples.sends,
        now,
        opts,
      );
    }

    if (rule.ruleType === 'failure_spike') {
      return detectFailureSpike(
        detectorRule,
        samples.terminals,
        now,
        opts,
      );
    }

    if (rule.ruleType === 'consistent_error') {
      return detectConsistentError(
        detectorRule,
        samples.terminals,
        now,
        opts,
      );
    }

    return detectDeliveryRateDrop(
      detectorRule,
      samples.terminals,
      now,
      opts,
    );
  }

  /**
   * Amostras de TERMINAIS (delivered/failed) no lookback, com `errorHint`, para o
   * `consistent_error`/`delivery_rate_drop`. Janelamento por `finalized_at` (desfecho). Vem do S3.
   *
   * @param lookbackStart - Início do lookback.
   * @param now - Fim do lookback (instante de referência).
   *
   * @returns Amostras terminais.
   */
  private async terminalSamples(
    lookbackStart: Date,
    now: Date,
  ): Promise<ShippingSampleInterface[]> {
    return this.audit.terminalSamples({
      from: lookbackStart,
      to: now,
    });
  }

  /**
   * Amostras de ENVIOS (qualquer status) no lookback, com `provider`/`requestedAt`/`finalizedAt`
   * para o `webhook_silence`. Janelamento por `requested_at` (envio). Vem do S3.
   *
   * @param lookbackStart - Início do lookback.
   * @param now - Fim do lookback (instante de referência).
   *
   * @returns Amostras de envio.
   */
  private async sendSamples(
    lookbackStart: Date,
    now: Date,
  ): Promise<ShippingSampleInterface[]> {
    return this.audit.sendSamples({
      from: lookbackStart,
      to: now,
    });
  }

  /**
   * Reconcilia detecções com os incidentes abertos da regra: cria os novos (sem
   * duplicar a dimensão) e auto-resolve os que não estão mais anômalos.
   *
   * @param rule - Regra avaliada.
   * @param detections - Anomalias atuais da regra.
   * @param now - Instante de referência.
   *
   * @returns Contagens da reconciliação.
   */
  private async reconcile(
    rule: AnomalyRule,
    detections: DetectionInterface[],
    now: Date,
  ): Promise<{
    created: number;
    auto_resolved: number
  }> {
    const open = await this.prisma.incident.findMany({
      where: {
        ruleId: rule.id,
        status: {
          in: [
            'detected',
            'acknowledged',
          ] as never,
        },
      },
    });

    const openValues = new Set(open.map((incident) => incident.dimensionValue ?? ''));
    const anomalousValues = new Set(detections.map((detection) => detection.dimensionValue));

    let created = 0;
    let autoResolved = 0;

    for (const detection of detections) {
      if (openValues.has(detection.dimensionValue)) {
        continue;
      }

      await this.createIncident(
        detection,
        now,
        rule.shadowMode,
      );

      created++;
    }

    for (const incident of open) {
      if (anomalousValues.has(incident.dimensionValue ?? '')) {
        continue;
      }

      await this.autoResolve(
        incident,
        now,
      );

      autoResolved++;
    }

    return {
      created,
      auto_resolved: autoResolved,
    };
  }

  /**
   * Persiste um incidente novo (status `detected`). Empurra `incident.created` **apenas** se a regra
   * não estiver em shadow mode — em shadow, o incidente é registrado para calibração mas não notifica.
   *
   * @param detection - Anomalia detectada.
   * @param now - Instante da detecção.
   * @param shadow - Se a regra está em observação silenciosa (registra sem notificar).
   *
   * @returns Resolve após criar e (quando não shadow) emitir.
   */
  private async createIncident(
    detection: DetectionInterface,
    now: Date,
    shadow: boolean,
  ): Promise<void> {
    const incident = await this.prisma.incident.create({
      data: {
        ruleId: detection.ruleId,
        severity: detection.severity as never,
        status: 'detected',
        dimensionType: detection.dimensionType as never,
        dimensionValue: detection.dimensionValue,
        detectionWindowStart: detection.windowStart,
        detectionWindowEnd: detection.windowEnd,
        detectionPayload: {
          rule: detection.ruleName,
          window: formatDetectionWindow(
            detection.windowStart,
            detection.windowEnd,
          ),
          summary: detection.summary,
          metrics: detection.metrics,
          relatedShippings: detection.relatedShippings,
          relatedShippingIds: detection.relatedShippingIds.slice(
            0,
            RELATED_IDS_CAP,
          ),
        } as unknown as Prisma.InputJsonValue,
        detectedAt: now,
        shadow,
      },
    });

    // Shadow mode: registra mas não alerta (sem WebSocket/banner) — para calibrar thresholds.
    if (shadow) {
      return;
    }

    this.realtime.broadcast({
      type: 'incident.created',
      incident: this.toIncidentInterface(
        incident.id,
        detection,
        now,
        shadow,
      ),
    });
  }

  /**
   * Auto-resolve um incidente cuja anomalia sumiu e empurra `incident.auto_resolved`.
   *
   * @param incident - Incidente aberto a fechar.
   * @param now - Instante da resolução automática.
   *
   * @returns Resolve após persistir e emitir.
   */
  private async autoResolve(
    incident: Incident,
    now: Date,
  ): Promise<void> {
    await this.prisma.incident.update({
      where: { id: incident.id },
      data: {
        status: 'auto_resolved',
        resolvedAt: now,
      },
    });

    await this.prisma.incidentActivity.create({
      data: {
        incidentId: incident.id,
        activityType: 'status_change',
        occurredAt: now,
        payload: {
          from_status: incident.status,
          to_status: 'auto_resolved',
          note: AUTO_RESOLVE_NOTE,
        },
      },
    });

    // Incidente shadow nunca notificou a criação — também resolve em silêncio.
    if (!incident.shadow) {
      this.realtime.broadcast({
        type: 'incident.auto_resolved',
        incident_id: incident.id,
        resolved_at: now.toISOString(),
        note: AUTO_RESOLVE_NOTE,
      });
    }
  }

  /** Converte um `AnomalyRule` do Prisma para o shape consumido pelos detectores. */
  private toDetectorRule(rule: AnomalyRule): DetectorRuleInterface {
    return {
      id: rule.id,
      name: rule.name,
      ruleType: rule.ruleType,
      dimension: rule.dimension,
      severity: rule.severity,
      threshold: Number(rule.threshold),
      windowMinutes: rule.windowMinutes,
      category: rule.category,
    };
  }

  /** Monta o `IncidentInterface` (snake_case) do evento `incident.created`. */
  private toIncidentInterface(
    id: string,
    detection: DetectionInterface,
    now: Date,
    shadow: boolean,
  ): IncidentInterface {
    return {
      id,
      rule: detection.ruleName,
      severity: detection.severity,
      status: 'detected',
      dimension_type: detection.dimensionType,
      dimension_value: detection.dimensionValue,
      detected_at: now.toISOString(),
      window: formatDetectionWindow(
        detection.windowStart,
        detection.windowEnd,
      ),
      window_from: detection.windowStart.toISOString(),
      window_to: detection.windowEnd.toISOString(),
      summary: detection.summary,
      metrics: detection.metrics,
      related_shippings: detection.relatedShippings,
      assignee: null,
      shadow,
    };
  }
}
