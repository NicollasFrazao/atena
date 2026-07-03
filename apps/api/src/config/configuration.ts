/**
 * Configuração tipada da Atena, lida do ambiente.
 *
 * O app lê SEMPRE um único `.env`, GERADO EM RUNTIME e NUNCA versionado
 * (em produção via SSM/Secrets Manager; em local via `make env` a partir do .env.example).
 * Veja .env.example para a lista de chaves.
 *
 * @property {{ port: number; env: string }} app - HTTP: porta de escuta e ambiente (NODE_ENV).
 * @property {{ url: string }} database - Conexão do Prisma (MySQL); `DATABASE_URL`.
 * @property {{ region: string }} aws - Região AWS usada por Bedrock/S3.
 * @property {{ modelId: string }} bedrock - Id do modelo no Bedrock (usado quando `llm.provider === 'bedrock'`).
 * @property {{ provider: string }} llm - Provider LLM ativo: `'fake'` (dev/local, sem credencial) | `'bedrock'` (produção).
 * @property {{ logsBucket: string; logsPrefix: string; contentBucket: string }} s3 - Buckets/prefixo de logs e bucket de conteúdo.
 * @property {{ tmpDir: string }} cache - Diretório do cache transitório read-through (decisão #8) — não é fonte de verdade.
 * @property {object} auth - Login social institucional (OIDC), provider plugável; default Microsoft 365 (Entra ID).
 * @property {string} auth.provider - Identificador do provider de autenticação (ex.: `microsoft-entra`).
 * @property {string} auth.allowedDomain - Domínio de e-mail institucional permitido.
 * @property {boolean} auth.devBypass - Em dev, resolve um usuário stub (com papéis) quando não há sessão; `false` em produção.
 * @property {object} auth.oidc - Credenciais/endereços OIDC do provider.
 * @property {string} auth.oidc.issuerUrl - URL do issuer OIDC.
 * @property {string} auth.oidc.clientId - Client ID da aplicação OIDC.
 * @property {string} auth.oidc.clientSecret - Client secret da aplicação OIDC.
 * @property {string} auth.oidc.redirectUri - URI de callback após o login.
 * @property {string} auth.sessionSecret - Segredo usado para assinar a sessão.
 */
export interface AtenaConfig {
  app: {
    port: number;
    env: string;
    /** Fuso de exibição/janela (IANA, ex.: `America/Sao_Paulo`). Parâmetro único do edge de fuso. */
    timezone: string;
  };
  database: { url: string };
  aws: { region: string };
  bedrock: {
    modelId: string;
    apiKey: string;
    maxTokens: number
  };
  /** Provider LLM ativo: 'fake' (dev/local, sem credencial) | 'bedrock' (produção). */
  llm: { provider: string };
  s3: {
    logsBucket: string;
    logsPrefix: string;
    contentBucket: string
  };
  /** Cache transitório read-through dos dados brutos (decisão #8) — não é fonte de verdade. */
  cache: { tmpDir: string };
  /**
   * Motor de consulta de auditoria (S3 = fonte de verdade, via DuckDB). `sourceRoot` aponta para o
   * **detailed report** de SMS (`s3://example-sms-delivery-reports`; um diretório local nos testes) — a fonte
   * por-destinatário do funil (queued→delivered/falhas). `defaultWindowDays` é a janela default de
   * `search`/`get_shipping_trail`. `lateStatusBufferHours` estende a varredura à frente para capturar
   * status atrasados (fornecedor pode levar até 48h). `minQueryDate` (ISO) barra consultas anteriores
   * ao contrato enriquecido (`provider_name`/`provider_code`/`error`); `null` desliga a guarda.
   */
  auditQuery: {
    // Fonte + janela
    sourceRoot: string;
    defaultWindowDays: number;
    minQueryDate: string | null;
    // Vidas de cache / reconciliação
    cacheSettleMinutes: number;
    liveCacheTtlSeconds: number;
    lateStatusBufferHours: number;
    lagHours: number;
    recordCacheTtlMinutes: number;
    snapshotTtlMinutes: number;
    // Tetos (memória / disco / retenção)
    cacheMaxMb: number;
    cacheMaxAgeHours: number;
    recordCacheMax: number;
    shippingIndexMax: number;
    scanEventRetentionDays: number;
    // Engine DuckDB / pré-fetch
    duckdbMemoryLimit: string;
    duckdbThreads: number;
    prefetchConcurrency: number;
  };
  /**
   * Detector de anomalias (Fase 2): liga o scan agendado e calibra a regra
   * `delivery_rate_drop`. Defaults amigáveis a dev; produção sobe os valores via `.env`
   * (ex.: `DETECT_MIN_VOLUME=500`, `DETECT_ENABLED=true`).
   */
  detect: {
    enabled: boolean;
    minTerminalVolume: number;
    baselineWindows: number;
  };
  /** Retenção do chat: job diário apaga sessões/mensagens inativas além da janela. */
  retention: {
    enabled: boolean;
    chatDays: number;
  };
  /** Login social institucional (OIDC). Provider plugável; default Microsoft 365 (Entra ID). */
  auth: {
    provider: string;
    allowedDomain: string;
    devBypass: boolean;
    oidc: {
      issuerUrl: string;
      clientId: string;
      clientSecret: string;
      redirectUri: string;
    };
    sessionSecret: string;
    /** Cookie de sessão (JWT assinado) emitido após o login OIDC. */
    session: {
      cookieName: string;
      ttlHours: number;
      sameSite: 'none' | 'lax' | 'strict';
      secure: boolean;
    };
    /** Cookie curto que guarda o desafio OIDC (state/nonce/PKCE) entre login e callback. */
    oidcCookieName: string;
    /** Origins do frontend autorizadas no CORS (allowlist; `*` não vale com credenciais). */
    corsOrigins: string[];
    /** Origin do frontend para onde o callback redireciona após o login (1º de `corsOrigins`). */
    webOrigin: string;
    /** Allowlist (lowercase) de e-mails que recebem `admin` no login (bootstrap do RBAC). */
    adminEmails: string[];
  };
}

/** Lê um inteiro do ambiente com fallback. Centraliza o parse dos knobs numéricos do motor. */
const intEnv = (
  name: string,
  fallback: number,
): number => Number.parseInt(
  process.env[name] ?? String(fallback),
  10,
);

/**
 * Defaults do motor de auditoria — **fonte ÚNICA**: usada tanto na leitura do `.env` (abaixo) quanto
 * no fallback do serviço (`DuckDbAuditQueryService`), p/ os dois lugares NUNCA divergirem. A unidade
 * está no nome (Minutes/Seconds/Hours/Days/Mb). Override por env `ATENA_AUDIT_*` (ver `.env.example`).
 */
export const AUDIT_QUERY_DEFAULTS = {
  defaultWindowDays: 30,
  cacheSettleMinutes: 60,
  liveCacheTtlSeconds: 60,
  lateStatusBufferHours: 48,
  lagHours: 48,
  recordCacheTtlMinutes: 30,
  snapshotTtlMinutes: 60,
  cacheMaxMb: 4096,
  cacheMaxAgeHours: 168,
  recordCacheMax: 10000,
  shippingIndexMax: 20000,
  scanEventRetentionDays: 30,
  duckdbThreads: 8,
  prefetchConcurrency: 32,
  duckdbMemoryLimit: '3GB',
} as const;

/**
 * Factory de configuração consumido pelo `ConfigModule.forRoot({ load: [...] })`.
 *
 * Lê o `.env` único (carregado em runtime) e devolve a config tipada, aplicando
 * defaults para variáveis ausentes (ex.: porta 3000, `llm.provider = 'fake'`,
 * região `us-east-1`). Avaliado uma vez na inicialização do módulo.
 *
 * @returns {AtenaConfig} Configuração tipada da aplicação.
 */
export default (): AtenaConfig => ({
  app: {
    port: Number.parseInt(
      process.env.PORT ?? '3000',
      10,
    ),
    env: process.env.NODE_ENV ?? 'development',
    // Fuso de exibição/janela do operador (IANA). Default BRT; trocar habilita outro fuso sem mudar lógica.
    timezone: process.env.APP_TIMEZONE || 'America/Sao_Paulo',
  },
  database: {
    url: process.env.DATABASE_URL ?? '',
  },
  aws: {
    region: process.env.AWS_REGION ?? 'us-east-1',
  },
  bedrock: {
    // modelo no Bedrock via inference profile (ex.: us.amazon.nova-pro-v1:0).
    modelId: process.env.BEDROCK_MODEL_ID ?? '',
    // API key (Bearer) do Bedrock; vazia → fallback pro fake provider (ver LlmModule).
    apiKey: process.env.AWS_BEARER_TOKEN_BEDROCK ?? '',
    maxTokens: Number.parseInt(
      process.env.BEDROCK_MAX_TOKENS ?? '1024',
      10,
    ),
  },
  llm: {
    // 'fake' = FakeLlmProvider determinístico (dev/local sem credencial); 'bedrock' em produção.
    provider: process.env.LLM_PROVIDER ?? 'fake',
  },
  s3: {
    logsBucket: process.env.ATENA_LOGS_BUCKET ?? '',
    logsPrefix: process.env.ATENA_LOGS_PREFIX ?? '',
    contentBucket: process.env.ATENA_CONTENT_BUCKET ?? '',
  },
  cache: {

    // eslint-disable-next-line sonarjs/publicly-writable-directories -- /tmp é o cache transitório read-through por design (decisão #8), não dado durável; sobrescrevível via ATENA_TMP_CACHE_DIR.
    tmpDir: process.env.ATENA_TMP_CACHE_DIR ?? '/tmp/atena-cache',
  },
  // Motor de auditoria. Defaults em AUDIT_QUERY_DEFAULTS (fonte única); override por env ATENA_AUDIT_*
  // (+ DUCKDB_*). Unidade no nome do campo. Ver `.env.example` p/ a tabela completa.
  auditQuery: {
    // — Fonte + janela —
    // Detailed report de SMS (s3://example-sms-delivery-reports em prod; um diretório local nos testes/fixture).
    sourceRoot: process.env.ATENA_AUDIT_SOURCE_ROOT
      ?? (process.env.ATENA_SMS_STATUS_BUCKET
        ? `s3://${process.env.ATENA_SMS_STATUS_BUCKET}`
        : 's3://example-sms-delivery-reports'),
    defaultWindowDays: intEnv(
      'ATENA_AUDIT_DEFAULT_WINDOW_DAYS',
      AUDIT_QUERY_DEFAULTS.defaultWindowDays,
    ),
    // Data mínima de consulta (ISO): barra dados pré-contrato enriquecido; vazio/0 desliga.
    minQueryDate: process.env.ATENA_AUDIT_MIN_QUERY_DATE || null,

    // — Vidas de cache / reconciliação —
    // Partição "settled" (cacheável) só depois deste tempo fechada; partições recentes vão live.
    cacheSettleMinutes: intEnv(
      'ATENA_AUDIT_CACHE_SETTLE_MINUTES',
      AUDIT_QUERY_DEFAULTS.cacheSettleMinutes,
    ),
    // TTL (s) do cache da partição RECENTE: dentro dele, queries reusam o Parquet em vez de re-varrer
    // o S3 (latência); custo = dado recente até este tempo velho. 0 desliga (sempre live).
    liveCacheTtlSeconds: intEnv(
      'ATENA_AUDIT_LIVE_CACHE_TTL_SECONDS',
      AUDIT_QUERY_DEFAULTS.liveCacheTtlSeconds,
    ),
    // Buffer do scan SÓ PRA FRENTE (horas): estende o fim da janela p/ captar status que o fornecedor
    // finaliza depois do envio. NÃO recua pra trás (requested_at vem do queued real). 48h ≈ lag.
    lateStatusBufferHours: intEnv(
      'ATENA_AUDIT_LATE_STATUS_BUFFER_HOURS',
      AUDIT_QUERY_DEFAULTS.lateStatusBufferHours,
    ),
    // Janela de LAG (horas): objetos podem chegar a uma partição até este tempo após ela "fechar".
    // Settled DENTRO do horizonte é reconciliada por LIST a cada consulta; além dele, é imutável.
    lagHours: intEnv(
      'ATENA_AUDIT_LAG_HOURS',
      AUDIT_QUERY_DEFAULTS.lagHours,
    ),
    // TTL (min) do cache de registros por id (reveal/análise pós-busca não re-varrem o S3).
    recordCacheTtlMinutes: intEnv(
      'ATENA_AUDIT_RECORD_CACHE_TTL_MINUTES',
      AUDIT_QUERY_DEFAULTS.recordCacheTtlMinutes,
    ),
    // TTL (min) dos snapshots de busca (Parquet do conjunto exato; export por token lê daqui).
    snapshotTtlMinutes: intEnv(
      'ATENA_AUDIT_SNAPSHOT_TTL_MINUTES',
      AUDIT_QUERY_DEFAULTS.snapshotTtlMinutes,
    ),

    // — Tetos (memória / disco / retenção) —
    // Eviction do cache de eventos no /tmp: teto de tamanho (MB) e idade (horas); 0 desliga cada um.
    cacheMaxMb: intEnv(
      'ATENA_AUDIT_CACHE_MAX_MB',
      AUDIT_QUERY_DEFAULTS.cacheMaxMb,
    ),
    cacheMaxAgeHours: intEnv(
      'ATENA_AUDIT_CACHE_MAX_AGE_HOURS',
      AUDIT_QUERY_DEFAULTS.cacheMaxAgeHours,
    ),
    // Teto do cache de registros por id (FIFO) e do índice persistente de datas (LRU) — memória.
    recordCacheMax: intEnv(
      'ATENA_AUDIT_RECORD_CACHE_MAX',
      AUDIT_QUERY_DEFAULTS.recordCacheMax,
    ),
    shippingIndexMax: intEnv(
      'ATENA_AUDIT_SHIPPING_INDEX_MAX',
      AUDIT_QUERY_DEFAULTS.shippingIndexMax,
    ),
    // Retenção (dias) dos eventos de scan persistidos (observabilidade); poda no eviction.
    scanEventRetentionDays: intEnv(
      'ATENA_AUDIT_SCAN_EVENT_RETENTION_DAYS',
      AUDIT_QUERY_DEFAULTS.scanEventRetentionDays,
    ),

    // — Engine DuckDB / pré-fetch —
    // `memory_limit` capa a RAM (spill em disco ao exceder); `threads` = concorrência de leitura dos
    // objetos S3 (network-bound). `prefetchConcurrency` = pré-fetch paralelo (Node/SDK); 0 = via httpfs.
    duckdbMemoryLimit: process.env.DUCKDB_MEMORY_LIMIT ?? AUDIT_QUERY_DEFAULTS.duckdbMemoryLimit,
    duckdbThreads: intEnv(
      'DUCKDB_THREADS',
      AUDIT_QUERY_DEFAULTS.duckdbThreads,
    ),
    prefetchConcurrency: intEnv(
      'ATENA_AUDIT_PREFETCH_CONCURRENCY',
      AUDIT_QUERY_DEFAULTS.prefetchConcurrency,
    ),
  },
  detect: {
    // Liga o @Interval agendado; o trigger manual POST /api/dev/detect roda independente disto.
    enabled: process.env.DETECT_ENABLED === 'true',
    // Guarda de volume: dev baixo p/ disparar no seed; produção ≥ 500 (anomaly-scenarios.md).
    minTerminalVolume: Number.parseInt(
      process.env.DETECT_MIN_VOLUME ?? '20',
      10,
    ),
    // Nº de janelas de lookback p/ o baseline (μ/σ) por cliente.
    baselineWindows: Number.parseInt(
      process.env.DETECT_BASELINE_WINDOWS ?? '8',
      10,
    ),
  },
  retention: {
    // Job diário de retenção do chat; CHAT_RETENTION_ENABLED=false desliga (default ligado).
    enabled: process.env.CHAT_RETENTION_ENABLED !== 'false',
    // Apaga sessões (e suas mensagens) inativas há mais de N dias. Bate com o rótulo do Histórico.
    chatDays: Number.parseInt(
      process.env.CHAT_RETENTION_DAYS ?? '90',
      10,
    ),
  },
  auth: {
    provider: process.env.AUTH_PROVIDER ?? 'microsoft-entra',
    allowedDomain: process.env.AUTH_ALLOWED_DOMAIN ?? 'example.com',
    // Dev/local: AuthGuard resolve usuário stub. **Fail-closed**: só liga com opt-in explícito
    // (`AUTH_DEV_BYPASS=true`, como o `make dev` injeta) E fora de produção. Ausente/typo/qualquer
    // outro valor, ou `NODE_ENV=production`, ⇒ OFF (evita bypass acidental por env errada em prod).
    devBypass: process.env.AUTH_DEV_BYPASS === 'true'
      && process.env.NODE_ENV !== 'production',
    oidc: {
      issuerUrl: process.env.OIDC_ISSUER_URL ?? '',
      clientId: process.env.OIDC_CLIENT_ID ?? '',
      clientSecret: process.env.OIDC_CLIENT_SECRET ?? '',
      redirectUri: process.env.OIDC_REDIRECT_URI ?? '',
    },
    sessionSecret: process.env.SESSION_SECRET ?? '',
    session: {
      cookieName: 'atena_session',
      ttlHours: Number.parseInt(
        process.env.AUTH_SESSION_TTL_HOURS ?? '8',
        10,
      ),
      // Cross-origin (web:5173/8080 ↔ api:3000): SameSite=None exige Secure. Secure é aceito em
      // http://localhost (contexto seguro) e obrigatório em prod HTTPS.
      sameSite: 'none',
      secure: true,
    },
    oidcCookieName: 'atena_oidc',
    corsOrigins: (
      process.env.CORS_ORIGINS
      ?? process.env.WEB_ORIGIN
      ?? 'http://localhost:5173,http://localhost:8080'
    )
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    webOrigin: (
      process.env.WEB_ORIGIN
      ?? process.env.CORS_ORIGINS
      ?? 'http://localhost:5173'
    )
      .split(',')[0]
      .trim(),
    adminEmails: (process.env.AUTH_ADMIN_EMAILS ?? '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  },
});
