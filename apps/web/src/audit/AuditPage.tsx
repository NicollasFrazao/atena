import { Fragment, type ReactNode, useState } from 'react';
import {
  CaretDown,
  ChatsCircle,
  CheckCircle,
  Download,
  Eye,
  Flag,
  Gear,
  type Icon,
  MagnifyingGlass,
  ShieldCheck,
  UsersThree,
  Warning,
  Wrench,
} from '@phosphor-icons/react';
import type {
  AuditActionType,
  AuditLogEntryInterface,
} from '@atena/types';
import {
  type AuditQueryInterface,
  downloadAuditJsonl,
  useAudit,
  useAuditSummary,
  useAuditUsers,
} from '../api/audit';
import {
  ACTION_LABEL,
  FILTERABLE_ACTIONS,
  SEVERITY_COLOR,
} from './audit-labels';
import { dayKeyInTz, formatDate, formatTime } from '../util/time';

/** Período do filtro (recorta `from`). */
type PeriodType = 'all' | 'today' | '7d' | '30d';

/** Opções do filtro de período. */
const PERIODS: Array<{
  id: PeriodType;
  label: string
}> = [
  {
    id: 'all',
    label: 'Todo o período',
  },
  {
    id: 'today',
    label: 'Hoje',
  },
  {
    id: '7d',
    label: 'Últimos 7 dias',
  },
  {
    id: '30d',
    label: 'Últimos 30 dias',
  },
];

/** Instante inicial (ISO) do período escolhido; `undefined` para "todo o período". */
function periodFrom(period: PeriodType): string | undefined {
  if (period === 'all') {
    return undefined;
  }

  const now = new Date();

  if (period === 'today') {
    return new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
    )).toISOString();
  }

  const days = period === '7d'
    ? 7
    : 30;

  return new Date(now.getTime() - days * 86_400_000).toISOString();
}

/** Ícone por ação auditada (espelha o protótipo). */
const ACTION_ICON: Record<AuditActionType, Icon> = {
  tool_call: Wrench,
  reveal_phone: Eye,
  reveal_content: Eye,
  incident_created: Warning,
  incident_ack: CheckCircle,
  incident_resolve: Flag,
  session_start: ChatsCircle,
  export_report: Download,
  rule_update: Gear,
  user_role_update: UsersThree,
  user_status_update: UsersThree,
};

/** Formata o instante do evento ("hoje HH:MM:SS" ou "DD/MM HH:MM:SS") no fuso de exibição do app. */
function formatWhen(iso: string): string {
  const sameDay = dayKeyInTz(iso) === dayKeyInTz(new Date().toISOString());

  const time = formatTime(
    iso,
    true,
  );

  return sameDay
    ? `hoje ${time}`
    : `${formatDate(iso)} ${time}`;
}

/**
 * Tela de Audit log (`GET /audit`, admin): trilha imutável de cada interação. KPIs (eventos hoje,
 * acessos a PII, mudanças de regra, total), filtros (tipo de ação, só-PII, busca) e tabela paginada.
 * Os acessos a PII destacam-se (borda/realce). Append-only — só leitura. Sem PII em claro.
 *
 * @returns {JSX.Element} A tela de audit log.
 */
export function AuditPage(): JSX.Element {
  const [
    action,
    setAction,
  ] = useState('');

  const [
    piiOnly,
    setPiiOnly,
  ] = useState(false);

  const [
    search,
    setSearch,
  ] = useState('');

  const [
    period,
    setPeriod,
  ] = useState<PeriodType>('all');

  const [
    user,
    setUser,
  ] = useState('');

  const [
    page,
    setPage,
  ] = useState(1);

  const [
    openId,
    setOpenId,
  ] = useState<string | null>(null);

  const summary = useAuditSummary().data;
  const users = useAuditUsers().data ?? [];

  const filters: AuditQueryInterface = {
    action: action || undefined,
    pii_only: piiOnly || undefined,
    search: search || undefined,
    user_id: user || undefined,
    from: periodFrom(period),
  };

  const audit = useAudit({
    ...filters,
    page,
  });

  const rows = audit.data?.rows ?? [];
  const totalPages = audit.data?.total_pages ?? 1;

  // Qualquer mudança de filtro volta à página 1.
  const resetTo = (apply: () => void): void => {
    apply();
    setPage(1);
  };

  const onExport = (): void => {
    downloadAuditJsonl(filters).catch(() => undefined);
  };

  return (
    <div style={{
      maxWidth: 1200,
      margin: '0 auto',
      padding: 'var(--at-space-32)',
    }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--at-space-12)',
        marginBottom: 'var(--at-space-4)',
      }}
      >
        <h1 style={{
          margin: 0,
          flex: 1,
          fontSize: 'var(--at-fs-24)',
          fontWeight: 600,
          color: 'var(--at-fg)',
        }}
        >
          Audit log
        </h1>
        <button
          type="button"
          onClick={onExport}
          disabled={rows.length === 0}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--at-space-8)',
            height: 36,
            padding: '0 var(--at-space-16)',
            borderRadius: 'var(--at-radius-4)',
            border: '1px solid var(--at-border)',
            background: 'var(--at-white)',
            color: rows.length === 0
              ? 'var(--at-fg-subtle)'
              : 'var(--at-fg)',
            fontSize: 'var(--at-fs-14)',
            fontWeight: 600,
            cursor: rows.length === 0
              ? 'not-allowed'
              : 'pointer',
          }}
        >
          <Download size={16} />
          Exportar JSONL
        </button>
      </div>
      <div style={{
        fontSize: 'var(--at-fs-14)',
        color: 'var(--at-fg-muted)',
        marginBottom: 'var(--at-space-24)',
      }}
      >
        Trilha imutável de cada interação no Assistente · retenção de 1 ano · append-only
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 'var(--at-space-12)',
        marginBottom: 'var(--at-space-24)',
      }}
      >
        <Kpi
          label="Eventos hoje"
          value={summary?.today}
          color="var(--at-fg)"
        />
        <Kpi
          label="Acessos a PII"
          value={summary?.pii}
          color="var(--at-danger-300)"
        />
        <Kpi
          label="Mudanças de regra"
          value={summary?.rule_changes}
          color="var(--at-info-100)"
        />
        <Kpi
          label="Total no log"
          value={summary?.total}
          color="var(--at-fg)"
        />
      </div>

      <div style={{
        display: 'flex',
        gap: 'var(--at-space-12)',
        marginBottom: 'var(--at-space-16)',
        flexWrap: 'wrap',
        alignItems: 'center',
        padding: 'var(--at-space-12)',
        background: 'var(--at-white)',
        border: '1px solid var(--at-border)',
        borderRadius: 8,
      }}
      >
        <select
          value={period}
          onChange={(event) => resetTo(() => setPeriod(event.target.value as PeriodType))}
          style={SELECT_STYLE}
        >
          {PERIODS.map((option) => (
            <option
              key={option.id}
              value={option.id}
            >
              {option.label}
            </option>
          ))}
        </select>

        <select
          value={user}
          onChange={(event) => resetTo(() => setUser(event.target.value))}
          style={SELECT_STYLE}
        >
          <option value="">Todos os usuários</option>
          {users.map((option) => (
            <option
              key={option.id}
              value={option.id}
            >
              {option.name ?? option.id}
            </option>
          ))}
        </select>

        <select
          value={action}
          onChange={(event) => resetTo(() => setAction(event.target.value))}
          style={SELECT_STYLE}
        >
          <option value="">Todos os tipos</option>
          {FILTERABLE_ACTIONS.map((value) => (
            <option
              key={value}
              value={value}
            >
              {ACTION_LABEL[value]}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={() => resetTo(() => setPiiOnly((value) => !value))}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--at-space-4)',
            height: 38,
            padding: '0 var(--at-space-12)',
            borderRadius: 'var(--at-radius-4)',
            border: `1px solid ${piiOnly
              ? 'var(--at-danger-200)'
              : 'var(--at-border)'}`,
            background: piiOnly
              ? 'var(--at-danger-50)'
              : 'var(--at-white)',
            color: piiOnly
              ? 'var(--at-danger-300)'
              : 'var(--at-fg-muted)',
            fontSize: 'var(--at-fs-12)',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          <Eye size={14} />
          Só acessos a PII
        </button>

        <div style={{
          position: 'relative',
          flex: 1,
          minWidth: 220,
        }}
        >
          <MagnifyingGlass
            size={16}
            style={{
              position: 'absolute',
              left: 12,
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--at-fg-subtle)',
            }}
          />
          <input
            value={search}
            onChange={(event) => resetTo(() => setSearch(event.target.value))}
            placeholder="Buscar por recurso ou detalhe…"
            style={{
              width: '100%',
              height: 38,
              padding: '0 12px 0 34px',
              border: '1px solid var(--at-border)',
              borderRadius: 'var(--at-radius-4)',
              fontFamily: 'inherit',
              fontSize: 'var(--at-fs-14)',
              color: 'var(--at-fg)',
            }}
          />
        </div>
      </div>

      <div style={{
        background: 'var(--at-white)',
        border: '1px solid var(--at-border)',
        borderRadius: 8,
        overflow: 'hidden',
      }}
      >
        <table style={{
          width: '100%',
          borderCollapse: 'collapse',
        }}
        >
          <thead>
            <tr style={{ background: 'var(--at-bg-soft)' }}>
              {[
                'Quando',
                'Usuário',
                'Ação',
                'Recurso',
                'Detalhe',
                '',
              ].map((column) => (
                <th
                  key={column}
                  style={{
                    textAlign: 'left',
                    padding: '9px 14px',
                    fontSize: 'var(--at-fs-12)',
                    fontWeight: 600,
                    color: 'var(--at-fg-muted)',
                    textTransform: 'uppercase',
                    letterSpacing: 0.4,
                    borderBottom: '1px solid var(--at-border)',
                  }}
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((entry) => (
              <AuditRow
                key={entry.id}
                entry={entry}
                isOpen={openId === entry.id}
                onToggle={() => setOpenId((current) => (current === entry.id
                  ? null
                  : entry.id))}
              />
            ))}
          </tbody>
        </table>
        {!audit.isLoading && rows.length === 0
          ? (
            <div style={{
              padding: 'var(--at-space-24)',
              textAlign: 'center',
              fontSize: 'var(--at-fs-14)',
              color: 'var(--at-fg-muted)',
            }}
            >
              Nenhum evento para os filtros atuais.
            </div>
          )
          : null}
      </div>

      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: 'var(--at-space-12)',
        marginTop: 'var(--at-space-16)',
        fontSize: 'var(--at-fs-12)',
        color: 'var(--at-fg-muted)',
      }}
      >
        <PagerButton
          label="‹ Anterior"
          disabled={page <= 1}
          onClick={() => setPage((value) => Math.max(
            1,
            value - 1,
          ))}
        />
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>
          Página {page} de {totalPages}
        </span>
        <PagerButton
          label="Próxima ›"
          disabled={page >= totalPages}
          onClick={() => setPage((value) => Math.min(
            totalPages,
            value + 1,
          ))}
        />
      </div>
    </div>
  );
}

/** Estilo comum dos selects de filtro. */
const SELECT_STYLE = {
  height: 38,
  padding: '0 12px',
  border: '1px solid var(--at-border)',
  borderRadius: 'var(--at-radius-4)',
  fontFamily: 'inherit',
  fontSize: 'var(--at-fs-14)',
  color: 'var(--at-fg)',
  background: 'var(--at-white)',
} as const;

/** Card de KPI. */
function Kpi({
  label,
  value,
  color,
}: {
  label: string;
  value: number | undefined;
  color: string
}): JSX.Element {
  return (
    <div style={{
      background: 'var(--at-white)',
      border: '1px solid var(--at-border)',
      borderRadius: 8,
      padding: 'var(--at-space-16)',
    }}
    >
      <div style={{
        fontSize: 'var(--at-fs-12)',
        fontWeight: 600,
        color: 'var(--at-fg-subtle)',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
      }}
      >
        {label}
      </div>
      <div style={{
        fontFamily: 'var(--at-font-heading)',
        fontSize: 'var(--at-fs-32)',
        fontWeight: 700,
        lineHeight: 1.1,
        marginTop: 'var(--at-space-4)',
        fontVariantNumeric: 'tabular-nums',
        color,
      }}
      >
        {value ?? '—'}
      </div>
    </div>
  );
}

/** Linha da tabela de auditoria (acessos a PII destacados). */
function AuditRow({
  entry,
  isOpen,
  onToggle,
}: {
  entry: AuditLogEntryInterface;
  isOpen: boolean;
  onToggle: () => void
}): JSX.Element {
  const isPii = entry.severity === 'pii';
  const color = SEVERITY_COLOR[entry.severity];
  const ActionIcon = ACTION_ICON[entry.action];

  const piiBackground = isPii
    ? '#C127220d'
    : 'transparent';

  const rowBackground = isOpen
    ? 'var(--at-bg-soft)'
    : piiBackground;

  return (
    <>
      <tr
        onClick={onToggle}
        style={{
          borderBottom: '1px solid var(--at-border)',
          cursor: 'pointer',
          background: rowBackground,
        }}
      >
        <td style={{
          padding: '9px 14px',
          fontFamily: 'ui-monospace, Menlo, monospace',
          fontSize: 'var(--at-fs-12)',
          color: 'var(--at-fg-muted)',
          whiteSpace: 'nowrap',
        }}
        >
          {formatWhen(entry.occurred_at)}
        </td>
        <td
          style={{
            padding: '9px 14px',
            fontSize: 'var(--at-fs-14)',
            color: 'var(--at-fg)',
          }}
          title={entry.user_id ?? undefined}
        >
          {entry.user_name ?? entry.user_id ?? '—'}
        </td>
        <td style={{ padding: '9px 14px' }}>
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--at-space-4)',
            fontSize: 'var(--at-fs-14)',
            fontWeight: isPii
              ? 600
              : 400,
            color: isPii
              ? color
              : 'var(--at-fg)',
          }}
          >
            <ActionIcon
              size={14}
              color={color}
              style={{ flexShrink: 0 }}
            />
            {ACTION_LABEL[entry.action]}
          </span>
        </td>
        <td style={{
          padding: '9px 14px',
          fontFamily: 'ui-monospace, Menlo, monospace',
          fontSize: 'var(--at-fs-12)',
          color: 'var(--at-fg-muted)',
        }}
        >
          {entry.resource}
        </td>
        <td style={{
          padding: '9px 14px',
          fontSize: 'var(--at-fs-12)',
          color: 'var(--at-fg-muted)',
        }}
        >
          {entry.detail ?? '—'}
        </td>
        <td style={{
          padding: '9px 8px',
          textAlign: 'right',
          color: 'var(--at-fg-subtle)',
        }}
        >
          <CaretDown
            size={13}
            style={{
              transform: isOpen
                ? 'rotate(180deg)'
                : 'rotate(0)',
              transition: 'transform .15s',
            }}
          />
        </td>
      </tr>
      {isOpen
        ? (
          <tr style={{
            borderBottom: '1px solid var(--at-border)',
            background: 'var(--at-bg-soft)',
          }}
          >
            <td
              colSpan={6}
              style={{ padding: '14px 18px' }}
            >
              <AuditDetail entry={entry} />
            </td>
          </tr>
        )
        : null}
    </>
  );
}

/**
 * Detalhe expansível de um evento de auditoria (campos crus + nota de imutabilidade), como no
 * protótipo. Aberto ao clicar na linha.
 *
 * @param {{ entry: AuditLogEntryInterface }} props - O evento.
 * @returns {JSX.Element} O painel de detalhe.
 */
function AuditDetail({ entry }: { entry: AuditLogEntryInterface }): JSX.Element {
  const fields: Array<[string, ReactNode]> = [
    [
      'ID',
      <code style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>{entry.id}</code>,
    ],
    [
      'Timestamp',
      <code style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>{formatWhen(entry.occurred_at)}</code>,
    ],
    [
      'Usuário',
      entry.user_name ?? entry.user_id ?? '—',
    ],
    [
      'Ação',
      ACTION_LABEL[entry.action],
    ],
    [
      'Recurso',
      <code style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>{entry.resource}</code>,
    ],
    [
      'Detalhe',
      entry.detail ?? '—',
    ],
    [
      'Severidade',
      entry.severity,
    ],
  ];

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'auto 1fr',
      gap: 'var(--at-space-4) var(--at-space-16)',
      fontSize: 'var(--at-fs-12)',
      alignItems: 'baseline',
    }}
    >
      {fields.map(([
        key,
        node,
      ]) => (
        <Fragment key={key}>
          <div style={{
            fontWeight: 600,
            color: 'var(--at-fg-muted)',
          }}
          >
            {key}
          </div>
          <div style={{ color: 'var(--at-fg)' }}>{node}</div>
        </Fragment>
      ))}
      <div style={{
        gridColumn: '1 / -1',
        marginTop: 'var(--at-space-8)',
        paddingTop: 'var(--at-space-8)',
        borderTop: '1px solid var(--at-border)',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--at-space-4)',
        fontSize: 'var(--at-fs-12)',
        color: 'var(--at-fg-subtle)',
      }}
      >
        <ShieldCheck size={12} />
        Este registro é imutável — não pode ser editado nem deletado.
      </div>
    </div>
  );
}

/** Botão de paginação. */
function PagerButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        height: 30,
        padding: '0 var(--at-space-12)',
        borderRadius: 'var(--at-radius-4)',
        border: '1px solid var(--at-border)',
        background: 'var(--at-white)',
        color: disabled
          ? 'var(--at-fg-subtle)'
          : 'var(--at-fg)',
        fontSize: 'var(--at-fs-12)',
        fontWeight: 600,
        cursor: disabled
          ? 'not-allowed'
          : 'pointer',
        opacity: disabled
          ? 0.6
          : 1,
      }}
    >
      {label}
    </button>
  );
}
