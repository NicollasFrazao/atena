import { type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  type DeliveryReportInterface,
  type ShippingTrailInterface,
  type RiskAnalysisInterface,
} from '@atena/types';
import { type DisplayToolInterface } from '../useChat';
import { ToolResultCard } from './ToolResultCard';
import { type SearchResultsResultInterface } from './SearchResultsCard';

/** Monta uma tool de exibição concluída com sucesso para os testes. */
function makeTool(
  name: string,
  result: unknown,
  status: DisplayToolInterface['status'] = 'success',
): DisplayToolInterface {
  return {
    name,
    args: {},
    status,
    result,
  };
}

const searchResult: SearchResultsResultInterface = {
  rows: [
    {
      id: 'msg_1',
      campaign_id: 'camp_aaa',
      phone_masked: '+55 11 9****-1234',
      status: 'delivered',
      provider: 'Twilio',
      customer: 'Cliente 1001',
      channel: 'sms',
      app_id: 'a1111111-0000-4000-8000-000000000001',
      requested_at: '2026-06-18T12:34:00Z',
      finalized_at: '2026-06-18T12:40:00Z',
      error_hint: null,
    },
    {
      id: 'msg_2',
      campaign_id: 'camp_bbb',
      phone_masked: '+55 21 9****-5678',
      status: 'failed',
      provider: 'Zenvia',
      customer: 'Cliente 1001',
      channel: 'sms_flash',
      app_id: 'a2222222-0000-4000-8000-000000000002',
      requested_at: '2026-06-18T12:35:00Z',
      finalized_at: '2026-06-19T05:00:00Z', // BRT 19/06 02:00 → dia POSTERIOR ao envio (18/06)
      error_hint: 'BLOCKED_30007',
    },
  ],
  total: 42,
  page: 1,
  total_pages: 4,
  latency_ms: 218,
};

const trailResult: ShippingTrailInterface = {
  shipping_id: 'msg_2',
  campaign_id: 'camp_bbb',
  customer: 'Cliente 1001',
  provider: 'Twilio',
  phone_masked: '+55 21 9****-5678',
  channel: 'sms_flash',
  app_id: 'a2222222-0000-4000-8000-000000000002',
  final_status: 'failed',
  content_ref: 's3://bucket/ref',
  content_available: true,
  events: [
    {
      type: 'api_request',
      label: 'Pedido recebido',
      at: '2026-06-18T12:35:00Z',
      detail: 'API aceitou o envio',
    },
    {
      type: 'final',
      label: 'Falha definitiva',
      at: '2026-06-18T12:35:06Z',
      detail: 'Número bloqueado pela operadora',
    },
  ],
};

const riskResult: RiskAnalysisInterface = {
  score: 0.82,
  verdict: 'high',
  categories: [
    {
      name: 'Phishing',
      strength: 0.9,
    },
    {
      name: 'Urgência',
      strength: 0.6,
    },
  ],
  explanation: 'Mensagem combina link suspeito com pedido urgente de dados.',
};

const reportResult: DeliveryReportInterface = {
  window: '24h',
  totals: {
    sent: 184320,
    delivered: 180000,
    failed: 3200,
    blocked: 0,
    pending: 1120,
  },
  by_provider: [
    {
      name: 'Twilio',
      sent: 90000,
      delivered: 89000,
      rate: 98.9,
    },
    {
      name: 'Zenvia',
      sent: 94320,
      delivered: 91000,
      rate: 92.4,
    },
  ],
  hourly: [
    {
      at: '2026-06-18T20:00:00Z',
      rate: 97,
    },
    {
      at: '2026-06-18T21:00:00Z',
      rate: 98,
    },
    {
      at: '2026-06-18T22:00:00Z',
      rate: 95,
    },
    {
      at: '2026-06-18T23:00:00Z',
      rate: 80,
    },
    {
      at: '2026-06-19T00:00:00Z',
      rate: 96,
    },
    {
      at: '2026-06-19T01:00:00Z',
      rate: 99,
    },
  ],
  top_errors: [
    {
      code: 'BLOCKED_30007',
      count: 1800,
      provider: 'Zenvia',
    },
  ],
  csv_url: 'https://example.test/report.csv',
};

describe('ToolResultCard (dispatcher)', () => {
  it('retorna null quando a tool não concluiu com sucesso', () => {
    const element = ToolResultCard({
      tool: makeTool(
        'search_shippings',
        searchResult,
        'running',
      ),
    });

    expect(element).toBeNull();
  });

  it('retorna null para tool desconhecida', () => {
    const element = ToolResultCard({
      tool: makeTool(
        'tool_inexistente',
        { foo: 'bar' },
      ),
    });

    expect(element).toBeNull();
  });

  it('retorna null quando o result está ausente', () => {
    const element = ToolResultCard({
      tool: makeTool(
        'search_shippings',
        null,
      ),
    });

    expect(element).toBeNull();
  });

  it('seleciona o card de busca e mostra o total de resultados', () => {
    const markup = renderToStaticMarkup(
      ToolResultCard({
        tool: makeTool(
          'search_shippings',
          searchResult,
        ),
      }) as ReactElement,
    );

    expect(markup).toContain('Buscar envios');
    expect(markup).toContain('42 envios encontrados');
    expect(markup).toContain('+55 11 9****-1234');
    expect(markup).toContain('BLOCKED_30007');
    // Coluna "Enviado" = data do envio; a sub-linha diz se/quando finalizou.
    expect(markup).toContain('>Enviado<');
    // msg_1 finalizou no MESMO dia BRT (09:40) → só a hora; msg_2 num dia POSTERIOR (19/06) → data inteira.
    expect(markup).toContain('finalizado 09:40');
    expect(markup).toContain('finalizado 19/06');
  });

  it('seleciona o card de trilha e lista os eventos', () => {
    const markup = renderToStaticMarkup(
      ToolResultCard({
        tool: makeTool(
          'get_shipping_trail',
          trailResult,
        ),
      }) as ReactElement,
    );

    expect(markup).toContain('Trilha de um envio');
    expect(markup).toContain('Trilha · msg_2');
    expect(markup).toContain('Falha definitiva');
    expect(markup).toContain('Conteúdo mascarado');
  });

  it('seleciona o card de risco e mostra o score', () => {
    const markup = renderToStaticMarkup(
      ToolResultCard({
        tool: makeTool(
          'analyze_shipping_content',
          riskResult,
        ),
      }) as ReactElement,
    );

    expect(markup).toContain('Analisar risco de conteúdo');
    expect(markup).toContain('82.0%'); // score em escala 0–100% (1 casa decimal)
    expect(markup).toContain('Phishing');
  });

  it('seleciona o card de relatório e formata totais em pt-BR', () => {
    const markup = renderToStaticMarkup(
      ToolResultCard({
        tool: makeTool(
          'generate_delivery_report',
          reportResult,
        ),
      }) as ReactElement,
    );

    expect(markup).toContain('Relatório de entregabilidade');
    expect(markup).toContain('184.320');
    expect(markup).toContain('Baixa as mensagens do relatório'); // botão de export (telefone em claro, auditado)
    expect(markup).toContain('BLOCKED_30007');
  });

  it('card de catálogo (list_customers): título usa o total e mostra nota de truncamento (top-N)', () => {
    const markup = renderToStaticMarkup(
      ToolResultCard({
        tool: makeTool(
          'list_customers',
          {
            window: 'últimas 24h',
            customers: [
              {
                id: '8349',
                name: '8349',
              },
              {
                id: '1001',
                name: '1001',
              },
              {
                id: '1002',
                name: '1002',
              },
            ],
            total: 120,
          },
        ),
      }) as ReactElement,
    );

    // Título reflete o TOTAL distinto (120), não os 3 chips exibidos; nota deixa claro o top-N.
    expect(markup).toContain('120 clientes ativos');
    expect(markup).toContain('mais ativos de');
    expect(markup).toContain('8349');
  });
});
