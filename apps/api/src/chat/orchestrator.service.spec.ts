import { BadRequestException, HttpException, NotFoundException } from '@nestjs/common';
import type { AuditService } from '../audit/audit.service';
import type { CatalogService } from '../catalog/catalog.service';
import type { IncidentsService } from '../incidents/incidents.service';
import { FakeLlmProvider } from '../llm/fake-llm.provider';
import type { AnalysisService } from '../shippings/analysis.service';
import type { ShippingsService } from '../shippings/shippings.service';
import type { ReportsService } from '../reports/reports.service';
import type { ChatService } from './chat.service';
import type { MetricsService } from '../observability/metrics.service';
import {
  historyToConvo,
  injectReusedWindow,
  lastSearchWindow,
  OrchestratorService,
  toolResultForLlm,
  windowClarification,
} from './orchestrator.service';
import type {
  LlmConverseParamsInterface,
  LlmDescriptorInterface,
  LlmMessageInterface,
  LlmProviderInterface,
  LlmStreamChunkType,
  LlmToolUseInterface,
} from '../llm/llm-provider.interface';
import type { ChatMessageInterface, ChatStreamEvent } from '@atena/types';

/** Tool-use sintético p/ os testes de injeção/clarificação de janela. */
const toolUse = (
  name: string,
  args: Record<string, unknown>,
): LlmToolUseInterface => ({
  type: 'tool_use',
  id: 'c1',
  name,
  args,
}) as unknown as LlmToolUseInterface;

/**
 * Cria um OrchestratorService com `FakeLlmProvider` real e serviços stub.
 * Retorna o serviço e os mocks para asserção.
 */
function buildOrchestrator() {
  const chat = {
    getMessages: jest.fn().mockResolvedValue([]),
    appendMessage: jest.fn().mockResolvedValue('asst-1'),
    updateSession: jest.fn().mockResolvedValue({
      session_id: 's-1',
      title: 'Conversa',
      pinned: false,
    }),
  } as unknown as ChatService;

  const messages = {
    search: jest.fn().mockResolvedValue({
      rows: [],
      page: 1,
      total: 0,
      total_pages: 1,
      latency_ms: 1,
    }),
    getTrail: jest.fn(),
  } as unknown as ShippingsService;

  const analysis = { analyze: jest.fn() } as unknown as AnalysisService;
  const reports = { generateDelivery: jest.fn() } as unknown as ReportsService;

  const catalog = {
    listProviders: jest.fn(),
    listCustomers: jest.fn(),
    windowLabel: jest.fn().mockReturnValue('últimas 24h'),
  } as unknown as CatalogService;

  const incidents = {
    list: jest.fn(),
    get: jest.fn(),
    shippings: jest.fn(),
  } as unknown as IncidentsService;

  const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;

  const svc = new OrchestratorService(
    new FakeLlmProvider(),
    chat,
    messages,
    analysis,
    reports,
    catalog,
    incidents,
    audit,
  );

  return {
    svc,
    chat,
    messages,
    audit,
    incidents,
  };
}

/** Coleta todos os eventos emitidos por `run`. */
async function collect(gen: AsyncGenerator<ChatStreamEvent>): Promise<ChatStreamEvent[]> {
  const out: ChatStreamEvent[] = [];

  for await (const ev of gen) {
    out.push(ev);
  }

  return out;
}

describe('OrchestratorService', () => {
  it('caminho com tool: tool_call → tool_result → text_delta → done', async () => {
    const {
      svc,
      messages,
      chat,
      audit,
    } = buildOrchestrator();

    const events = await collect(svc.run(
      's-1',
      'status do telefone +5511987651234',
    ));

    const types = events.map((event) => event.event);
    expect(types[0]).toBe('tool_call');
    expect(types[1]).toBe('tool_result');
    expect(types).toContain('text_delta');
    expect(types[types.length - 1]).toBe('done');

    const first = events[0];

    if (first.event === 'tool_call') {
      expect(first.data.name).toBe('search_shippings');
      expect(first.data.status).toBe('running');
      expect(first.data.args).toMatchObject({ phone: '+5511987651234' });
    }

    const second = events[1];

    if (second.event === 'tool_result') {
      expect(second.data.status).toBe('success');
    }

    const last = events[events.length - 1];

    if (last.event === 'done') {
      expect(last.data.message_id).toBe('asst-1');
      expect(last.data.refusal).toBeNull();
    }

    expect(messages.search).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalled(); // tool executada é auditada
    // user + assistant persistidos
    expect(chat.appendMessage).toHaveBeenCalledTimes(2);
  });

  it('search_shippings: barra um shipping_id (hash 32 hex) passado como campaign_id', () => {
    const { svc } = buildOrchestrator();

    const exec = (svc as unknown as {
      execute: (name: string, args: Record<string, unknown>) => unknown
    }).execute.bind(svc);

    let thrown: unknown;

    try {
      exec(
        'search_shippings',
        { campaign_id: '61e721836c5fc4e91394c6be3afb25f2' },
      );
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(BadRequestException);

    expect((thrown as BadRequestException).getResponse()).toMatchObject({
      error: { code: 'looks_like_shipping_id' },
    });
  });

  it('get_shipping_trail: barra um campaign_id (UUID) passado como shipping_id', () => {
    const { svc } = buildOrchestrator();

    const exec = (svc as unknown as {
      execute: (name: string, args: Record<string, unknown>) => unknown
    }).execute.bind(svc);

    let thrown: unknown;

    try {
      exec(
        'get_shipping_trail',
        { shipping_id: 'f35b1480-00c1-4714-9b3a-2b1c0d4e5f60' },
      );
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(BadRequestException);

    expect((thrown as BadRequestException).getResponse()).toMatchObject({
      error: { code: 'looks_like_campaign_id' },
    });
  });

  it('get_shipping_trail: exige a data (sem janela → trail_window_required, evita scan de 30d)', () => {
    const { svc } = buildOrchestrator();

    const exec = (svc as unknown as {
      execute: (name: string, args: Record<string, unknown>) => unknown
    }).execute.bind(svc);

    let thrown: unknown;

    try {
      exec(
        'get_shipping_trail',
        { shipping_id: '0e39fb791be5089b88d672bd10294031' },
      );
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(BadRequestException);

    expect((thrown as BadRequestException).getResponse()).toMatchObject({
      error: { code: 'trail_window_required' },
    });
  });

  it('search_shippings: incident_id → envios EXATOS do incidente (total = impactado; breakdown do conjunto)', async () => {
    const {
      svc,
      incidents,
      messages,
    } = buildOrchestrator();

    (incidents.shippings as jest.Mock).mockResolvedValue({
      available: true,
      rows: [
        {
          id: 'm1',
          campaign_id: 'camp-a',
          phone_masked: '+55 (65) 9****-0001',
          status: 'failed',
          provider: 'provider-c',
          customer: '8349',
          requested_at: '2026-06-22T19:54:06.000Z',
          finalized_at: '2026-06-23T19:54:20.000Z',
          error_hint: 'generic_error',
        },
        {
          id: 'm2',
          campaign_id: 'camp-a',
          phone_masked: '+55 (65) 9****-0002',
          status: 'delivered',
          provider: 'provider-c',
          customer: '8349',
          requested_at: '2026-06-22T19:55:00.000Z',
          finalized_at: '2026-06-22T19:56:00.000Z',
          error_hint: null,
        },
      ],
      total: 41,
      top_campaigns: [],
    });

    const exec = (svc as unknown as {
      execute: (name: string, args: Record<string, unknown>) => Promise<{
        total: number;
        rows: unknown[];
        breakdown: {
          delivered: number;
          failed: number;
          blocked: number;
          pending: number
        }
      }>
    }).execute.bind(svc);

    const result = await exec(
      'search_shippings',
      { incident_id: '190878de-8d3b-48d7-b843-30b1596dd78e' },
    );

    // Contagem = total impactado do incidente (não os filtros/janela); breakdown sobre as linhas trazidas.
    expect(result.total).toBe(41);
    expect(result.rows).toHaveLength(2);

    expect(result.breakdown).toEqual({
      delivered: 1,
      failed: 1,
      blocked: 0,
      pending: 0,
    });

    expect(incidents.shippings).toHaveBeenCalledWith(
      '190878de-8d3b-48d7-b843-30b1596dd78e',
      expect.any(Number),
    );

    // NÃO caiu na busca normal por janela/filtro.
    expect(messages.search).not.toHaveBeenCalled();
  });

  it('get_shipping_trail: com data (date_from) NÃO dispara o guard — chama getTrail', () => {
    const {
      svc,
      messages,
    } = buildOrchestrator();

    (messages.getTrail as jest.Mock).mockResolvedValue(null);

    const exec = (svc as unknown as {
      execute: (name: string, args: Record<string, unknown>) => Promise<unknown>
    }).execute.bind(svc);

    expect(() => exec(
      'get_shipping_trail',
      {
        shipping_id: '0e39fb791be5089b88d672bd10294031',
        date_from: '2026-06-22',
        date_to: '2026-06-22',
      },
    )).not.toThrow();

    expect(messages.getTrail).toHaveBeenCalledTimes(1);
  });

  it('repassa o progresso do motor (tool_progress) e anexa duration_ms ao tool_result', async () => {
    const {
      svc,
      messages,
    } = buildOrchestrator();

    (messages.search as jest.Mock).mockImplementation((
      _query: unknown,
      onProgress?: (event: {
        phase: string;
        label: string;
        current?: number;
        total?: number
      }) => void,
    ) => {
      onProgress?.({
        phase: 'mapping',
        label: 'Mapeando 1 partição da janela',
        total: 1,
      });

      onProgress?.({
        phase: 'reading',
        label: 'Lendo do S3 (partição fria)',
        current: 1,
        total: 1,
      });

      onProgress?.({
        phase: 'querying',
        label: 'Calculando os resultados',
      });

      return Promise.resolve({
        rows: [],
        page: 1,
        total: 0,
        total_pages: 1,
        latency_ms: 1,
      });
    });

    const events = await collect(svc.run(
      's-1',
      'status do telefone +5511987651234',
    ));

    const progress = events.filter((event) => event.event === 'tool_progress');

    expect(progress.map((event) => event.data.phase))
      .toEqual([
        'mapping',
        'reading',
        'querying',
      ]);

    // tool_progress vem ANTES do tool_result
    const resultIndex = events.findIndex((event) => event.event === 'tool_result');
    const lastProgressIndex = events.map((event) => event.event).lastIndexOf('tool_progress');
    expect(lastProgressIndex).toBeLessThan(resultIndex);

    const result = events[resultIndex];

    if (result.event === 'tool_result') {
      expect(typeof result.data.duration_ms).toBe('number');
      expect(result.data.duration_ms).toBeGreaterThanOrEqual(0);
    }
  });

  it('caminho de recusa: pedido fora de escopo → único evento refusal', async () => {
    const {
      svc,
      messages,
    } = buildOrchestrator();

    const events = await collect(svc.run(
      's-1',
      'qual é a capital da França?',
    ));

    expect(events).toHaveLength(1);
    const only = events[0];
    expect(only.event).toBe('refusal');

    if (only.event === 'refusal') {
      expect(only.data.can_do.length).toBeGreaterThan(0);
      expect(typeof only.data.explanation).toBe('string');
    }

    expect(messages.search).not.toHaveBeenCalled();
  });
});

describe('historyToConvo', () => {
  it('reidrata as tools de um turno do assistente (tool_use + resultado) para o LLM manter o id', () => {
    const history: ChatMessageInterface[] = [
      {
        role: 'user',
        content: { text: 'o que aconteceu com o envio f35b1480?' },
      },
      {
        role: 'assistant',
        content: {
          text: 'O envio foi entregue.',
          tools: [
            {
              name: 'search_shippings',
              args: { campaign_id: 'f35b1480' },
              status: 'success',
              result: { rows: [{ id: '0e39fb791be5089b88d672bd10294031' }] },
            },
          ],
        },
      },
    ] as unknown as ChatMessageInterface[];

    const convo = historyToConvo(history);

    // user(text) → assistant(tool_use) → tool(result) → assistant(texto final)
    expect(convo).toHaveLength(4);

    expect(convo[0]).toEqual({
      role: 'user',
      content: 'o que aconteceu com o envio f35b1480?',
    });

    const toolUse = convo[1].content as {
      tool_use: {
        id: string;
        name: string
      }
    };

    const toolResult = convo[2].content as {
      id: string;
      result: unknown
    };

    expect(convo[1].role).toBe('assistant');
    expect(toolUse.tool_use.name).toBe('search_shippings');
    expect(convo[2].role).toBe('tool');
    // id casa entre o tool_use e o resultado, e o shipping_id do search fica VISÍVEL ao modelo.
    expect(toolResult.id).toBe(toolUse.tool_use.id);
    expect(JSON.stringify(toolResult.result)).toContain('0e39fb791be5089b88d672bd10294031');

    expect(convo[3]).toEqual({
      role: 'assistant',
      content: 'O envio foi entregue.',
    });
  });

  it('mensagens sem tools viram texto simples (comportamento anterior preservado)', () => {
    const history: ChatMessageInterface[] = [
      {
        role: 'user',
        content: { text: 'oi' },
      },
      {
        role: 'assistant',
        content: { text: 'olá!' },
      },
    ] as unknown as ChatMessageInterface[];

    expect(historyToConvo(history)).toEqual([
      {
        role: 'user',
        content: 'oi',
      },
      {
        role: 'assistant',
        content: 'olá!',
      },
    ]);
  });
});

describe('toolResultForLlm', () => {
  it('search_shippings: remove a paginação fantasma (page/total_pages/export_token/latency_ms) e adiciona returned', () => {
    const full = {
      rows: [
        { id: 'a' },
        { id: 'b' },
      ],
      total: 677,
      page: 1,
      total_pages: 14,
      latency_ms: 210000,
      export_token: 'tok',
      breakdown: {
        delivered: 333,
        failed: 300,
        blocked: 42,
        pending: 2,
      },
      date_from: '2026-06-22',
      date_to: '2026-06-22',
    };

    const slim = toolResultForLlm(
      'search_shippings',
      full,
    ) as Record<string, unknown>;

    // mantém só o que o modelo precisa p/ resumir; total + returned em vez de page/total_pages.
    expect(slim).toEqual({
      rows: full.rows,
      total: 677,
      returned: 2,
      breakdown: full.breakdown,
      date_from: '2026-06-22',
      date_to: '2026-06-22',
    });

    // o modelo NÃO enxerga páginas que não consegue buscar (senão re-chama a busca e trava o turno).
    expect(slim.page).toBeUndefined();
    expect(slim.total_pages).toBeUndefined();
    expect(slim.export_token).toBeUndefined();
  });

  it('outras tools passam direto (sem alteração)', () => {
    const result = {
      items: [
        1,
        2,
      ],
      total: 2,
      total_pages: 1,
    };

    expect(toolResultForLlm(
      'list_customers',
      result,
    )).toBe(result);
  });

  it('search_shippings com ERRO passa intacto (não vira "0 resultados")', () => {
    // Regressão: um resultado de erro (min_query_date/window_required) tinha o `error` descartado pela
    // projeção → o modelo via rows/total undefined e respondia "não foram encontrados envios".
    const errored = {
      error: {
        code: 'min_query_date',
        message: 'Os dados de auditoria são confiáveis a partir de 2026-06-18T20:40:00Z.',
      },
    };

    expect(toolResultForLlm(
      'search_shippings',
      errored,
    )).toBe(errored);
  });

  it('resultado não-objeto passa direto', () => {
    expect(toolResultForLlm(
      'search_shippings',
      null,
    )).toBeNull();

    expect(toolResultForLlm(
      'search_shippings',
      'erro',
    )).toBe('erro');
  });
});

describe('injectReusedWindow', () => {
  const searchResultMsg = (
    dateFrom: string,
    dateTo: string,
  ): LlmMessageInterface => ({
    role: 'tool',
    content: {
      id: 't1',
      name: 'search_shippings',
      result: {
        rows: [],
        total: 5,
        date_from: dateFrom,
        date_to: dateTo,
      },
    },
  }) as unknown as LlmMessageInterface;

  it('injeta a janela do search anterior quando a busca por campaign_id vem SEM data', () => {
    const out = injectReusedWindow(
      toolUse(
        'search_shippings',
        { campaign_id: 'fa1fcc0e-f1ad-4314-8e31-4d131ec3ca98' },
      ),
      [searchResultMsg(
        '2026-06-22',
        '2026-06-22',
      )],
    );

    expect(out).toEqual({
      campaign_id: 'fa1fcc0e-f1ad-4314-8e31-4d131ec3ca98',
      date_from: '2026-06-22',
      date_to: '2026-06-22',
    });
  });

  it('NÃO mexe quando o modelo já passou uma janela (date_range)', () => {
    const out = injectReusedWindow(
      toolUse(
        'search_shippings',
        {
          campaign_id: 'x',
          date_range: '7d',
        },
      ),
      [searchResultMsg(
        '2026-06-22',
        '2026-06-22',
      )],
    );

    expect(out).toEqual({
      campaign_id: 'x',
      date_range: '7d',
    });
  });

  it('NÃO injeta sem campaign_id (busca por telefone/cliente cai na janela default)', () => {
    const out = injectReusedWindow(
      toolUse(
        'search_shippings',
        { phone: '11999' },
      ),
      [searchResultMsg(
        '2026-06-22',
        '2026-06-22',
      )],
    );

    expect(out).toEqual({ phone: '11999' });
  });

  it('sem search anterior, devolve os args originais (o fluxo então pede a data)', () => {
    const out = injectReusedWindow(
      toolUse(
        'search_shippings',
        { campaign_id: 'x' },
      ),
      [],
    );

    expect(out).toEqual({ campaign_id: 'x' });
  });

  it('trilha (get_shipping_trail) por shipping_id SEM data também reusa a janela do search anterior', () => {
    const out = injectReusedWindow(
      toolUse(
        'get_shipping_trail',
        { shipping_id: '1cd9e95cf1c0158d1ba72e5b2bfb5f23' },
      ),
      [searchResultMsg(
        '2026-06-22',
        '2026-06-22',
      )],
    );

    expect(out).toEqual({
      shipping_id: '1cd9e95cf1c0158d1ba72e5b2bfb5f23',
      date_from: '2026-06-22',
      date_to: '2026-06-22',
    });
  });

  it('outra tool (nem busca nem trilha): passthrough', () => {
    const out = injectReusedWindow(
      toolUse(
        'list_customers',
        { customer_id: '1001' },
      ),
      [searchResultMsg(
        '2026-06-22',
        '2026-06-22',
      )],
    );

    expect(out).toEqual({ customer_id: '1001' });
  });
});

describe('windowClarification', () => {
  it('busca por campaign_id SEM janela → bloqueia (window_required) e marca o id como pendente', () => {
    const pending = new Set<string>();

    const out = windowClarification(
      toolUse(
        'search_shippings',
        { campaign_id: 'fa1fcc0e-f1ad-4314-8e31-4d131ec3ca98' },
      ),
      { campaign_id: 'fa1fcc0e-f1ad-4314-8e31-4d131ec3ca98' },
      pending,
    );

    expect(out?.error.code).toBe('window_required');
    expect(pending.has('fa1fcc0e-f1ad-4314-8e31-4d131ec3ca98')).toBe(true);
  });

  it('busca por campaign_id COM janela (do usuário/histórico) → null (executa)', () => {
    const out = windowClarification(
      toolUse(
        'search_shippings',
        {
          campaign_id: 'fa1fcc0e',
          date_from: '2026-06-22',
        },
      ),
      {
        campaign_id: 'fa1fcc0e',
        date_from: '2026-06-22',
      },
      new Set<string>(),
    );

    expect(out).toBeNull();
  });

  it('re-tentativa com data ADIVINHADA no mesmo turno (id já pendente) → bloqueia, mesmo COM janela', () => {
    const pending = new Set<string>(['fa1fcc0e']);

    const out = windowClarification(
      toolUse(
        'search_shippings',
        {
          campaign_id: 'fa1fcc0e',
          date_from: '2026-06-01',
        },
      ),
      {
        campaign_id: 'fa1fcc0e',
        date_from: '2026-06-01',
      },
      pending,
    );

    expect(out?.error.code).toBe('window_required');
  });

  it('trilha por shipping_id SEM janela → bloqueia (trail_window_required)', () => {
    const out = windowClarification(
      toolUse(
        'get_shipping_trail',
        { shipping_id: '1cd9e95cf1c0158d1ba72e5b2bfb5f23' },
      ),
      { shipping_id: '1cd9e95cf1c0158d1ba72e5b2bfb5f23' },
      new Set<string>(),
    );

    expect(out?.error.code).toBe('trail_window_required');
  });

  it('busca por telefone (sem campaign_id) → null (cai na janela default, não bloqueia)', () => {
    const out = windowClarification(
      toolUse(
        'search_shippings',
        { phone: '11999998888' },
      ),
      { phone: '11999998888' },
      new Set<string>(),
    );

    expect(out).toBeNull();
  });
});

/**
 * LLM provider that replays one scripted list of chunks per `converseStream` call (in order). When
 * the script runs out it fails, which is how the tests exercise the title-generation fallback.
 */
class ScriptedLlmProvider implements LlmProviderInterface {
  readonly calls: LlmConverseParamsInterface[] = [];

  constructor(private readonly turns: LlmStreamChunkType[][]) {}

  async *converseStream(params: LlmConverseParamsInterface): AsyncIterable<LlmStreamChunkType> {
    this.calls.push(params);
    const turn = this.turns.shift();

    if (!turn) {
      throw new Error('no scripted turn left');
    }

    for (const chunk of turn) {
      yield await Promise.resolve(chunk);
    }
  }

  describe(): LlmDescriptorInterface {
    return {
      provider: 'fake',
      model: 'scripted',
    };
  }
}

/** Fixed operator time zone so the UTC → wall-clock conversions are deterministic. */
const OPERATOR_TZ = 'America/Sao_Paulo';

/** Persisted message that makes a session "not new" (skips the auto-title). */
const PREVIOUS_MESSAGE: ChatMessageInterface = {
  id: 'm-0',
  role: 'user',
  content: { text: 'earlier question' },
  created_at: '2026-06-22T12:00:00.000Z',
};

/** Incident detail as returned by IncidentsService.get (UTC instants). */
const INCIDENT_DETAIL = {
  id: 'inc-1',
  rule: 'Delivery rate drop',
  detected_at: '2026-06-22T19:54:06.000Z',
  window: '19:40 → 19:55 (UTC)',
  window_from: '2026-06-22T19:40:00.000Z',
  window_to: '2026-06-22T19:55:00.000Z',
  activities: [
    {
      id: 'act-1',
      type: 'status_change',
      at: '2026-06-22T20:00:00.000Z',
      payload: { status: 'acknowledged' },
    },
  ],
};

/**
 * Builds an OrchestratorService around a scripted LLM, with every collaborator mocked by hand.
 *
 * @param turns - Chunks of each `converseStream` call, in order.
 * @param history - Persisted messages of the session.
 */
function buildScripted(
  turns: LlmStreamChunkType[][],
  history: ChatMessageInterface[] = [PREVIOUS_MESSAGE],
) {
  const llm = new ScriptedLlmProvider(turns);

  const chat = {
    getMessages: jest.fn().mockResolvedValue(history),
    appendMessage: jest.fn().mockResolvedValue('asst-9'),
    updateSession: jest.fn().mockResolvedValue({}),
    linkIncident: jest.fn().mockResolvedValue(undefined),
  };

  const shippings = {
    search: jest.fn(),
    getTrail: jest.fn(),
  };

  const analysis = { analyze: jest.fn() };

  const reports = {
    generateDelivery: jest.fn(),
    generateIncident: jest.fn(),
  };

  const catalog = {
    listProviders: jest.fn(),
    listCustomers: jest.fn(),
    windowLabel: jest.fn().mockReturnValue('últimas 24h'),
  };

  const incidents = {
    list: jest.fn(),
    get: jest.fn(),
    shippings: jest.fn(),
  };

  const audit = { record: jest.fn().mockResolvedValue(undefined) };

  const metrics = {
    increment: jest.fn(),
    histogram: jest.fn(),
  };

  const svc = new OrchestratorService(
    llm,
    chat as unknown as ChatService,
    shippings as unknown as ShippingsService,
    analysis as unknown as AnalysisService,
    reports as unknown as ReportsService,
    catalog as unknown as CatalogService,
    incidents as unknown as IncidentsService,
    audit as unknown as AuditService,
    metrics as unknown as MetricsService,
  );

  const internals = svc as unknown as {
    execute: (name: string, args: Record<string, unknown>) => Promise<unknown>;
    runTool: (name: string, args: Record<string, unknown>, userId: string) => Promise<{
      status: string;
      result: unknown;
      durationMs: number
    }>
  };

  return {
    svc,
    llm,
    chat,
    shippings,
    analysis,
    reports,
    catalog,
    incidents,
    audit,
    metrics,
    execute: internals.execute.bind(svc),
    runTool: internals.runTool.bind(svc),
  };
}

/** Scripted final turn: a plain answer and the end of the turn. */
const ANSWER_TURN: LlmStreamChunkType[] = [
  {
    type: 'text_delta',
    delta: 'Here is the answer.',
  },
  {
    type: 'stop',
    reason: 'end_turn',
  },
];

describe('OrchestratorService (scripted LLM)', () => {
  const originalTimeZone = process.env.APP_TIMEZONE;

  beforeAll(() => {
    process.env.APP_TIMEZONE = OPERATOR_TZ;
  });

  afterAll(() => {
    process.env.APP_TIMEZONE = originalTimeZone;
  });

  describe('run', () => {
    it('asks for the date instead of scanning when a campaign search comes without a window', async () => {
      const {
        svc,
        shippings,
        chat,
        metrics,
        llm,
      } = buildScripted([
        [
          {
            type: 'tool_use',
            id: 'tu-1',
            name: 'search_shippings',
            args: { campaign_id: 'f35b1480-00c1-4714-9b3a-2b1c0d4e5f60' },
          },
          {
            type: 'stop',
            reason: 'tool_use',
          },
        ],
        ANSWER_TURN,
      ]);

      const events = await collect(svc.run(
        's-1',
        'what happened to campaign f35b1480?',
        'user-7',
      ));

      expect(events.map((event) => event.event)).toEqual([
        'tool_call',
        'tool_result',
        'text_delta',
        'done',
      ]);

      const result = events[1];

      expect(result).toMatchObject({
        event: 'tool_result',
        data: {
          name: 'search_shippings',
          status: 'error',
          duration_ms: 0,
          result: { error: { code: 'window_required' } },
        },
      });

      expect(shippings.search).not.toHaveBeenCalled();

      // The refused call reaches the model as a tool result in the second turn.
      const secondTurn = llm.calls[1].messages;

      expect(secondTurn.at(-1)).toMatchObject({
        role: 'tool',
        content: {
          id: 'tu-1',
          result: { error: { code: 'window_required' } },
        },
      });

      // No usage chunks → the persisted message carries no `usage` and no token histogram.
      const persisted = chat.appendMessage.mock.calls[1][2];

      expect(persisted).toEqual({
        text: 'Here is the answer.',
        tools: [
          expect.objectContaining({
            name: 'search_shippings',
            status: 'error',
          }),
        ],
      });

      expect(metrics.histogram).not.toHaveBeenCalledWith(
        'llm.tokens',
        expect.anything(),
      );
    });

    it('records usage, links the incident and converts its times when get_incident succeeds', async () => {
      const {
        svc,
        chat,
        incidents,
        metrics,
        audit,
      } = buildScripted([
        [
          {
            type: 'tool_use',
            id: 'tu-1',
            name: 'get_incident',
            args: { incident_id: 'inc-1' },
          },
          {
            type: 'usage',
            inputTokens: 100,
            outputTokens: 20,
          },
          {
            type: 'stop',
            reason: 'tool_use',
          },
        ],
        [
          ...ANSWER_TURN,
          {
            type: 'usage',
            inputTokens: 50,
            outputTokens: 10,
          },
        ],
      ]);

      incidents.get.mockResolvedValue(INCIDENT_DETAIL);
      // Linking is best-effort: a failure there must not break the stream.
      chat.linkIncident.mockRejectedValue(new Error('db down'));

      const events = await collect(svc.run(
        's-1',
        'investigate inc-1',
        'user-7',
      ));

      expect(events.at(-1)?.event).toBe('done');

      expect(chat.linkIncident).toHaveBeenCalledWith(
        's-1',
        'inc-1',
      );

      const result = events.find((event) => event.event === 'tool_result');

      expect(result?.data).toMatchObject({
        status: 'success',
        result: {
          detected_at: '22/06/2026 às 16:54',
          window: '22/06/2026 às 16:40 → 22/06/2026 às 16:55',
          window_from: '2026-06-22T16:40:00',
          window_to: '2026-06-22T16:55:00',
          activities: [{ at: '22/06/2026 às 17:00' }],
        },
      });

      expect(chat.appendMessage.mock.calls[1][2]).toMatchObject({
        usage: {
          input_tokens: 150,
          output_tokens: 30,
        },
      });

      expect(metrics.histogram).toHaveBeenCalledWith(
        'llm.tokens',
        180,
      );

      expect(metrics.increment).toHaveBeenCalledWith(
        'tool.calls',
        { tool: 'get_incident' },
      );

      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
        action: 'tool_call',
        resource: 'orchestrator:get_incident',
        severity: 'info',
        userId: 'user-7',
      }));
    });

    it('reports a failed tool as an error result, audits it as a warning and does not link the incident', async () => {
      const {
        svc,
        chat,
        incidents,
        metrics,
        audit,
      } = buildScripted([
        [
          {
            type: 'tool_use',
            id: 'tu-1',
            name: 'get_incident',
            args: { incident_id: 'missing' },
          },
          {
            type: 'stop',
            reason: 'tool_use',
          },
        ],
        ANSWER_TURN,
      ]);

      incidents.get.mockRejectedValue(new NotFoundException({
        error: {
          code: 'not_found',
          message: 'Incidente não encontrado',
        },
      }));

      const events = await collect(svc.run(
        's-1',
        'investigate missing',
      ));

      const result = events.find((event) => event.event === 'tool_result');

      expect(result?.data).toMatchObject({
        status: 'error',
        result: {
          error: {
            code: 'not_found',
            message: 'Incidente não encontrado',
          },
        },
      });

      expect(chat.linkIncident).not.toHaveBeenCalled();

      expect(metrics.increment).toHaveBeenCalledWith(
        'tool.errors',
        { tool: 'get_incident' },
      );

      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
        severity: 'warning',
        detail: 'tool_error',
      }));
    });

    it('emits the reasoning apart and a fallback answer when the model only thinks', async () => {
      const {
        svc,
        chat,
      } = buildScripted([
        [
          {
            type: 'text_delta',
            delta: '<thinking>checking the data</thinking>',
          },
          {
            type: 'stop',
            reason: 'end_turn',
          },
        ],
      ]);

      const events = await collect(svc.run(
        's-1',
        'hmm',
      ));

      expect(events.map((event) => event.event)).toEqual([
        'thinking_delta',
        'text_delta',
        'done',
      ]);

      expect(events[0].data).toEqual({ delta: 'checking the data' });

      const fallback = (events[1].data as { delta: string }).delta;

      expect(fallback).toContain('Não consegui gerar uma resposta');
      expect(chat.appendMessage.mock.calls[1][2].text).toBe(fallback);
      // Not the first exchange of the session → no auto-title.
      expect(chat.updateSession).not.toHaveBeenCalled();
    });

    it('auto-titles the first exchange with the cleaned first line of the model\'s title', async () => {
      const {
        svc,
        chat,
        llm,
      } = buildScripted(
        [
          ANSWER_TURN,
          [
            {
              type: 'text_delta',
              delta: '"Provider D failures today."',
            },
            {
              type: 'text_delta',
              delta: '\nsecond line is ignored',
            },
            {
              type: 'stop',
              reason: 'end_turn',
            },
          ],
        ],
        [],
      );

      const events = await collect(svc.run(
        's-1',
        'which shippings failed on Provider D today?',
        'user-7',
      ));

      expect(events.at(-1)).toEqual({
        event: 'done',
        data: {
          message_id: 'asst-9',
          refusal: null,
          session_title: 'Provider D failures today',
        },
      });

      expect(chat.updateSession).toHaveBeenCalledWith(
        's-1',
        'user-7',
        { title: 'Provider D failures today' },
      );

      // The title request is a separate, tool-less call.
      expect(llm.calls[1].tools).toEqual([]);
    });

    it('falls back to the first words of the question when the title call fails', async () => {
      const {
        svc,
        chat,
      } = buildScripted(
        [ANSWER_TURN],
        [],
      );

      await collect(svc.run(
        's-1',
        '  which   shippings failed on provider-d for customer Acme since yesterday morning ',
        'user-7',
      ));

      expect(chat.updateSession).toHaveBeenCalledWith(
        's-1',
        'user-7',
        { title: 'Which shippings failed on provider-d for customer Acme' },
      );
    });

    it('titles a blank question "Nova conversa" when the model returns only quotes', async () => {
      const {
        svc,
        chat,
      } = buildScripted(
        [
          ANSWER_TURN,
          [
            {
              type: 'usage',
              inputTokens: 1,
              outputTokens: 1,
            },
            {
              type: 'text_delta',
              delta: '“”',
            },
          ],
        ],
        [],
      );

      await collect(svc.run(
        's-1',
        '   ',
        'user-7',
      ));

      expect(chat.updateSession).toHaveBeenCalledWith(
        's-1',
        'user-7',
        { title: 'Nova conversa' },
      );
    });
  });

  describe('runTool error mapping', () => {
    it('uses the domain message with a default code when the HttpException detail has no code', async () => {
      const {
        incidents,
        runTool,
      } = buildScripted([]);

      incidents.list.mockRejectedValue(new HttpException(
        { error: { message: 'Filtro inválido' } },
        422,
      ));

      const outcome = await runTool(
        'list_incidents',
        {},
        'user-7',
      );

      expect(outcome).toMatchObject({
        status: 'error',
        result: {
          error: {
            code: 'tool_error',
            message: 'Filtro inválido',
          },
        },
      });
    });

    it('falls back to the exception message when the HttpException carries no usable detail', async () => {
      const {
        incidents,
        runTool,
      } = buildScripted([]);

      incidents.list
        .mockRejectedValueOnce(new BadRequestException('plain bad request'))
        .mockRejectedValueOnce(new HttpException(
          { error: { code: 'no_message' } },
          400,
        ))
        .mockRejectedValueOnce(new HttpException(
          { reason: 'other shape' },
          400,
        ));

      const plain = await runTool(
        'list_incidents',
        {},
        'user-7',
      );

      const withoutMessage = await runTool(
        'list_incidents',
        {},
        'user-7',
      );

      const otherShape = await runTool(
        'list_incidents',
        {},
        'user-7',
      );

      expect(plain.result).toEqual({
        error: {
          code: 'tool_error',
          message: 'plain bad request',
        },
      });

      expect((withoutMessage.result as { error: { code: string } }).error.code).toBe('tool_error');
      expect((otherShape.result as { error: { code: string } }).error.code).toBe('tool_error');
    });

    it('maps a plain Error (e.g. an unknown tool) to tool_error with its message', async () => {
      const { runTool } = buildScripted([]);

      const outcome = await runTool(
        'delete_everything',
        {},
        'user-7',
      );

      expect(outcome.result).toEqual({
        error: {
          code: 'tool_error',
          message: 'Tool desconhecida: delete_everything',
        },
      });
    });
  });

  describe('execute', () => {
    it('get_shipping_trail requires a shipping_id', () => {
      const { execute } = buildScripted([]);

      expect(() => execute(
        'get_shipping_trail',
        { date_range: '7d' },
      )).toThrow('shipping_id é obrigatório');
    });

    it('get_shipping_trail resolves a date_range window and returns event times in the operator zone', async () => {
      const {
        execute,
        shippings,
      } = buildScripted([]);

      shippings.getTrail.mockResolvedValue({
        shipping_id: '0e39fb791be5089b88d672bd10294031',
        events: [
          {
            status: 'queued',
            at: '2026-06-22T19:54:06.000Z',
          },
          {
            status: 'delivered',
            at: '2026-06-22T19:54:09.000Z',
          },
        ],
      });

      const trail = await execute(
        'get_shipping_trail',
        {
          shipping_id: '0e39fb791be5089b88d672bd10294031',
          date_range: '7d',
        },
      );

      expect(shippings.getTrail).toHaveBeenCalledWith(
        '0e39fb791be5089b88d672bd10294031',
        {
          from: expect.any(Date),
          to: null,
        },
        undefined,
      );

      expect((trail as { events: { at: string }[] }).events.map((event) => event.at)).toEqual([
        '2026-06-22T16:54:06',
        '2026-06-22T16:54:09',
      ]);
    });

    it('search_shippings returns row times in the operator zone and keeps a null finalized_at', async () => {
      const {
        execute,
        shippings,
      } = buildScripted([]);

      shippings.search.mockResolvedValue({
        rows: [
          {
            id: 'm1',
            requested_at: '2026-06-22T19:54:06.000Z',
            finalized_at: '2026-06-23T02:10:00.000Z',
          },
          {
            id: 'm2',
            requested_at: '2026-06-22T19:55:00.000Z',
            finalized_at: null,
          },
        ],
        total: 2,
        page: 1,
        total_pages: 1,
        latency_ms: 3,
      });

      const page = await execute(
        'search_shippings',
        { phone: '+5511987651234' },
      ) as {
        rows: {
          requested_at: string;
          finalized_at: string | null
        }[]
      };

      expect(page.rows).toEqual([
        {
          id: 'm1',
          requested_at: '2026-06-22T16:54:06',
          finalized_at: '2026-06-22T23:10:00',
        },
        {
          id: 'm2',
          requested_at: '2026-06-22T16:55:00',
          finalized_at: null,
        },
      ]);
    });

    it('search_shippings by incident honours an explicit limit and counts blocked and pending rows', async () => {
      const {
        execute,
        incidents,
      } = buildScripted([]);

      incidents.shippings.mockResolvedValue({
        rows: [
          {
            id: 'm1',
            status: 'blocked',
            requested_at: '2026-06-22T19:54:06.000Z',
            finalized_at: null,
          },
          {
            id: 'm2',
            status: 'pending',
            requested_at: '2026-06-22T19:54:06.000Z',
            finalized_at: null,
          },
          {
            id: 'm3',
            status: 'sent',
            requested_at: '2026-06-22T19:54:06.000Z',
            finalized_at: null,
          },
        ],
        total: 3,
      });

      const page = await execute(
        'search_shippings',
        {
          incident_id: 'inc-1',
          limit: 5,
        },
      ) as { breakdown: Record<string, number> };

      expect(incidents.shippings).toHaveBeenCalledWith(
        'inc-1',
        5,
      );

      expect(page.breakdown).toEqual({
        delivered: 0,
        failed: 0,
        blocked: 1,
        pending: 1,
      });
    });

    it('generate_delivery_report labels the top errors and converts the hourly buckets', async () => {
      const {
        execute,
        reports,
      } = buildScripted([]);

      reports.generateDelivery.mockResolvedValue({
        totals: { sent: 10 },
        top_errors: [
          {
            code: 'generic_error',
            count: 3,
          },
          {
            code: 'brand_new_code',
            count: 1,
          },
        ],
        hourly: [
          {
            at: '2026-06-22T15:00:00.000Z',
            rate: 0.9,
          },
        ],
      });

      const report = await execute(
        'generate_delivery_report',
        { date_range: '24h' },
      );

      expect(report).toEqual({
        totals: { sent: 10 },
        top_errors: [
          {
            code: 'erro genérico',
            count: 3,
          },
          {
            code: 'brand_new_code',
            count: 1,
          },
        ],
        hourly: [
          {
            at: '2026-06-22T12:00:00',
            rate: 0.9,
          },
        ],
      });
    });

    it('list_providers and list_customers state the window they used', async () => {
      const {
        execute,
        catalog,
      } = buildScripted([]);

      catalog.listProviders.mockResolvedValue([
        'Provider D',
        'Provider C',
      ]);

      catalog.listCustomers.mockResolvedValue({
        items: ['Acme'],
        total: 12,
      });

      await expect(execute(
        'list_providers',
        { date_range: '24h' },
      )).resolves.toEqual({
        window: 'últimas 24h',
        providers: [
          'Provider D',
          'Provider C',
        ],
      });

      await expect(execute(
        'list_customers',
        { date_range: '24h' },
      )).resolves.toEqual({
        window: 'últimas 24h',
        customers: ['Acme'],
        total: 12,
      });

      expect(catalog.windowLabel).toHaveBeenCalledWith({ date_range: '24h' });
    });

    it('routes the passthrough tools to their services with the model arguments', async () => {
      const {
        execute,
        analysis,
        incidents,
        reports,
      } = buildScripted([]);

      analysis.analyze.mockResolvedValue({ risk: 'low' });
      incidents.list.mockResolvedValue({ rows: [] });
      reports.generateIncident.mockResolvedValue({ total: 0 });

      await expect(execute(
        'analyze_shipping_content',
        { shipping_id: 'abc' },
      )).resolves.toEqual({ risk: 'low' });

      await expect(execute(
        'list_incidents',
        { status: 'open' },
      )).resolves.toEqual({ rows: [] });

      await expect(execute(
        'generate_incident_report',
        { date_range: '7d' },
      )).resolves.toEqual({ total: 0 });

      expect(analysis.analyze).toHaveBeenCalledWith({ shipping_id: 'abc' });
      expect(incidents.list).toHaveBeenCalledWith({ status: 'open' });
      expect(reports.generateIncident).toHaveBeenCalledWith({ date_range: '7d' });
    });

    it('get_incident requires an incident_id', () => {
      const { execute } = buildScripted([]);

      expect(() => execute(
        'get_incident',
        {},
      )).toThrow('incident_id é obrigatório');
    });

    it('get_incident keeps the stored window label when the incident has no window bounds', async () => {
      const {
        execute,
        incidents,
      } = buildScripted([]);

      incidents.get.mockResolvedValue({
        ...INCIDENT_DETAIL,
        window_from: null,
        window_to: null,
        activities: [],
      });

      const detail = await execute(
        'get_incident',
        { incident_id: 'inc-1' },
      );

      expect(detail).toMatchObject({
        window: '19:40 → 19:55 (UTC)',
        window_from: null,
        window_to: null,
        detected_at: '22/06/2026 às 16:54',
      });
    });
  });
});

describe('toolResultForLlm (edge shapes)', () => {
  it('reports zero returned rows when the search envelope has no rows array', () => {
    const projected = toolResultForLlm(
      'search_shippings',
      {
        total: 0,
        date_from: '2026-06-22',
        date_to: '2026-06-22',
      },
    );

    expect(projected).toMatchObject({
      rows: undefined,
      returned: 0,
      total: 0,
    });
  });
});

describe('lastSearchWindow', () => {
  it('skips a search result without dates and returns the window of an earlier search', () => {
    const messages = [
      {
        role: 'tool',
        content: {
          name: 'search_shippings',
          result: {
            date_from: '2026-06-01',
            date_to: '2026-06-02',
          },
        },
      },
      {
        role: 'tool',
        content: {
          name: 'search_shippings',
          result: { error: { code: 'window_required' } },
        },
      },
      {
        role: 'tool',
        content: {
          name: 'list_providers',
          result: {},
        },
      },
      {
        role: 'user',
        content: 'and the campaign?',
      },
    ] as LlmMessageInterface[];

    expect(lastSearchWindow(messages)).toEqual({
      date_from: '2026-06-01',
      date_to: '2026-06-02',
    });
  });

  it('returns null when no search in the conversation carried a window', () => {
    const messages = [
      {
        role: 'tool',
        content: {
          name: 'search_shippings',
          result: null,
        },
      },
    ] as LlmMessageInterface[];

    expect(lastSearchWindow(messages)).toBeNull();
  });
});
