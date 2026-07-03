import { useState } from 'react';
import { Broadcast, Buildings, Download, Funnel, TrendUp, UsersThree } from '@phosphor-icons/react';
import { type DeliveryReportInterface, type ShippingStatusType } from '@atena/types';
import { downloadDeliveryReport } from '../../api/reports';
import { categoryLabel } from '../../rules/rule-labels';
import { ToolResultFrame } from './ToolResultFrame';
import { HourlyChart } from './HourlyChart';
import { formatNumber } from './format';

/** KPI a exibir no strip: rótulo, chave em `totals` e cor. */
const KPI_DEFS: Array<{
  label: string;
  key: keyof DeliveryReportInterface['totals'];
  color: string
}> = [
  {
    label: 'Total',
    key: 'sent',
    color: 'var(--at-fg)',
  },
  {
    label: 'Entregues',
    key: 'delivered',
    color: 'var(--at-success-300)',
  },
  {
    label: 'Falhas',
    key: 'failed',
    color: 'var(--at-danger-300)',
  },
  {
    label: 'Pendentes',
    key: 'pending',
    color: 'var(--at-warning-300)',
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
const OUTCOME_SEGMENTS: Array<{
  label: string;
  key: OutcomeKeyType;
  color: string
}> = [
  {
    label: 'Entregues',
    key: 'delivered',
    color: 'var(--at-success-300)',
  },
  {
    label: 'Bloqueados',
    key: 'blocked',
    color: 'var(--at-fg-muted)',
  },
  {
    label: 'Pendentes',
    key: 'pending',
    color: 'var(--at-warning-300)',
  },
  {
    label: 'Falhas',
    key: 'failed',
    color: 'var(--at-danger-300)',
  },
];

/** Contagens por desfecho — base de uma barra empilhada (`totals` e `by_provider[i]` satisfazem). */
type OutcomeCountsInterface = Record<OutcomeKeyType, number>;

/**
 * Barra horizontal EMPILHADA dos desfechos: uma fatia por segmento, proporcional ao `total`, na ordem
 * de {@link OUTCOME_SEGMENTS}. Defensiva a campos ausentes (dado antigo persistido) via `?? 0`.
 *
 * @param {{ counts: OutcomeCountsInterface; total: number; height: number }} props - Contagens, base e altura.
 * @returns {JSX.Element} A barra empilhada.
 */
function StackedOutcomeBar({
  counts,
  total,
  height,
}: {
  counts: OutcomeCountsInterface;
  total: number;
  height: number
}): JSX.Element {
  return (
    <div style={{
      display: 'flex',
      height,
      borderRadius: 'var(--at-radius-full)',
      overflow: 'hidden',
      background: 'var(--at-bg-soft)',
    }}
    >
      {OUTCOME_SEGMENTS.map((segment) => {
        const value = counts[segment.key] ?? 0;

        const pct = total === 0
          ? 0
          : (value / total) * 100;

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

/**
 * Card da tool `generate_delivery_report`: KPIs (total/entregues/falhas/pendentes),
 * gráfico horário interativo da taxa por hora, barras por fornecedor (rate %) e lista de top erros.
 * O botão CSV baixa as mensagens do recorte (telefone em claro, acesso auditado) via `csv_url`.
 *
 * @param {{ result: DeliveryReportInterface }} props - Relatório de entregabilidade.
 * @returns {JSX.Element} O card de relatório.
 */
export function ReportCard({ result }: { result: DeliveryReportInterface }): JSX.Element {
  const [
    downloading,
    setDownloading,
  ] = useState(false);

  const onExport = (): void => {
    setDownloading(true);

    downloadDeliveryReport(result.csv_url)
      .catch(() => undefined)
      .finally(() => setDownloading(false));
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
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--at-space-4)',
            padding: '4px 10px',
            border: '1px solid var(--at-border)',
            borderRadius: 'var(--at-radius-4)',
            background: 'var(--at-white)',
            color: 'var(--at-fg)',
            fontSize: 11,
            fontWeight: 600,
            cursor: downloading
              ? 'wait'
              : 'pointer',
            opacity: downloading
              ? 0.7
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
          gap: 'var(--at-space-8)',
          marginBottom: 'var(--at-space-16)',
        }}
        >
          {KPI_DEFS.map((kpi) => {
            // % do total (envios). O próprio "Total" é a base, então não mostra fração.
            const share = kpi.key === 'sent' || result.totals.sent === 0
              ? null
              : (result.totals[kpi.key] / result.totals.sent) * 100;

            return (
              <div
                key={kpi.label}
                style={{
                  padding: '10px 12px',
                  background: 'var(--at-bg-soft)',
                  border: '1px solid var(--at-border)',
                  borderRadius: 'var(--at-radius-4)',
                }}
              >
                <div style={{
                  fontSize: 10,
                  fontWeight: 600,
                  color: 'var(--at-fg-subtle)',
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                }}
                >
                  {kpi.label}
                </div>
                <div style={{
                  marginTop: 'var(--at-space-2)',
                  fontSize: 22,
                  fontWeight: 700,
                  lineHeight: 1.2,
                  color: kpi.color,
                  fontVariantNumeric: 'tabular-nums',
                }}
                >
                  {formatNumber(result.totals[kpi.key])}
                </div>
                {share !== null
                  ? (
                    <div style={{
                      marginTop: 'var(--at-space-2)',
                      fontSize: 11,
                      color: 'var(--at-fg-muted)',
                      fontVariantNumeric: 'tabular-nums',
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

        <div style={{ marginBottom: 'var(--at-space-16)' }}>
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
          gap: 'var(--at-space-16)',
        }}
        >
          <div>
            <SectionLabel>Por fornecedor</SectionLabel>
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--at-space-8)',
            }}
            >
              {result.by_provider.map((provider) => (
                <div
                  key={provider.name}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '70px 1fr 60px',
                    alignItems: 'center',
                    gap: 'var(--at-space-8)',
                  }}
                >
                  <div style={{
                    fontSize: 'var(--at-fs-14)',
                    fontWeight: 600,
                    color: 'var(--at-fg)',
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
                    fontFamily: 'ui-monospace, Menlo, monospace',
                    fontSize: 'var(--at-fs-12)',
                    fontWeight: 600,
                    textAlign: 'right',
                    color: 'var(--at-fg)',
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
              gap: 'var(--at-space-4)',
            }}
            >
              {result.top_errors.map((error) => {
                // Participação do código de erro no total de envios (mesma base dos KPIs).
                const share = result.totals.sent === 0
                  ? null
                  : (error.count / result.totals.sent) * 100;

                return (
                  <div
                    key={error.code}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '6px 8px',
                      background: 'var(--at-bg-soft)',
                      border: '1px solid var(--at-border)',
                      borderRadius: 'var(--at-radius-4)',
                    }}
                  >
                    <code style={{
                      fontFamily: 'ui-monospace, Menlo, monospace',
                      fontSize: 11,
                      color: 'var(--at-fg)',
                    }}
                    >
                      {categoryLabel(error.code)}
                    </code>
                    <span style={{
                      display: 'inline-flex',
                      alignItems: 'baseline',
                      gap: 'var(--at-space-8)',
                      fontFamily: 'ui-monospace, Menlo, monospace',
                      fontSize: 'var(--at-fs-12)',
                      color: 'var(--at-fg-muted)',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                    >
                      {formatNumber(error.count)}
                      {share !== null
                        ? (
                          <span style={{
                            fontSize: 11,
                            color: 'var(--at-fg-subtle)',
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
}: {
  icon: JSX.Element;
  children: string
}): JSX.Element {
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 'var(--at-space-4)',
      padding: '3px 10px',
      borderRadius: 999,
      background: 'var(--at-bg-soft)',
      border: '1px solid var(--at-border)',
      fontSize: 12,
      fontWeight: 600,
      color: 'var(--at-fg)',
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
 * @param {{ filters?: DeliveryReportInterface['filters'] }} props - Filtros ecoados pelo backend.
 * @returns {JSX.Element} A linha de chips de escopo.
 */
function ReportScope({ filters }: { filters?: DeliveryReportInterface['filters'] }): JSX.Element {
  const customer = filters?.customer_id;
  const provider = filters?.provider;
  const status = filters?.status;
  const hasAny = Boolean(customer || provider || status);

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: 'var(--at-space-8)',
      marginBottom: 'var(--at-space-16)',
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
 * @param {{ totals: DeliveryReportInterface['totals'] }} props - Totais por status (soma = `sent`).
 * @returns {JSX.Element} A barra de composição.
 */
function CompositionBar({ totals }: { totals: DeliveryReportInterface['totals'] }): JSX.Element {
  const total = totals.sent;

  // Defensivo: relatórios ANTIGOS (persistidos no histórico ANTES do campo `blocked`) não têm a
  // chave → conta como 0 (o type exige, mas o dado em runtime pode ser mais velho que o contrato).
  const count = (key: OutcomeKeyType): number => totals[key] ?? 0;

  const share = (key: OutcomeKeyType): number => (total === 0
    ? 0
    : (count(key) / total) * 100);

  return (
    <div style={{ marginBottom: 'var(--at-space-16)' }}>
      <SectionLabel>Composição dos envios</SectionLabel>
      <StackedOutcomeBar
        counts={totals}
        total={total}
        height={10}
      />
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 'var(--at-space-12)',
        marginTop: 'var(--at-space-8)',
      }}
      >
        {OUTCOME_SEGMENTS.map((segment) => (
          <span
            key={segment.label}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 'var(--at-space-4)',
              fontSize: 11,
              color: 'var(--at-fg-muted)',
              fontVariantNumeric: 'tabular-nums',
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
function SectionLabel({ children }: { children: string }): JSX.Element {
  return (
    <div style={{
      marginBottom: 'var(--at-space-8)',
      fontSize: 11,
      fontWeight: 600,
      color: 'var(--at-fg-subtle)',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    }}
    >
      {children}
    </div>
  );
}
