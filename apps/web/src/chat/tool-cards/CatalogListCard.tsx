import { Buildings, UsersThree } from '@phosphor-icons/react';
import { ToolResultFrame } from './ToolResultFrame';

/** Resultado das tools `list_providers` / `list_customers` (lista + janela usada). */
export interface CatalogListResultInterface {
  /** Janela temporal da lista (rótulo legível), ex.: "últimas 24h", "desde 2026-06-18T20:40:00Z (padrão)". */
  window?: string;
  providers?: string[];
  customers?: Array<{
    id: string;
    name: string
  }>;
  /** Total distinto na janela (clientes): `customers` pode trazer só os top-N mais ativos. */
  total?: number;
}

/** Estilo de cada chip de item (provedor/cliente). */
const CHIP_STYLE = {
  display: 'inline-flex',
  alignItems: 'center',
  height: 26,
  padding: '0 10px',
  borderRadius: 'var(--at-radius-full)',
  background: 'var(--at-bg-soft)',
  border: '1px solid var(--at-border)',
  fontSize: 'var(--at-fs-12)',
  fontWeight: 600,
  color: 'var(--at-fg)',
  fontVariantNumeric: 'tabular-nums',
} as const;

/**
 * Card das tools `list_providers` / `list_customers`: deixa EXPLÍCITA a janela temporal da lista
 * (subtítulo) e mostra os itens como chips — uma lista de "ativos" sem janela é ambígua.
 *
 * @param {object} props - Resultado da tool + o tipo de catálogo.
 * @param {CatalogListResultInterface} props.result - Lista + janela usada.
 * @param {'providers' | 'customers'} props.kind - Qual catálogo (define ícone, rótulo e a fonte dos itens).
 * @returns {JSX.Element} O card de catálogo.
 */
export function CatalogListCard({
  result,
  kind,
}: {
  result: CatalogListResultInterface;
  kind: 'providers' | 'customers'
}): JSX.Element {
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
        gap: 'var(--at-space-8)',
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
              fontSize: 'var(--at-fs-12)',
              color: 'var(--at-fg-muted)',
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
            fontSize: 'var(--at-fs-12)',
            color: 'var(--at-fg-muted)',
          }}
          >
            Mostrando os {items.length} mais ativos de {result.total}.
          </div>
        )
        : null}
    </ToolResultFrame>
  );
}
