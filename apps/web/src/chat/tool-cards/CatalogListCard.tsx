import type { JSX } from 'react';
import { BuildingsIcon as Buildings, UsersThreeIcon as UsersThree } from '@phosphor-icons/react';
import { ToolResultFrame } from './ToolResultFrame';
import { cssValue, cssVar } from '../../styles/tokens';

/** Resultado das tools `list_providers` / `list_customers` (lista + janela usada). */
export interface CatalogListResultInterface {
  /** Janela temporal da lista (rótulo legível), ex.: "últimas 24h", "desde 2026-06-18T20:40:00Z (padrão)". */
  window?: string;
  providers?: string[];
  customers?: {
    id: string;
    name: string
  }[];
  /** Total distinto na janela (clientes): `customers` pode trazer só os top-N mais ativos. */
  total?: number;
}

/** Estilo de cada chip de item (provedor/cliente). */
const CHIP_STYLE = {
  display: cssValue.inlineFlex,
  alignItems: 'center',
  height: 26,
  padding: '0 10px',
  borderRadius: cssVar.radiusFull,
  background: cssVar.bgSoft,
  border: cssVar.borderLine,
  fontSize: cssVar.fs12,
  fontWeight: 600,
  color: cssVar.fg,
  fontVariantNumeric: cssValue.tabularNums,
} as const;

/**
 * Card das tools `list_providers` / `list_customers`: deixa EXPLÍCITA a janela temporal da lista
 * (subtítulo) e mostra os itens como chips — uma lista de "ativos" sem janela é ambígua.
 *
 * @param props - Resultado da tool + o tipo de catálogo.
 * @param props.result - Lista + janela usada.
 * @param props.kind - Qual catálogo (define ícone, rótulo e a fonte dos itens).
 *
 * @returns O card de catálogo.
 */
export function CatalogListCard({
  result,
  kind,
}: Readonly<{
  result: CatalogListResultInterface;
  kind: 'providers' | 'customers'
}>): JSX.Element {
  const items = kind === 'providers'
    ? result.providers ?? []
    : (result.customers ?? []).map((customer) => customer.name);

  const CatalogIcon = kind === 'providers'
    ? Buildings
    : UsersThree;

  const noun = kind === 'providers'
    ? 'provedores'
    : 'clientes';

  // `total` (clientes) reflete o conjunto inteiro; `items` pode ser só os top-N mais ativos.
  const count = result.total ?? items.length;

  const suffix = count === 1
    ? 'ativo'
    : 'ativos';

  const truncated = result.total != null
    && result.total > items.length;

  return (
    <ToolResultFrame
      icon={<CatalogIcon size={13} />}
      toolName={kind === 'providers'
        ? 'list_providers'
        : 'list_customers'}
      title={`${count} ${noun} ${suffix}`}
      subtitle={`Janela: ${result.window ?? '—'}`}
    >
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: cssVar.space8,
        padding: 18,
      }}
      >
        {items.length > 0
          ? items.map((item) => (
            <span
              key={item}
              style={CHIP_STYLE}
            >
              {item}
            </span>
          ))
          : (
            <span style={{
              fontSize: cssVar.fs12,
              color: cssVar.fgMuted,
            }}
            >
              Nenhum {noun.slice(
                0,
                -1,
              )} ativo na janela.
            </span>
          )}
      </div>
      {truncated
        ? (
          <div style={{
            padding: '0 18px 14px',
            fontSize: cssVar.fs12,
            color: cssVar.fgMuted,
          }}
          >
            Mostrando os {items.length} mais ativos de {result.total}.
          </div>
        )
        : null}
    </ToolResultFrame>
  );
}
