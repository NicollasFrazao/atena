/**
 * @atena/types — contrato compartilhado entre backend e frontend.
 *
 * Os objetos de entrada/saída da API são **snake_case** (ver .context/docs/code-style.md).
 * O banco também é snake_case; o Prisma Client (camelCase) é mapeado na borda da API.
 * Fonte da verdade dos shapes: (protótipo original, não incluído) + 01-backend-api-contract.md
 * (os mocks do protótipo são camelCase; a API de produção serializa em snake_case).
 */

// ---------------------------------------------------------------------------
// Enums / unions de domínio (valores inalterados)
// ---------------------------------------------------------------------------

/**
 * Papel do usuário para RBAC. Gerenciado no app (atribuído por um admin, persistido no banco) —
 * não vem mais da claim do IdP. Cada papel é um pacote de permissões (mapa em código no backend).
 *
 * @remarks
 * - `admin` — administra usuários/papéis (e tudo; wildcard de permissões).
 * - `support_lead` — operação + ações sensíveis (reveal de PII, editar regras, gatilhos de ops).
 * - `support_analyst` — operação do dia a dia (busca, trilha, relatórios, incidentes), PII mascarada.
 * - `viewer` — somente leitura.
 */
export type RoleType = 'admin' | 'support_lead' | 'support_analyst' | 'viewer';

/**
 * Permissão granular de RBAC (checada pelos guards via `@Requires`). Papéis são pacotes destas.
 *
 * @remarks Catálogo: acesso base, busca/trilha, reveal de PII, relatórios, incidentes
 * (ver/comentar/ack/resolver), regras (ver/editar), auditoria, observabilidade, gatilhos de ops
 * e gestão de usuários.
 */
export type PermissionType =
  | 'app:use'
  | 'messages:search'
  | 'messages:trail'
  | 'pii:reveal'
  | 'reports:view'
  | 'incidents:view'
  | 'incidents:comment'
  | 'incidents:ack'
  | 'incidents:resolve'
  | 'rules:view'
  | 'rules:edit'
  | 'audit:view'
  | 'observability:view'
  | 'ops:run'
  | 'users:manage';

/** Status de conta do usuário. `disabled` bloqueia o acesso mesmo com papéis. */
export type UserStatusType = 'active' | 'disabled';

/**
 * Usuário autenticado da sessão, devolvido por `GET /auth/me`. É o contrato de identidade +
 * autorização consumido pelo frontend (saudação/topbar + gate de acesso + UI condicional).
 * Os papéis/permissões são resolvidos do banco a cada requisição (não ficam no cookie JWT).
 *
 * @property {string} sub - Identificador estável do usuário no IdP (claim `sub`).
 * @property {string} email - E-mail institucional (dentro do domínio permitido).
 * @property {string} name - Nome de exibição.
 * @property {RoleType[]} roles - Papéis atribuídos (vazio = acesso pendente).
 * @property {PermissionType[]} permissions - Permissões derivadas dos papéis.
 * @property {UserStatusType} status - `active` | `disabled`.
 * @property {boolean} is_super_admin - Super admin (definido só pelo `AUTH_ADMIN_EMAILS`/env):
 *   acesso total + gerencia admins; imutável pela tela.
 */
export interface SessionUserInterface {
  sub: string;
  email: string;
  name: string;
  roles: RoleType[];
  permissions: PermissionType[];
  status: UserStatusType;
  is_super_admin: boolean;
}

/**
 * Item da lista de usuários da tela de admin (`GET /admin/users`).
 *
 * @property {string} sub - Id do usuário (= claim `sub`).
 * @property {string} email - E-mail institucional.
 * @property {string} name - Nome de exibição.
 * @property {UserStatusType} status - `active` | `disabled`.
 * @property {RoleType[]} roles - Papéis atribuídos.
 * @property {boolean} is_super_admin - Super admin (via env): imutável pela tela.
 * @property {string | null} last_login_at - Último login (ISO) ou `null`.
 * @property {string} created_at - Criação (ISO).
 */
export interface AdminUserInterface {
  sub: string;
  email: string;
  name: string;
  status: UserStatusType;
  roles: RoleType[];
  is_super_admin: boolean;
  last_login_at: string | null;
  created_at: string;
}

/**
 * Item do catálogo de papéis (`GET /admin/roles`) — alimenta a tela de admin.
 *
 * @property {RoleType} role - Chave do papel.
 * @property {string} label - Rótulo legível.
 * @property {string} description - O que o papel permite (para a UI explicar cada papel).
 * @property {PermissionType[]} permissions - Permissões que o papel concede.
 */
export interface RoleCatalogItemInterface {
  role: RoleType;
  label: string;
  description: string;
  permissions: PermissionType[];
}

/**
 * Status de entrega de um envio (estado consolidado na trilha).
 *
 * @remarks
 * - `delivered` — confirmada como entregue pelo provedor/webhook.
 * - `failed` — falha definitiva de entrega (desfecho negativo do fornecedor).
 * - `blocked` — bloqueado pelo controle de entrega ANTES/NO envio (número na bounce list ou throttling
 *   comercial), reportado como `bounce`. NÃO é falha de entrega e fica FORA do denominador da taxa.
 * - `pending` — em trânsito / aguardando confirmação.
 * - `unknown` — sem sinal conclusivo (ex.: silêncio de webhook).
 */
export type ShippingStatusType = 'delivered' | 'failed' | 'blocked' | 'pending' | 'unknown';

/**
 * Tipo de evento na trilha (lifecycle) de um envio, em ordem de fluxo.
 *
 * @remarks
 * - `api_request` — recebimento do pedido de envio na API.
 * - `routing` — decisão de roteamento (escolha de provedor/rota).
 * - `provider_attempt` — tentativa de envio junto ao provedor.
 * - `webhook_status` — atualização de status recebida via webhook do provedor.
 * - `final` — evento terminal que consolida o `final_status`.
 */
export type ShippingEventType =
  | 'api_request'
  | 'routing'
  | 'provider_attempt'
  | 'webhook_status'
  | 'final';

/**
 * Severidade de um incidente (impacto/urgência).
 *
 * @remarks `info` < `warning` < `critical` (ordem crescente de gravidade).
 */
export type IncidentSeverityType = 'info' | 'warning' | 'critical';

/**
 * Estado do ciclo de vida de um incidente.
 *
 * @remarks
 * - `detected` — detectado por regra, ainda não tratado.
 * - `acknowledged` — reconhecido por um operador.
 * - `resolved` — resolvido manualmente (exige `ResolveIncidentPayload`).
 * - `auto_resolved` — resolvido automaticamente (métrica voltou ao baseline).
 *
 * A mudança de estado nunca é tool do LLM: só UI + validação server-side.
 */
export type IncidentStatusType = 'detected' | 'acknowledged' | 'resolved' | 'auto_resolved';

/**
 * Dimensão à qual um incidente/anomalia está associado (escopo da agregação).
 *
 * @remarks
 * - `provider` — recortado por provedor.
 * - `customer` — recortado por cliente.
 * - `route` — recortado por rota (par provedor/cliente, etc.).
 * - `global` — sem recorte; afeta toda a operação.
 */
export type DimensionType = 'provider' | 'customer' | 'route' | 'global';

/**
 * Categoria da ação tomada ao resolver um incidente (para auditoria/relatório).
 *
 * @remarks
 * - `provider_recovered` — provedor se recuperou sozinho.
 * - `provider_escalated` — escalado ao provedor (exige `escalated_to`).
 * - `internal_escalated` — escalado internamente (exige `escalated_to`).
 * - `false_positive` — alarme falso.
 * - `customer_communicated` — cliente foi comunicado.
 * - `monitoring_only` — apenas monitoramento, sem ação corretiva.
 * - `other` — outra categoria (detalhar na descrição).
 */
export type ActionCategoryType =
  | 'provider_recovered'
  | 'provider_escalated'
  | 'internal_escalated'
  | 'false_positive'
  | 'customer_communicated'
  | 'monitoring_only'
  | 'other';

/**
 * Tipo de regra de detecção de anomalia que origina um incidente.
 *
 * @remarks
 * - `delivery_rate_drop` — queda na taxa de entrega vs. baseline.
 * - `failure_spike` — pico de falhas.
 * - `consistent_error` — erro recorrente/consistente.
 * - `webhook_silence` — ausência de webhooks esperados (silêncio).
 */
export type RuleType =
  | 'delivery_rate_drop'
  | 'failure_spike'
  | 'consistent_error'
  | 'webhook_silence';

/**
 * Unidade do limiar (threshold) de uma regra de detecção.
 *
 * @remarks
 * - `%` — pontos percentuais.
 * - `σ` — desvios-padrão em relação ao baseline.
 * - `min` — minutos (ex.: janela de silêncio de webhook).
 */
export type ThresholdUnitType = '%' | 'σ' | 'min';

/**
 * Ação registrada no audit log (append-only) para rastreabilidade.
 *
 * @remarks
 * - `tool_call` — execução de uma tool pelo orquestrador.
 * - `reveal_phone` — revelação de telefone (PII; sempre auditado).
 * - `reveal_content` — revelação de conteúdo do envio (PII; sempre auditado).
 * - `incident_created` / `incident_ack` / `incident_resolve` — ciclo de vida de incidente.
 * - `session_start` — início de sessão de chat.
 * - `export_report` — exportação de relatório.
 * - `rule_update` — alteração de configuração de regra.
 */
export type AuditActionType =
  | 'tool_call'
  | 'reveal_phone'
  | 'reveal_content'
  | 'incident_created'
  | 'incident_ack'
  | 'incident_resolve'
  | 'session_start'
  | 'export_report'
  | 'rule_update'
  | 'user_role_update'
  | 'user_status_update';

/**
 * Severidade/categoria de um registro do audit log.
 *
 * @remarks
 * - `info` — evento informativo.
 * - `warning` — evento de atenção.
 * - `pii` — acesso a dado sensível (reveal); destaca-se na auditoria.
 * - `config` — mudança de configuração.
 */
export type AuditSeverityType = 'info' | 'warning' | 'pii' | 'config';

/**
 * Registro do audit log (append-only), na borda da API (snake_case). Sem PII em claro —
 * `detail`/`metadata` carregam só referências (IDs/hashes).
 *
 * @property {string} id - Id do registro.
 * @property {string} occurred_at - Instante do evento (ISO 8601 UTC).
 * @property {string | null} user_id - Subject do usuário; `null` se sem autenticação.
 * @property {AuditActionType} action - Ação auditada.
 * @property {string} resource - Recurso afetado (ex.: rota, `orchestrator:tool`).
 * @property {string | null} detail - Detalhe livre (só referências); `null` se ausente.
 * @property {AuditSeverityType} severity - Severidade/categoria.
 * @property {string | null} ip_address - IP de origem; `null` se indisponível.
 * @property {Record<string, unknown> | null} metadata - Metadados estruturados (só referências).
 */
export interface AuditLogEntryInterface {
  id: string;
  occurred_at: string;
  user_id: string | null;
  /** Nome de exibição do usuário (resolvido do `user_id`/sub); `null` se desconhecido (mostra o id). */
  user_name: string | null;
  action: AuditActionType;
  resource: string;
  detail: string | null;
  severity: AuditSeverityType;
  ip_address: string | null;
  metadata: Record<string, unknown> | null;
}

/**
 * Opção do filtro de usuário do Audit log: o `id` (sub) + o nome de exibição resolvido.
 *
 * @property {string} id - Subject (`sub`) do usuário, usado como valor do filtro.
 * @property {string | null} name - Nome de exibição (ou `null` → a tela mostra o `id`).
 */
export interface AuditUserOptionInterface {
  id: string;
  name: string | null;
}

/**
 * Contadores do topo da tela de Audit log.
 *
 * @property {number} today - Eventos de hoje (UTC).
 * @property {number} pii - Acessos a PII (severity `pii`).
 * @property {number} rule_changes - Mudanças de regra (`rule_update`).
 * @property {number} total - Total de registros no log.
 */
export interface AuditSummaryInterface {
  today: number;
  pii: number;
  rule_changes: number;
  total: number;
}

/**
 * Veredito de risco da análise de conteúdo do envio.
 *
 * @remarks `low` < `medium` < `high` (ordem crescente de risco).
 */
export type RiskVerdictType = 'low' | 'medium' | 'high';

/**
 * Catálogo de tools que o LLM pode invocar (o orquestrador executa; a IA nunca toca o banco).
 *
 * @remarks
 * Fonte da verdade do `ToolNameType`: a tupla é `as const` para que a união derive
 * exatamente destes literais. Liberadas por fase — Fase 1 (consulta de envios/
 * catálogo) e Fase 2 (incidentes). Acrescentar nomes só amplia o contrato; remover
 * ou renomear é breaking change.
 */
export const TOOL_NAMES = [
  // Fase 1
  'search_shippings',
  'get_shipping_trail',
  'analyze_shipping_content',
  'generate_delivery_report',
  'list_providers',
  'list_customers',
  // Fase 2
  'list_incidents',
  'get_incident',
  'generate_incident_report',
] as const;
/** Nome de uma tool válida — união derivada de {@link TOOL_NAMES}. */
export type ToolNameType = (typeof TOOL_NAMES)[number];

// ---------------------------------------------------------------------------
// Envelopes / utilitários (API: snake_case)
// ---------------------------------------------------------------------------

/**
 * Shape único de resposta de erro da API (produzido pelo `AllExceptionsFilter`).
 *
 * @property {{ code: string; message: string }} error - Erro de domínio: `code` estável (chave de tradução/contrato) e `message` legível.
 */
export interface ApiErrorInterface {
  error: {
    code: string;
    message: string
  };
}

/**
 * Envelope padrão de respostas paginadas da API (snake_case na borda).
 *
 * @template {T} Tipo de cada linha em `rows`.
 * @property {T[]} rows - Itens da página atual.
 * @property {number} page - Página atual (base do contrato; ver §C).
 * @property {number} total_pages - Total de páginas disponíveis.
 * @property {number} total - Total de itens em todas as páginas.
 * @property {number} latency_ms - Tempo de processamento da consulta, em ms.
 */
export interface PaginatedEnvelopeInterface<T> {
  rows: T[];
  page: number;
  total_pages: number;
  total: number;
  latency_ms: number;
}

// ---------------------------------------------------------------------------
// Tool results (§C do contrato) — snake_case
// ---------------------------------------------------------------------------

/**
 * Linha de resultado da tool `search_shippings` (§C do contrato).
 *
 * @property {string} id - Identificador do envio.
 * @property {string | null} campaign_id - Id da campanha (id da requisição); 1 campanha → N destinatários. Alias externo do `correlation_id` interno.
 * @property {string} phone_masked - Telefone mascarado; exibido por padrão.
 * @property {string} [phone_full] - PII: telefone completo, só com permissão + reveal auditado.
 * @property {ShippingStatusType} status - Status de entrega do envio.
 * @property {string} provider - Provedor responsável pelo envio.
 * @property {string} customer - Cliente dono do envio.
 * @property {string} requested_at - Instante do pedido de ENVIO (ISO 8601 UTC). A janela da busca filtra
 *   por ESTE instante (envios feitos na janela), nunca pela finalização — ver `finalized_at`.
 * @property {string | null} finalized_at - Instante em que o envio chegou ao status final (ISO 8601
 *   UTC); pode ser de um dia POSTERIOR ao envio. `null` enquanto não finalizou (`pending`).
 * @property {string | null} error_hint - Dica de erro quando houve falha; `null` caso contrário.
 */
export interface SearchResultRowInterface {
  id: string;
  campaign_id: string | null;
  phone_masked: string;
  phone_full?: string; // só com permissão + reveal (gera audit)
  status: ShippingStatusType;
  provider: string;
  customer: string;
  /** Canal do envio: `sms` (SMS Short) ou `sms_flash` (SMS Flash). */
  channel: string | null;
  /** Aplicação que originou o envio (atribuição); UUID. */
  app_id: string | null;
  requested_at: string;
  finalized_at: string | null;
  error_hint: string | null;
}

/**
 * Evento individual na trilha (timeline) de um envio.
 *
 * @property {ShippingEventType} type - Tipo/etapa do evento no lifecycle.
 * @property {string} label - Rótulo curto para exibição.
 * @property {string} at - Instante do evento. ISO 8601 UTC (com `Z`) na fonte; na borda do chat vem
 *   como datetime naive (sem `Z`) no fuso do operador, p/ o assistente citar a hora local correta.
 *   O formatador da UI aceita as duas formas (naive = relógio de parede já no fuso; com `Z` = absoluto).
 * @property {string} detail - Detalhe legível do que ocorreu.
 */
export interface ShippingTrailEvent {
  type: ShippingEventType;
  label: string;
  at: string;
  detail: string;
}

/**
 * Trilha completa de um envio (resultado de `get_shipping_trail`, §C).
 *
 * @property {string} shipping_id - Identificador do envio rastreado.
 * @property {string | null} campaign_id - Id da campanha (id da requisição). Alias externo do `correlation_id` interno.
 * @property {string} customer - Cliente dono do envio.
 * @property {string} provider - Provedor responsável pelo envio.
 * @property {string} phone_masked - Telefone mascarado; exibido por padrão.
 * @property {ShippingStatusType} final_status - Status consolidado (do evento `final`).
 * @property {string} content_ref - Referência opaca ao conteúdo (não é a PII em si).
 * @property {boolean} content_available - Se há texto do SMS para revelar nesta fonte; quando `false`,
 *   a UI mostra "conteúdo não disponível" em vez de oferecer o reveal.
 * @property {string} [content_preview] - PII: prévia do conteúdo, só após reveal auditado; mascarado por padrão.
 * @property {ShippingTrailEvent[]} events - Eventos do lifecycle, em ordem cronológica.
 */
export interface ShippingTrailInterface {
  shipping_id: string;
  campaign_id: string | null;
  customer: string;
  provider: string;
  phone_masked: string;
  /** Canal do envio: `sms` (SMS Short) ou `sms_flash` (SMS Flash). */
  channel: string | null;
  /** Aplicação que originou o envio (atribuição); UUID. */
  app_id: string | null;
  final_status: ShippingStatusType;
  content_ref: string;
  content_available: boolean;
  content_preview?: string; // só após reveal (audit); mascarado por padrão
  events: ShippingTrailEvent[];
}

/**
 * Categoria de risco detectada na análise de conteúdo, com sua intensidade.
 *
 * @property {string} name - Nome da categoria de risco.
 * @property {number} strength - Intensidade da categoria (peso/score relativo).
 */
export interface RiskCategoryInterface {
  name: string;
  strength: number;
}

/**
 * Resultado da tool `analyze_shipping_content` (§C): risco do conteúdo.
 *
 * @property {number} score - Score agregado de risco.
 * @property {RiskVerdictType} verdict - Veredito derivado do score.
 * @property {RiskCategoryInterface[]} categories - Categorias que compõem o risco.
 * @property {string} explanation - Justificativa legível do veredito.
 */
export interface RiskAnalysisInterface {
  score: number;
  verdict: RiskVerdictType;
  categories: RiskCategoryInterface[];
  explanation: string;
}

/**
 * Relatório de entregabilidade (resultado de `generate_delivery_report`, §C).
 *
 * @property {string} window - Janela temporal do relatório (ex.: "24h", intervalo).
 * @property {{ sent: number; delivered: number; failed: number; blocked: number; pending: number }} totals - Totais por status. `blocked` = bloqueado pelo controle de entrega (bounce); NÃO conta como falha.
 * @property {Array<{ name: string; sent: number; delivered: number; rate: number }>} by_provider - Quebra por provedor; `rate` = taxa de entrega = entregues/(entregues+falhas) (bloqueados/pendentes fora do denominador).
 * @property {Array<{ at: string; rate: number }>} hourly - Taxa de entrega por hora, em buckets CRONOLÓGICOS; `at` é o início do bucket (ISO 8601 UTC, ex.: "2026-06-18T21:00:00Z"). Cobre os dias da janela (não colapsa por hora-do-dia).
 * @property {Array<{ code: string; count: number; provider: string }>} top_errors - Principais erros: código, contagem e provedor.
 * @property {string} csv_url - URL para download do relatório em CSV.
 * @property {{ customer_id?: string; provider?: string; status?: ShippingStatusType }} [filters] - Filtros aplicados (eco do recorte); ausente/`{}` = todos os clientes e provedores. Mostrado no card para identificar o escopo.
 */
export interface DeliveryReportInterface {
  window: string;
  filters?: {
    customer_id?: string;
    provider?: string;
    status?: ShippingStatusType
  };
  totals: {
    sent: number;
    delivered: number;
    failed: number;
    blocked: number;
    pending: number
  };
  by_provider: Array<{
    name: string;
    sent: number;
    delivered: number;
    failed: number;
    blocked: number;
    pending: number;
    rate: number
  }>;
  hourly: Array<{
    at: string;
    rate: number
  }>;
  top_errors: Array<{
    code: string;
    count: number;
    provider: string
  }>;
  csv_url: string;
}

// ---------------------------------------------------------------------------
// Reveal de PII (telefone/conteúdo) — snake_case
// ---------------------------------------------------------------------------

/**
 * Resultado de reveal de telefone (`POST /api/shippings/{id}/reveal-phone`).
 *
 * PII: só é retornado após reveal autorizado e auditado (`reveal_phone`); por
 * padrão o telefone sai mascarado (`phone_masked`).
 *
 * @property {string} shipping_id - Id do envio revelado.
 * @property {string} phone_full - Telefone completo em E.164 (NÃO mascarado).
 */
export interface RevealedPhoneInterface {
  shipping_id: string;
  phone_full: string;
}

/**
 * Resultado de reveal de conteúdo (`POST /api/shippings/{id}/reveal-content`).
 *
 * PII: conteúdo bruto hidratado do S3 via `content_ref` (cache `/tmp`↔S3); só
 * após reveal autorizado e auditado (`reveal_content`).
 *
 * @property {string} shipping_id - Id do envio revelado.
 * @property {string} content_preview - Conteúdo textual do envio (NÃO mascarado).
 */
export interface RevealedContentInterface {
  shipping_id: string;
  content_preview: string;
}

// ---------------------------------------------------------------------------
// Incidentes — snake_case
// ---------------------------------------------------------------------------

/**
 * Incidente detectado por uma regra de anomalia (snake_case na borda da API).
 *
 * @property {string} id - Identificador do incidente.
 * @property {string} rule - Regra que originou o incidente (ver {@link RuleType}).
 * @property {IncidentSeverityType} severity - Severidade/impacto.
 * @property {IncidentStatusType} status - Estado atual no ciclo de vida.
 * @property {DimensionType} dimension_type - Tipo de dimensão afetada.
 * @property {string} dimension_value - Valor da dimensão (ex.: nome do provedor/cliente).
 * @property {string} detected_at - Instante da detecção (ISO 8601 UTC).
 * @property {string} window - Janela temporal analisada.
 * @property {string} summary - Resumo legível do incidente.
 * @property {{ baseline: string; current: string; threshold: string; sample: string }} metrics - Métricas de suporte: baseline, valor atual, limiar e tamanho da amostra.
 * @property {number} related_shippings - Quantidade de envios relacionados.
 * @property {string | null} assignee - Responsável atribuído; `null` se não atribuído.
 */
export interface IncidentInterface {
  id: string;
  rule: string;
  severity: IncidentSeverityType;
  status: IncidentStatusType;
  dimension_type: DimensionType;
  dimension_value: string;
  detected_at: string;
  /** Rótulo legível da janela de detecção, no fuso de exibição (ex.: `23/06 16:40 → 16:55 GMT-3 (15 min)`). */
  window: string;
  /** Início da janela de detecção em ISO 8601 UTC (com `Z`) — use direto como `date_from` de relatório. */
  window_from: string | null;
  /** Fim da janela de detecção em ISO 8601 UTC (com `Z`) — use direto como `date_to` de relatório. */
  window_to: string | null;
  summary: string;
  metrics: {
    baseline: string;
    current: string;
    threshold: string;
    sample: string
  };
  related_shippings: number;
  assignee: string | null;
  shadow: boolean;
}

/**
 * Amostra de envios relacionados a um incidente (`GET /incidents/:id/shippings`).
 *
 * Busca real escopada pela dimensão do incidente (provider/customer) + janela em torno do
 * `detected_at`. Para dimensões sem filtro de busca direto (global/route), `available` é `false`
 * e a UI cai no modo contagem (`IncidentInterface.related_shippings`).
 *
 * @property {boolean} available - Se foi possível buscar amostra real para a dimensão do incidente.
 * @property {SearchResultRowInterface[]} rows - Amostra de envios (mesma forma do `search_shippings`); base do CSV.
 * @property {number} total - Total de envios que casam a dimensão+janela (não só a amostra retornada).
 * @property {Array<{ campaign_id: string; count: number }>} top_campaigns - Códigos de envio (campaign_id)
 *   com mais ocorrências na amostra, em ordem decrescente (poucos; resumo do detalhe do incidente).
 */
export interface IncidentShippingsInterface {
  available: boolean;
  rows: SearchResultRowInterface[];
  total: number;
  top_campaigns: Array<{
    campaign_id: string;
    count: number
  }>;
}

/**
 * Payload para resolver um incidente manualmente (UI + validação server-side;
 * resolver não é tool do LLM).
 *
 * @property {ActionCategoryType} action_category - Categoria da ação tomada.
 * @property {string} action_description - Descrição da ação; ≥ 20 chars (≥ 10 em `auto_resolved`), validado server-side.
 * @property {string} [escalated_to] - Destino do escalonamento; obrigatório se `action_category` ∈ {`provider_escalated`, `internal_escalated`}.
 * @property {string[]} [related_shipping_ids] - IDs de envios relacionados ao incidente.
 * @property {string[]} [tags] - Tags livres para categorização/auditoria.
 */
export interface ResolveIncidentPayload {
  action_category: ActionCategoryType;
  action_description: string; // ≥ 20 chars (≥ 10 no auto_resolved) — validado server-side
  escalated_to?: string; // obrigatório se action_category ∈ {provider_escalated, internal_escalated}
  related_shipping_ids?: string[];
  tags?: string[];
}

/**
 * Atividade no ciclo de vida de um incidente (comentário, mudança de estado, tool).
 *
 * @property {string} id - Id da atividade.
 * @property {string} [user_id] - Usuário que a gerou, quando houver.
 * @property {'comment' | 'status_change' | 'tool_call'} type - Tipo da atividade.
 * @property {string} at - Instante (ISO 8601 UTC).
 * @property {Record<string, unknown>} payload - Detalhe estruturado (ex.: novo status, texto do comentário).
 */
export interface IncidentActivityInterface {
  id: string;
  user_id?: string;
  type: 'comment' | 'status_change' | 'tool_call';
  at: string;
  payload: Record<string, unknown>;
}

/**
 * Incidente já resolvido, como aparece no relatório de incidentes (§C.6).
 *
 * @property {string} id - Id do incidente.
 * @property {IncidentSeverityType} severity - Severidade.
 * @property {string} rule - Regra que originou.
 * @property {string} resolved_at - Instante de resolução (ISO 8601 UTC).
 * @property {ActionCategoryType} action - Categoria da ação tomada na resolução.
 * @property {string | null} analyst - Analista que resolveu; `null` se automático.
 * @property {string} duration - Duração detecção→resolução (legível).
 * @property {string | null} escalated_to - Destino do escalonamento, quando houve.
 */
export interface ResolvedIncidentInterface {
  id: string;
  severity: IncidentSeverityType;
  rule: string;
  resolved_at: string;
  action: ActionCategoryType;
  analyst: string | null;
  duration: string;
  escalated_to: string | null;
  shadow: boolean;
}

/**
 * Dimensão (fornecedor/cliente/rota) mais afetada por incidentes resolvidos na janela.
 *
 * @property {DimensionType} dimension - Tipo da dimensão (`provider`/`customer`/`route`/`global`).
 * @property {string} value - Valor da dimensão (ex.: nome do fornecedor/cliente).
 * @property {number} count - Quantidade de incidentes resolvidos atribuídos à dimensão.
 * @property {IncidentSeverityType} severity - Pior severidade observada no grupo (realce do ponto).
 */
export interface AffectedDimensionInterface {
  dimension: DimensionType;
  value: string;
  count: number;
  severity: IncidentSeverityType;
}

/**
 * Resultado da tool `generate_incident_report` (§C.6): métricas agregadas + lista
 * de incidentes resolvidos na janela.
 *
 * @property {string} window - Janela temporal do relatório (rótulo legível).
 * @property {number} total - Total de incidentes resolvidos na janela.
 * @property {{ critical: number; warning: number; info: number }} by_severity - Contagem por severidade.
 * @property {number | null} mtta_seconds - MTTA médio (detecção→acknowledge) em segundos; `null` sem amostra.
 * @property {number | null} mttr_seconds - MTTR médio (detecção→resolução) em segundos; `null` sem amostra.
 * @property {number | null} delta_vs_previous - Variação do total vs o período anterior de mesmo tamanho; `null` quando a janela é "todo o período".
 * @property {AffectedDimensionInterface[]} affected_dimensions - Top dimensões afetadas (desc. por contagem).
 * @property {ResolvedIncidentInterface[]} resolved - Incidentes resolvidos na janela.
 */
export interface IncidentReportInterface {
  window: string;
  total: number;
  by_severity: {
    critical: number;
    warning: number;
    info: number
  };
  mtta_seconds: number | null;
  mttr_seconds: number | null;
  delta_vs_previous: number | null;
  affected_dimensions: AffectedDimensionInterface[];
  resolved: ResolvedIncidentInterface[];
}

// ---------------------------------------------------------------------------
// Regras de anomalia (tela de Regras) — snake_case
// ---------------------------------------------------------------------------

/**
 * Regra de detecção de anomalia (tabela `anomaly_rules`; tela de Regras).
 *
 * @property {string} id - Id estável da regra (ex.: `r-delivery-rate-drop`).
 * @property {string} name - Nome legível da regra.
 * @property {RuleType} rule_type - Tipo da regra (imutável na UI).
 * @property {DimensionType} dimension - Dimensão de agregação.
 * @property {boolean} enabled - Se a regra está ativa.
 * @property {IncidentSeverityType} severity - Severidade do incidente gerado.
 * @property {number} threshold - Valor do limiar.
 * @property {ThresholdUnitType} threshold_unit - Unidade do limiar (`%`/`σ`/`min`).
 * @property {number} window_minutes - Janela de avaliação, em minutos.
 * @property {string | null} category - Categoria de erro alvo (só `consistent_error`, ex.: `invalid_number`); read-only, usada na descrição. `null` para os demais tipos.
 * @property {boolean} shadow_mode - Regra em observação silenciosa: detecta e registra o incidente, mas não notifica (sem WebSocket/banner) — para calibrar thresholds antes de ligar o alerta.
 * @property {string | null} updated_by - Último editor; `null` se nunca editada.
 * @property {string} updated_at - Última atualização (ISO 8601 UTC).
 */
export interface AnomalyRuleInterface {
  id: string;
  name: string;
  rule_type: RuleType;
  dimension: DimensionType;
  enabled: boolean;
  severity: IncidentSeverityType;
  threshold: number;
  threshold_unit: ThresholdUnitType;
  window_minutes: number;
  category: string | null;
  shadow_mode: boolean;
  updated_by: string | null;
  updated_at: string;
}

/**
 * Payload de `PUT /api/rules/{id}` — campos editáveis da regra. `rule_type` é
 * imutável (não aparece aqui). Validado server-side; toda alteração é auditada.
 *
 * @property {string} [name] - Novo nome de exibição da regra (`rule_type`/`id` continuam imutáveis).
 * @property {number} [threshold] - Novo limiar.
 * @property {DimensionType} [dimension] - Nova dimensão de agregação.
 * @property {number} [window_minutes] - Nova janela (minutos).
 * @property {IncidentSeverityType} [severity] - Nova severidade.
 * @property {boolean} [enabled] - Ativa/desativa a regra.
 * @property {boolean} [shadow_mode] - Liga/desliga o modo observação silenciosa (detecta sem notificar).
 */
export interface UpdateRulePayload {
  name?: string;
  threshold?: number;
  dimension?: DimensionType;
  window_minutes?: number;
  severity?: IncidentSeverityType;
  enabled?: boolean;
  shadow_mode?: boolean;
}

// ---------------------------------------------------------------------------
// Chat / streaming (SSE) — snake_case
// ---------------------------------------------------------------------------

/**
 * Item da listagem de sessões de chat (resumo para a lista, snake_case).
 *
 * @property {string} id - Identificador da sessão.
 * @property {string} title - Título da sessão.
 * @property {string} started_at - Instante de início (ISO 8601 UTC).
 * @property {number} message_count - Total de mensagens trocadas.
 * @property {number} tool_count - Total de tools invocadas na sessão.
 * @property {boolean} pinned - Indica se a sessão está fixada pelo usuário.
 * @property {string[]} tags - Tags associadas à sessão.
 * @property {string} preview - Prévia textual do conteúdo da sessão.
 * @property {string} duration - Duração legível da sessão.
 * @property {boolean} has_incident - Indica se a sessão derivou em incidente.
 */
export interface ChatSessionListItemInterface {
  id: string;
  title: string;
  started_at: string;
  message_count: number;
  tool_count: number;
  pinned: boolean;
  tags: string[];
  preview: string;
  duration: string;
  has_incident: boolean;
}

/**
 * Uma invocação de tool registrada em uma mensagem de chat do assistente.
 *
 * @property {ToolNameType} name - Nome da tool executada (catálogo da Fase 1).
 * @property {Record<string, unknown>} args - Argumentos com que a tool foi chamada.
 * @property {'success' | 'error'} status - Resultado da execução server-side.
 * @property {unknown} result - Resultado da tool (shape conforme §C; depende da tool).
 */
export interface ChatToolInvocationInterface {
  name: ToolNameType;
  args: Record<string, unknown>;
  status: 'success' | 'error';
  result: unknown;
}

/**
 * Conteúdo persistido de uma mensagem de chat (JSON em `chat_messages.content`).
 *
 * `user` usa apenas `text`; `assistant` pode trazer `tools` (invocações) e/ou `refusal`.
 *
 * @property {string} text - Texto da mensagem (do usuário ou a resposta final do assistente).
 * @property {ChatToolInvocationInterface[]} [tools] - Tools executadas para compor a resposta (assistant).
 * @property {{ reason: string; explanation: string; can_do: string[] } | null} [refusal] - Recusa estruturada, quando o pedido sai do escopo.
 * @property {{ input_tokens: number; output_tokens: number }} [usage] - Uso de tokens da resposta (assistant), quando o provider reporta; base de tokens/cost na observabilidade.
 */
export interface ChatMessageContentInterface {
  text: string;
  tools?: ChatToolInvocationInterface[];
  refusal?: {
    reason: string;
    explanation: string;
    can_do: string[]
  } | null;
  usage?: {
    input_tokens: number;
    output_tokens: number
  };
}

/**
 * Item do histórico de mensagens de uma sessão (`GET /api/chat/sessions/{id}/messages`).
 *
 * @property {string} id - Id da mensagem.
 * @property {'user' | 'assistant'} role - Autor da mensagem.
 * @property {ChatMessageContentInterface} content - Conteúdo estruturado da mensagem.
 * @property {string} created_at - Instante de criação (ISO 8601 UTC).
 */
export interface ChatMessageInterface {
  id: string;
  role: 'user' | 'assistant';
  content: ChatMessageContentInterface;
  created_at: string;
}

/**
 * Evento de streaming do chat via SSE (união discriminada por `event`).
 *
 * @remarks
 * - `tool_call` — orquestrador iniciou uma tool (`status: 'running'`), com `name` e `args`.
 * - `tool_progress` — andamento de uma tool em execução: `phase` (etapa do motor) + `label` legível,
 *   e `current`/`total` (partições processadas) para uma barra de progresso. Pode ocorrer N vezes
 *   entre o `tool_call` e o `tool_result`; nem toda tool emite (só as que varrem o S3).
 * - `tool_result` — tool concluiu: `status` `success`/`error`, `result` (shape depende da tool) e
 *   `duration_ms` (tempo total da execução, do `tool_call` ao resultado).
 * - `text_delta` — fragmento incremental do texto da resposta (`delta`).
 * - `thinking_delta` — fragmento do raciocínio do modelo (ex.: `<thinking>` do Nova), exibido à
 *   parte e efêmero (não persiste no histórico).
 * - `done` — fim da resposta; `refusal` é `null` quando houve resposta normal.
 * - `refusal` — recusa: `reason`/`explanation` e `can_do` com alternativas possíveis.
 * - `error` — falha no processamento (ex.: timeout do stream do LLM): `{ error: { code, message } }`.
 */
export type ChatStreamEvent =
  | {
    event: 'tool_call';
    data: {
      name: ToolNameType;
      args: Record<string, unknown>;
      status: 'running'
    }
  }
  | {
    event: 'tool_progress';
    data: {
      name: ToolNameType;
      phase: string;
      label: string;
      current?: number;
      total?: number
    }
  }
  | {
    event: 'tool_result';
    data: {
      name: ToolNameType;
      status: 'success' | 'error';
      result: unknown;
      duration_ms: number
    }
  }
  | {
    event: 'text_delta';
    data: { delta: string }
  }
  | {
    event: 'thinking_delta';
    data: { delta: string }
  }
  | {
    event: 'done';
    data: {
      message_id: string;
      refusal: null;
      /** Título gerado automaticamente para a sessão (só na 1ª troca); ausente nas demais. */
      session_title?: string
    }
  }
  | {
    event: 'refusal';
    data: {
      reason: string;
      explanation: string;
      can_do: string[]
    }
  }
  | {
    event: 'error';
    data: {
      error: {
        code: string;
        message: string
      }
    }
  };

// ---------------------------------------------------------------------------
// WebSocket (push de incidentes — Fase 2) — snake_case
// ---------------------------------------------------------------------------

/**
 * Evento push do servidor via WebSocket — incidentes (Fase 2). União discriminada por `type`.
 *
 * @remarks
 * - `incident.created` — novo incidente, com o `IncidentInterface` completo.
 * - `incident.updated` — mudança de `status`; `acknowledged_by` quando reconhecido e `at` (ISO 8601 UTC).
 * - `incident.auto_resolved` — resolução automática, com `resolved_at` e `note`.
 * - `connection.status` — heartbeat/estado da conexão (`ok`).
 */
export type WsServerEvent =
  | {
    type: 'incident.created';
    incident: IncidentInterface
  }
  | {
    type: 'incident.updated';
    incident_id: string;
    status: IncidentStatusType;
    acknowledged_by?: string;
    at: string
  }
  | {
    type: 'incident.auto_resolved';
    incident_id: string;
    resolved_at: string;
    note: string
  }
  | {
    type: 'connection.status';
    ok: boolean
  };

// ---------------------------------------------------------------------------
// Observabilidade do assistente (página admin) — snake_case
// ---------------------------------------------------------------------------

/**
 * Estatística de uso de uma tool (observabilidade).
 *
 * @property {string} name - Nome da tool.
 * @property {number} calls - Total de execuções na janela.
 * @property {number} errors - Execuções que falharam.
 * @property {number | null} avg_latency_ms - Latência média (ms); `null` se sem amostra.
 * @property {number | null} p50_ms - Latência mediana (ms); `null` se sem amostra.
 * @property {number | null} p95_ms - Latência p95 (ms); `null` se sem amostra.
 * @property {number | null} p99_ms - Latência p99 (ms); `null` se sem amostra.
 */
export interface ToolUsageStatInterface {
  name: string;
  calls: number;
  errors: number;
  avg_latency_ms: number | null;
  p50_ms: number | null;
  p95_ms: number | null;
  p99_ms: number | null;
}

/**
 * Métricas básicas do próprio assistente (`GET /api/observability`), reusando o
 * audit log e as sessões. Custo/tokens/MTTA/percentis de latência ficam pendentes
 * (OpenTelemetry/Prometheus) e vêm como `null`/vazios até então.
 *
 * @property {string} period - Janela coberta (rótulo legível).
 * @property {object} overview - Visão geral.
 * @property {number} overview.sessions - Total de sessões de chat.
 * @property {number} overview.reveals - Acessos a PII (reveal de telefone/conteúdo) auditados.
 * @property {number | null} overview.tokens - Tokens consumidos; `null` (pendente).
 * @property {number | null} overview.cost - Custo estimado; `null` (pendente).
 * @property {string | null} overview.mtta - Tempo médio até reconhecimento; `null` (pendente).
 * @property {ToolUsageStatInterface[]} tools - Uso por tool (calls/errors/latência média).
 * @property {object} refusals - Recusas do assistente.
 * @property {number} refusals.total - Total de recusas (pendente de persistência → 0).
 * @property {Array<{ reason: string; count: number }>} refusals.by_reason - Recusas por motivo.
 * @property {object} websocket - Estado do WebSocket.
 * @property {number} websocket.connected - Conexões ativas no `/ws/support`.
 * @property {number | null} websocket.peak - Pico de conexões; `null` (pendente).
 */
export interface ObservabilityInterface {
  period: string;
  overview: {
    sessions: number;
    reveals: number;
    tokens: number | null;
    cost: number | null;
    mtta: string | null;
    /** Duração média de sessão (ms) na janela; `null` se sem sessão. */
    avg_session_ms: number | null;
  };
  /** Consumo de tokens por hora (buckets cronológicos UTC) na janela — base do gráfico. */
  tokens_hourly: Array<{
    at: string;
    tokens: number
  }>;
  tools: ToolUsageStatInterface[];
  refusals: {
    total: number;
    by_reason: Array<{
      reason: string;
      count: number
    }>;
  };
  websocket: {
    connected: number;
    peak: number | null;
  };
  /** Provider/modelo LLM ativo atendendo o assistente (rótulo p/ a observabilidade). */
  llm: {
    provider: string;
    model: string;
  };
  audit_scan: AuditScanStatsInterface;
}

/**
 * Custo de leitura do S3 pelo motor de auditoria (DuckDB), acumulado desde a subida do serviço.
 * Mede quanto se lê do S3 (fonte de verdade) vs. do cache `/tmp`, para observabilidade de custo.
 *
 * @property {number} queries - Consultas que materializaram a janela (search/trail/report/detector/...).
 * @property {number} partitions_total - Partições candidatas somadas (todas as consultas).
 * @property {number} partitions_cached - Partições servidas do cache Parquet (0 leitura no S3).
 * @property {number} partitions_scanned - Partições lidas do S3 (frias sem cache + recentes/live).
 * @property {number} s3_objects - Objetos (`.json.gz`) lidos do S3.
 * @property {number} cache_hit_rate - `partitions_cached / partitions_total` (0–1).
 * @property {number} avg_materialize_ms - Tempo médio de materialização por consulta (ms).
 * @property {number} estimated_get_requests - Estimativa de GET requests ao S3 (≈ objetos; limite inferior).
 * @property {number} estimated_cost_usd - Custo estimado (GET + LIST), grosseiro, em USD.
 */
export interface AuditScanStatsInterface {
  queries: number;
  partitions_total: number;
  partitions_cached: number;
  partitions_scanned: number;
  s3_objects: number;
  cache_hit_rate: number;
  avg_materialize_ms: number;
  estimated_get_requests: number;
  estimated_cost_usd: number;
}

// ---------------------------------------------------------------------------
// Log de ingestão (fonte: at-api-logs-prod / LogInterface) — formato externo, mantido
// ---------------------------------------------------------------------------

/**
 * Contexto opcional de um log de ingestão — formato externo (`at-api-logs-prod` /
 * `LogInterface`), mantido como recebido. Não confundir com o logging interno da API
 * (que nunca registra PII).
 *
 * @property {string} [user_id] - Identificador do usuário associado à requisição.
 * @property {string} [app_id] - Identificador da aplicação cliente.
 * @property {string} [method] - Método HTTP da requisição.
 * @property {string} [url] - URL/rota da requisição.
 * @property {string} [user_agent] - User-Agent do cliente.
 * @property {string} [ip] - IP de origem.
 * @property {Record<string, unknown>} [payload] - Corpo/parâmetros da requisição.
 * @property {Record<string, unknown>} [response] - Corpo da resposta.
 * @property {number} [status_code] - Código de status HTTP da resposta.
 * @property {number} [response_time] - Tempo de resposta (ms).
 * @property {string} [error] - Mensagem de erro, quando houve.
 * @property {string} [stack] - Stack trace do erro, quando houve.
 * @property {Record<string, string>} [headers] - Cabeçalhos da requisição/resposta.
 * @property {string} [content_type] - Content-Type associado.
 */
export interface LogContextInterface {
  user_id?: string;
  app_id?: string;
  method?: string;
  url?: string;
  user_agent?: string;
  ip?: string;
  payload?: Record<string, unknown>;
  response?: Record<string, unknown>;
  status_code?: number;
  response_time?: number;
  error?: string;
  stack?: string;
  headers?: Record<string, string>;
  content_type?: string;
}

/**
 * Entrada de log de ingestão (uma linha do `at-api-logs-prod` / `LogInterface`).
 * Formato externo, mantido fielmente para parsing dos dados de origem.
 *
 * @property {string} timestamp - Instante do log (ISO 8601 UTC).
 * @property {'info' | 'warn' | 'error' | 'debug'} level - Nível do log.
 * @property {string} id - Identificador do registro de log.
 * @property {'development' | 'homologation' | 'production' | 'test'} environment - Ambiente de origem.
 * @property {string} service - Serviço que emitiu o log.
 * @property {string} correlation_id - ID de correlação para rastrear a requisição entre serviços.
 * @property {string} message - Mensagem principal do log.
 * @property {LogContextInterface} [context] - Contexto adicional da requisição/erro.
 */
export interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  id: string;
  environment: 'development' | 'homologation' | 'production' | 'test';
  service: string;
  correlation_id: string;
  message: string;
  context?: LogContextInterface;
}
