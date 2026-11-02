import { useState, type JSX } from 'react';
import { BroadcastIcon as Broadcast, BuildingsIcon as Buildings, DownloadIcon as Download, FunnelIcon as Funnel, TrendUpIcon as TrendUp, UsersThreeIcon as UsersThree } from '@phosphor-icons/react';
import { type DeliveryReportInterface, type ShippingStatusType } from '@atena/types';
import { downloadDeliveryReport } from '../../api/reports';
import { categoryLabel } from '../../rules/rule-labels';
import { ToolResultFrame } from './ToolResultFrame';
import { HourlyChart } from './HourlyChart';
import { formatNumber } from './format';
import { cssValue, cssVar } from '../../styles/tokens';
import { PERCENT_SCALE } from '../../util/units';

/** KPI a exibir no strip: rótulo, chave em `totals` e cor. */
const KPI_DEFS: {
  label: string;
  key: keyof DeliveryReportInterface['totals'];
  color: string
}[] = [
  {
    label: 'Total',
    key: 'sent',
    color: cssVar.fg,
  },
  {
    label: 'Entregues',
    key: 'delivered',
    color: cssVar.success300,
  },
  {
    label: 'Falhas',
    key: 'failed',
    color: cssVar.danger300,
  },
  {
    label: 'Pendentes',
    key: 'pending',
    color: cssVar.warning300,
  },
];

/** Chave de um desfecho (fatia de uma barra empilhada); existe em `totals` e em cada `by_provider`. */
type OutcomeKeyType = 'delivered' | 'failed' | 'blocked' | 'pending';

/**
 * Segmentos de desfecho — base das barras EMPILHADAS (composição dos envios E por fornecedor). Ordem:
 * **Entregues (verde) + Bloqueados (cinza) adjacentes** (o bounce é pseudo-sucesso do controle de
 * entrega, então fica do lado do verde), depois Pendentes, e **Falha por ÚLTIMO** (o pior desfecho no
 * fim). Compartilhado pelas duas barras; as chaves existem em `totals` e em cada `by_provider`.
 */
const OUTCOME_SEGMENTS: {
  label: string;
  key: OutcomeKeyType;
  color: string
}[] = [
  {
    label: 'Entregues',
    key: 'delivered',
    color: cssVar.success300,
  },
  {
    label: 'Bloqueados',
    key: 'blocked',
    color: cssVar.fgMuted,
  },
  {
    label: 'Pendentes',
    key: 'pending',
    color: cssVar.warning300,
  },
  {
    label: 'Falhas',
    key: 'failed',
    color: cssVar.danger300,
  },
];

/**
 * Contagens por desfecho — base de uma barra empilhada (`totals` e `by_provider[i]` satisfazem).
 *
 * @remarks
 * Partial because a report persisted in the history before a field existed (e.g. `blocked`) lacks
 * that key at run time, whatever the current contract says.
 */
type OutcomeCountsInterface = Partial<Record<OutcomeKeyType, number>>;

/**
 * Barra horizontal EMPILHADA dos desfechos: uma fatia por segmento, proporcional ao `total`, na ordem
 * de {@link OUTCOME_SEGMENTS}. Defensiva a campos ausentes (dado antigo persistido) via `?? 0`.
 *
 * @param props - Contagens, base e altura.
 *
 * @returns A barra empilhada.
 */
function StackedOutcomeBar({
  counts,
  total,
  height,
}: Readonly<{
  counts: OutcomeCountsInterface;
  total: number;
  height: number
}>): JSX.Element {
  return (
    <div style={{
      display: 'flex',
      height,
      borderRadius: cssVar.radiusFull,
      overflow: 'hidden',
      background: cssVar.bgSoft,
    }}
    >
      {OUTCOME_SEGMENTS.map((segment) => {
        const value = counts[segment.key] ?? 0;

        const pct = total === 0
          ? 0
          : (value / total) * PERCENT_SCALE;

        return pct > 0
          ? (
            <div
              key={segment.key}
              title={`${segment.label}: ${formatNumber(value)} (${pct.toFixed(1)}%)`}
              style={{
                width: `${pct}%`,
                background: segment.color,
              }}
            />
          )
          : null;
      })}
    </div>
  );
}

/** Opacity of the download button while the export is running. */
const DOWNLOADING_OPACITY = 0.7;

/**
 * Card da tool `generate_delivery_report`: KPIs (total/entregues/falhas/pendentes),
 * gráfico horário interativo da taxa por hora, barras por fornecedor (rate %) e lista de top erros.
 * O botão CSV baixa as mensagens do recorte (telefone em claro, acesso auditado) via `csv_url`.
 *
 * @param props - Relatório de entregabilidade.
 *
 * @returns O card de relatório.
 */
export function ReportCard({ result }: Readonly<{ result: DeliveryReportInterface }>): JSX.Element {
  const [
    downloading,
    setDownloading,
  ] = useState(false);

  const onExport = (): void => {
    setDownloading(true);

    downloadDeliveryReport(result.csv_url)
      .catch(() => undefined)
      .finally(() => { setDownloading(false); });
  };

  return (
    <ToolResultFrame
      icon={<TrendUp size={13} />}
      toolName="generate_delivery_report"
      title={`Relatório · ${result.window}`}
      subtitle={`${formatNumber(result.totals.sent)} envios · agrupado por fornecedor`}
      actions={(
        <button
          type="button"
          onClick={onExport}
          disabled={downloading}
          title="Baixa as mensagens do relatório · telefone em claro (acesso auditado)"
          style={{
            display: cssValue.inlineFlex,
            alignItems: 'center',
            gap: cssVar.space4,
            padding: '4px 10px',
            border: cssVar.borderLine,
            borderRadius: cssVar.radius4,
            background: cssVar.white,
            color: cssVar.fg,
            fontSize: 11,
            fontWeight: 600,
            cursor: downloading
              ? 'wait'
              : 'pointer',
            opacity: downloading
              ? DOWNLOADING_OPACITY
              : 1,
          }}
        >
          <Download size={12} />
          {downloading
            ? 'Exportando…'
            : 'CSV'}
        </button>
      )}
    >
      <div style={{ padding: 18 }}>
        <ReportScope filters={result.filters} />

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: cssVar.space8,
          marginBottom: cssVar.space16,
        }}
        >
          {KPI_DEFS.map((kpi) => {
            // % do total (envios). O próprio "Total" é a base, então não mostra fração.
            const share = kpi.key === 'sent' || result.totals.sent === 0
              ? null
              : (result.totals[kpi.key] / result.totals.sent) * PERCENT_SCALE;

            return (
              <div
                key={kpi.label}
                style={{
                  padding: '10px 12px',
                  background: cssVar.bgSoft,
                  border: cssVar.borderLine,
                  borderRadius: cssVar.radius4,
                }}
              >
                <div style={{
                  fontSize: 10,
                  fontWeight: 600,
                  color: cssVar.fgSubtle,
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                }}
                >
                  {kpi.label}
                </div>
                <div style={{
                  marginTop: cssVar.space2,
                  fontSize: 22,
                  fontWeight: 700,
                  lineHeight: 1.2,
                  color: kpi.color,
                  fontVariantNumeric: cssValue.tabularNums,
                }}
                >
                  {formatNumber(result.totals[kpi.key])}
                </div>
                {share !== null
                  ? (
                    <div style={{
                      marginTop: cssVar.space2,
                      fontSize: 11,
                      color: cssVar.fgMuted,
                      fontVariantNumeric: cssValue.tabularNums,
                    }}
                    >
                      {share.toFixed(1)}% do total
                    </div>
                  )
                  : null}
              </div>
            );
          })}
        </div>

        <CompositionBar totals={result.totals} />

        <div style={{ marginBottom: cssVar.space16 }}>
          <HourlyChart
            title="Taxa de entrega por hora"
            points={result.hourly.map((bucket) => ({
              at: bucket.at,
              value: bucket.rate,
            }))}
            formatValue={(value) => `${value.toFixed(1)}%`}
            clampMax={100}
          />
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: '1.2fr 1fr',
          gap: cssVar.space16,
        }}
        >
          <div>
            <SectionLabel>Por fornecedor</SectionLabel>
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: cssVar.space8,
            }}
            >
              {result.by_provider.map((provider) => (
                <div
                  key={provider.name}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '70px 1fr 60px',
                    alignItems: 'center',
                    gap: cssVar.space8,
                  }}
                >
                  <div style={{
                    fontSize: cssVar.fs14,
                    fontWeight: 600,
                    color: cssVar.fg,
                  }}
                  >
                    {provider.name}
                  </div>
                  <StackedOutcomeBar
                    counts={provider}
                    total={provider.sent}
                    height={8}
                  />
                  {/* Taxa em tom neutro: a COR do desfecho já é comunicada pela composição da barra
                      (verde/cinza/âmbar/vermelho), então o número não precisa repetir o sinal. */}
                  <div style={{
                    fontFamily: cssValue.fontMono,
                    fontSize: cssVar.fs12,
                    fontWeight: 600,
                    textAlign: 'right',
                    color: cssVar.fg,
                  }}
                  >
                    {provider.rate.toFixed(1)}%
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <SectionLabel>Top erros</SectionLabel>
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: cssVar.space4,
            }}
            >
              {result.top_errors.map((error) => {
                // Participação do código de erro no total de envios (mesma base dos KPIs).
                const share = result.totals.sent === 0
                  ? null
                  : (error.count / result.totals.sent) * PERCENT_SCALE;

                return (
                  <div
                    key={error.code}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: cssValue.spaceBetween,
                      padding: '6px 8px',
                      background: cssVar.bgSoft,
                      border: cssVar.borderLine,
                      borderRadius: cssVar.radius4,
                    }}
                  >
                    <code style={{
                      fontFamily: cssValue.fontMono,
                      fontSize: 11,
                      color: cssVar.fg,
                    }}
                    >
                      {categoryLabel(error.code)}
                    </code>
                    <span style={{
                      display: cssValue.inlineFlex,
                      alignItems: 'baseline',
                      gap: cssVar.space8,
                      fontFamily: cssValue.fontMono,
                      fontSize: cssVar.fs12,
                      color: cssVar.fgMuted,
                      fontVariantNumeric: cssValue.tabularNums,
                    }}
                    >
                      {formatNumber(error.count)}
                      {share !== null
                        ? (
                          <span style={{
                            fontSize: 11,
                            color: cssVar.fgSubtle,
                          }}
                          >
                            {share.toFixed(1)}%
                          </span>
                        )
                        : null}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </ToolResultFrame>
  );
}

/** Rótulo PT-BR de cada status final, usado no chip de escopo do relatório. */
const STATUS_LABEL: Record<ShippingStatusType, string> = {
  delivered: 'entregues',
  failed: 'falhas',
  blocked: 'bloqueados',
  pending: 'pendentes',
  unknown: 'sem status',
};

/** Um chip de escopo (ícone + texto) na linha de filtros aplicados. */
function ScopeChip({
  icon,
  children,
}: Readonly<{
  icon: JSX.Element;
  children: string
}>): JSX.Element {
  return (
    <span style={{
      display: cssValue.inlineFlex,
      alignItems: 'center',
      gap: cssVar.space4,
      padding: '3px 10px',
      borderRadius: 999,
      background: cssVar.bgSoft,
      border: cssVar.borderLine,
      fontSize: 12,
      fontWeight: 600,
      color: cssVar.fg,
    }}
    >
      {icon}
      {children}
    </span>
  );
}

/**
 * Linha de escopo do relatório: chips com os filtros aplicados (cliente / provedor / status) para
 * deixar claro de qual recorte são os números. Sem filtros, mostra "Todos os clientes e provedores".
 *
 * @param props - Filtros ecoados pelo backend.
 *
 * @returns A linha de chips de escopo.
 */
function ReportScope({ filters }: Readonly<{ filters?: DeliveryReportInterface['filters'] }>): JSX.Element {
  const customer = filters?.customer_id;
  const provider = filters?.provider;
  const status = filters?.status;

  // Truthiness on purpose: an empty string echoed by the backend counts as "no filter".
  const hasAny = [
    customer,
    provider,
    status,
  ].some(Boolean);

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: cssVar.space8,
      marginBottom: cssVar.space16,
    }}
    >
      {hasAny
        ? null
        : (
          <ScopeChip icon={<UsersThree size={13} />}>
            Todos os clientes e provedores
          </ScopeChip>
        )}
      {customer
        ? (
          <ScopeChip icon={<Buildings size={13} />}>
            {`Cliente ${customer}`}
          </ScopeChip>
        )
        : null}
      {provider
        ? (
          <ScopeChip icon={<Broadcast size={13} />}>
            {`Provedor ${provider}`}
          </ScopeChip>
        )
        : null}
      {status
        ? (
          <ScopeChip icon={<Funnel size={13} />}>
            {`Só ${STATUS_LABEL[status]}`}
          </ScopeChip>
        )
        : null}
    </div>
  );
}

/**
 * Barra de COMPOSIÇÃO dos envios: uma barra horizontal empilhada com as fatias
 * entregue/falha/bloqueado/pendente (soma = total) + legenda. Comunica "para onde foram os envios" e
 * dá ao `blocked` (controle de entrega) uma fatia distinta — separada dos desfechos e fora da taxa.
 *
 * @param props - Totais por status (soma = `sent`).
 *
 * @returns A barra de composição.
 */
function CompositionBar({ totals }: Readonly<{ totals: DeliveryReportInterface['totals'] }>): JSX.Element {
  const total = totals.sent;

  // Defensivo: relatórios ANTIGOS (persistidos no histórico ANTES do campo `blocked`) não têm a
  // chave → conta como 0 (o type exige, mas o dado em runtime pode ser mais velho que o contrato).
  const persistedCounts: OutcomeCountsInterface = totals;
  const count = (key: OutcomeKeyType): number => persistedCounts[key] ?? 0;

  const share = (key: OutcomeKeyType): number => (total === 0
    ? 0
    : (count(key) / total) * PERCENT_SCALE);

  return (
    <div style={{ marginBottom: cssVar.space16 }}>
      <SectionLabel>Composição dos envios</SectionLabel>
      <StackedOutcomeBar
        counts={totals}
        total={total}
        height={10}
      />
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: cssVar.space12,
        marginTop: cssVar.space8,
      }}
      >
        {OUTCOME_SEGMENTS.map((segment) => (
          <span
            key={segment.label}
            style={{
              display: cssValue.inlineFlex,
              alignItems: 'center',
              gap: cssVar.space4,
              fontSize: 11,
              color: cssVar.fgMuted,
              fontVariantNumeric: cssValue.tabularNums,
            }}
          >
            <span style={{
              display: 'inline-block',
              width: 8,
              height: 8,
              borderRadius: 2,
              background: segment.color,
            }}
            />
            {`${segment.label} ${formatNumber(count(segment.key))} · ${share(segment.key).toFixed(1)}%`}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Rótulo de seção em maiúsculas usado no corpo do relatório. */
function SectionLabel({ children }: Readonly<{ children: string }>): JSX.Element {
  return (
    <div style={{
      marginBottom: cssVar.space8,
      fontSize: 11,
      fontWeight: 600,
      color: cssVar.fgSubtle,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    }}
    >
      {children}
    </div>
  );
}
