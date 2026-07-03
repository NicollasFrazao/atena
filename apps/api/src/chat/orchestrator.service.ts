import { BadRequestException, HttpException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type {
  ChatMessageContentInterface,
  ChatMessageInterface,
  ChatStreamEvent,
  ChatToolInvocationInterface,
  ShippingTrailInterface,
  ToolNameType,
} from '@atena/types';
import { AuditService } from '../audit/audit.service';
import { appTimeZone, formatInstantInTz, toNaiveDatetimeInTz } from '../audit-query/tz';
import { withIdleTimeout } from '../common/async-timeout';
import { categoryLabel } from '../common/status-labels';
import type {
  AuditProgressCallback,
  AuditProgressEventInterface,
  AuditWindowInterface,
} from '../audit-query/audit-query.types';
import { resolveWindow } from '../audit-query/window';
import { CatalogService } from '../catalog/catalog.service';
import { CatalogQueryDto } from '../catalog/dto/catalog-query.dto';
import {
  LLM_PROVIDER,
  type LlmMessageInterface,
  type LlmProviderInterface,
  type LlmStopInterface,
  type LlmToolSpecInterface,
  type LlmToolUseInterface,
} from '../llm/llm-provider.interface';
import { IncidentsService } from '../incidents/incidents.service';
import { AnalysisService } from '../shippings/analysis.service';
import { ShippingsService } from '../shippings/shippings.service';
import { ReportsService } from '../reports/reports.service';
import { DeliveryReportDto } from '../reports/dto/delivery-report.dto';
import { ChatService, STUB_USER_ID } from './chat.service';
import { ThinkingSplitter, type ThinkingSplitResultInterface } from './thinking-splitter';
import { MetricsService } from '../observability/metrics.service';
import { tracer } from '../tracing';

/** Limite de turnos do loop tool-use→resultado→texto (guarda anti-loop). */
const MAX_TURNS = 5;

/** Resposta mínima quando o stream encerra sem texto (só <thinking>, ou MAX_TURNS esgotado em tool-use) — evita balão vazio. */
const EMPTY_RESPONSE_FALLBACK = 'Não consegui gerar uma resposta para isso. Pode reformular a pergunta ou dar mais detalhes?';

/** Teto de envios trazidos numa busca por `incident_id` (cobre os impactados de um incidente típico). */
const INCIDENT_SEARCH_LIMIT = 200;

/**
 * Formato de UUID (id de ENVIO/requisição = campaign_id). O shipping_id da trilha é um
 * hash (md5, 32 hex SEM hifens) vindo de uma linha do search_shippings — nunca um UUID. Usado para
 * barrar o erro comum de passar o id da campanha direto ao get_shipping_trail.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Formato de shipping_id (id de um ENVIO/destinatário): hash md5 de 32 hex SEM hífens (ex.:
 * "61e721836c5fc4e91394c6be3afb25f2"). É o id da trilha. Usado para barrar o erro inverso ao do
 * {@link UUID_PATTERN}: passar um shipping_id (hash) como campaign_id no search_shippings (que então
 * não acha nada, porque campaign_id é um UUID) em vez de abrir a trilha direto.
 */
const SHIPPING_ID_PATTERN = /^[0-9a-f]{32}$/i;

/**
 * Idle-timeout (ms) do stream do LLM por turno: se o provider abrir o stream mas não emitir nenhum
 * chunk nesse intervalo (ex.: Bedrock pendurado), aborta com erro em vez de travar a sessão pra
 * sempre. 120s dá folga quando o event loop está sob carga (scans pesados do DuckDB concorrentes
 * podem atrasar a drenagem do stream); first-token legítimo costuma ser < 15s.
 */
const LLM_STREAM_IDLE_TIMEOUT_MS = 120_000;

/** Logger de observabilidade do orquestrador (latência/erro por tool). */
const logger = new Logger('Orchestrator');

/** Prompt de sistema da Atena (persona + invariantes dos princípios). */
const SYSTEM_PROMPT =
  'Você é a Atena, assistente de suporte para dados de entrega de SMS. ' +
  'Responda em PT-BR, de forma objetiva. NUNCA escreva os nomes técnicos das ferramentas (ex.: ' +
  '"generate_delivery_report", "search_shippings", "get_shipping_trail") em NENHUM texto que você ' +
  'produzir — nem no raciocínio, nem na resposta final. Descreva sempre a ação em português natural ' +
  '("vou gerar o relatório de entregabilidade", "vou buscar os envios", "vou abrir a trilha do ' +
  'envio"). Os nomes técnicos são internos e o usuário não deve vê-los. ' +
  'Use SOMENTE as tools disponíveis para obter dados — ' +
  'nunca invente números, status ou conteúdo. Telefones e conteúdo são sensíveis e ficam mascarados por padrão. ' +
  'Os códigos retornados pelas tools (ex.: "código de status do provedor 401") são códigos da ' +
  'operadora/gateway de SMS, NÃO códigos HTTP — não os interprete como HTTP (ex.: 401 não é ' +
  '"Unauthorized"); se não souber o significado exato, reporte só o número e o status normalizado. ' +
  'Quando o usuário JÁ informa um cliente, provedor ou status específico, consulte DIRETO com esse ' +
  'filtro (generate_delivery_report.filters ou search_shippings) — NÃO use list_customers/list_providers ' +
  'para "localizar" o que já foi informado (são só para descobrir o que existe, e varrem muito dado). ' +
  'Um id de CAMPANHA/REQUISIÇÃO (UUID, ex.: "f35b1480-00c1-4714-...") é o campaign_id (id da ' +
  'campanha): a busca por campaign_id EXIGE uma janela temporal. Se o usuário NÃO ' +
  'informou QUANDO o envio ocorreu, NÃO chame a busca ainda — PRIMEIRO pergunte a data aproximada ' +
  '(pode ser só o dia) e só busque DEPOIS que ele responder. EXCEÇÃO (não pergunte): se o campaign_id ' +
  'veio de uma BUSCA ANTERIOR nesta conversa — ex.: é a "Campanha" de uma linha que você acabou de ' +
  'listar — a janela JÁ está no histórico (date_from/date_to daquela busca); REUSE a MESMA janela e ' +
  'busque direto, sem perguntar a data de novo. NUNCA chame a busca por campaign_id sem ' +
  'janela "para tentar": a tool recusa e a chamada é desperdiçada. IMPORTANTE: um erro de tool (code ' +
  '"window_required"/"trail_window_required"/"looks_like_shipping_id"/"looks_like_campaign_id") NUNCA ' +
  'é "nenhum resultado" — a busca NEM rodou. JAMAIS responda "não foram encontrados envios/resultados" ' +
  'diante de um desses erros. SIGA a mensagem do erro: se falta a data, PERGUNTE-a ao usuário (NÃO ' +
  'invente nem adivinhe uma data); se o erro diz que o id é de OUTRO tipo (looks_like_shipping_id = o ' +
  'id é de um ENVIO → abra a TRILHA dele com get_shipping_trail; looks_like_campaign_id = é de uma ' +
  'CAMPANHA → busque os envios dela), faça a ação certa em vez de reclamar de "sem resultados". O shipping_id do get_shipping_trail ' +
  'é o id de um ENVIO específico — um HASH de 32 caracteres hex SEM hífens (ex.: ' +
  '"61e721836c5fc4e91394c6be3afb25f2"); o campaign_id (id da campanha) é um UUID (com hífens). ' +
  'NUNCA passe um shipping_id (hash) como campaign_id no search_shippings (não acha nada), nem um ' +
  'campaign_id (UUID) como shipping_id no get_shipping_trail. ' +
  'Para mostrar a TRILHA/linha do tempo de eventos de um envio (queued → sent → delivered/falha, ' +
  'com os códigos do provedor), chame get_shipping_trail com esse shipping_id. Se você JÁ tem o ' +
  'shipping_id (o usuário forneceu o hash, ou ele veio de um search anterior), NÃO faça um search ' +
  'antes — chame get_shipping_trail DIRETO; a janela vem da data que o usuário indicar (se ele não ' +
  'disse QUANDO foi o envio, PERGUNTE a data aproximada — pode ser só o dia). Quando o id veio de um ' +
  'search, passe date_from=date_to = o DIA do envio DAQUELA linha (o campo `requested_at`/"Enviado" '
  + 'do resultado) — NÃO a janela ampla da busca: a trilha varre só aquele dia e fica MUITO mais '
  + 'rápida (varrer a janela inteira só pra um envio é desperdício). NUNCA use search_shippings para '
  + 'ver a trilha (ele só lista o resumo, não os eventos). ' +
  'Ao listar clientes ou provedores (list_customers/list_providers), o resultado traz a JANELA usada no ' +
  'campo `window`; SEMPRE declare essa janela na resposta (ex.: "Clientes ativos nas últimas 24h: …" ou ' +
  '"Provedores ativos desde 18/06 (janela padrão): …"), porque uma lista de "ativos" sem janela é ambígua. ' +
  'O list_customers traz só os MAIS ATIVOS (top-N) + o `total` distinto da janela: quando `total` for ' +
  'MAIOR que a quantidade de itens listados, CITE o total e deixe claro que são "os mais ativos" (não a ' +
  'lista completa) — ex.: "N clientes ativos; os mais ativos: …". ' +
  'Os resultados das tools já são exibidos ao usuário em CARTÕES visuais ricos (tabela de envios, '
  + 'trilha de eventos, gráfico de taxa de entrega por hora, quebra por provedor e top erros). NÃO '
  + 'transcreva esses dados linha a linha no texto — em especial NUNCA liste as 24 horas do relatório '
  + 'nem repita a tabela inteira de resultados. Ao resumir uma busca de envios (search_shippings), CITE o '
  + 'breakdown por status do resultado (campo `breakdown`: entregue/falha/pendente do conjunto todo) — '
  + 'são números REAIS (não invente nem some à mão); o search NÃO traz taxa de entrega, só essas contagens. '
  + 'Resuma o essencial em 1–3 frases (taxa geral, pico e '
  + 'vale com HORA e DATA, e tendência) e deixe os detalhes para o cartão. Sempre que citar um horário, '
  + 'inclua a DATA no formato DD/MM (ex.: "vale de 19,4% às 12:00 de 19/06"), porque a janela pode '
  + 'abranger mais de um dia e a hora sozinha é ambígua. TODAS as datas e horas — tanto as que você '
  + 'INFORMA às tools quanto as que CITA ao usuário — são no fuso do operador (horário de Brasília); '
  + 'NUNCA cite "UTC". Para um DIA do calendário (ex.: "no dia 19/06"), passe date_from e date_to como '
  + 'YYYY-MM-DD SEM hora (ex.: date_from="2026-06-19", date_to="2026-06-19") — o backend interpreta no '
  + 'fuso do operador e cobre o dia inteiro. Para um INTERVALO DE HORAS de um dia (ex.: "das 13h às '
  + '17h"), passe date_from/date_to como YYYY-MM-DDTHH:MM SEM o sufixo "Z" (ex.: date_from='
  + '"2026-06-19T13:00", date_to="2026-06-19T17:00") — sem o "Z" é interpretado no fuso do operador. '
  + 'Use o sufixo "Z" (UTC absoluto) SOMENTE se o usuário pedir explicitamente em UTC. Ao citar horários de EVENTOS DA TRILHA '
  + '(queued/sent/delivered), que podem estar a poucos segundos de distância, inclua os SEGUNDOS '
  + '(HH:MM:SS) — sem eles os eventos parecem simultâneos e contradizem a duração. '
  + 'Ao concluir uma resposta, SEMPRE ofereça 1–3 próximos passos — mas SOMENTE ações que VOCÊ pode ' +
  'executar AGORA com as tools disponíveis: abrir a trilha de um envio (get_shipping_trail), ' +
  'buscar outros envios (search_shippings), gerar relatório de entrega de outra janela/cliente/' +
  'provedor (generate_delivery_report), analisar o conteúdo de um envio (analyze_shipping_content), ' +
  'listar clientes/provedores/incidentes ou abrir um incidente (list_customers/list_providers/' +
  'list_incidents/get_incident), ou gerar relatório de incidentes (generate_incident_report). NUNCA ' +
  'sugira ações fora dessas tools (ex.: "consultar a documentação do provedor", "entrar em contato com ' +
  'a operadora", "verificar manualmente"): se não dá para fazer com uma tool, não ofereça. Termine ' +
  'perguntando se o usuário quer seguir com algum. ' +
  'Se estiver em DÚVIDA sobre o que o usuário quer, qual valor/filtro usar, ou se faltar uma ' +
  'informação necessária (um id, uma data, qual cliente/provedor), PEÇA esclarecimento em vez de ' +
  'adivinhar ou chutar. NUNCA invente ids, números, datas, status nem resultados: se uma tool não ' +
  'devolveu o dado (resultado vazio ou não encontrado), DIGA isso claramente e ofereça o próximo ' +
  'passo (ex.: ajustar a janela de data, confirmar o id) — jamais preencha com valores plausíveis. ' +
  'Se o pedido estiver fora do escopo (não for sobre entrega/diagnóstico de SMS) ou não houver tool aplicável, ' +
  'recuse explicitamente e oriente o que é possível fazer.';

/**
 * Monta o system prompt do turno acrescentando a DATA DE HOJE (resolvida em runtime, não no load do
 * módulo, para não envelhecer num servidor longo). Sem essa âncora temporal o modelo trata datas de
 * 2026 como "futuras" e recusa consultas válidas (ex.: hoje) em vez de chamar a tool.
 *
 * @param {Date} now - Instante atual (injetável para teste).
 * @returns {string} O system prompt base + a referência de data atual e a regra passado/futuro.
 */
function buildSystemPrompt(now: Date): string {
  const timeZone = appTimeZone();

  // "Hoje" NO FUSO do operador (não em UTC) — perto da meia-noite o dia UTC difere do dia local.
  const today = new Intl.DateTimeFormat(
    'en-CA',
    {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    },
  ).format(now);

  return `${SYSTEM_PROMPT} FUSO HORÁRIO: você opera no fuso ${timeZone} (horário de Brasília, UTC−3). `
    + 'TODAS as datas e horas — as que você INFORMA às tools e as que CITA ao usuário — são nesse fuso; '
    + 'o motor converte para UTC internamente. A data de HOJE (nesse fuso) é '
    + `${today} (referência temporal). Datas iguais ou anteriores a hoje são passado/presente e SÃO `
    + 'consultáveis — só trate como futura (sem dados) uma data ESTRITAMENTE posterior a hoje; NUNCA '
    + 'recuse uma data só por estar em 2026 ou por "parecer" futura.';
}

/**
 * Projeta o resultado de uma tool para o que o MODELO vê no `tool_result` do converse. Para
 * `search_shippings`, REMOVE a paginação (`page`/`total_pages`/`export_token`/`latency_ms`): o chat
 * não pagina (sem `page`/`limit` no inputSchema), então expor "página 1 de N" leva o modelo a
 * re-chamar a busca tentando "pegar o resto" — encadeando uma 2ª varredura cara e travando o turno.
 * Entrega `total` + as linhas retornadas (as mais recentes) + `returned`; o conjunto completo sai
 * pelo Exportar CSV (o card, via SSE/histórico, mantém o envelope cheio). Demais tools: passthrough.
 *
 * @param {string} name - Nome da tool.
 * @param {unknown} result - Resultado bruto da tool.
 * @returns {unknown} Resultado projetado para o modelo.
 */
export function toolResultForLlm(
  name: string,
  result: unknown,
): unknown {
  if (
    name !== 'search_shippings'
    || result === null
    || typeof result !== 'object'
  ) {
    return result;
  }

  const envelope = result as Record<string, unknown>;

  const rows = Array.isArray(envelope.rows)
    ? envelope.rows
    : [];

  return {
    rows: envelope.rows,
    total: envelope.total,
    returned: rows.length,
    breakdown: envelope.breakdown,
    date_from: envelope.date_from,
    date_to: envelope.date_to,
  };
}

/**
 * Varre as mensagens (mais recente → mais antiga) procurando a janela EFETIVA do último
 * `search_shippings` — `date_from`/`date_to` no `tool_result` (preservados por {@link toolResultForLlm}).
 * Base p/ reusar a janela quando o modelo pede os envios de uma campanha que veio de uma busca anterior
 * SEM repassar a data: injetamos a janela em vez de depender do modelo (que tende a errar) ou falhar.
 *
 * @param {LlmMessageInterface[]} messages - Conversa (histórico + turno atual).
 * @returns {{ date_from: string; date_to: string } | null} Janela do último search, ou `null`.
 */
export function lastSearchWindow(
  messages: LlmMessageInterface[],
): {
  date_from: string;
  date_to: string
} | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const content = messages[index].content;

    if (
      messages[index].role !== 'tool'
      || content === null
      || typeof content !== 'object'
      || (content as { name?: string }).name !== 'search_shippings'
    ) {
      continue;
    }

    const result = (content as { result?: unknown }).result;

    if (
      result !== null
      && typeof result === 'object'
      && typeof (result as { date_from?: unknown }).date_from === 'string'
      && typeof (result as { date_to?: unknown }).date_to === 'string'
    ) {
      return {
        date_from: (result as { date_from: string }).date_from,
        date_to: (result as { date_to: string }).date_to,
      };
    }
  }

  return null;
}

/**
 * Tools cuja varredura por id pontual EXIGE janela e que devem REUSAR a janela de um search anterior
 * quando o modelo a omite: busca por `campaign_id` e trilha por `shipping_id`. Em ambas o id costuma
 * vir de um search recente — a janela já está no histórico.
 *
 * @param {LlmToolUseInterface} chunk - Tool-use pedido pelo modelo.
 * @returns {boolean} `true` se a chamada precisa de janela e qualifica para o reuso.
 */
function needsReusedWindow(chunk: LlmToolUseInterface): boolean {
  return (
    chunk.name === 'search_shippings'
    && Boolean(chunk.args.campaign_id)
  ) || (
    chunk.name === 'get_shipping_trail'
    && Boolean(chunk.args.shipping_id)
  );
}

/**
 * Resolve os args de um `search_shippings` (por `campaign_id`) ou `get_shipping_trail` (por `shipping_id`)
 * que vieram SEM janela (date_from/date_to/date_range): se houver a janela de um search anterior
 * (ver {@link lastSearchWindow}), INJETA-a. Cobre "me traga os envios da campanha X" e "abre a trilha
 * desse envio" logo após uma busca — sem depender de o modelo repassar a data (ele tende a errar:
 * conclui "sem resultados" ou cai no guard `*_window_required`). Com janela, sem id qualificador, ou
 * sem janela anterior: devolve os args originais (o guard então pede a data). Demais tools: passthrough.
 *
 * @param {LlmToolUseInterface} chunk - Tool-use pedido pelo modelo.
 * @param {LlmMessageInterface[]} messages - Conversa (histórico + turno atual) p/ achar a janela.
 * @returns {Record<string, unknown>} Args efetivos (possivelmente com a janela injetada).
 */
export function injectReusedWindow(
  chunk: LlmToolUseInterface,
  messages: LlmMessageInterface[],
): Record<string, unknown> {
  if (!needsReusedWindow(chunk)) {
    return chunk.args;
  }

  const hasWindow = Boolean(
    chunk.args.date_from
    || chunk.args.date_to
    || chunk.args.date_range,
  );

  if (hasWindow) {
    return chunk.args;
  }

  const window = lastSearchWindow(messages);

  if (!window) {
    return chunk.args;
  }

  logger.debug(
    `${chunk.name} sem janela → reusando a janela do search anterior `
    + `(${window.date_from} … ${window.date_to})`,
  );

  return {
    ...chunk.args,
    date_from: window.date_from,
    date_to: window.date_to,
  };
}

/**
 * Decide se uma busca por `campaign_id` ou trilha por `shipping_id` deve ser BLOQUEADA por falta de
 * janela — caso em que o motor NÃO deve escanear (~30 dias à toa) e o assistente deve PEDIR a data.
 * Bloqueia quando: (a) não há janela nos args (e {@link injectReusedWindow} não achou uma no histórico),
 * ou (b) o id já teve uma tentativa sem janela NESTE turno (`pendingWindowIds`) — então qualquer data
 * agora é um CHUTE do modelo (não houve nova mensagem do usuário), e re-escanear seria desperdício.
 * Determinístico: o modelo costuma ignorar o prompt e adivinhar a data; isto força o pedido sem scan.
 *
 * @param {LlmToolUseInterface} chunk - Tool-use pedido pelo modelo.
 * @param {Record<string, unknown>} args - Args efetivos (pós-injeção de janela).
 * @param {Set<string>} pendingWindowIds - Ids com tentativa sem janela neste turno (mutado aqui).
 * @returns {{ error: { code: string; message: string } } | null} Erro de "pede a data", ou `null` p/ executar.
 */
export function windowClarification(
  chunk: LlmToolUseInterface,
  args: Record<string, unknown>,
  pendingWindowIds: Set<string>,
): {
  error: {
    code: string;
    message: string
  }
} | null {
  const isSearch = chunk.name === 'search_shippings'
    && typeof args.campaign_id === 'string'
    && Boolean(args.campaign_id);

  const isTrail = chunk.name === 'get_shipping_trail'
    && typeof args.shipping_id === 'string'
    && Boolean(args.shipping_id);

  if (
    !isSearch
    && !isTrail
  ) {
    return null;
  }

  const id = isSearch
    ? String(args.campaign_id)
    : String(args.shipping_id);

  const hasWindow = Boolean(
    args.date_from
    || args.date_to
    || args.date_range,
  );

  if (
    hasWindow
    && !pendingWindowIds.has(id)
  ) {
    return null;
  }

  pendingWindowIds.add(id);

  return {
    error: {
      code: isTrail
        ? 'trail_window_required'
        : 'window_required',
      message: 'A consulta NÃO foi executada (sem janela temporal e sem uma do histórico desta '
        + 'conversa) — para não varrer ~30 dias à toa. Isto NÃO é "nenhum resultado". PERGUNTE ao '
        + 'usuário a DATA aproximada do envio (pode ser só o dia); NÃO invente/adivinhe uma data nem '
        + 'repita a chamada sem ela. Assim que o usuário responder, refaça com date_from/date_to.',
    },
  };
}

/**
 * Reconstrói o histórico persistido em mensagens para o LLM, EXPANDINDO as tools de cada turno do
 * assistente em blocos `tool_use` + resultado (não só o texto). Sem isso o modelo perde o que tools
 * de turnos anteriores devolveram — ex.: o `shipping_id` de um `search_shippings` necessário para
 * abrir a trilha depois — e acaba re-buscando ou passando um id errado.
 *
 * O `id` é sintético e local (só precisa casar tool_use↔resultado dentro do payload); a fusão de
 * mensagens consecutivas no provider agrupa os vários blocos de um turno como o Converse exige. O
 * texto final do turno vem por último (depois dos resultados), espelhando o fluxo real.
 *
 * @param {ChatMessageInterface[]} history - Mensagens persistidas da sessão (ordem cronológica).
 * @returns {LlmMessageInterface[]} Conversa para o LLM, com as tools dos turnos passados reidratadas.
 */
export function historyToConvo(history: ChatMessageInterface[]): LlmMessageInterface[] {
  const convo: LlmMessageInterface[] = [];

  history.forEach((
    message,
    mi,
  ) => {
    const tools = message.role === 'assistant'
      ? message.content.tools ?? []
      : [];

    if (tools.length === 0) {
      convo.push({
        role: message.role,
        content: message.content.text,
      });

      return;
    }

    tools.forEach((
      tool,
      ti,
    ) => {
      convo.push({
        role: 'assistant',
        content: {
          tool_use: {
            id: `h${mi}-${ti}`,
            name: tool.name,
            args: tool.args,
          },
        },
      });
    });

    tools.forEach((
      tool,
      ti,
    ) => {
      convo.push({
        role: 'tool',
        content: {
          id: `h${mi}-${ti}`,
          name: tool.name,
          result: toolResultForLlm(
            tool.name,
            tool.result,
          ),
        },
      });
    });

    if (message.content.text) {
      convo.push({
        role: 'assistant',
        content: message.content.text,
      });
    }
  });

  return convo;
}

/** Catálogo de tools exposto ao modelo (contrato; a execução é server-side). */
const TOOL_SPECS: LlmToolSpecInterface[] = [
  {
    name: 'search_shippings',
    description: 'Busca envios por telefone (com ou SEM DDI), status, provedor, cliente ou '
      + 'campaign_id (id da campanha — devolve os destinatários daquela campanha). '
      + 'Janela temporal: date_from/date_to (ISO 8601) ou date_range (24h/7d/30d/all). A janela filtra '
      + 'por requested_at (quando o envio foi ENVIADO), NUNCA pela finalização — "envios do dia X" = '
      + 'enviados no dia X. Cada linha traz requested_at (envio) e finalized_at (quando finalizou, pode '
      + 'ser um dia POSTERIOR, ou null se ainda não finalizou). Retorna as linhas MAIS RECENTES '
      + '(campo `returned`) de um `total`; NÃO há paginação e você NÃO deve re-chamar a busca para '
      + '"pegar o resto" — para o conjunto completo, oriente o operador a usar o Exportar CSV do card. '
      + 'Para buscar por campaign_id, uma janela é OBRIGATÓRIA — se o usuário não disser quando '
      + 'o envio ocorreu, PERGUNTE a data aproximada (pode ser só o dia, sem horário) antes de chamar '
      + 'a tool; a janela é recortada à data mínima confiável automaticamente, então não rejeite datas antigas. '
      + 'Para listar os ENVIOS DE UM INCIDENTE, passe incident_id (o UUID do incidente): a busca '
      + 'devolve EXATAMENTE os envios impactados que o detector marcou (mesma contagem do incidente) '
      + '— NÃO use janela/cliente pra isso, senão a contagem diverge.',
    inputSchema: {
      type: 'object',
      properties: {
        phone: {
          type: 'string',
          description: 'Telefone do destinatário, só dígitos ou formatado; o DDI (55) é OPCIONAL — '
            + '"11991884678" acha o mesmo que "+55 11 99188-4678" (casa por sufixo).',
        },
        status: { type: 'string' },
        provider: { type: 'string' },
        customer_id: { type: 'string' },
        campaign_id: { type: 'string' },
        incident_id: {
          type: 'string',
          description: 'UUID de um incidente — restringe aos envios EXATOS impactados (mesma contagem '
            + 'do card do incidente). Ignora janela/dimensão.',
        },
        date_from: { type: 'string' },
        date_to: { type: 'string' },
        date_range: { type: 'string' },
      },
    },
  },
  {
    name: 'get_shipping_trail',
    description: 'A LINHA DO TEMPO de eventos de um ENVIO (queued → sent → delivered/falha, com os '
      + 'códigos do provedor em cada etapa), pelo seu shipping_id (o id da linha de um search_shippings). '
      + 'Use SEMPRE que pedirem "a trilha", "o que aconteceu passo a passo" ou os eventos de um envio '
      + '— NÃO repita o search_shippings para isso. O shipping_id é um HASH de 32 hex SEM hífens; NÃO é o '
      + 'campaign_id (UUID, id da campanha). Uma DATA/janela é OBRIGATÓRIA (como na busca por '
      + 'campaign_id): se o id veio de um search, REPASSE a MESMA janela (date_from/date_to) daquele '
      + 'resultado; se o usuário só forneceu o shipping_id (sem QUANDO foi o envio), PERGUNTE a data '
      + 'aproximada (pode ser só o dia) ANTES de chamar — sem data a varredura cai no padrão de ~30 dias '
      + 'e fica lenta. NÃO faça um search só para abrir a trilha.',
    inputSchema: {
      type: 'object',
      properties: {
        shipping_id: { type: 'string' },
        date_from: { type: 'string' },
        date_to: { type: 'string' },
        date_range: { type: 'string' },
      },
      required: ['shipping_id'],
    },
  },
  {
    name: 'analyze_shipping_content',
    description: 'Analisa o risco do conteúdo de um envio (texto direto ou shipping_id).',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        shipping_id: { type: 'string' },
      },
    },
  },
  {
    name: 'generate_delivery_report',
    description: 'Gera relatório agregado de entregabilidade por janela/filtros. Janela: para um DIA '
      + 'do calendário passe date_from/date_to como YYYY-MM-DD SEM hora (interpretado no fuso do '
      + 'operador, horário de Brasília — cobre o dia inteiro); use ISO com hora só para um instante '
      + 'preciso; ou date_range (24h/7d/30d/all). '
      + 'Filtros opcionais em `filters`: customer_id (cliente), provider (provedor), status — '
      + 'use isto para "entregas do cliente/provedor X" em vez de listar o catálogo antes.',
    inputSchema: {
      type: 'object',
      properties: {
        date_range: { type: 'string' },
        date_from: { type: 'string' },
        date_to: { type: 'string' },
        group_by: {
          type: 'array',
          items: { type: 'string' },
        },
        filters: {
          type: 'object',
          properties: {
            customer_id: { type: 'string' },
            provider: { type: 'string' },
            status: { type: 'string' },
          },
        },
      },
    },
  },
  {
    name: 'list_providers',
    description: 'Lista os provedores com ATIVIDADE numa janela (date_from/date_to ISO 8601 ou '
      + 'date_range 24h/7d/30d/all; default: período recente confiável). Para um provedor JÁ conhecido, '
      + 'filtre direto no generate_delivery_report (filters.provider) ou search_shippings (provider).',
    inputSchema: {
      type: 'object',
      properties: {
        date_range: { type: 'string' },
        date_from: { type: 'string' },
        date_to: { type: 'string' },
      },
    },
  },
  {
    name: 'list_customers',
    description: 'Lista os clientes com ATIVIDADE numa janela (date_from/date_to ISO 8601 ou '
      + 'date_range 24h/7d/30d/all; default: período recente confiável). Ex.: "quais clientes enviaram '
      + 'nas últimas 24h". Filtro textual opcional (search). Para o status de um cliente JÁ conhecido, '
      + 'prefira generate_delivery_report (filters.customer_id).',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string' },
        date_range: { type: 'string' },
        date_from: { type: 'string' },
        date_to: { type: 'string' },
      },
    },
  },
  {
    name: 'list_incidents',
    description: 'Lista incidentes de anomalia. Filtros opcionais (CSV): status '
      + '(detected|acknowledged|resolved|auto_resolved; use "open" para os ainda ABERTOS = '
      + 'detected+acknowledged), severity (critical|warning|info), dimension '
      + '(provider|customer|route|global). Paginação (page/limit).',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string' },
        severity: { type: 'string' },
        dimension: { type: 'string' },
        page: { type: 'number' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'get_incident',
    description: 'Retorna um incidente e suas atividades pelo id. Os horários já vêm NO FUSO DO '
      + 'OPERADOR (cite-os como estão; nunca some/subtraia horas). Para gerar um relatório da JANELA '
      + 'do incidente, passe `window_from`/`window_to` DIRETO como date_from/date_to do '
      + 'generate_delivery_report (já estão no fuso, sem `Z`).',
    inputSchema: {
      type: 'object',
      properties: { incident_id: { type: 'string' } },
      required: ['incident_id'],
    },
  },
  {
    name: 'generate_incident_report',
    description: 'Gera relatório de incidentes resolvidos por janela (total, por severidade e a lista).',
    inputSchema: {
      type: 'object',
      properties: {
        date_range: { type: 'string' },
        filters: { type: 'object' },
      },
    },
  },
];

/**
 * Extrai `{ code, message }` úteis de um erro de tool. Surfacia o `{ error: { code, message } }`
 * das `HttpException` de domínio (ex.: `window_required`) — assim o LLM vê a mensagem real (e age,
 * ex.: pede a janela ao usuário) em vez do genérico "Bad Request Exception".
 *
 * @param {unknown} err - Erro lançado pela execução da tool.
 * @returns {{ code: string; message: string }} Código e mensagem para o `tool_result` de erro.
 */
function toolError(err: unknown): {
  code: string;
  message: string;
} {
  if (err instanceof HttpException) {
    const response = err.getResponse();

    if (
      response
      && typeof response === 'object'
      && 'error' in response
    ) {
      const detail = (response as {
        error?: {
          code?: string;
          message?: string
        }
      }).error;

      if (detail?.message) {
        return {
          code: detail.code ?? 'tool_error',
          message: detail.message,
        };
      }
    }
  }

  return {
    code: 'tool_error',
    message: (err as Error).message,
  };
}

/**
 * Barra o erro inverso ao do {@link UUID_PATTERN}: um shipping_id (hash de 32 hex SEM hífens) passado
 * como `campaign_id` no search_shippings — como campaign_id é um UUID, a busca não acharia nada.
 * Orienta o modelo a abrir a trilha DIRETO em vez de buscar por campaign_id.
 *
 * @param {Record<string, unknown>} args - Args crus da tool search_shippings.
 * @throws {BadRequestException} Se `campaign_id` tiver formato de shipping_id (hash 32 hex).
 */
function assertCampaignIdNotShippingId(args: Record<string, unknown>): void {
  const campaignId = typeof args.campaign_id === 'string'
    ? args.campaign_id
    : '';

  if (
    !campaignId
    || !SHIPPING_ID_PATTERN.test(campaignId)
    || UUID_PATTERN.test(campaignId)
  ) {
    return;
  }

  throw new BadRequestException({
    error: {
      code: 'looks_like_shipping_id',
      message: 'Esse id é um HASH de 32 hex (sem hífens) — é um shipping_id (id de UM envio), '
        + 'NÃO um campaign_id (que é um UUID, com hífens). Para ver a TRILHA/eventos desse '
        + 'envio, chame get_shipping_trail com esse shipping_id e a janela de data que você já '
        + 'tem (não faça um search por campaign_id).',
    },
  });
}

/**
 * Resolve a janela (`date_from`/`date_to` ISO ou `date_range`) dos args crus de uma tool em uma
 * {@link AuditWindowInterface}, ou `undefined` se nenhum limite veio (o motor cai na janela default).
 * Usada pelo `get_shipping_trail`. Delega ao {@link resolveWindow} (a MESMA fonte da busca/relatório):
 * datas só-dia são interpretadas no fuso do operador (`date_to` cobre o dia inteiro) e `date_range`
 * é suportado — sem isso, a trilha-direta por data cortaria envios do fim do dia (data crua = UTC).
 *
 * @param {Record<string, unknown>} args - Args crus da tool (vindos do modelo).
 * @returns {AuditWindowInterface | undefined} Janela resolvida, ou `undefined`.
 */
function windowFromArgs(args: Record<string, unknown>): AuditWindowInterface | undefined {
  return resolveWindow({
    date_from: typeof args.date_from === 'string'
      ? args.date_from
      : undefined,
    date_to: typeof args.date_to === 'string'
      ? args.date_to
      : undefined,
    date_range: typeof args.date_range === 'string'
      ? args.date_range
      : undefined,
  });
}

/**
 * Converte os horários de um incidente (canônicos em UTC na API/banco) para o fuso do operador ANTES
 * de entregar ao LLM — assim ele NUNCA cita UTC cru (era a fonte da "alucinação" de horário):
 * - `detected_at` e `activities[].at` → rótulo legível no fuso (exibição);
 * - `window` → rótulo legível no fuso, derivado dos limites (sobrepõe o rótulo antigo em UTC);
 * - `window_from`/`window_to` → datetime naive no fuso (sem `Z`): o LLM cita em BRT E repassa direto
 *   ao `generate_delivery_report`, onde naive é reinterpretado no fuso → mesma janela UTC (sem shift).
 *
 * @param {Awaited<ReturnType<IncidentsService['get']>>} detail - Incidente + atividades (UTC).
 * @returns {Record<string, unknown>} Incidente com horários no fuso do operador (para o LLM).
 */
function incidentForOperator(
  detail: Awaited<ReturnType<IncidentsService['get']>>,
): Record<string, unknown> {
  const timeZone = appTimeZone();

  const window = detail.window_from && detail.window_to
    ? `${formatInstantInTz(
      detail.window_from,
      timeZone,
    )} → ${formatInstantInTz(
      detail.window_to,
      timeZone,
    )}`
    : detail.window;

  return {
    ...detail,
    detected_at: formatInstantInTz(
      detail.detected_at,
      timeZone,
    ),
    window,
    window_from: detail.window_from
      ? toNaiveDatetimeInTz(
        detail.window_from,
        timeZone,
      )
      : null,
    window_to: detail.window_to
      ? toNaiveDatetimeInTz(
        detail.window_to,
        timeZone,
      )
      : null,
    activities: detail.activities.map((activity) => ({
      ...activity,
      at: formatInstantInTz(
        activity.at,
        timeZone,
      ),
    })),
  };
}

/**
 * Converte os horários dos eventos da trilha (canônicos em UTC) para o fuso do operador ANTES de
 * entregar ao LLM — senão ele cita a hora do `Z` cru (era a "alucinação" de horário: card em BRT,
 * texto em UTC). Usa naive COM SEGUNDOS (`toNaiveDatetimeInTz`, não `formatInstantInTz`): o card ainda
 * parseia o `at` para calcular a DURAÇÃO e o formatador do web é naive-aware (exibe sem deslocar).
 *
 * @param {ShippingTrailInterface | null} trail - Trilha do {@link ShippingsService.getTrail} (ou `null`).
 * @returns {ShippingTrailInterface | null} Trilha com `events[].at` no fuso do operador (naive), ou `null`.
 */
function trailForOperator(trail: ShippingTrailInterface | null): ShippingTrailInterface | null {
  if (!trail) {
    return trail;
  }

  const timeZone = appTimeZone();

  return {
    ...trail,
    events: trail.events.map((event) => ({
      ...event,
      at: toNaiveDatetimeInTz(
        event.at,
        timeZone,
      ),
    })),
  };
}

/**
 * Converte `requested_at`/`finalized_at` das linhas da busca para o fuso do operador (naive, sem `Z`)
 * ANTES de entregar ao LLM — senão a prosa cita a hora do `Z` cru (mesma "alucinação" da trilha). O
 * card é naive-aware (exibe sem deslocar) e `dayWindow` usa só o prefixo `YYYY-MM-DD` (= dia BRT).
 *
 * @param {Awaited<ReturnType<ShippingsService['search']>>} page - Página da busca (linhas + agregados).
 * @returns {Awaited<ReturnType<ShippingsService['search']>>} Página com datas das linhas no fuso do operador.
 */
function searchForOperator(
  page: Awaited<ReturnType<ShippingsService['search']>>,
): Awaited<ReturnType<ShippingsService['search']>> {
  const timeZone = appTimeZone();

  return {
    ...page,
    rows: page.rows.map((row) => ({
      ...row,
      requested_at: toNaiveDatetimeInTz(
        row.requested_at,
        timeZone,
      ),
      finalized_at: row.finalized_at
        ? toNaiveDatetimeInTz(
          row.finalized_at,
          timeZone,
        )
        : row.finalized_at,
    })),
  };
}

/**
 * Traduz os códigos de `top_errors` do relatório para rótulos PT-BR ANTES de entregar ao LLM, para a
 * prosa citar "erro genérico" em vez de "generic_error" (o card já traduz na exibição; aqui é para o
 * TEXTO do assistente não vazar o código cru). Demais campos do relatório intactos.
 *
 * @param {Awaited<ReturnType<ReportsService['generateDelivery']>>} report - Relatório de entregabilidade.
 * @returns {Awaited<ReturnType<ReportsService['generateDelivery']>>} Relatório com `top_errors.code` legível.
 */
function reportWithReadableErrors(
  report: Awaited<ReturnType<ReportsService['generateDelivery']>>,
): Awaited<ReturnType<ReportsService['generateDelivery']>> {
  return {
    ...report,
    top_errors: report.top_errors.map((error) => ({
      ...error,
      code: categoryLabel(error.code),
    })),
  };
}

/**
 * Converte o `at` dos buckets horários do relatório para o fuso do operador (naive, sem `Z`) ANTES de
 * entregar ao LLM — senão a prosa cita o pico/vale na hora do `Z` cru (mesma "alucinação" da trilha/
 * busca). O card é naive-aware (HourlyChart formata sem deslocar; posiciona por índice, não por `at`).
 *
 * @param {Awaited<ReturnType<ReportsService['generateDelivery']>>} report - Relatório de entregabilidade.
 * @returns {Awaited<ReturnType<ReportsService['generateDelivery']>>} Relatório com `hourly[].at` no fuso do operador.
 */
function reportForOperator(
  report: Awaited<ReturnType<ReportsService['generateDelivery']>>,
): Awaited<ReturnType<ReportsService['generateDelivery']>> {
  const timeZone = appTimeZone();

  return {
    ...report,
    hourly: report.hourly.map((bucket) => ({
      ...bucket,
      at: toNaiveDatetimeInTz(
        bucket.at,
        timeZone,
      ),
    })),
  };
}

/**
 * Ponte entre o callback de progresso (síncrono, push) do motor e o async generator do SSE.
 * O motor empilha eventos via {@link push}; o orquestrador os drena com `for await (… of drain())`,
 * que encerra quando {@link close} é chamado (no fim da tool). Sem perda de eventos nem espera ativa.
 *
 * @template T - Tipo do item de progresso transportado.
 */
class ProgressChannel<T> {
  private readonly buffer: T[] = [];

  private resolveNext: (() => void) | null = null;

  private closed = false;

  /** Empilha um item e acorda quem estiver drenando. */
  push(item: T): void {
    this.buffer.push(item);
    this.wake();
  }

  /** Sinaliza o fim do fluxo — faz o `drain` retornar após esvaziar o buffer. */
  close(): void {
    this.closed = true;
    this.wake();
  }

  /** Drena os itens na ordem de chegada; retorna quando o canal é fechado e esvaziado. */
  async *drain(): AsyncGenerator<T> {
    for (;;) {
      while (this.buffer.length > 0) {
        yield this.buffer.shift() as T;
      }

      if (this.closed) {
        return;
      }

      await new Promise<void>((resolve) => {
        this.resolveNext = resolve;
      });
    }
  }

  /** Acorda o consumidor pendente (se houver). */
  private wake(): void {
    const resolve = this.resolveNext;
    this.resolveNext = null;
    resolve?.();
  }
}

/** Capitaliza a primeira letra (resto intacto). */
function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Título heurístico (fallback do auto-título): primeiras palavras da pergunta do usuário.
 *
 * @param {string} userText - Primeira mensagem do usuário.
 * @returns {string} Título curto (≤8 palavras, ≤60 chars).
 */
function heuristicTitle(userText: string): string {
  const words = userText
    .trim()
    .replace(
      /\s+/g,
      ' ',
    )
    .split(' ')
    .slice(
      0,
      8,
    )
    .join(' ');

  const trimmed = words.slice(
    0,
    60,
  ).trim();

  return trimmed.length > 0
    ? capitalize(trimmed)
    : 'Nova conversa';
}

/** Aspas removidas no início do título gerado pelo LLM. */
const LEADING_TRIM_CHARS = new Set([
  '"',
  "'",
  '“',
  '”',
]);

/** Aspas e ponto final removidos no fim do título gerado pelo LLM. */
const TRAILING_TRIM_CHARS = new Set([
  '"',
  "'",
  '“',
  '”',
  '.',
]);

/**
 * Normaliza a saída do LLM em um título: pega a 1ª linha, remove aspas/ponto final das pontas e
 * limita a 80 chars. Trim por conjunto de caracteres (sem regex) — determinístico e O(n).
 *
 * @param {string} raw - Texto bruto devolvido pelo modelo.
 * @returns {string} Título limpo (pode ser vazio se o modelo não produziu nada útil).
 */
function cleanTitle(raw: string): string {
  const firstLine = raw.trim().split('\n')[0] ?? '';

  let start = 0;
  let end = firstLine.length;

  while (
    start < end
    && LEADING_TRIM_CHARS.has(firstLine[start])
  ) {
    start += 1;
  }

  while (
    end > start
    && TRAILING_TRIM_CHARS.has(firstLine[end - 1])
  ) {
    end -= 1;
  }

  return firstLine
    .slice(
      start,
      end,
    )
    .slice(
      0,
      80,
    )
    .trim();
}

/**
 * Orquestrador do chat (Fase 1, task 2.9): conduz o turno do LLM e faz o tool
 * routing server-side, emitindo eventos SSE.
 *
 * Loop por turno: pede ao {@link LlmProviderInterface} um `converseStream`; ao
 * receber `tool_use`, a APLICAÇÃO executa a tool (a IA nunca toca o banco —
 * princípio 1) e devolve o resultado como mensagem `tool` no próximo turno; ao
 * `end_turn`, finaliza com o texto; ao `refusal`, recusa (princípio 2: não
 * fabricar dados). Cada tool executada é auditada (`tool_call`).
 *
 * @see ChatService - persistência das mensagens (user/assistant).
 * @see AuditService - auditoria das tools executadas.
 */
@Injectable()
export class OrchestratorService {
  /**
   * @param {LlmProviderInterface} llm - Provider LLM selecionado (fake em dev | bedrock em prod).
   * @param {ChatService} chat - Persistência/leitura de mensagens da sessão.
   * @param {ShippingsService} shippings - Tools `search_shippings` / `get_shipping_trail`.
   * @param {AnalysisService} analysis - Tool `analyze_shipping_content`.
   * @param {ReportsService} reports - Tools `generate_delivery_report` / `generate_incident_report`.
   * @param {CatalogService} catalog - Tools `list_providers` / `list_customers`.
   * @param {IncidentsService} incidents - Tools `list_incidents` / `get_incident`.
   * @param {AuditService} audit - Auditoria das tools executadas pelo orquestrador.
   */
  constructor(
    @Inject(LLM_PROVIDER) private readonly llm: LlmProviderInterface,
    private readonly chat: ChatService,
    private readonly shippings: ShippingsService,
    private readonly analysis: AnalysisService,
    private readonly reports: ReportsService,
    private readonly catalog: CatalogService,
    private readonly incidents: IncidentsService,
    private readonly audit: AuditService,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  /**
   * Conduz a resposta a uma mensagem do usuário, emitindo eventos de stream.
   *
   * Persiste a mensagem do usuário, roda o loop de tools e persiste a resposta
   * (ou a recusa) do assistente. Os eventos seguem o contrato §B: `tool_call` →
   * (`tool_progress`*) → `tool_result` → `text_delta` → `done`, ou `refusal`.
   * O `tool_progress` (0..N) reporta as etapas da varredura no S3 entre `tool_call` e `tool_result`.
   *
   * @param {string} sessionId - Id da sessão (já validada como existente).
   * @param {string} userText - Texto enviado pelo usuário.
   * @returns {AsyncGenerator<ChatStreamEvent>} Sequência de eventos de stream.
   */
  async *run(
    sessionId: string,
    userText: string,
    userId: string = STUB_USER_ID,
  ): AsyncGenerator<ChatStreamEvent> {
    const history = await this.chat.getMessages(
      sessionId,
      userId,
    );

    // 1ª troca da sessão → ao final, gera um título automático (baseado no contexto) e o devolve no `done`.
    const isFirstTurn = history.length === 0;

    await this.chat.appendMessage(
      sessionId,
      'user',
      { text: userText },
    );

    const convo: LlmMessageInterface[] = [
      ...historyToConvo(history),
      {
        role: 'user',
        content: userText,
      },
    ];

    const toolsUsed: ChatToolInvocationInterface[] = [];
    // Ids (campaign_id/shipping_id) cuja busca/trilha foi pedida SEM janela e SEM histórico p/ injetar
    // NESTE turno → o motor recusa e PEDE a data; uma 2ª tentativa com data (necessariamente um chute
    // do modelo, pois não houve nova mensagem do usuário) é bloqueada também — evita scan desperdiçado.
    const pendingWindowIds = new Set<string>();
    const thinkingSplitter = new ThinkingSplitter();
    let finalText = '';
    let inputTokens = 0;
    let outputTokens = 0;

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      let stopReason: LlmStopInterface['reason'] | null = null;
      const toolMessages: LlmMessageInterface[] = [];

      const stream = withIdleTimeout(
        this.llm.converseStream({
          system: buildSystemPrompt(new Date()),
          messages: convo,
          tools: TOOL_SPECS,
        }),
        LLM_STREAM_IDLE_TIMEOUT_MS,
        'converseStream',
      );

      for await (const chunk of stream) {
        if (chunk.type === 'text_delta') {
          finalText += yield* this.emitSplit(thinkingSplitter.push(chunk.delta));
        } else if (chunk.type === 'tool_use') {
          yield* this.handleToolUse(
            chunk,
            convo,
            toolsUsed,
            toolMessages,
            userId,
            sessionId,
            pendingWindowIds,
          );
        } else if (chunk.type === 'usage') {
          inputTokens += chunk.inputTokens;
          outputTokens += chunk.outputTokens;
        } else {
          stopReason = chunk.reason;
        }
      }

      if (stopReason === 'refusal') {
        const refusal = this.buildRefusal();

        await this.chat.appendMessage(
          sessionId,
          'assistant',
          this.withUsage(
            {
              text: '',
              refusal,
              // Persiste as tools JÁ executadas (e auditadas) neste turno antes do guardrail — sem
              // isso a recusa apagaria do histórico o que de fato rodou.
              tools: toolsUsed,
            },
            inputTokens,
            outputTokens,
          ),
        );

        this.metrics?.increment(
          'chat.refusals',
          { reason: refusal.reason },
        );

        yield {
          event: 'refusal',
          data: refusal,
        };

        return;
      }

      if (toolMessages.length > 0) {
        convo.push(...toolMessages);

        continue; // próximo turno: o modelo produz o texto final com os resultados
      }

      break; // end_turn
    }

    // Esvazia o buffer do splitter (raciocínio/resposta remanescentes ao fim do stream).
    finalText += yield* this.emitSplit(thinkingSplitter.flush());

    // Fallback p/ resposta vazia (só <thinking>, ou MAX_TURNS esgotado em tool-use) → evita balão vazio.
    finalText = yield* this.emitFallbackIfEmpty(finalText);

    const messageId = await this.chat.appendMessage(
      sessionId,
      'assistant',
      this.withUsage(
        {
          text: finalText,
          tools: toolsUsed,
        },
        inputTokens,
        outputTokens,
      ),
    );

    if (inputTokens + outputTokens > 0) {
      this.metrics?.histogram(
        'llm.tokens',
        inputTokens + outputTokens,
      );
    }

    // Auto-título na 1ª troca: gera (LLM, com fallback heurístico) e persiste; segue no `done`.
    let sessionTitle: string | undefined;

    if (isFirstTurn) {
      sessionTitle = await this.generateTitle(
        userText,
        finalText,
      );

      await this.chat.updateSession(
        sessionId,
        userId,
        { title: sessionTitle },
      );
    }

    yield {
      event: 'done',
      data: {
        message_id: messageId,
        refusal: null,
        session_title: sessionTitle,
      },
    };
  }

  /**
   * Gera um título curto (≤6 palavras) para a sessão a partir da 1ª troca, via LLM (sem tools).
   * Em caso de erro/saída vazia, cai numa heurística sobre a pergunta do usuário.
   *
   * @param {string} userText - Primeira mensagem do usuário.
   * @param {string} assistantText - Resposta final do assistente (contexto extra).
   * @returns {Promise<string>} Título conciso (≤80 chars).
   */
  private async generateTitle(
    userText: string,
    assistantText: string,
  ): Promise<string> {
    const fallback = heuristicTitle(userText);

    try {
      const stream = withIdleTimeout(
        this.llm.converseStream({
          system: 'Você nomeia conversas de uma ferramenta interna de suporte a entregas de SMS. '
            + 'Responda APENAS com um título curto em português (no máximo 6 palavras, sem aspas, '
            + 'sem ponto final) que resuma o tema da conversa.',
          messages: [{
            role: 'user',
            content: `Pergunta do analista: "${userText}"\n\nResumo da resposta: "${assistantText.slice(
              0,
              400,
            )}"`,
          }],
          tools: [],
        }),
        LLM_STREAM_IDLE_TIMEOUT_MS,
        'titleStream',
      );

      let text = '';

      for await (const chunk of stream) {
        if (chunk.type === 'text_delta') {
          text += chunk.delta;
        }
      }

      return cleanTitle(text) || fallback;
    } catch {
      return fallback;
    }
  }

  /**
   * Emite os eventos SSE de um resultado do {@link ThinkingSplitter}: `thinking_delta` para o
   * raciocínio (exibido à parte, efêmero) e `text_delta` para a resposta. Devolve a porção de
   * RESPOSTA para o chamador acumular em `finalText`. Extraído de {@link run} para manter a
   * complexidade cognitiva baixa.
   *
   * @param {ThinkingSplitResultInterface} split - Porções classificadas (raciocínio / resposta).
   * @returns {Generator<ChatStreamEvent, string>} Eventos a emitir; retorna o texto da resposta.
   */
  private *emitSplit(split: ThinkingSplitResultInterface): Generator<ChatStreamEvent, string> {
    if (split.thinking) {
      yield {
        event: 'thinking_delta',
        data: { delta: split.thinking },
      };
    }

    if (split.text) {
      yield {
        event: 'text_delta',
        data: { delta: split.text },
      };
    }

    return split.text;
  }

  /**
   * Garante uma resposta visível quando o stream encerra sem texto (só `<thinking>`, ou MAX_TURNS
   * esgotado ainda pedindo tools): emite um `text_delta` de fallback e o devolve; senão devolve o
   * texto original. Extraído do laço principal para manter a complexidade do `run` dentro do limite.
   *
   * @param {string} finalText - Texto acumulado do turno final.
   * @returns {Generator<ChatStreamEvent, string>} Texto efetivo (original, ou o fallback).
   */
  private *emitFallbackIfEmpty(finalText: string): Generator<ChatStreamEvent, string> {
    if (finalText.trim() !== '') {
      return finalText;
    }

    yield {
      event: 'text_delta',
      data: { delta: EMPTY_RESPONSE_FALLBACK },
    };

    return EMPTY_RESPONSE_FALLBACK;
  }

  /**
   * Executa uma tool pedida pelo modelo e emite os eventos SSE do ciclo (`tool_call` →
   * `tool_progress`* → `tool_result`), drenando o progresso da varredura no S3. Acumula o
   * resultado em `convo`/`toolsUsed`/`toolMessages` (mutados por referência) para o próximo turno.
   * Extraído de {@link run} para manter cada um sob o limite de complexidade cognitiva.
   *
   * @param {LlmToolUseInterface} chunk - Pedido de tool do modelo (nome, args, id).
   * @param {LlmMessageInterface[]} convo - Conversa acumulada (recebe o bloco `tool_use` do assistente).
   * @param {ChatToolInvocationInterface[]} toolsUsed - Tools já invocadas no turno (para persistir).
   * @param {LlmMessageInterface[]} toolMessages - Resultados de tool a anexar à conversa do próximo turno.
   * @returns {AsyncGenerator<ChatStreamEvent>} Eventos SSE do ciclo da tool.
   */
  private async *handleToolUse(
    chunk: LlmToolUseInterface,
    convo: LlmMessageInterface[],
    toolsUsed: ChatToolInvocationInterface[],
    toolMessages: LlmMessageInterface[],
    userId: string,
    sessionId: string,
    pendingWindowIds: Set<string>,
  ): AsyncGenerator<ChatStreamEvent> {
    // Reuso determinístico da janela: o modelo às vezes pede os envios de uma campanha (campaign_id) ou
    // a trilha de um envio (shipping_id) vindos de uma busca anterior SEM repassar a data — o guard
    // recusaria e o modelo tende a errar (conclui "sem resultados" ou ignora). Se há a janela de um
    // search anterior no convo/turno, injeta-a aqui (cobre search_shippings e get_shipping_trail).
    const args = injectReusedWindow(
      chunk,
      [
        ...convo,
        ...toolMessages,
      ],
    );

    // Sem janela do usuário e sem histórico p/ injetar → NÃO escaneia (~30 dias à toa): pede a data.
    // Determinístico (o modelo não adere ao prompt: chuta uma data e escaneia). Bloqueia também a
    // re-tentativa com data adivinhada NESTE turno (ver pendingWindowIds) — sem gastar processamento.
    const clarification = windowClarification(
      chunk,
      args,
      pendingWindowIds,
    );

    if (clarification) {
      yield {
        event: 'tool_call',
        data: {
          name: chunk.name,
          args,
          status: 'running',
        },
      };

      yield {
        event: 'tool_result',
        data: {
          name: chunk.name,
          status: 'error',
          result: clarification,
          duration_ms: 0,
        },
      };

      toolsUsed.push({
        name: chunk.name,
        args,
        status: 'error',
        result: clarification,
      });

      convo.push({
        role: 'assistant',
        content: {
          tool_use: {
            id: chunk.id,
            name: chunk.name,
            args,
          },
        },
      });

      toolMessages.push({
        role: 'tool',
        content: {
          id: chunk.id,
          name: chunk.name,
          result: clarification,
        },
      });

      return;
    }

    yield {
      event: 'tool_call',
      data: {
        name: chunk.name,
        args,
        status: 'running',
      },
    };

    // Ponte progresso→SSE: o motor empilha etapas no canal; drenamos e damos `yield`
    // de `tool_progress` até a tool concluir (o `finally` fecha o canal e encerra o drain).
    const channel = new ProgressChannel<AuditProgressEventInterface>();

    const pending = this.runTool(
      chunk.name,
      args,
      userId,
      (progress) => channel.push(progress),
    ).finally(() => channel.close());

    for await (const progress of channel.drain()) {
      yield {
        event: 'tool_progress',
        data: {
          name: chunk.name,
          phase: progress.phase,
          label: progress.label,
          current: progress.current,
          total: progress.total,
        },
      };
    }

    const {
      status,
      result,
      durationMs,
    } = await pending;

    // Vincula a sessão ao incidente quando a tool referenciou um (ex.: get_incident no fluxo
    // "Investigar") — many-to-many, idempotente, best-effort (não bloqueia o stream).
    if (
      status === 'success'
      && typeof args.incident_id === 'string'
    ) {
      this.chat.linkIncident(
        sessionId,
        args.incident_id,
      ).catch(() => undefined);
    }

    yield {
      event: 'tool_result',
      data: {
        name: chunk.name,
        status,
        result,
        duration_ms: durationMs,
      },
    };

    toolsUsed.push({
      name: chunk.name,
      args: args,
      status,
      result,
    });

    convo.push({
      role: 'assistant',
      content: {
        tool_use: {
          id: chunk.id,
          name: chunk.name,
          args: args,
        },
      },
    });

    toolMessages.push({
      role: 'tool',
      content: {
        id: chunk.id,
        name: chunk.name,
        // O modelo recebe o resultado SEM a paginação fantasma (ver toolResultForLlm); o card (SSE,
        // acima) e o histórico (toolsUsed) ficam com o envelope cheio.
        result: toolResultForLlm(
          chunk.name,
          result,
        ),
      },
    });
  }

  /**
   * Anexa `usage` (tokens de entrada/saída) ao conteúdo da mensagem, quando houve consumo.
   *
   * @param {ChatMessageContentInterface} content - Conteúdo base da mensagem do assistente.
   * @param {number} inputTokens - Tokens de entrada acumulados no turno.
   * @param {number} outputTokens - Tokens de saída acumulados no turno.
   *
   * @returns {ChatMessageContentInterface} Conteúdo com `usage` (ou inalterado se sem consumo).
   */
  private withUsage(
    content: ChatMessageContentInterface,
    inputTokens: number,
    outputTokens: number,
  ): ChatMessageContentInterface {
    if (inputTokens + outputTokens <= 0) {
      return content;
    }

    return {
      ...content,
      usage: {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
      },
    };
  }

  /**
   * Executa uma tool server-side com auditoria, capturando erros.
   *
   * @param {ToolNameType} name - Nome da tool pedida pelo modelo.
   * @param {Record<string, unknown>} args - Argumentos pedidos pelo modelo.
   * @param {AuditProgressCallback} [onProgress] - Callback de andamento (repassado às tools de auditoria).
   * @returns {Promise<{ status; result; durationMs }>} Status, resultado e duração total da tool.
   */
  private async runTool(
    name: ToolNameType,
    args: Record<string, unknown>,
    userId: string,
    onProgress?: AuditProgressCallback,
  ): Promise<{
    status: 'success' | 'error';
    result: unknown;
    durationMs: number;
  }> {
    const startedAt = Date.now();

    try {
      const result = await tracer.trace(
        'atena.tool',
        { resource: name },
        () => this.execute(
          name,
          args,
          onProgress,
        ),
      );

      const latencyMs = Date.now() - startedAt;

      logger.log(`tool=${name} status=success ${latencyMs}ms`);

      await this.audit.record({
        action: 'tool_call',
        resource: `orchestrator:${name}`,
        severity: 'info',
        userId,
        metadata: { latency_ms: latencyMs },
      });

      this.metrics?.increment(
        'tool.calls',
        { tool: name },
      );

      this.metrics?.histogram(
        'tool.latency_ms',
        latencyMs,
        { tool: name },
      );

      return {
        status: 'success',
        result,
        durationMs: latencyMs,
      };
    } catch (err) {
      const latencyMs = Date.now() - startedAt;

      logger.warn(`tool=${name} status=error ${latencyMs}ms`);

      await this.audit.record({
        action: 'tool_call',
        resource: `orchestrator:${name}`,
        severity: 'warning',
        userId,
        detail: 'tool_error',
        metadata: { latency_ms: latencyMs },
      });

      this.metrics?.increment(
        'tool.calls',
        { tool: name },
      );

      this.metrics?.increment(
        'tool.errors',
        { tool: name },
      );

      this.metrics?.histogram(
        'tool.latency_ms',
        latencyMs,
        { tool: name },
      );

      return {
        status: 'error',
        result: { error: toolError(err) },
        durationMs: latencyMs,
      };
    }
  }

  /**
   * Roteia o `search_shippings`: por `incident_id` (mensagens exatas do incidente) ou busca normal por
   * filtros/janela. Mantém o {@link execute} simples (uma linha) e a guarda de id no mesmo lugar.
   *
   * @param {Record<string, unknown>} args - Args da tool.
   * @param {AuditProgressCallback} [onProgress] - Callback de andamento (só a busca normal usa).
   * @returns {Promise<Awaited<ReturnType<ShippingsService['search']>>>} Envelope da busca.
   */
  private runSearch(
    args: Record<string, unknown>,
    onProgress?: AuditProgressCallback,
  ): Promise<Awaited<ReturnType<ShippingsService['search']>>> {
    assertCampaignIdNotShippingId(args);

    const incidentId = typeof args.incident_id === 'string'
      ? args.incident_id
      : '';

    // incident_id → mensagens EXATAS do incidente (byIds), pra a contagem bater com o card; senão,
    // busca normal por filtros/janela.
    return incidentId
      ? this.searchIncidentShippings(
        incidentId,
        args,
      )
      : this.shippings.search(
        args,
        onProgress,
      );
  }

  /**
   * Busca escopada por INCIDENTE (`search_shippings` com incident_id): devolve EXATAMENTE os envios
   * impactados que o detector persistiu (via {@link IncidentsService.shippings} → byIds), no envelope da
   * busca, pra a contagem do chat bater com o card do incidente (e com o GET /incidents/:id/shippings).
   * `total` = total impactado; `breakdown` é sobre as linhas trazidas (exato quando todas cabem no limite).
   *
   * @param {string} incidentId - UUID do incidente.
   * @param {Record<string, unknown>} args - Args da tool (usa `limit`).
   * @returns {Promise<Awaited<ReturnType<ShippingsService['search']>>>} Envelope de busca dos impactados.
   */
  private async searchIncidentShippings(
    incidentId: string,
    args: Record<string, unknown>,
  ): Promise<Awaited<ReturnType<ShippingsService['search']>>> {
    const startedAt = Date.now();

    const limit = typeof args.limit === 'number'
      ? args.limit
      : INCIDENT_SEARCH_LIMIT;

    const result = await this.incidents.shippings(
      incidentId,
      limit,
    );

    const breakdown = {
      delivered: 0,
      failed: 0,
      pending: 0,
    };

    for (const row of result.rows) {
      if (row.status === 'delivered') {
        breakdown.delivered += 1;
      }
      else if (row.status === 'failed') {
        breakdown.failed += 1;
      }
      else if (row.status === 'pending') {
        breakdown.pending += 1;
      }
    }

    return {
      rows: result.rows,
      total: result.total,
      page: 1,
      total_pages: 1,
      latency_ms: Date.now() - startedAt,
      date_from: null,
      date_to: new Date(startedAt).toISOString(),
      breakdown,
    };
  }

  /**
   * Roteia o nome da tool para o serviço correspondente (a aplicação executa, não a IA).
   *
   * @param {ToolNameType} name - Nome da tool.
   * @param {Record<string, unknown>} args - Argumentos da tool.
   * @param {AuditProgressCallback} [onProgress] - Callback de andamento (só as tools que varrem o S3 usam).
   * @returns {Promise<unknown>} Resultado da tool (shape conforme §C).
   * @throws {Error} Se a tool for desconhecida ou os argumentos forem inválidos.
   */
  private execute(
    name: ToolNameType,
    args: Record<string, unknown>,
    onProgress?: AuditProgressCallback,
  ): Promise<unknown> {
    switch (name) {
      case 'search_shippings':
        return this.runSearch(
          args,
          onProgress,
        ).then(searchForOperator);

      case 'get_shipping_trail': {
        const id = typeof args.shipping_id === 'string'
          ? args.shipping_id
          : '';

        if (!id) {
          throw new Error('shipping_id é obrigatório');
        }

        if (UUID_PATTERN.test(id)) {
          throw new BadRequestException({
            error: {
              code: 'looks_like_campaign_id',
              message: 'Esse id tem formato de UUID — é o campaign_id (id da campanha), '
                + 'NÃO um shipping_id. A trilha é de UM envio. Para investigar um '
                + 'envio, chame search_shippings com campaign_id e uma janela de data (se o usuário não '
                + 'informou QUANDO o envio ocorreu, PERGUNTE a data aproximada antes); o shipping_id da '
                + 'trilha é o id (hash) de uma LINHA desse resultado.',
            },
          });
        }

        const window = windowFromArgs(args);

        // Sem data, getTrail cai na janela default (~30 dias) e o materialize varre tudo (lento, ~min).
        // Exige a data aproximada (como a busca por campaign_id) → varredura estreita e rápida. Quando o
        // id veio de um search, o modelo reaproveita a MESMA janela e isto nem dispara.
        if (!window) {
          throw new BadRequestException({
            error: {
              code: 'trail_window_required',
              message: 'Para abrir a trilha preciso da DATA aproximada do envio (pode ser só o dia). Sem '
                + 'ela a varredura cai no padrão de ~30 dias e fica lenta. Pergunte ao usuário QUANDO o '
                + 'envio ocorreu e repasse em date_from/date_to (ou date_range); se a trilha veio de um '
                + 'search, use date_from=date_to = o DIA do envio daquela linha (o `requested_at`/"Enviado" '
                + 'do resultado), NÃO a janela ampla da busca — assim a trilha varre só aquele dia.',
            },
          });
        }

        return this.shippings.getTrail(
          id,
          window,
          onProgress,
        ).then(trailForOperator);
      }

      case 'analyze_shipping_content':
        return this.analysis.analyze(args);
      case 'generate_delivery_report':
        return this.reports.generateDelivery(
          args as DeliveryReportDto,
          onProgress,
        ).then(reportWithReadableErrors).then(reportForOperator);
      // Embrulha a lista com a `window` usada → o assistente deixa EXPLÍCito de que período é a
      // lista (sem isso, "clientes/provedores ativos" não diz a janela). Objeto (não array) também
      // satisfaz o Converse do Bedrock, que rejeita array no topo do toolResult.
      case 'list_providers':
        return this.catalog.listProviders(args as CatalogQueryDto).then((providers) => ({
          window: this.catalog.windowLabel(args as CatalogQueryDto),
          providers,
        }));
      case 'list_customers':
        return this.catalog.listCustomers(args as CatalogQueryDto).then((result) => ({
          window: this.catalog.windowLabel(args as CatalogQueryDto),
          customers: result.items,
          // `total` distinto na janela; `customers` traz só os top-N (mais ativos). O assistente cita
          // "N clientes; os mais ativos: …" em vez de despejar a lista inteira.
          total: result.total,
        }));

      case 'list_incidents':
        return this.incidents.list(args);

      case 'get_incident': {
        const incidentId = typeof args.incident_id === 'string'
          ? args.incident_id
          : '';

        if (!incidentId) {
          throw new Error('incident_id é obrigatório');
        }

        return this.incidents.get(incidentId).then(incidentForOperator);
      }

      case 'generate_incident_report':
        return this.reports.generateIncident(args);
      default:
        throw new Error(`Tool desconhecida: ${name}`);
    }
  }

  /**
   * Monta a recusa estruturada (pedido fora de escopo / sem tool aplicável).
   *
   * @returns {{ reason: string; explanation: string; can_do: string[] }} Recusa com alternativas possíveis.
   */
  private buildRefusal(): {
    reason: string;
    explanation: string;
    can_do: string[]
  } {
    return {
      reason: 'fora_do_escopo',
      explanation:
        'Não consigo responder isso com os dados e ferramentas disponíveis. A Atena consulta dados de entrega de SMS e não inventa informações.',
      can_do: [
        'Buscar envios por telefone, status, provedor ou cliente',
        'Mostrar a trilha de eventos de um envio',
        'Analisar o risco do conteúdo de um envio',
        'Gerar um relatório de entregabilidade',
        'Listar provedores e clientes',
        'Listar e detalhar incidentes de entrega',
        'Gerar um relatório de incidentes resolvidos',
      ],
    };
  }
}
