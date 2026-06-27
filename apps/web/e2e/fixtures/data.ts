import type { SessionUserInterface } from '@atena/types';

/**
 * Fixtures SINTÉTICAS para a suíte e2e hermética. Os shapes espelham as respostas reais da API
 * (capturadas do backend), mas TODO dado pessoal foi substituído por valores fictícios: nenhum
 * e-mail, nome ou telefone real. Métricas/contagens/ids de cliente (numéricos) são agregados — não
 * são PII. Mantê-las fiéis ao contrato é proposital: se `@atena/types` mudar, o type-check quebra
 * aqui e sinaliza fixture desatualizada.
 */

/** Usuário da sessão (admin, todas as 15 permissões) — renderiza o app completo, com o nav de admin. */
export const SESSION_USER: SessionUserInterface = {
  sub: 'e2e-user',
  email: 'e2e@example.com',
  name: 'E2E Tester',
  roles: ['admin'],
  permissions: [
    'app:use',
    'messages:search',
    'messages:trail',
    'pii:reveal',
    'reports:view',
    'incidents:view',
    'incidents:comment',
    'incidents:ack',
    'incidents:resolve',
    'rules:view',
    'rules:edit',
    'audit:view',
    'observability:view',
    'ops:run',
    'users:manage',
  ],
  status: 'active',
  is_super_admin: true,
};

/** Relatório de entregabilidade (resposta do stream SSE `POST /reports/delivery/stream`). */
export const DELIVERY_REPORT = {
  window: 'Últimos 7 dias',
  totals: {
    sent: 1_250_000,
    delivered: 812_500,
    failed: 412_500,
    pending: 25_000,
  },
  by_provider: [
    {
      name: 'sinch',
      sent: 1_240_000,
      delivered: 812_500,
      rate: 65.5,
    },
    {
      name: 'zapsms',
      sent: 10_000,
      delivered: 0,
      rate: 0,
    },
  ],
  hourly: [
    {
      at: '2026-06-20T03:00:00Z',
      rate: 62.1,
    },
    {
      at: '2026-06-20T04:00:00Z',
      rate: 61.9,
    },
    {
      at: '2026-06-20T05:00:00Z',
      rate: 64,
    },
  ],
  top_errors: [
    {
      code: 'invalid_number',
      count: 18_200,
      provider: 'sinch',
    },
    {
      code: 'blocked',
      count: 4_100,
      provider: 'sinch',
    },
  ],
  csv_url: '/api/reports/delivery.csv?token=e2e',
};

/** Observabilidade do assistente (`GET /observability`) — só agregados. */
export const OBSERVABILITY = {
  period: 'Últimas 24h',
  overview: {
    sessions: 9,
    reveals: 1,
    tokens: 533_787,
    cost: 0.4381,
    mtta: null,
    avg_session_ms: 315_440,
  },
  tokens_hourly: [
    {
      at: '2026-06-26T00:00:00.000Z',
      tokens: 20_511,
    },
    {
      at: '2026-06-26T01:00:00.000Z',
      tokens: 370_771,
    },
    {
      at: '2026-06-26T23:00:00.000Z',
      tokens: 30_079,
    },
  ],
  tools: [
    {
      name: 'search_shippings',
      calls: 12,
      errors: 5,
      avg_latency_ms: 24_554,
      p50_ms: 7_106,
      p95_ms: 82_455,
      p99_ms: 82_455,
    },
    {
      name: 'generate_delivery_report',
      calls: 5,
      errors: 1,
      avg_latency_ms: 12_873,
      p50_ms: 7_859,
      p95_ms: 31_173,
      p99_ms: 31_173,
    },
  ],
  refusals: {
    total: 0,
    by_reason: [],
  },
  websocket: {
    connected: 0,
    peak: 0,
  },
  llm: {
    provider: 'bedrock',
    model: 'Amazon Nova Pro v1',
  },
  audit_scan: {
    queries: 570,
    partitions_total: 2_623,
    partitions_cached: 2_168,
    partitions_scanned: 455,
    s3_objects: 74_275,
    cache_hit_rate: 0.827,
    avg_materialize_ms: 25_597,
    estimated_get_requests: 74_275,
    estimated_cost_usd: 0.032,
  },
};

/** Lista de incidentes (`GET /incidents`) — 1 incidente sintético + paginação. */
export const INCIDENTS = {
  rows: [
    {
      id: '246031d1-d740-4a6b-bb91-f0abba2d625b',
      rule: 'Queda de entrega por cliente',
      severity: 'critical',
      status: 'auto_resolved',
      dimension_type: 'customer',
      dimension_value: '1002',
      detected_at: '2026-06-26T12:41:27.173Z',
      window: '26/06 09:26 → 09:41 GMT-3 (15 min)',
      window_from: '2026-06-26T12:26:27.173Z',
      window_to: '2026-06-26T12:41:27.173Z',
      summary: 'Taxa de entrega do cliente 1002 caiu de 92.9% (baseline) para 40.9% na janela de 15 min.',
      metrics: {
        sample: '22 terminais',
        current: '40.9%',
        baseline: '92.9%',
        threshold: '4σ',
      },
      related_shippings: 22,
      assignee: null,
      shadow: false,
    },
  ],
  page: 1,
  total: 1,
  total_pages: 1,
  latency_ms: 42,
};

/** Regras de anomalia (`GET /rules`). */
export const RULES = [
  {
    id: 'r-delivery-drop-customer',
    name: 'Queda de entrega por cliente',
    rule_type: 'delivery_rate_drop',
    dimension: 'customer',
    enabled: true,
    severity: 'critical',
    threshold: 4,
    threshold_unit: 'σ',
    window_minutes: 15,
    category: null,
    shadow_mode: false,
    updated_by: 'e2e-user',
    updated_at: '2026-06-19T21:04:42.193Z',
  },
  {
    id: 'r-delivery-drop-provider',
    name: 'Queda de entrega por provedor',
    rule_type: 'delivery_rate_drop',
    dimension: 'provider',
    enabled: false,
    severity: 'warning',
    threshold: 3,
    threshold_unit: 'σ',
    window_minutes: 30,
    category: null,
    shadow_mode: true,
    updated_by: 'e2e-user',
    updated_at: '2026-06-18T10:00:00.000Z',
  },
];

/** Catálogo de papéis (`GET /admin/roles`). */
export const ADMIN_ROLES = [
  {
    role: 'admin',
    label: 'Administrador',
    description: 'Acesso total: gerencia usuários e papéis, além de tudo que os demais fazem.',
    permissions: SESSION_USER.permissions,
  },
  {
    role: 'support_analyst',
    label: 'Analista de suporte',
    description: 'Busca, trilha, relatórios e incidentes.',
    permissions: [
      'app:use',
      'messages:search',
      'messages:trail',
      'reports:view',
      'incidents:view',
    ],
  },
];

/** Usuários (`GET /admin/users`) — e-mails/nomes SINTÉTICOS. */
export const ADMIN_USERS = [
  {
    sub: 'e2e-user',
    email: 'e2e@example.com',
    name: 'E2E Tester',
    status: 'active',
    roles: ['admin'],
    is_super_admin: true,
    last_login_at: '2026-06-26T17:21:07.854Z',
    created_at: '2026-06-21T19:33:43.620Z',
  },
  {
    sub: 'analyst-1',
    email: 'analista@example.com',
    name: 'Analista Exemplo',
    status: 'active',
    roles: ['support_analyst'],
    is_super_admin: false,
    last_login_at: null,
    created_at: '2026-06-22T12:00:00.000Z',
  },
];

/** Resumo do audit log (`GET /audit/summary`). */
export const AUDIT_SUMMARY = {
  today: 12,
  pii: 3,
  rule_changes: 1,
  total: 1_204,
};

/** Filtro de usuários do audit (`GET /audit/users`) — ids sintéticos. */
export const AUDIT_USERS = [
  {
    id: 'e2e-user',
    name: 'E2E Tester',
  },
  {
    id: 'analyst-1',
    name: 'Analista Exemplo',
  },
];

/** Página do audit log (`GET /audit`). */
export const AUDIT_LIST = {
  rows: [
    {
      id: 'a1',
      occurred_at: '2026-06-27T00:14:45.202Z',
      user_id: 'e2e-user',
      user_name: 'E2E Tester',
      action: 'tool_call',
      resource: 'POST /api/reports/delivery',
      detail: null,
      severity: 'info',
      ip_address: '10.0.0.1',
      metadata: null,
    },
    {
      id: 'a2',
      occurred_at: '2026-06-27T00:13:37.889Z',
      user_id: 'e2e-user',
      user_name: 'E2E Tester',
      action: 'reveal_content',
      resource: 'GET /api/shippings/…',
      detail: 'reveal de conteúdo',
      severity: 'pii',
      ip_address: '203.0.113.10',
      metadata: null,
    },
  ],
  page: 1,
  total: 2,
  total_pages: 1,
  latency_ms: 8,
};

/** Sessões do chat (`GET /chat/sessions`) — títulos/preview sintéticos, sem telefone real. */
export const CHAT_SESSIONS = [
  {
    id: '06fd1b2c-4820-4238-bc15-768b22768cb1',
    title: 'Relatório de entregabilidade — últimas 24h',
    started_at: '2026-06-26T23:18:10.279Z',
    message_count: 4,
    tool_count: 3,
    pinned: false,
    tags: [],
    preview: 'Quero a taxa de entrega das últimas 24h',
    duration: '2m',
    has_incident: false,
  },
];
