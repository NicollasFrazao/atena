import { BadRequestException } from '@nestjs/common';
import type { AuditService } from '../audit/audit.service';
import type { CatalogService } from '../catalog/catalog.service';
import type { IncidentsService } from '../incidents/incidents.service';
import { FakeLlmProvider } from '../llm/fake-llm.provider';
import type { AnalysisService } from '../shippings/analysis.service';
import type { ShippingsService } from '../shippings/shippings.service';
import type { ReportsService } from '../reports/reports.service';
import type { ChatService } from './chat.service';
import { historyToConvo, injectReusedWindow, OrchestratorService, toolResultForLlm, windowClarification } from './orchestrator.service';
import type { LlmMessageInterface, LlmToolUseInterface } from '../llm/llm-provider.interface';
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
          provider: 'sinch',
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
          provider: 'sinch',
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

    (messages.search as jest.Mock).mockImplementation(async (
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

      return {
        rows: [],
        page: 1,
        total: 0,
        total_pages: 1,
        latency_ms: 1,
      };
    });

    const events = await collect(svc.run(
      's-1',
      'status do telefone +5511987651234',
    ));

    const progress = events.filter((event) => event.event === 'tool_progress');

    expect(progress.map((event) => event.event === 'tool_progress' && event.data.phase))
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
