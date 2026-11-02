import type { AuditScanStatsInterface } from '@atena/types';
import type { ShippingSampleInterface } from '../detector/detection.types';
import type {
  AuditProgressCallback,
  AuditSearchFilterInterface,
  AuditWindowInterface,
  DeliveryPageInterface,
  DeliveryRecordInterface,
  DeliveryReportAggregateInterface,
  DeliveryTrailInterface,
} from './audit-query.types';

/**
 * Motor de consulta de auditoria: a ÚNICA porta de entrada para o dado de entrega, que
 * vive no S3 (fonte de verdade) e é consultado sob demanda via DuckDB, com cache `/tmp`.
 *
 * Substitui as leituras de `prisma.message` nos 6 call sites (search/trail/report/catálogo/
 * detectores/reveal-análise). A implementação NUNCA escreve no bucket de origem; derivados
 * (Parquet) vivem só no cache local. PII (telefone/conteúdo) só sai mascarada/sob reveal auditado.
 *
 * @see {@link AUDIT_QUERY} - token de injeção do NestJS.
 */
export interface AuditQueryServiceInterface {
  /**
   * Busca paginada de registros de entrega que casam o filtro (`search_shippings`).
   *
   * @param filter - Filtros (janela obrigatória; phone/status/provider/customer opcionais).
   * @param page - Página (base 1).
   * @param limit - Itens por página.
   * @param [onProgress] - Callback de andamento da varredura (etapas do motor).
   *
   * @returns Linhas da página + total de itens do filtro.
   */
  search(
    filter: AuditSearchFilterInterface,
    page: number,
    limit: number,
    onProgress?: AuditProgressCallback,
  ): Promise<DeliveryPageInterface>;

  /**
   * Registro consolidado de um envio por id (para reveal de telefone e análise de conteúdo).
   *
   * @param shippingId - Id estável do destinatário.
   * @param [window] - Janela a varrer (idealmente a mesma do search/trilha que
   *   produziu o id). Sem ela, cai na janela default (~30 dias) e a varredura fria pode estourar
   *   timeout — um lookup pontual por id deve sempre receber a janela do contexto.
   * @param [expand=true] - Expandir a janela pelo buffer de status tardio (±lateStatusBuffer,
   *   ~6 dias) p/ capturar o desfecho terminal fora da janela. `false` (reveal): varre SÓ a
   *   janela/filtros (~1 dia) — o telefone/conteúdo está no evento do próprio dia, então o desfecho
   *   terminal é dispensável e a leitura fria fica muito mais barata.
   *
   * @returns O registro, ou `null` se não existir.
   */
  getShipping(
    shippingId: string,
    window?: AuditWindowInterface,
    expand?: boolean,
  ): Promise<DeliveryRecordInterface | null>;

  /**
   * Trilha completa de um envio (`get_shipping_trail`): registro + eventos do lifecycle.
   *
   * A `window` deve ser **a mesma janela do `search_shippings` que produziu o `id`**: assim a
   * varredura cai nas partições já quentes no cache `/tmp` (leitura em ms, sem ir ao S3). Ausente →
   * o motor cai na janela default (varredura potencialmente larga e fria).
   *
   * @param shippingId - Id estável do destinatário.
   * @param [window] - Janela da varredura (idealmente a mesma do search).
   * @param [onProgress] - Callback de andamento da varredura (etapas do motor).
   *
   * @returns A trilha, ou `null` se não existir.
   */
  getTrail(
    shippingId: string,
    window?: AuditWindowInterface,
    onProgress?: AuditProgressCallback,
  ): Promise<DeliveryTrailInterface | null>;

  /**
   * Relatório de entregabilidade agregado em SQL (`generate_delivery_report`).
   *
   * @param filter - Janela + filtros opcionais.
   * @param [onProgress] - Callback de andamento da varredura (etapas do motor).
   * @param [signal] - Cancela a varredura entre partições se abortado (ex.: cliente desconectou).
   *
   * @returns Totais, quebra por provedor, hourly e top-erros.
   */
  deliveryReport(
    filter: AuditSearchFilterInterface,
    onProgress?: AuditProgressCallback,
    signal?: AbortSignal,
  ): Promise<DeliveryReportAggregateInterface>;

  /**
   * Provedores distintos na janela (`list_providers`), em ordem alfabética.
   *
   * @param [window] - Janela temporal; ausente → janela default.
   *
   * @returns Nomes de provedores distintos (não nulos).
   */
  distinctProviders(window?: AuditWindowInterface): Promise<string[]>;

  /**
   * Clientes distintos na janela (`list_customers`), opcionalmente filtrados por busca parcial.
   * Retorna os MAIS ATIVOS (top-N por volume) + o total distinto — para não despejar centenas de ids
   * no LLM (lento/caro na geração) e ainda informar o tamanho real do conjunto.
   *
   * @param [window] - Janela temporal; ausente → janela default.
   * @param [search] - Termo para filtrar o cliente (match parcial); opcional.
   *
   * @returns Top-N clientes por volume + total distinto.
   */
  distinctCustomers(
    window?: AuditWindowInterface,
    search?: string,
  ): Promise<{
    items: string[];
    total: number
  }>;

  /**
   * Amostras de TERMINAIS (delivered/failed) na janela, com `errorHint`, para os detectores
   * `consistent_error`/`delivery_rate_drop`. Janelamento por desfecho (`finalizedAt`).
   *
   * @param window - Janela de lookback (por desfecho).
   *
   * @returns Amostras terminais (sem PII).
   */
  terminalSamples(window: AuditWindowInterface): Promise<ShippingSampleInterface[]>;

  /**
   * Amostras de ENVIOS (qualquer status) na janela, com `provider`/`requestedAt`/`finalizedAt`,
   * para o detector `webhook_silence`. Janelamento por envio (`requestedAt`).
   *
   * @param window - Janela de lookback (por envio).
   *
   * @returns Amostras de envio (sem PII).
   */
  sendSamples(window: AuditWindowInterface): Promise<ShippingSampleInterface[]>;

  /**
   * Registros de entrega por uma lista de ids (na janela dada) — usado para buscar EXATAMENTE as
   * mensagens que um incidente marcou como impactadas (ids persistidos pelo detector).
   *
   * @param ids - Ids dos destinatários (`md5(campaign_id||phone)`).
   * @param window - Janela (a da detecção; escopa as partições).
   *
   * @returns Os registros que casam os ids (ordem de `requested_at`).
   */
  searchByIds(
    ids: string[],
    window: AuditWindowInterface,
  ): Promise<DeliveryRecordInterface[]>;

  /**
   * Exporta TODOS os registros que casam o filtro para um arquivo CSV (sem paginação nem teto), via
   * `COPY` do DuckDB. Base do export auditado (`GET /shippings/export`): o telefone sai **EM CLARO**
   * (a ação é auditada com severidade `pii`). O arquivo tem delimitador `;` e header snake_case; o
   * chamador é responsável por enviá-lo e removê-lo.
   *
   * @param filter - Filtros (janela + phone/status/provider/customer/campaign).
   *
   * @returns Caminho do arquivo CSV gerado.
   */
  exportSearchCsv(filter: AuditSearchFilterInterface): Promise<string>;

  /**
   * Exporta para CSV EXATAMENTE os registros de uma lista de ids (na janela dada) — base do download
   * das mensagens impactadas de um incidente. Mesma forma do {@link exportSearchCsv} (telefone **EM
   * CLARO**, header snake_case, `;`); lista vazia gera um CSV só com o header.
   *
   * @param ids - Ids dos destinatários (impactados pelo incidente).
   * @param window - Janela (a da detecção; escopa as partições).
   *
   * @returns Caminho do arquivo CSV gerado.
   */
  exportByIdsCsv(
    ids: string[],
    window: AuditWindowInterface,
  ): Promise<string>;

  /**
   * Exporta para CSV o SNAPSHOT de uma busca (Parquet do conjunto exato, gravado no `search` e
   * referenciado por `token`) — download byte-exato com o total exibido, lido do disco (sem S3 nem
   * re-materialização). `null` se o token for inválido ou o snapshot já tiver expirado (TTL).
   *
   * @param token - Token do snapshot (`DeliveryPageInterface.snapshotToken`).
   *
   * @returns Caminho do CSV gerado, ou `null` se o snapshot não existe.
   */
  exportSnapshotCsv(token: string): Promise<string | null>;

  /**
   * Acumulado (desde a subida) do custo de leitura do S3: partições servidas do cache vs. lidas do
   * S3 (frias/recentes), objetos lidos, taxa de acerto do cache, tempo médio e custo estimado. Para
   * observabilidade de custo (`GET /observability`), não é PII.
   *
   * @param [windowHours] - Janela temporal em horas (default 24); agrega os eventos persistidos.
   *
   * @returns Estatísticas de scan do S3 na janela.
   */
  scanStats(windowHours?: number): Promise<AuditScanStatsInterface>;
}

/** Token de injeção do NestJS para o {@link AuditQueryServiceInterface}. */
export const AUDIT_QUERY = Symbol('AUDIT_QUERY');
