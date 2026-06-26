import { useEffect, useState } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { DeliveryReportInterface, IncidentReportInterface } from '@atena/types';
import { downloadFile } from '../util/download';
import { apiFetch } from './client';
import { API_URL } from './config';

/** Nome do arquivo do export do relatório de entregabilidade. */
const REPORT_FILENAME = 'atena-relatorio-entregabilidade.csv';

/**
 * Baixa o CSV do relatório de entregabilidade (as mensagens da janela/filtros do relatório), via o
 * `csv_url` que veio no resultado da tool — gerado no servidor em stream. O telefone sai **EM CLARO**;
 * o acesso é auditado no servidor (`export_report`, severidade `pii`). Já vem com BOM + `;` (Excel pt-BR).
 *
 * @param {string} csvUrl - Caminho do export (sob `/api`) devolvido em `DeliveryReportInterface.csv_url`.
 * @returns {Promise<void>} Resolve quando o download é disparado.
 * @throws {Error} Se a resposta não for 2xx.
 */
export async function downloadDeliveryReport(csvUrl: string): Promise<void> {
  await downloadFile(
    `${API_URL}/api${csvUrl}`,
    REPORT_FILENAME,
  );
}

/**
 * Janela pedida ao relatório: um preset (`date_range`) OU um intervalo explícito (`date_from`/
 * `date_to`). Datas só-dia (`YYYY-MM-DD`) e datetimes sem fuso (`YYYY-MM-DDTHH:mm`) são
 * interpretados no fuso do operador (BRT) pelo backend.
 */
export interface ReportWindowInterface {
  date_range?: string;
  date_from?: string;
  date_to?: string;
  filters?: {
    customer_id?: string;
    provider?: string;
    status?: string
  };
}

/**
 * Query do relatório de entregabilidade (`POST /reports/delivery`) por janela — preset ou intervalo.
 *
 * @param {ReportWindowInterface} window - Preset (`date_range`) ou intervalo (`date_from`/`date_to`).
 * @param {boolean} enabled - Só busca quando a aba de entregabilidade está ativa.
 * @returns {UseQueryResult<DeliveryReportInterface>} Estado da query.
 */
export function useDeliveryReport(
  window: ReportWindowInterface,
  enabled: boolean,
): UseQueryResult<DeliveryReportInterface> {
  return useQuery({
    queryKey: [
      'report-delivery',
      window.date_range ?? '',
      window.date_from ?? '',
      window.date_to ?? '',
    ],
    queryFn: () => apiFetch<DeliveryReportInterface>(
      '/reports/delivery',
      {
        method: 'POST',
        body: JSON.stringify(window),
      },
    ),
    enabled,
  });
}

/** Etapa de progresso da geração do relatório (espelha o `AuditProgressEventInterface` do motor). */
export interface DeliveryProgressInterface {
  phase: 'mapping' | 'reading' | 'querying';
  label: string;
  current?: number;
  total?: number;
}

/** Parseia um frame SSE (`event: <tipo>\ndata: <json>`) em `{ event, data }`. */
function parseReportFrame(frame: string): {
  event: string;
  data: unknown
} {
  let event = '';
  const dataLines: string[] = [];

  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trim());
    }
  }

  try {
    return {
      event,
      data: dataLines.length > 0
        ? JSON.parse(dataLines.join('\n'))
        : null,
    };
  } catch {
    return {
      event,
      data: null,
    };
  }
}

/**
 * Gera o relatório de entregabilidade em **stream SSE** (`POST /reports/delivery/stream`), chamando
 * `onProgress` a cada etapa da varredura (mapping → reading X/Y → querying) e resolvendo com o
 * relatório final (evento `result`). Lança em `error` ou se o stream encerrar sem resultado.
 *
 * @param {ReportWindowInterface} window - Preset ou intervalo da janela.
 * @param {(progress: DeliveryProgressInterface) => void} onProgress - Handler de cada etapa.
 * @param {AbortSignal} [signal] - Cancela o stream (troca de janela/desmontagem).
 * @returns {Promise<DeliveryReportInterface>} O relatório agregado.
 */
export async function streamDeliveryReport(
  window: ReportWindowInterface,
  onProgress: (progress: DeliveryProgressInterface) => void,
  signal?: AbortSignal,
): Promise<DeliveryReportInterface> {
  const response = await fetch(
    `${API_URL}/api/reports/delivery/stream`,
    {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(window),
      signal,
    },
  );

  if (!response.body) {
    throw new Error(`Falha ao abrir o stream do relatório (HTTP ${response.status})`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: DeliveryReportInterface | undefined;

  for (;;) {
    const {
      done,
      value,
    } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(
      value,
      { stream: true },
    );

    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';

    for (const frame of parts) {
      const {
        event,
        data,
      } = parseReportFrame(frame);

      if (
        event === 'progress'
        && data
      ) {
        onProgress(data as DeliveryProgressInterface);
      } else if (
        event === 'result'
               && data
      ) {
        result = data as DeliveryReportInterface;
      } else if (event === 'error') {
        throw new Error('Falha ao gerar o relatório');
      }
    }
  }

  if (!result) {
    throw new Error('O stream do relatório encerrou sem resultado');
  }

  return result;
}

/** Estado do relatório de entregabilidade em streaming (dado + flags + progresso ao vivo). */
export interface DeliveryStreamStateInterface {
  data?: DeliveryReportInterface;
  isLoading: boolean;
  isError: boolean;
  progress?: DeliveryProgressInterface;
}

/**
 * Hook do relatório de entregabilidade COM progresso ao vivo (consome {@link streamDeliveryReport}).
 * Reexecuta quando a janela muda; aborta o stream anterior. Use no lugar do `useDeliveryReport` quando
 * quiser exibir o andamento da varredura.
 *
 * @param {ReportWindowInterface} window - Preset ou intervalo da janela.
 * @param {boolean} enabled - Só busca quando a aba de entregabilidade está ativa.
 * @returns {DeliveryStreamStateInterface} Dado + `isLoading`/`isError` + `progress`.
 */
export function useDeliveryReportStream(
  window: ReportWindowInterface,
  enabled: boolean,
): DeliveryStreamStateInterface {
  const [
    state,
    setState,
  ] = useState<DeliveryStreamStateInterface>({
    isLoading: false,
    isError: false,
  });

  // A janela é um objeto novo a cada render; a chave (conteúdo) é a dependência estável do efeito.
  const key = JSON.stringify(window);

  useEffect(
    () => {
      if (!enabled) {
        setState({
          isLoading: false,
          isError: false,
        });

        return undefined;
      }

      const controller = new AbortController();

      setState({
        isLoading: true,
        isError: false,
      });

      streamDeliveryReport(
        JSON.parse(key) as ReportWindowInterface,
        (progress) => setState((current) => ({
          ...current,
          progress,
        })),
        controller.signal,
      )
        .then((report) => setState({
          isLoading: false,
          isError: false,
          data: report,
        }))
        .catch(() => {
          if (!controller.signal.aborted) {
            setState({
              isLoading: false,
              isError: true,
            });
          }
        });

      return () => controller.abort();
    },
    [
      enabled,
      key,
    ],
  );

  return state;
}

/**
 * Query do relatório de incidentes resolvidos (`POST /reports/incidents`) por janela (`date_range`).
 *
 * @param {string} dateRange - Preset da janela (`24h`/`7d`/`30d`/`all`).
 * @param {boolean} enabled - Só busca quando a aba de incidentes está ativa.
 * @returns {UseQueryResult<IncidentReportInterface>} Estado da query.
 */
export function useIncidentReport(
  dateRange: string,
  enabled: boolean,
): UseQueryResult<IncidentReportInterface> {
  return useQuery({
    queryKey: [
      'report-incidents',
      dateRange,
    ],
    queryFn: () => apiFetch<IncidentReportInterface>(
      '/reports/incidents',
      {
        method: 'POST',
        body: JSON.stringify({ date_range: dateRange }),
      },
    ),
    enabled,
  });
}
