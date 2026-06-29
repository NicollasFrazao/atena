import { useEffect, useState } from 'react';
import { Gear, Warning, X } from '@phosphor-icons/react';
import type {
  AnomalyRuleInterface,
  DimensionType,
  IncidentSeverityType,
  UpdateRulePayload,
} from '@atena/types';
import { ApiError } from '../api/client';
import { updateRule } from '../api/rules';
import { SEVERITY_COLOR, SEVERITY_LABEL } from '../incidents/severity';
import {
  DIMENSION_LABEL,
  DIMENSIONS,
  ruleDescription,
  RULE_TYPE_LABEL,
} from './rule-labels';

/** Severidades selecionáveis (ordem crescente de impacto). */
const SEVERITIES: IncidentSeverityType[] = [
  'info',
  'warning',
  'critical',
];

/** Estado editável do rascunho da regra. */
interface DraftInterface {
  name: string;
  threshold: string;
  windowMinutes: string;
  dimension: DimensionType;
  severity: IncidentSeverityType;
  enabled: boolean;
  shadowMode: boolean;
}

/** Cria o rascunho a partir da regra. */
function toDraft(rule: AnomalyRuleInterface): DraftInterface {
  return {
    name: rule.name,
    threshold: String(rule.threshold),
    windowMinutes: String(rule.window_minutes),
    dimension: rule.dimension,
    severity: rule.severity,
    enabled: rule.enabled,
    shadowMode: rule.shadow_mode,
  };
}

/**
 * Drawer lateral (slide-over) de edição de regra de anomalia, fiel ao protótipo: nome, tipo
 * (imutável), dimensão (grade), severidade (segmented), limiar (input + unidade), janela, e o
 * toggle de ativação no rodapé. Salva via `PUT /rules/:id` (auditado); o botão Salvar só habilita
 * quando há mudança.
 *
 * @param {object} props - Regra + callbacks.
 * @param {AnomalyRuleInterface} props.rule - Regra a editar.
 * @param {() => void} props.onClose - Fecha sem salvar.
 * @param {() => void} props.onSaved - Chamado após salvar com sucesso.
 * @returns {JSX.Element} O drawer de edição.
 */
export function RuleEditDrawer({
  rule,
  onClose,
  onSaved,
}: {
  rule: AnomalyRuleInterface;
  onClose: () => void;
  onSaved: () => void
}): JSX.Element {
  const [
    draft,
    setDraft,
  ] = useState<DraftInterface>(() => toDraft(rule));

  const [
    submitting,
    setSubmitting,
  ] = useState(false);

  const [
    error,
    setError,
  ] = useState<string | null>(null);

  useEffect(
    () => {
      const onKey = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') {
          onClose();
        }
      };

      document.addEventListener(
        'keydown',
        onKey,
      );

      return () => document.removeEventListener(
        'keydown',
        onKey,
      );
    },
    [onClose],
  );

  const patch = (next: Partial<DraftInterface>): void => setDraft((current) => ({
    ...current,
    ...next,
  }));

  const thresholdNumber = Number(draft.threshold);
  const windowNumber = Number(draft.windowMinutes);

  const valid = draft.name.trim().length > 0
    && draft.threshold.trim() !== ''
    && Number.isFinite(thresholdNumber)
    && thresholdNumber >= 0
    && Number.isInteger(windowNumber)
    && windowNumber >= 1;

  const dirty = draft.name !== rule.name
    || thresholdNumber !== rule.threshold
    || windowNumber !== rule.window_minutes
    || draft.dimension !== rule.dimension
    || draft.severity !== rule.severity
    || draft.enabled !== rule.enabled
    || draft.shadowMode !== rule.shadow_mode;

  const submit = (): void => {
    if (
      !valid
      || !dirty
      || submitting
    ) {
      return;
    }

    setSubmitting(true);
    setError(null);

    const payload: UpdateRulePayload = {
      name: draft.name.trim(),
      threshold: thresholdNumber,
      window_minutes: windowNumber,
      dimension: draft.dimension,
      severity: draft.severity,
      enabled: draft.enabled,
      shadow_mode: draft.shadowMode,
    };

    updateRule(
      rule.id,
      payload,
    )
      .then(() => onSaved())
      .catch((err: unknown) => {
        setError(err instanceof ApiError
          ? err.message
          : 'Não foi possível salvar a regra.');

        setSubmitting(false);
      });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Editar regra"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        justifyContent: 'flex-end',
        background: 'rgba(0, 0, 0, 0.5)',
      }}
    >
      <div
        className="at-slide-right"
        onClick={(event) => event.stopPropagation()}
        style={{
          width: 'min(520px, 100%)',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--at-white)',
          boxShadow: '-12px 0 40px rgba(0, 0, 0, 0.2)',
        }}
      >
        <div style={{
          padding: 'var(--at-space-20) var(--at-space-24)',
          borderBottom: '1px solid var(--at-border)',
        }}
        >
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--at-space-8)',
          }}
          >
            <Gear
              size={16}
              color="var(--at-primary)"
            />
            <h2 style={{
              margin: 0,
              flex: 1,
              fontSize: 'var(--at-fs-18)',
              fontWeight: 600,
              color: 'var(--at-fg)',
            }}
            >
              Editar regra
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar"
              style={{
                display: 'grid',
                placeItems: 'center',
                width: 28,
                height: 28,
                border: 'none',
                background: 'transparent',
                color: 'var(--at-fg-muted)',
                cursor: 'pointer',
              }}
            >
              <X size={16} />
            </button>
          </div>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--at-space-8)',
            marginTop: 'var(--at-space-8)',
          }}
          >
            <code style={{
              fontFamily: 'ui-monospace, Menlo, monospace',
              fontSize: 'var(--at-fs-12)',
              color: 'var(--at-fg-muted)',
            }}
            >
              {rule.id}
            </code>
            <SeverityChip severity={draft.severity} />
          </div>
        </div>

        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: 'var(--at-space-20) var(--at-space-24)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--at-space-20)',
        }}
        >
          <Field
            label="Nome da regra"
            required
          >
            <input
              value={draft.name}
              onChange={(event) => patch({ name: event.target.value })}
              style={INPUT_STYLE}
            />
          </Field>

          <Field label="Tipo">
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--at-space-8)',
              padding: '10px 12px',
              background: 'var(--at-bg-soft)',
              border: '1px solid var(--at-border)',
              borderRadius: 'var(--at-radius-4)',
              fontSize: 'var(--at-fs-14)',
              color: 'var(--at-fg-muted)',
            }}
            >
              {RULE_TYPE_LABEL[rule.rule_type]}
              <span style={{
                marginLeft: 'auto',
                fontSize: 'var(--at-fs-12)',
              }}
              >
                imutável
              </span>
            </div>
            <span style={{
              fontSize: 'var(--at-fs-12)',
              color: 'var(--at-fg-muted)',
              lineHeight: 'var(--at-lh-22)',
            }}
            >
              {ruleDescription(rule)}
            </span>
          </Field>

          <Field label="Dimensão de monitoramento">
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 'var(--at-space-4)',
            }}
            >
              {DIMENSIONS.map((value) => (
                <SelectableButton
                  key={value}
                  selected={draft.dimension === value}
                  onClick={() => patch({ dimension: value })}
                >
                  {DIMENSION_LABEL[value]}
                </SelectableButton>
              ))}
            </div>
          </Field>

          <Field label="Severidade do incidente disparado">
            <div style={{
              display: 'flex',
              gap: 'var(--at-space-4)',
            }}
            >
              {SEVERITIES.map((value) => (
                <SelectableButton
                  key={value}
                  selected={draft.severity === value}
                  onClick={() => patch({ severity: value })}
                  grow
                >
                  <span style={{
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    background: SEVERITY_COLOR[value],
                  }}
                  />
                  {SEVERITY_LABEL[value]}
                </SelectableButton>
              ))}
            </div>
          </Field>

          <Field label="Limiar (threshold)">
            <div style={{
              display: 'flex',
              gap: 'var(--at-space-8)',
            }}
            >
              <input
                type="number"
                value={draft.threshold}
                min={0}
                step="any"
                onChange={(event) => patch({ threshold: event.target.value })}
                style={{
                  ...INPUT_STYLE,
                  flex: 1,
                  height: 44,
                  fontFamily: 'var(--at-font-heading)',
                  fontSize: 'var(--at-fs-18)',
                  fontWeight: 600,
                  fontVariantNumeric: 'tabular-nums',
                }}
              />
              <div style={{
                width: 56,
                display: 'grid',
                placeItems: 'center',
                background: 'var(--at-bg-soft)',
                border: '1px solid var(--at-border)',
                borderRadius: 'var(--at-radius-4)',
                fontSize: 'var(--at-fs-14)',
                fontWeight: 600,
                color: 'var(--at-fg-muted)',
              }}
              >
                {rule.threshold_unit}
              </div>
            </div>
          </Field>

          <Field label="Janela de avaliação">
            <div style={{
              display: 'flex',
              gap: 'var(--at-space-8)',
            }}
            >
              <input
                type="number"
                value={draft.windowMinutes}
                min={1}
                step={1}
                onChange={(event) => patch({ windowMinutes: event.target.value })}
                style={{
                  ...INPUT_STYLE,
                  flex: 1,
                  fontVariantNumeric: 'tabular-nums',
                }}
              />
              <div style={{
                width: 80,
                display: 'grid',
                placeItems: 'center',
                background: 'var(--at-bg-soft)',
                border: '1px solid var(--at-border)',
                borderRadius: 'var(--at-radius-4)',
                fontSize: 'var(--at-fs-13)',
                color: 'var(--at-fg-muted)',
              }}
              >
                minutos
              </div>
            </div>
          </Field>

          <div style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 'var(--at-space-12)',
            padding: '12px',
            border: `1px solid ${draft.shadowMode
              ? 'var(--at-primary)'
              : 'var(--at-border)'}`,
            borderRadius: 'var(--at-radius-4)',
            background: draft.shadowMode
              ? 'var(--at-primary-lighter)'
              : 'var(--at-white)',
          }}
          >
            <Switch
              checked={draft.shadowMode}
              onToggle={() => patch({ shadowMode: !draft.shadowMode })}
            />
            <div>
              <div style={{
                fontSize: 'var(--at-fs-13)',
                fontWeight: 600,
                color: 'var(--at-fg)',
              }}
              >
                Shadow mode (observação silenciosa)
              </div>
              <div style={{
                fontSize: 'var(--at-fs-12)',
                color: 'var(--at-fg-muted)',
                marginTop: 'var(--at-space-4)',
                lineHeight: 'var(--at-lh-22)',
              }}
              >
                Detecta e registra o incidente, mas <b>não notifica</b> (sem WebSocket/banner). Use
                para calibrar thresholds antes de ligar o alerta.
              </div>
            </div>
          </div>

          <div style={{
            display: 'flex',
            gap: 'var(--at-space-8)',
            padding: '12px',
            background: 'var(--at-warning-50)',
            border: '1px solid var(--at-warning-200)',
            borderRadius: 'var(--at-radius-4)',
          }}
          >
            <Warning
              size={16}
              color="var(--at-warning-200)"
              style={{
                flexShrink: 0,
                marginTop: 2,
              }}
            />
            <div style={{
              fontSize: 'var(--at-fs-12)',
              color: 'var(--at-warning-300)',
              lineHeight: 'var(--at-lh-22)',
            }}
            >
              Mudanças nesta regra são aplicadas imediatamente ao detector. Antes de afrouxar limiares,
              verifique se a regra <b>não está</b> sub-disparada — falsa sensação de tranquilidade é o
              pior cenário.
            </div>
          </div>

          {error !== null
            ? (
              <div style={{
                padding: '10px 12px',
                borderRadius: 'var(--at-radius-4)',
                background: 'var(--at-danger-50)',
                border: '1px solid var(--at-danger-200)',
                fontSize: 'var(--at-fs-12)',
                color: 'var(--at-danger-300)',
              }}
              >
                {error}
              </div>
            )
            : null}
        </div>

        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--at-space-8)',
          padding: 'var(--at-space-16) var(--at-space-24)',
          borderTop: '1px solid var(--at-border)',
          background: 'var(--at-bg-soft)',
        }}
        >
          <Switch
            checked={draft.enabled}
            onToggle={() => patch({ enabled: !draft.enabled })}
          />
          <span style={{
            fontSize: 'var(--at-fs-13)',
            fontWeight: 600,
            color: 'var(--at-fg)',
          }}
          >
            {draft.enabled
              ? 'Habilitada'
              : 'Desabilitada'}
          </span>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            onClick={onClose}
            style={{
              height: 36,
              padding: '0 var(--at-space-16)',
              borderRadius: 'var(--at-radius-4)',
              border: '1px solid var(--at-border)',
              background: 'var(--at-white)',
              color: 'var(--at-fg)',
              fontSize: 'var(--at-fs-14)',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!valid || !dirty || submitting}
            style={{
              height: 36,
              padding: '0 var(--at-space-16)',
              borderRadius: 'var(--at-radius-4)',
              border: 'none',
              background: valid && dirty && !submitting
                ? 'var(--at-primary)'
                : 'var(--at-bg-soft)',
              color: valid && dirty && !submitting
                ? 'var(--at-white)'
                : 'var(--at-fg-subtle)',
              fontSize: 'var(--at-fs-14)',
              fontWeight: 600,
              cursor: valid && dirty && !submitting
                ? 'pointer'
                : 'not-allowed',
            }}
          >
            {submitting
              ? 'Salvando…'
              : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Estilo comum dos inputs de texto/número. */
const INPUT_STYLE = {
  width: '100%',
  height: 38,
  padding: '0 12px',
  border: '1.5px solid var(--at-border)',
  borderRadius: 'var(--at-radius-4)',
  fontFamily: 'inherit',
  fontSize: 'var(--at-fs-14)',
  color: 'var(--at-fg)',
  outline: 'none',
  background: 'var(--at-white)',
} as const;

/** Campo rotulado (label acima do controle). */
function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode
}): JSX.Element {
  return (
    <label style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--at-space-8)',
    }}
    >
      <span style={{
        fontSize: 'var(--at-fs-12)',
        fontWeight: 600,
        color: 'var(--at-fg)',
      }}
      >
        {label}
        {required
          ? <span style={{ color: 'var(--at-danger-300)' }}> *</span>
          : null}
      </span>
      {children}
    </label>
  );
}

/** Botão selecionável (grade de dimensão / segmented de severidade). */
function SelectableButton({
  selected,
  onClick,
  grow,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  grow?: boolean;
  children: React.ReactNode
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: grow
          ? 1
          : undefined,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--at-space-4)',
        padding: '8px 10px',
        borderRadius: 'var(--at-radius-4)',
        border: `1px solid ${selected
          ? 'var(--at-primary)'
          : 'var(--at-border)'}`,
        background: selected
          ? 'var(--at-primary-lighter)'
          : 'var(--at-white)',
        color: selected
          ? 'var(--at-primary-dark)'
          : 'var(--at-fg)',
        fontSize: 'var(--at-fs-12)',
        fontWeight: 600,
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

/** Chip de severidade (cor + rótulo) para o cabeçalho do drawer. */
function SeverityChip({ severity }: { severity: IncidentSeverityType }): JSX.Element {
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
      onClick={onToggle}
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
        flexShrink: 0,
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
