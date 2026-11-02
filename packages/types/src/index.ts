/**
 * `@atena/types` — contrato compartilhado entre backend e frontend.
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
 */
export interface SessionUserInterface {
  /** Identificador estável do usuário no IdP (claim `sub`). */
  sub: string;
  /** E-mail institucional (dentro do domínio permitido). */
  email: string;
  /** Nome de exibição. */
  name: string;
  /** Papéis atribuídos (vazio = acesso pendente). */
  roles: RoleType[];
  /** Permissões derivadas dos papéis. */
  permissions: PermissionType[];
  /** `active` | `disabled`. */
  status: UserStatusType;
  /** Super admin (definido só pelo `AUTH_ADMIN_EMAILS`/env): acesso total + gerencia admins; imutável pela tela. */
  is_super_admin: boolean;
}

/** Item da lista de usuários da tela de admin (`GET /admin/users`). */
export interface AdminUserInterface {
  /** Id do usuário (= claim `sub`). */
  sub: string;
  /** E-mail institucional. */
  email: string;
  /** Nome de exibição. */
  name: string;
  /** `active` | `disabled`. */
  status: UserStatusType;
  /** Papéis atribuídos. */
  roles: RoleType[];
  /** Super admin (via env): imutável pela tela. */
  is_super_admin: boolean;
  /** Último login (ISO) ou `null`. */
  last_login_at: string | null;
  /** Criação (ISO). */
  created_at: string;
}

/** Item do catálogo de papéis (`GET /admin/roles`) — alimenta a tela de admin. */
export interface RoleCatalogItemInterface {
  /** Chave do papel. */
  role: RoleType;
  /** Rótulo legível. */
  label: string;
  /** O que o papel permite (para a UI explicar cada papel). */
  description: string;
  /** Permissões que o papel concede. */
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
 */
export interface AuditLogEntryInterface {
  /** Id do registro. */
  id: string;
  /** Instante do evento (ISO 8601 UTC). */
  occurred_at: string;
  /** Subject do usuário; `null` se sem autenticação. */
  user_id: string | null;
  /** Nome de exibição do usuário (resolvido do `user_id`/sub); `null` se desconhecido (mostra o id). */
  user_name: string | null;
  /** Ação auditada. */
  action: AuditActionType;
  /** Recurso afetado (ex.: rota, `orchestrator:tool`). */
  resource: string;
  /** Detalhe livre (só referências); `null` se ausente. */
  detail: string | null;
  /** Severidade/categoria. */
  severity: AuditSeverityType;
  /** IP de origem; `null` se indisponível. */
  ip_address: string | null;
  /** Metadados estruturados (só referências). */
  metadata: Record<string, unknown> | null;
}

/** Opção do filtro de usuário do Audit log: o `id` (sub) + o nome de exibição resolvido. */
export interface AuditUserOptionInterface {
  /** Subject (`sub`) do usuário, usado como valor do filtro. */
  id: string;
  /** Nome de exibição (ou `null` → a tela mostra o `id`). */
  name: string | null;
}

/** Contadores do topo da tela de Audit log. */
export interface AuditSummaryInterface {
  /** Eventos de hoje (UTC). */
  today: number;
  /** Acessos a PII (severity `pii`). */
  pii: number;
  /** Mudanças de regra (`rule_update`). */
  rule_changes: number;
  /** Total de registros no log. */
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

/** Shape único de resposta de erro da API (produzido pelo `AllExceptionsFilter`). */
export interface ApiErrorInterface {
  /** Erro de domínio: `code` estável (chave de tradução/contrato) e `message` legível. */
  error: {
    code: string;
    message: string
  };
}

/**
 * Envelope padrão de respostas paginadas da API (snake_case na borda).
 *
 * @template {T} Tipo de cada linha em `rows`.
 */
export interface PaginatedEnvelopeInterface<T> {
  /** Itens da página atual. */
  rows: T[];
  /** Página atual (base do contrato; ver §C). */
  page: number;
  /** Total de páginas disponíveis. */
  total_pages: number;
  /** Total de itens em todas as páginas. */
  total: number;
  /** Tempo de processamento da consulta, em ms. */
  latency_ms: number;
}

// ---------------------------------------------------------------------------
// Tool results (§C do contrato) — snake_case
// ---------------------------------------------------------------------------

/** Linha de resultado da tool `search_shippings` (§C do contrato). */
export interface SearchResultRowInterface {
  /** Identificador do envio. */
  id: string;
  /** Id da campanha (id da requisição); 1 campanha → N destinatários. Alias externo do `correlation_id` interno. */
  campaign_id: string | null;
  /** Telefone mascarado; exibido por padrão. */
  phone_masked: string;
  /** PII: telefone completo, só com permissão + reveal auditado. */
  phone_full?: string; // só com permissão + reveal (gera audit)
  /** Status de entrega do envio. */
  status: ShippingStatusType;
  /** Provedor responsável pelo envio. */
  provider: string;
  /** Cliente dono do envio. */
  customer: string;
  /** Canal do envio: `sms` (SMS Short) ou `sms_flash` (SMS Flash). */
  channel: string | null;
  /** Aplicação que originou o envio (atribuição); UUID. */
  app_id: string | null;
  /**
   * Instante do pedido de ENVIO (ISO 8601 UTC). A janela da busca filtra
   * por ESTE instante (envios feitos na janela), nunca pela finalização — ver `finalized_at`.
   */
  requested_at: string;
  /**
   * Instante em que o envio chegou ao status final (ISO 8601
   * UTC); pode ser de um dia POSTERIOR ao envio. `null` enquanto não finalizou (`pending`).
   */
  finalized_at: string | null;
  /** Dica de erro quando houve falha; `null` caso contrário. */
  error_hint: string | null;
}

/** Evento individual na trilha (timeline) de um envio. */
export interface ShippingTrailEvent {
  /** Tipo/etapa do evento no lifecycle. */
  type: ShippingEventType;
  /** Rótulo curto para exibição. */
  label: string;
  /**
   * Instante do evento. ISO 8601 UTC (com `Z`) na fonte; na borda do chat vem
   * como datetime naive (sem `Z`) no fuso do operador, p/ o assistente citar a hora local correta.
   * O formatador da UI aceita as duas formas (naive = relógio de parede já no fuso; com `Z` = absoluto).
   */
  at: string;
  /** Detalhe legível do que ocorreu. */
  detail: string;
}

/** Trilha completa de um envio (resultado de `get_shipping_trail`, §C). */
export interface ShippingTrailInterface {
  /** Identificador do envio rastreado. */
  shipping_id: string;
  /** Id da campanha (id da requisição). Alias externo do `correlation_id` interno. */
  campaign_id: string | null;
  /** Cliente dono do envio. */
  customer: string;
  /** Provedor responsável pelo envio. */
  provider: string;
  /** Telefone mascarado; exibido por padrão. */
  phone_masked: string;
  /** Canal do envio: `sms` (SMS Short) ou `sms_flash` (SMS Flash). */
  channel: string | null;
  /** Aplicação que originou o envio (atribuição); UUID. */
  app_id: string | null;
  /** Status consolidado (do evento `final`). */
  final_status: ShippingStatusType;
  /** Referência opaca ao conteúdo (não é a PII em si). */
  content_ref: string;
  /**
   * Se há texto do SMS para revelar nesta fonte; quando `false`,
   * a UI mostra "conteúdo não disponível" em vez de oferecer o reveal.
   */
  content_available: boolean;
  /** PII: prévia do conteúdo, só após reveal auditado; mascarado por padrão. */
  content_preview?: string; // só após reveal (audit); mascarado por padrão
  /** Eventos do lifecycle, em ordem cronológica. */
  events: ShippingTrailEvent[];
}

/** Categoria de risco detectada na análise de conteúdo, com sua intensidade. */
export interface RiskCategoryInterface {
  /** Nome da categoria de risco. */
  name: string;
  /** Intensidade da categoria (peso/score relativo). */
  strength: number;
}

/** Resultado da tool `analyze_shipping_content` (§C): risco do conteúdo. */
export interface RiskAnalysisInterface {
  /** Score agregado de risco. */
  score: number;
  /** Veredito derivado do score. */
  verdict: RiskVerdictType;
  /** Categorias que compõem o risco. */
  categories: RiskCategoryInterface[];
  /** Justificativa legível do veredito. */
  explanation: string;
}

/** Relatório de entregabilidade (resultado de `generate_delivery_report`, §C). */
export interface DeliveryReportInterface {
  /** Janela temporal do relatório (ex.: "24h", intervalo). */
  window: string;
  /**
   * Filtros aplicados (eco do recorte); ausente/`{}` = todos os clientes e provedores. Mostrado no card para identificar o escopo.
   */
  filters?: {
    customer_id?: string;
    provider?: string;
    status?: ShippingStatusType
  };
  /** Totais por status. `blocked` = bloqueado pelo controle de entrega (bounce); NÃO conta como falha. */
  totals: {
    sent: number;
    delivered: number;
    failed: number;
    blocked: number;
    pending: number
  };
  /**
   * Quebra por provedor; `rate` = taxa de entrega = entregues/(entregues+falhas) (bloqueados/pendentes fora do denominador).
   */
  by_provider: {
    name: string;
    sent: number;
    delivered: number;
    failed: number;
    blocked: number;
    pending: number;
    rate: number
  }[];
  /**
   * Taxa de entrega por hora, em buckets CRONOLÓGICOS; `at` é o início do bucket (ISO 8601 UTC, ex.: "2026-06-18T21:00:00Z"). Cobre os dias da janela (não colapsa por hora-do-dia).
   */
  hourly: {
    at: string;
    rate: number
  }[];
  /** Principais erros: código, contagem e provedor. */
  top_errors: {
    code: string;
    count: number;
    provider: string
  }[];
  /** URL para download do relatório em CSV. */
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
 */
export interface RevealedPhoneInterface {
  /** Id do envio revelado. */
  shipping_id: string;
  /** Telefone completo em E.164 (NÃO mascarado). */
  phone_full: string;
}

/**
 * Resultado de reveal de conteúdo (`POST /api/shippings/{id}/reveal-content`).
 *
 * PII: conteúdo bruto hidratado do S3 via `content_ref` (cache `/tmp`↔S3); só
 * após reveal autorizado e auditado (`reveal_content`).
 */
export interface RevealedContentInterface {
  /** Id do envio revelado. */
  shipping_id: string;
  /** Conteúdo textual do envio (NÃO mascarado). */
  content_preview: string;
}

// ---------------------------------------------------------------------------
// Incidentes — snake_case
// ---------------------------------------------------------------------------

/** Incidente detectado por uma regra de anomalia (snake_case na borda da API). */
export interface IncidentInterface {
  /** Identificador do incidente. */
  id: string;
  /** Regra que originou o incidente (ver {@link RuleType}). */
  rule: string;
  /** Severidade/impacto. */
  severity: IncidentSeverityType;
  /** Estado atual no ciclo de vida. */
  status: IncidentStatusType;
  /** Tipo de dimensão afetada. */
  dimension_type: DimensionType;
  /** Valor da dimensão (ex.: nome do provedor/cliente). */
  dimension_value: string;
  /** Instante da detecção (ISO 8601 UTC). */
  detected_at: string;
  /** Rótulo legível da janela de detecção, no fuso de exibição (ex.: `23/06 16:40 → 16:55 GMT-3 (15 min)`). */
  window: string;
  /** Início da janela de detecção em ISO 8601 UTC (com `Z`) — use direto como `date_from` de relatório. */
  window_from: string | null;
  /** Fim da janela de detecção em ISO 8601 UTC (com `Z`) — use direto como `date_to` de relatório. */
  window_to: string | null;
  /** Resumo legível do incidente. */
  summary: string;
  /** Métricas de suporte: baseline, valor atual, limiar e tamanho da amostra. */
  metrics: {
    baseline: string;
    current: string;
    threshold: string;
    sample: string
  };
  /** Quantidade de envios relacionados. */
  related_shippings: number;
  /** Responsável atribuído; `null` se não atribuído. */
  assignee: string | null;
  shadow: boolean;
}

/**
 * Amostra de envios relacionados a um incidente (`GET /incidents/:id/shippings`).
 *
 * Busca real escopada pela dimensão do incidente (provider/customer) + janela em torno do
 * `detected_at`. Para dimensões sem filtro de busca direto (global/route), `available` é `false`
 * e a UI cai no modo contagem (`IncidentInterface.related_shippings`).
 */
export interface IncidentShippingsInterface {
  /** Se foi possível buscar amostra real para a dimensão do incidente. */
  available: boolean;
  /** Amostra de envios (mesma forma do `search_shippings`); base do CSV. */
  rows: SearchResultRowInterface[];
  /** Total de envios que casam a dimensão+janela (não só a amostra retornada). */
  total: number;
  /**
   * Códigos de envio (campaign_id)
   * com mais ocorrências na amostra, em ordem decrescente (poucos; resumo do detalhe do incidente).
   */
  top_campaigns: {
    campaign_id: string;
    count: number
  }[];
}

/**
 * Payload para resolver um incidente manualmente (UI + validação server-side;
 * resolver não é tool do LLM).
 */
export interface ResolveIncidentPayload {
  /** Categoria da ação tomada. */
  action_category: ActionCategoryType;
  /** Descrição da ação; ≥ 20 chars (≥ 10 em `auto_resolved`), validado server-side. */
  action_description: string; // ≥ 20 chars (≥ 10 no auto_resolved) — validado server-side
  /** Destino do escalonamento; obrigatório se `action_category` ∈ {`provider_escalated`, `internal_escalated`}. */
  escalated_to?: string; // obrigatório se action_category ∈ {provider_escalated, internal_escalated}
  /** IDs de envios relacionados ao incidente. */
  related_shipping_ids?: string[];
  /** Tags livres para categorização/auditoria. */
  tags?: string[];
}

/** Atividade no ciclo de vida de um incidente (comentário, mudança de estado, tool). */
export interface IncidentActivityInterface {
  /** Id da atividade. */
  id: string;
  /** Usuário que a gerou, quando houver. */
  user_id?: string;
  /** Tipo da atividade. */
  type: 'comment' | 'status_change' | 'tool_call';
  /** Instante (ISO 8601 UTC). */
  at: string;
  /** Detalhe estruturado (ex.: novo status, texto do comentário). */
  payload: Record<string, unknown>;
}

/** Incidente já resolvido, como aparece no relatório de incidentes (§C.6). */
export interface ResolvedIncidentInterface {
  /** Id do incidente. */
  id: string;
  /** Severidade. */
  severity: IncidentSeverityType;
  /** Regra que originou. */
  rule: string;
  /** Instante de resolução (ISO 8601 UTC). */
  resolved_at: string;
  /** Categoria da ação tomada na resolução. */
  action: ActionCategoryType;
  /** Analista que resolveu; `null` se automático. */
  analyst: string | null;
  /** Duração detecção→resolução (legível). */
  duration: string;
  /** Destino do escalonamento, quando houve. */
  escalated_to: string | null;
  shadow: boolean;
}

/** Dimensão (fornecedor/cliente/rota) mais afetada por incidentes resolvidos na janela. */
export interface AffectedDimensionInterface {
  /** Tipo da dimensão (`provider`/`customer`/`route`/`global`). */
  dimension: DimensionType;
  /** Valor da dimensão (ex.: nome do fornecedor/cliente). */
  value: string;
  /** Quantidade de incidentes resolvidos atribuídos à dimensão. */
  count: number;
  /** Pior severidade observada no grupo (realce do ponto). */
  severity: IncidentSeverityType;
}

/**
 * Resultado da tool `generate_incident_report` (§C.6): métricas agregadas + lista
 * de incidentes resolvidos na janela.
 */
export interface IncidentReportInterface {
  /** Janela temporal do relatório (rótulo legível). */
  window: string;
  /** Total de incidentes resolvidos na janela. */
  total: number;
  /** Contagem por severidade. */
  by_severity: {
    critical: number;
    warning: number;
    info: number
  };
  /** MTTA médio (detecção→acknowledge) em segundos; `null` sem amostra. */
  mtta_seconds: number | null;
  /** MTTR médio (detecção→resolução) em segundos; `null` sem amostra. */
  mttr_seconds: number | null;
  /** Variação do total vs o período anterior de mesmo tamanho; `null` quando a janela é "todo o período". */
  delta_vs_previous: number | null;
  /** Top dimensões afetadas (desc. por contagem). */
  affected_dimensions: AffectedDimensionInterface[];
  /** Incidentes resolvidos na janela. */
  resolved: ResolvedIncidentInterface[];
}

// ---------------------------------------------------------------------------
// Regras de anomalia (tela de Regras) — snake_case
// ---------------------------------------------------------------------------

/** Regra de detecção de anomalia (tabela `anomaly_rules`; tela de Regras). */
export interface AnomalyRuleInterface {
  /** Id estável da regra (ex.: `r-delivery-rate-drop`). */
  id: string;
  /** Nome legível da regra. */
  name: string;
  /** Tipo da regra (imutável na UI). */
  rule_type: RuleType;
  /** Dimensão de agregação. */
  dimension: DimensionType;
  /** Se a regra está ativa. */
  enabled: boolean;
  /** Severidade do incidente gerado. */
  severity: IncidentSeverityType;
  /** Valor do limiar. */
  threshold: number;
  /** Unidade do limiar (`%`/`σ`/`min`). */
  threshold_unit: ThresholdUnitType;
  /** Janela de avaliação, em minutos. */
  window_minutes: number;
  /**
   * Categoria de erro alvo (só `consistent_error`, ex.: `invalid_number`); read-only, usada na descrição. `null` para os demais tipos.
   */
  category: string | null;
  /**
   * Regra em observação silenciosa: detecta e registra o incidente, mas não notifica (sem WebSocket/banner) — para calibrar thresholds antes de ligar o alerta.
   */
  shadow_mode: boolean;
  /** Último editor; `null` se nunca editada. */
  updated_by: string | null;
  /** Última atualização (ISO 8601 UTC). */
  updated_at: string;
}

/**
 * Payload de `PUT /api/rules/{id}` — campos editáveis da regra. `rule_type` é
 * imutável (não aparece aqui). Validado server-side; toda alteração é auditada.
 */
export interface UpdateRulePayload {
  /** Novo nome de exibição da regra (`rule_type`/`id` continuam imutáveis). */
  name?: string;
  /** Novo limiar. */
  threshold?: number;
  /** Nova dimensão de agregação. */
  dimension?: DimensionType;
  /** Nova janela (minutos). */
  window_minutes?: number;
  /** Nova severidade. */
  severity?: IncidentSeverityType;
  /** Ativa/desativa a regra. */
  enabled?: boolean;
  /** Liga/desliga o modo observação silenciosa (detecta sem notificar). */
  shadow_mode?: boolean;
}

// ---------------------------------------------------------------------------
// Chat / streaming (SSE) — snake_case
// ---------------------------------------------------------------------------

/** Item da listagem de sessões de chat (resumo para a lista, snake_case). */
export interface ChatSessionListItemInterface {
  /** Identificador da sessão. */
  id: string;
  /** Título da sessão. */
  title: string;
  /** Instante de início (ISO 8601 UTC). */
  started_at: string;
  /** Total de mensagens trocadas. */
  message_count: number;
  /** Total de tools invocadas na sessão. */
  tool_count: number;
  /** Indica se a sessão está fixada pelo usuário. */
  pinned: boolean;
  /** Tags associadas à sessão. */
  tags: string[];
  /** Prévia textual do conteúdo da sessão. */
  preview: string;
  /** Duração legível da sessão. */
  duration: string;
  /** Indica se a sessão derivou em incidente. */
  has_incident: boolean;
}

/** Uma invocação de tool registrada em uma mensagem de chat do assistente. */
export interface ChatToolInvocationInterface {
  /** Nome da tool executada (catálogo da Fase 1). */
  name: ToolNameType;
  /** Argumentos com que a tool foi chamada. */
  args: Record<string, unknown>;
  /** Resultado da execução server-side. */
  status: 'success' | 'error';
  /** Resultado da tool (shape conforme §C; depende da tool). */
  result: unknown;
}

/**
 * Conteúdo persistido de uma mensagem de chat (JSON em `chat_messages.content`).
 *
 * `user` usa apenas `text`; `assistant` pode trazer `tools` (invocações) e/ou `refusal`.
 */
export interface ChatMessageContentInterface {
  /** Texto da mensagem (do usuário ou a resposta final do assistente). */
  text: string;
  /** Tools executadas para compor a resposta (assistant). */
  tools?: ChatToolInvocationInterface[];
  /** Recusa estruturada, quando o pedido sai do escopo. */
  refusal?: {
    reason: string;
    explanation: string;
    can_do: string[]
  } | null;
  /** Uso de tokens da resposta (assistant), quando o provider reporta; base de tokens/cost na observabilidade. */
  usage?: {
    input_tokens: number;
    output_tokens: number
  };
}

/** Item do histórico de mensagens de uma sessão (`GET /api/chat/sessions/{id}/messages`). */
export interface ChatMessageInterface {
  /** Id da mensagem. */
  id: string;
  /** Autor da mensagem. */
  role: 'user' | 'assistant';
  /** Conteúdo estruturado da mensagem. */
  content: ChatMessageContentInterface;
  /** Instante de criação (ISO 8601 UTC). */
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

/** Estatística de uso de uma tool (observabilidade). */
export interface ToolUsageStatInterface {
  /** Nome da tool. */
  name: string;
  /** Total de execuções na janela. */
  calls: number;
  /** Execuções que falharam. */
  errors: number;
  /** Latência média (ms); `null` se sem amostra. */
  avg_latency_ms: number | null;
  /** Latência mediana (ms); `null` se sem amostra. */
  p50_ms: number | null;
  /** Latência p95 (ms); `null` se sem amostra. */
  p95_ms: number | null;
  /** Latência p99 (ms); `null` se sem amostra. */
  p99_ms: number | null;
}

/**
 * Métricas básicas do próprio assistente (`GET /api/observability`), reusando o
 * audit log e as sessões. Custo/tokens/MTTA/percentis de latência ficam pendentes
 * (OpenTelemetry/Prometheus) e vêm como `null`/vazios até então.
 */
export interface ObservabilityInterface {
  /** Janela coberta (rótulo legível). */
  period: string;
  /** Visão geral. */
  overview: {
    /** Total de sessões de chat. */
    sessions: number;
    /** Acessos a PII (reveal de telefone/conteúdo) auditados. */
    reveals: number;
    /** Tokens consumidos; `null` (pendente). */
    tokens: number | null;
    /** Custo estimado; `null` (pendente). */
    cost: number | null;
    /** Tempo médio até reconhecimento; `null` (pendente). */
    mtta: string | null;
    /** Duração média de sessão (ms) na janela; `null` se sem sessão. */
    avg_session_ms: number | null;
  };
  /** Consumo de tokens por hora (buckets cronológicos UTC) na janela — base do gráfico. */
  tokens_hourly: {
    at: string;
    tokens: number
  }[];
  /** Uso por tool (calls/errors/latência média). */
  tools: ToolUsageStatInterface[];
  /** Recusas do assistente. */
  refusals: {
    /** Total de recusas (pendente de persistência → 0). */
    total: number;
    /** Recusas por motivo. */
    by_reason: {
      reason: string;
      count: number
    }[];
  };
  /** Estado do WebSocket. */
  websocket: {
    /** Conexões ativas no `/ws/support`. */
    connected: number;
    /** Pico de conexões; `null` (pendente). */
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
 */
export interface AuditScanStatsInterface {
  /** Consultas que materializaram a janela (search/trail/report/detector/...). */
  queries: number;
  /** Partições candidatas somadas (todas as consultas). */
  partitions_total: number;
  /** Partições servidas do cache Parquet (0 leitura no S3). */
  partitions_cached: number;
  /** Partições lidas do S3 (frias sem cache + recentes/live). */
  partitions_scanned: number;
  /** Objetos (`.json.gz`) lidos do S3. */
  s3_objects: number;
  /** `partitions_cached / partitions_total` (0–1). */
  cache_hit_rate: number;
  /** Tempo médio de materialização por consulta (ms). */
  avg_materialize_ms: number;
  /** Estimativa de GET requests ao S3 (≈ objetos; limite inferior). */
  estimated_get_requests: number;
  /** Custo estimado (GET + LIST), grosseiro, em USD. */
  estimated_cost_usd: number;
}

// ---------------------------------------------------------------------------
// Log de ingestão (fonte: at-api-logs-prod / LogInterface) — formato externo, mantido
// ---------------------------------------------------------------------------

/**
 * Contexto opcional de um log de ingestão — formato externo (`at-api-logs-prod` /
 * `LogInterface`), mantido como recebido. Não confundir com o logging interno da API
 * (que nunca registra PII).
 */
export interface LogContextInterface {
  /** Identificador do usuário associado à requisição. */
  user_id?: string;
  /** Identificador da aplicação cliente. */
  app_id?: string;
  /** Método HTTP da requisição. */
  method?: string;
  /** URL/rota da requisição. */
  url?: string;
  /** User-Agent do cliente. */
  user_agent?: string;
  /** IP de origem. */
  ip?: string;
  /** Corpo/parâmetros da requisição. */
  payload?: Record<string, unknown>;
  /** Corpo da resposta. */
  response?: Record<string, unknown>;
  /** Código de status HTTP da resposta. */
  status_code?: number;
  /** Tempo de resposta (ms). */
  response_time?: number;
  /** Mensagem de erro, quando houve. */
  error?: string;
  /** Stack trace do erro, quando houve. */
  stack?: string;
  /** Cabeçalhos da requisição/resposta. */
  headers?: Record<string, string>;
  /** Content-Type associado. */
  content_type?: string;
}

/**
 * Entrada de log de ingestão (uma linha do `at-api-logs-prod` / `LogInterface`).
 * Formato externo, mantido fielmente para parsing dos dados de origem.
 */
export interface LogEntry {
  /** Instante do log (ISO 8601 UTC). */
  timestamp: string;
  /** Nível do log. */
  level: 'info' | 'warn' | 'error' | 'debug';
  /** Identificador do registro de log. */
  id: string;
  /** Ambiente de origem. */
  environment: 'development' | 'homologation' | 'production' | 'test';
  /** Serviço que emitiu o log. */
  service: string;
  /** ID de correlação para rastrear a requisição entre serviços. */
  correlation_id: string;
  /** Mensagem principal do log. */
  message: string;
  /** Contexto adicional da requisição/erro. */
  context?: LogContextInterface;
}
