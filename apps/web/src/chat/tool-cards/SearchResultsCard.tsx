import { useState, type JSX } from 'react';
import { DownloadSimpleIcon as DownloadSimple, MagnifyingGlassIcon as MagnifyingGlass } from '@phosphor-icons/react';
import { type SearchResultRowInterface } from '@atena/types';
import { type RevealWindowInterface } from '../reveal';
import { downloadSearchExport, type SearchShippingsQuery } from '../../api/shippings';
import { ToolResultFrame } from './ToolResultFrame';
import { StatusPill } from './StatusPill';
import { RevealField } from './RevealField';
import { describeStatus, formatDateTime, formatNumber } from './format';
import { categoryLabel } from '../../rules/rule-labels';
import { cssValue, cssVar, FONT_WEIGHT } from '../../styles/tokens';

/** Resultado da tool `search_shippings` (envelope paginado). */
export interface SearchResultsResultInterface {
  rows: SearchResultRowInterface[];
  total: number;
  page: number;
  total_pages: number;
  latency_ms: number;
  /** Janela EFETIVA congelada da busca (ISO) — fallback do export se o snapshot expirar. */
  date_from?: string | null;
  date_to?: string;
  /** Token do snapshot da busca — o export baixa o conjunto EXATO (byte-exato com o total). */
  export_token?: string;
  /** Quebra por status de todo o conjunto (não só a página) — exibida no rodapé, casa com o CSV. */
  breakdown?: {
    delivered: number;
    failed: number;
    blocked: number;
    pending: number
  };
}

/**
 * Quebra por status no rodapé (rótulo + cor). Mesma ordem/semântica da composição do relatório:
 * entregue → bloqueado (cinza, controle de entrega/bounce) → pendente → falha (por último). Somadas,
 * as quatro fatias fecham com o total (antes `blocked` ficava de fora e o rodapé não batia).
 */
const BREAKDOWN_PARTS: {
  key: 'delivered' | 'failed' | 'blocked' | 'pending';
  label: string;
  color: string
}[] = [
  {
    key: 'delivered',
    label: 'entregues',
    color: cssVar.success300,
  },
  {
    key: 'blocked',
    label: 'bloqueado',
    color: cssVar.fgMuted,
  },
  {
    key: 'pending',
    label: 'pendente',
    color: cssVar.warning300,
  },
  {
    key: 'failed',
    label: 'falha',
    color: cssVar.danger300,
  },
];

/** Colunas da tabela de resultados de busca. */
const COLUMNS = [
  'Envio',
  'Canal',
  'Telefone',
  'Status',
  'Enviado',
  'Fornecedor',
  'Erro',
  'Cliente',
  'App',
  'Campanha',
] as const;

/** Rótulo legível do canal do envio (`campaign_type`). */
const CHANNEL_LABELS: Record<string, string> = {
  sms: 'SMS',
  sms_flash: 'SMS Flash',
};

const cellStyle = {
  padding: '10px 14px',
  fontSize: cssVar.fs12,
  verticalAlign: 'top',
} as const;

/** Length of the `YYYY-MM-DD` date at the start of an ISO 8601 instant. */
const ISO_DATE_LENGTH = 10;

/**
 * Janela de 1 dia (UTC) em torno da data do envio — escopa o reveal à partição daquele dia,
 * evitando o scan frio de ~30 dias quando a busca não trouxe datas explícitas (ex.: busca por
 * telefone). `null` se `requested_at` não for uma data ISO válida (cai na janela da busca).
 *
 * @param requestedAt - Data do envio (ISO 8601 UTC) da linha.
 *
 * @returns Janela do dia (`date_from = date_to = YYYY-MM-DD`), ou `null`.
 */
function dayWindow(requestedAt: string): RevealWindowInterface | null {
  const day = requestedAt.slice(
    0,
    ISO_DATE_LENGTH,
  );

  return /^\d{4}-\d{2}-\d{2}$/.test(day)
    ? {
      date_from: day,
      date_to: day,
    }
    : null;
}

/** Length of the `dd/MM` day at the start of a {@link formatDateTime} text. */
const DAY_MONTH_LENGTH = 5;

/**
 * Sub-linha de finalização da coluna "Enviado": a data principal é sempre o ENVIO; esta linha responde
 * "foi finalizado? quando?". Finalizou no MESMO dia → só a hora; num dia POSTERIOR → a data inteira,
 * destacada (a entrega/falha cruzou a meia-noite); ainda `pending` → "não finalizado".
 *
 * @param props - Datas da linha (ISO 8601 UTC).
 * @param props.requestedAt - Instante do envio.
 * @param props.finalizedAt - Instante da finalização, ou `null` se ainda não finalizou.
 *
 * @returns A sub-linha de status de finalização.
 */
function FinalizeLine({
  requestedAt,
  finalizedAt,
}: Readonly<{
  requestedAt: string;
  finalizedAt: string | null
}>): JSX.Element {
  if (!finalizedAt) {
    return (
      <div style={{
        marginTop: cssVar.space2,
        fontSize: 11,
        color: cssVar.warning300,
      }}
      >
        não finalizado
      </div>
    );
  }

  const finalizedText = formatDateTime(finalizedAt);

  const laterDay = finalizedText.slice(
    0,
    DAY_MONTH_LENGTH,
  ) !== formatDateTime(requestedAt).slice(
    0,
    DAY_MONTH_LENGTH,
  );

  return (
    <div style={{
      marginTop: cssVar.space2,
      fontSize: 11,
      fontWeight: laterDay
        ? FONT_WEIGHT.semibold
        : FONT_WEIGHT.regular,
      color: laterDay
        ? cssVar.warning300
        : cssVar.fgSubtle,
    }}
    >
      {laterDay
        ? `finalizado ${finalizedText}`
        : `finalizado ${finalizedText.split(' ')[1] ?? finalizedText}`}
    </div>
  );
}

/** Um filtro aplicado, para o chip (rótulo + valor já legível). */
interface FilterChipInterface {
  label: string;
  value: string;
}

/**
 * Valor do chip de "Janela": intervalo formatado no fuso (`date_from`/`date_to`, efetivos ou crus) ou,
 * na ausência deles, o preset (`date_range`). `null` quando não há janela (busca cobriu o default).
 *
 * @param from - Início da janela (ISO) ou `undefined`.
 * @param to - Fim da janela (ISO) ou `undefined`.
 * @param range - Preset (`24h`/`7d`/…) ou `undefined`.
 *
 * @returns Texto do chip, ou `null` se não há janela.
 */
function windowChipValue(
  from: string | undefined,
  to: string | undefined,
  range: string | undefined,
): string | null {
  if (
    from
    || to
  ) {
    return `${from
      ? formatDateTime(from)
      : '…'} → ${to
      ? formatDateTime(to)
      : 'agora'}`;
  }

  return range ?? null;
}

/**
 * Monta os chips dos filtros aplicados na busca — a partir dos `args` da tool + a janela EFETIVA
 * congelada do resultado (ISO), para o card declarar o escopo exato (cliente, telefone, status,
 * fornecedor, campanha, janela). Sem filtro = lista vazia (a busca cobriu a janela padrão).
 *
 * @param args - Filtros enviados à tool.
 * @param result - Resultado (janela congelada `date_from`/`date_to`).
 *
 * @returns Chips na ordem de exibição.
 */
function buildFilterChips(
  args: SearchShippingsQuery | undefined,
  result: SearchResultsResultInterface,
): FilterChipInterface[] {
  const chips: FilterChipInterface[] = [];

  const value = (key: string): string | undefined => {
    const raw = args?.[key];

    return raw === undefined || raw === ''
      ? undefined
      : String(raw);
  };

  const customer = value('customer_id');

  if (customer) {
    chips.push({
      label: 'Cliente',
      value: customer,
    });
  }

  const phone = value('phone');

  if (phone) {
    chips.push({
      label: 'Telefone',
      value: phone,
    });
  }

  const status = value('status');

  if (status) {
    chips.push({
      label: 'Status',
      value: describeStatus(status).label,
    });
  }

  const provider = value('provider');

  if (provider) {
    chips.push({
      label: 'Fornecedor',
      value: provider,
    });
  }

  const channel = value('channel');

  if (channel) {
    chips.push({
      label: 'Canal',
      value: CHANNEL_LABELS[channel] ?? channel,
    });
  }

  const errorHint = value('error_hint');

  if (errorHint) {
    chips.push({
      label: 'Erro',
      value: categoryLabel(errorHint),
    });
  }

  const campaign = value('campaign_id');

  if (campaign) {
    chips.push({
      label: 'Campanha',
      value: campaign,
    });
  }

  const incident = value('incident_id');

  if (incident) {
    chips.push({
      label: 'Incidente',
      value: incident,
    });
  }

  // Janela só faz sentido na busca por filtro/janela; a busca por incidente é escopada pelos ids
  // impactados (sem janela) — não mostramos um chip de janela enganoso ("… → agora").
  const janela = incident
    ? null
    : windowChipValue(
      result.date_from ?? value('date_from'),
      result.date_to ?? value('date_to'),
      value('date_range'),
    );

  if (janela) {
    chips.push({
      label: 'Janela',
      value: janela,
    });
  }

  return chips;
}

/** Opacity of the download button while the export is running. */
const DOWNLOADING_OPACITY = 0.7;

/**
 * Card da tool `search_shippings`: tabela de envios encontrados. Telefone mascarado
 * por padrão, com reveal auditado por linha ({@link RevealField}); status colorido por tom;
 * `error_hint` em `<code>` vermelho ou "—"; rodapé com total e página.
 *
 * @param props - Resultado da tool + janela do contexto.
 * @param props.result - Envelope paginado da busca.
 * @param [props.window] - Janela usada na busca (escopa o reveal por linha).
 * @param [props.args] - Filtros da busca (p/ o export paginar TODOS os resultados).
 *
 * @returns O card de resultados de busca.
 */
export function SearchResultsCard({
  result,
  window,
  args,
}: Readonly<{
  result: SearchResultsResultInterface;
  window?: RevealWindowInterface;
  args?: SearchShippingsQuery
}>): JSX.Element {
  const [
    downloading,
    setDownloading,
  ] = useState(false);

  // Exporta TODAS as linhas do filtro (CSV gerado no servidor, sem teto) — o card só tem a 1ª página.
  // Telefone EM CLARO no arquivo: o acesso é auditado no servidor (export_report · pii). Usa a janela
  // CONGELADA da busca (date_from/date_to do resultado) p/ o download bater com o total exibido — em
  // vez do preset relativo dos args, que deslizaria se reaberto depois (precedência: datas > preset).
  const onExport = (): void => {
    setDownloading(true);

    // Precedência: token (snapshot exato) → janela congelada → preset relativo dos args.
    const exportQuery: SearchShippingsQuery = {
      ...(args ?? {}),
      ...(result.date_to
        ? {
          date_from: result.date_from ?? undefined,
          date_to: result.date_to,
        }
        : {}),
      token: result.export_token,
    };

    downloadSearchExport(exportQuery)
      .catch(() => undefined)
      .finally(() => { setDownloading(false); });
  };

  // Const local: o TS narrow do `breakdown?` não atravessa o closure do `.map` do rodapé.
  const breakdown = result.breakdown;

  const filterChips = buildFilterChips(
    args,
    result,
  );

  return (
    <ToolResultFrame
      icon={<MagnifyingGlass size={13} />}
      toolName="search_shippings"
      title={`${formatNumber(result.total)} envios encontrados`}
      subtitle={`página ${result.page} de ${result.total_pages} · ${result.latency_ms} ms`}
    >
      {filterChips.length > 0
        ? (
          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: cssVar.space8,
            padding: '10px 14px',
            borderBottom: cssVar.borderLine,
            background: cssVar.bgSoft,
          }}
          >
            <span style={{
              fontSize: 11,
              fontWeight: 600,
              color: cssVar.fgMuted,
              textTransform: 'uppercase',
              letterSpacing: 0.4,
            }}
            >
              Filtros
            </span>
            {filterChips.map((chip) => (
              <span
                key={chip.label}
                style={{
                  display: cssValue.inlineFlex,
                  alignItems: 'center',
                  gap: cssVar.space4,
                  padding: '2px 8px',
                  borderRadius: 999,
                  background: cssVar.white,
                  border: cssVar.borderLine,
                  fontSize: cssVar.fs12,
                  color: cssVar.fg,
                }}
              >
                <span style={{ color: cssVar.fgMuted }}>{`${chip.label}:`}</span>
                <b style={{ fontWeight: 600 }}>{chip.value}</b>
              </span>
            ))}
          </div>
        )
        : null}
      <div style={{ overflowX: 'auto' }}>
        <table style={{
          width: '100%',
          borderCollapse: 'collapse',
        }}
        >
          <thead>
            <tr style={{ background: cssVar.bgSoft }}>
              {COLUMNS.map((column) => (
                <th
                  key={column}
                  style={{
                    textAlign: 'left',
                    padding: '9px 14px',
                    fontSize: 11,
                    fontWeight: 600,
                    color: cssVar.fgMuted,
                    textTransform: 'uppercase',
                    letterSpacing: 0.4,
                    borderBottom: cssVar.borderLine,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((
              row,
              index,
            ) => (
              <tr
                key={row.id}
                style={{
                  borderBottom: index < result.rows.length - 1
                    ? cssVar.borderLine
                    : 'none',
                }}
              >
                {/* Envio (Message ID) — identificador do envio, 1ª coluna */}
                <td style={{
                  ...cellStyle,
                  fontFamily: cssValue.fontMono,
                  color: cssVar.fg,
                  whiteSpace: 'nowrap',
                }}
                >
                  {row.id}
                </td>
                {/* Canal (badge) */}
                <td style={cellStyle}>
                  {row.channel
                    ? (
                      <span style={{
                        display: 'inline-block',
                        padding: '2px 8px',
                        borderRadius: cssVar.radiusFull,
                        background: cssVar.bgSoft,
                        border: cssVar.borderLine,
                        fontSize: 11,
                        fontWeight: 600,
                        color: cssVar.fg,
                        whiteSpace: 'nowrap',
                      }}
                      >
                        {CHANNEL_LABELS[row.channel] ?? row.channel}
                      </span>
                    )
                    : <span style={{ color: cssVar.fgSubtle }}>—</span>}
                </td>
                {/* Telefone */}
                <td style={{
                  ...cellStyle,
                  color: cssVar.fg,
                }}
                >
                  <RevealField
                    shippingId={row.id}
                    kind="phone"
                    masked={row.phone_masked}
                    window={dayWindow(row.requested_at) ?? window}
                  />
                </td>
                {/* Status */}
                <td style={cellStyle}>
                  <StatusPill status={row.status} />
                </td>
                {/* Enviado */}
                <td style={{
                  ...cellStyle,
                  color: cssVar.fgMuted,
                  whiteSpace: 'nowrap',
                }}
                >
                  <div style={{ color: cssVar.fg }}>{formatDateTime(row.requested_at)}</div>
                  <FinalizeLine
                    requestedAt={row.requested_at}
                    finalizedAt={row.finalized_at}
                  />
                </td>
                {/* Fornecedor */}
                <td style={{
                  ...cellStyle,
                  color: cssVar.fg,
                }}
                >
                  {row.provider}
                </td>
                {/* Erro */}
                <td style={cellStyle}>
                  {row.error_hint
                    ? (
                      <code style={{
                        fontFamily: cssValue.fontMono,
                        fontSize: 11,
                        color: cssVar.danger300,
                        background: cssVar.danger50,
                        padding: '2px 6px',
                        borderRadius: cssVar.radius4,
                      }}
                      >
                        {categoryLabel(row.error_hint)}
                      </code>
                    )
                    : <span style={{ color: cssVar.fgSubtle }}>—</span>}
                </td>
                {/* Cliente */}
                <td style={{
                  ...cellStyle,
                  color: cssVar.fgMuted,
                }}
                >
                  {row.customer}
                </td>
                {/* App — UUID encurtado (quebra nos hífens, ~2 linhas) */}
                <td style={{
                  ...cellStyle,
                  fontFamily: cssValue.fontMono,
                  fontSize: 11,
                  color: cssVar.fgMuted,
                  maxWidth: 160,
                  whiteSpace: 'normal',
                  overflowWrap: 'break-word',
                }}
                >
                  {row.app_id ?? <span style={{
                    fontFamily: 'inherit',
                    color: cssVar.fgSubtle,
                  }}
                  >—</span>}
                </td>
                {/* Campanha — UUID encurtado (quebra nos hífens, ~2 linhas) */}
                <td style={{
                  ...cellStyle,
                  fontFamily: cssValue.fontMono,
                  fontSize: 11,
                  color: cssVar.fgMuted,
                  maxWidth: 160,
                  whiteSpace: 'normal',
                  overflowWrap: 'break-word',
                }}
                >
                  {row.campaign_id ?? <span style={{ color: cssVar.fgSubtle }}>—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: cssValue.spaceBetween,
        gap: cssVar.space12,
        padding: '8px 14px',
        borderTop: cssVar.borderLine,
        background: cssVar.bgSoft,
        fontSize: cssVar.fs12,
        color: cssVar.fgMuted,
      }}
      >
        <span style={{
          display: cssValue.inlineFlex,
          alignItems: 'center',
          gap: cssVar.space12,
          flexWrap: 'wrap',
        }}
        >
          <span>{formatNumber(result.total)} resultados</span>
          {breakdown
            ? BREAKDOWN_PARTS.map((part) => (
              <span
                key={part.key}
                style={{
                  display: cssValue.inlineFlex,
                  alignItems: 'center',
                  gap: cssVar.space4,
                  fontVariantNumeric: cssValue.tabularNums,
                }}
              >
                <span style={{
                  width: 7,
                  height: 7,
                  borderRadius: 999,
                  background: part.color,
                }}
                />
                <b style={{ color: cssVar.fg }}>{formatNumber(breakdown[part.key])}</b>
                {part.label}
              </span>
            ))
            : null}
        </span>
        <button
          type="button"
          onClick={onExport}
          disabled={downloading}
          title="Exporta TODAS as mensagens do filtro · telefone em claro (acesso auditado)"
          style={{
            display: cssValue.inlineFlex,
            alignItems: 'center',
            gap: cssVar.space4,
            height: 28,
            padding: cssVar.paddingInline12,
            borderRadius: cssVar.radius4,
            border: cssVar.borderLine,
            background: cssVar.white,
            color: cssVar.fg,
            fontSize: cssVar.fs12,
            fontWeight: 600,
            cursor: downloading
              ? 'wait'
              : 'pointer',
            opacity: downloading
              ? DOWNLOADING_OPACITY
              : 1,
          }}
        >
          <DownloadSimple size={13} />
          {downloading
            ? 'Exportando…'
            : 'Exportar CSV'}
        </button>
      </div>
    </ToolResultFrame>
  );
}
