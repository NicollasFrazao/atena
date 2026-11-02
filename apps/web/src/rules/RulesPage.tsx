import { useState, type JSX } from 'react';
import { EyeSlashIcon as EyeSlash } from '@phosphor-icons/react';
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
import { cssValue, cssVar } from '../styles/tokens';

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
 * @returns A tela de regras.
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
      padding: cssVar.space32,
    }}
    >
      <h1 style={{
        margin: 0,
        marginBottom: cssVar.space4,
        fontSize: cssVar.fs24,
        fontWeight: 600,
        color: cssVar.fg,
      }}
      >
        Regras de anomalia
      </h1>
      <div style={{
        fontSize: cssVar.fs14,
        color: cssVar.fgMuted,
        marginBottom: cssVar.space24,
      }}
      >
        {rules.isLoading
          ? 'Carregando regras…'
          : `${activeCount} de ${list.length} regras ativas · alterações registradas em audit log`}
      </div>

      {rules.isError
        ? (
          <div style={{
            fontSize: cssVar.fs14,
            color: cssVar.fgMuted,
          }}
          >
            Não foi possível carregar as regras.
          </div>
        )
        : null}

      {list.length > 0
        ? (
          <div style={{
            background: cssVar.white,
            border: cssVar.borderLine,
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
                <tr style={{ background: cssVar.bgSoft }}>
                  {COLUMNS.map((column) => (
                    <th
                      key={column}
                      style={{
                        textAlign: 'left',
                        padding: '9px 14px',
                        fontSize: cssVar.fs12,
                        fontWeight: 600,
                        color: cssVar.fgMuted,
                        textTransform: 'uppercase',
                        letterSpacing: 0.4,
                        borderBottom: cssVar.borderLine,
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
                    onToggle={() => { onToggle(rule); }}
                    onEdit={() => { setEditTarget(rule); }}
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
            onClose={() => { setEditTarget(null); }}
            onSaved={onSaved}
          />
        )
        : null}
    </div>
  );
}

/** Opacity of the row of a disabled rule. */
const DISABLED_RULE_OPACITY = 0.55;

/** Linha da tabela de regras. */
function RuleRow({
  rule,
  onToggle,
  onEdit,
}: Readonly<{
  rule: AnomalyRuleInterface;
  onToggle: () => void;
  onEdit: () => void
}>): JSX.Element {
  return (
    <tr
      className="at-row-click"
      onClick={onEdit}
      style={{
        borderBottom: cssVar.borderLine,
        opacity: rule.enabled
          ? 1
          : DISABLED_RULE_OPACITY,
      }}
    >
      <Cell>
        <span style={{
          display: 'flex',
          alignItems: 'center',
          gap: cssVar.space8,
        }}
        >
          <span style={{
            fontSize: cssVar.fs14,
            fontWeight: 600,
            color: cssVar.fg,
          }}
          >
            {rule.name}
          </span>
          {rule.shadow_mode
            ? <ShadowBadge />
            : null}
        </span>
        <code style={{
          fontFamily: cssValue.fontMono,
          fontSize: cssVar.fs12,
          color: cssVar.fgSubtle,
        }}
        >
          {rule.id}
        </code>
        <span style={{
          display: 'block',
          maxWidth: 420,
          marginTop: cssVar.space4,
          fontSize: cssVar.fs12,
          color: cssVar.fgMuted,
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
          fontSize: cssVar.fs12,
          color: cssVar.fg,
        }}
        >
          {formatRelativeTime(rule.updated_at)}
        </span>
        {rule.updated_by !== null
          ? (
            <span style={{
              display: 'block',
              fontSize: cssVar.fs12,
              color: cssVar.fgSubtle,
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
          fontSize: cssVar.fs16,
          color: cssVar.fgSubtle,
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
}: Readonly<{
  children: React.ReactNode;
  muted?: boolean;
  mono?: boolean
}>): JSX.Element {
  return (
    <td style={{
      padding: '10px 14px',
      verticalAlign: 'middle',
      fontSize: cssVar.fs14,
      fontFamily: mono
        ? cssValue.fontMono
        : 'inherit',
      fontVariantNumeric: mono
        ? cssValue.tabularNums
        : undefined,
      color: muted
        ? cssVar.fgMuted
        : cssVar.fg,
    }}
    >
      {children}
    </td>
  );
}

/** Chip de severidade (cor + rótulo). */
function SeverityChip({ severity }: Readonly<{ severity: AnomalyRuleInterface['severity'] }>): JSX.Element {
  const color = SEVERITY_COLOR[severity];

  return (
    <span style={{
      display: cssValue.inlineFlex,
      alignItems: 'center',
      gap: cssVar.space4,
      padding: '2px 8px',
      borderRadius: 999,
      background: `${color}1a`,
      color,
      fontSize: cssVar.fs12,
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
        display: cssValue.inlineFlex,
        alignItems: 'center',
        gap: cssVar.space4,
        padding: '2px 8px',
        borderRadius: 999,
        background: cssVar.bgSoft,
        border: cssVar.borderLine,
        color: cssVar.fgMuted,
        fontSize: cssVar.fs12,
        fontWeight: 600,
      }}
    >
      <EyeSlash size={11} />
      shadow
    </span>
  );
}

/** Left offset of the toggle knob when on: track width (38) − knob (18) − inset (2). */
const TOGGLE_KNOB_ON_LEFT_PX = 18;

/** Toggle de ativação (switch). */
function Switch({
  checked,
  onToggle,
}: Readonly<{
  checked: boolean;
  onToggle: () => void
}>): JSX.Element {
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
          ? cssVar.primary
          : cssVar.border,
        cursor: 'pointer',
        position: 'relative',
        transition: 'background .2s',
      }}
    >
      <span style={{
        position: 'absolute',
        top: 2,
        left: checked
          ? TOGGLE_KNOB_ON_LEFT_PX
          : 2,
        width: 18,
        height: 18,
        borderRadius: 999,
        background: cssVar.white,
        transition: 'left .2s',
        boxShadow: '0 1px 2px rgba(0, 0, 0, 0.2)',
      }}
      />
    </button>
  );
}
