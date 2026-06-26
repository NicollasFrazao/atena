import {
  type DeliveryReportInterface,
  type ShippingTrailInterface,
  type RiskAnalysisInterface,
} from '@atena/types';
import { type DisplayToolInterface } from '../useChat';
import { type RevealWindowInterface } from '../reveal';
import { SearchResultsCard, type SearchResultsResultInterface } from './SearchResultsCard';
import { TrailCard } from './TrailCard';
import { RiskCard } from './RiskCard';
import { ReportCard } from './ReportCard';
import { CatalogListCard, type CatalogListResultInterface } from './CatalogListCard';

/**
 * Extrai a janela temporal dos argumentos da tool (date_from/date_to do search/trilha), para escopar
 * o reveal por id — sem ela o lookup cairia na janela default (~30 dias) e poderia estourar timeout.
 *
 * @param {Record<string, unknown>} args - Argumentos com que a tool foi chamada.
 * @returns {RevealWindowInterface} Janela `{ date_from?, date_to? }` (campos não-string viram `undefined`).
 */
function windowFromArgs(args: Record<string, unknown>): RevealWindowInterface {
  return {
    date_from: typeof args.date_from === 'string'
      ? args.date_from
      : undefined,
    date_to: typeof args.date_to === 'string'
      ? args.date_to
      : undefined,
  };
}

/**
 * Dispatcher dos cards de resultado de tool: escolhe o card pelo `tool.name` e
 * passa o `tool.result` tipado. Retorna `null` para tools sem card dedicado ou
 * que não concluíram com sucesso (a pill genérica já cobre esses casos).
 *
 * @param {{ tool: DisplayToolInterface }} props - A invocação de tool a renderizar.
 * @returns {JSX.Element | null} O card adequado, ou `null`.
 */
export function ToolResultCard({ tool }: { tool: DisplayToolInterface }): JSX.Element | null {
  if (
    tool.status !== 'success'
    || tool.result == null
  ) {
    return null;
  }

  switch (tool.name) {
    case 'search_shippings':
      return (
        <SearchResultsCard
          result={tool.result as SearchResultsResultInterface}
          window={windowFromArgs(tool.args)}
          args={tool.args as Record<string, string | number | undefined>}
        />
      );
    case 'get_shipping_trail':
      return (
        <TrailCard
          result={tool.result as ShippingTrailInterface}
          window={windowFromArgs(tool.args)}
        />
      );
    case 'analyze_shipping_content':
      return <RiskCard result={tool.result as RiskAnalysisInterface} />;
    case 'generate_delivery_report':
      return <ReportCard result={tool.result as DeliveryReportInterface} />;
    case 'list_providers':
      return (
        <CatalogListCard
          result={tool.result as CatalogListResultInterface}
          kind="providers"
        />
      );
    case 'list_customers':
      return (
        <CatalogListCard
          result={tool.result as CatalogListResultInterface}
          kind="customers"
        />
      );
    default:
      return null;
  }
}
