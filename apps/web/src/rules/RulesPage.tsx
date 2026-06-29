import { useState } from 'react';
import { EyeSlash } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import type { AnomalyRuleInterface } from '@atena/types';
import { updateRule, useRules } from '../api/rules';
import { SEVERITY_COLOR, SEVERITY_LABEL } from '../incidents/severity';
import { formatRelativeTime } from '../util/time';
import {
  DIMENSION_LABEL,
  formatThreshold,
  ruleDescription,
} from './rule-labels';
import { RuleEditDrawer } from './RuleEditDrawer';

/** Colunas da tabela de regras. */
const COLUMNS = [
  'Regra',
  'Dimensão',
  'Severidade',
  'Threshold',
  'Janela',
  'Atualizada',
  'Ativa',
  '',
];

/**
 * Tela de Regras de anomalia: tabela com os campos da regra, ativação inline (toggle → `PUT enabled`)
 * e edição (limiar/dimensão/janela/severidade) via modal. Sem "Nova regra" — não há endpoint de
 * criação; só `GET`/`PUT`. Toda alteração é auditada no servidor.
 *
 * @returns {JSX.Element} A tela de regras.
 */
export function RulesPage(): JSX.Element {
  const queryClient = useQueryClient();
  const rules = useRules();

  const [
    editTarget,
    setEditTarget,
  ] = useState<AnomalyRuleInterface | null>(null);

  const invalidate = (): void => {
    queryClient.invalidateQueries({ queryKey: ['rules'] }).catch(() => undefined);
  };

  const onToggle = (rule: AnomalyRuleInterface): void => {
    updateRule(
      rule.id,
      { enabled: !rule.enabled },
    )
      .then(invalidate)
      .catch(() => undefined);
  };

  const onSaved = (): void => {
    setEditTarget(null);
    invalidate();
  };

  const list = rules.data ?? [];
  const activeCount = list.filter((rule) => rule.enabled).length;

  return (
    <div style={{
      maxWidth: 1200,
      margin: '0 auto',
      padding: 'var(--at-space-32)',
    }}
    >
      <h1 style={{
        margin: 0,
        marginBottom: 'var(--at-space-4)',
        fontSize: 'var(--at-fs-24)',
        fontWeight: 600,
        color: 'var(--at-fg)',
      }}
      >
        Regras de anomalia
      </h1>
      <div style={{
        fontSize: 'var(--at-fs-14)',
        color: 'var(--at-fg-muted)',
        marginBottom: 'var(--at-space-24)',
      }}
      >
        {rules.isLoading
          ? 'Carregando regras…'
          : `${activeCount} de ${list.length} regras ativas · alterações registradas em audit log`}
      </div>

      {rules.isError
        ? (
          <div style={{
            fontSize: 'var(--at-fs-14)',
            color: 'var(--at-fg-muted)',
          }}
          >
            Não foi possível carregar as regras.
          </div>
        )
        : null}

      {list.length > 0
        ? (
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
                  {COLUMNS.map((column) => (
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
                {list.map((rule) => (
                  <RuleRow
                    key={rule.id}
                    rule={rule}
                    onToggle={() => onToggle(rule)}
                    onEdit={() => setEditTarget(rule)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )
        : null}

      {editTarget !== null
        ? (
          <RuleEditDrawer
            rule={editTarget}
            onClose={() => setEditTarget(null)}
            onSaved={onSaved}
          />
        )
        : null}
    </div>
  );
}

/** Linha da tabela de regras. */
function RuleRow({
  rule,
  onToggle,
  onEdit,
}: {
  rule: AnomalyRuleInterface;
  onToggle: () => void;
  onEdit: () => void
}): JSX.Element {
  return (
    <tr
      className="at-row-click"
      onClick={onEdit}
      style={{
        borderBottom: '1px solid var(--at-border)',
        opacity: rule.enabled
          ? 1
          : 0.55,
      }}
    >
      <Cell>
        <span style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--at-space-8)',
        }}
        >
          <span style={{
            fontSize: 'var(--at-fs-14)',
            fontWeight: 600,
            color: 'var(--at-fg)',
          }}
          >
            {rule.name}
          </span>
          {rule.shadow_mode
            ? <ShadowBadge />
            : null}
        </span>
        <code style={{
          fontFamily: 'ui-monospace, Menlo, monospace',
          fontSize: 'var(--at-fs-12)',
          color: 'var(--at-fg-subtle)',
        }}
        >
          {rule.id}
        </code>
        <span style={{
          display: 'block',
          maxWidth: 420,
          marginTop: 'var(--at-space-4)',
          fontSize: 'var(--at-fs-12)',
          color: 'var(--at-fg-muted)',
          lineHeight: 'var(--at-lh-18, 1.4)',
        }}
        >
          {ruleDescription(rule)}
        </span>
      </Cell>
      <Cell muted>{DIMENSION_LABEL[rule.dimension]}</Cell>
      <Cell>
        <SeverityChip severity={rule.severity} />
      </Cell>
      <Cell mono>{formatThreshold(rule)}</Cell>
      <Cell muted>{rule.window_minutes} min</Cell>
      <Cell>
        <span style={{
          display: 'block',
          fontSize: 'var(--at-fs-12)',
          color: 'var(--at-fg)',
        }}
        >
          {formatRelativeTime(rule.updated_at)}
        </span>
        {rule.updated_by !== null
          ? (
            <span style={{
              display: 'block',
              fontSize: 'var(--at-fs-12)',
              color: 'var(--at-fg-subtle)',
            }}
            >
              por {rule.updated_by}
            </span>
          )
          : null}
      </Cell>
      <Cell>
        <Switch
          checked={rule.enabled}
          onToggle={onToggle}
        />
      </Cell>
      <Cell>
        <span style={{
          fontSize: 'var(--at-fs-16)',
          color: 'var(--at-fg-subtle)',
        }}
        >
          ›
        </span>
      </Cell>
    </tr>
  );
}

/** Célula da tabela. */
function Cell({
  children,
  muted,
  mono,
}: {
  children: React.ReactNode;
  muted?: boolean;
  mono?: boolean
}): JSX.Element {
  return (
    <td style={{
      padding: '10px 14px',
      verticalAlign: 'middle',
      fontSize: 'var(--at-fs-14)',
      fontFamily: mono
        ? 'ui-monospace, Menlo, monospace'
        : 'inherit',
      fontVariantNumeric: mono
        ? 'tabular-nums'
        : undefined,
      color: muted
        ? 'var(--at-fg-muted)'
        : 'var(--at-fg)',
    }}
    >
      {children}
    </td>
  );
}

/** Chip de severidade (cor + rótulo). */
function SeverityChip({ severity }: { severity: AnomalyRuleInterface['severity'] }): JSX.Element {
  const color = SEVERITY_COLOR[severity];

  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 'var(--at-space-4)',
      padding: '2px 8px',
      borderRadius: 999,
      background: `${color}1a`,
      color,
      fontSize: 'var(--at-fs-12)',
      fontWeight: 600,
    }}
    >
      <span style={{
        width: 6,
        height: 6,
        borderRadius: 999,
        background: color,
      }}
      />
      {SEVERITY_LABEL[severity]}
    </span>
  );
}

/** Selo de "shadow mode" (observação silenciosa) exibido junto ao nome da regra. */
function ShadowBadge(): JSX.Element {
  return (
    <span
      title="Shadow mode: detecta e registra, mas não notifica (calibração)"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--at-space-4)',
        padding: '2px 8px',
        borderRadius: 999,
        background: 'var(--at-bg-soft)',
        border: '1px solid var(--at-border)',
        color: 'var(--at-fg-muted)',
        fontSize: 'var(--at-fs-12)',
        fontWeight: 600,
      }}
    >
      <EyeSlash size={11} />
      shadow
    </span>
  );
}

/** Toggle de ativação (switch). */
function Switch({
  checked,
  onToggle,
}: {
  checked: boolean;
  onToggle: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      style={{
        width: 38,
        height: 22,
        padding: 0,
        border: 'none',
        borderRadius: 999,
        background: checked
          ? 'var(--at-primary)'
          : 'var(--at-border)',
        cursor: 'pointer',
        position: 'relative',
        transition: 'background .2s',
      }}
    >
      <span style={{
        position: 'absolute',
        top: 2,
        left: checked
          ? 18
          : 2,
        width: 18,
        height: 18,
        borderRadius: 999,
        background: 'var(--at-white)',
        transition: 'left .2s',
        boxShadow: '0 1px 2px rgba(0, 0, 0, 0.2)',
      }}
      />
    </button>
  );
}
