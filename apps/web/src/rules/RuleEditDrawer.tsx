import { useEffect, useState, type JSX } from 'react';
import { GearIcon as Gear, WarningIcon as Warning, XIcon } from '@phosphor-icons/react';
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
import { cssValue, cssVar } from '../styles/tokens';

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
 * @param props - Regra + callbacks.
 * @param props.rule - Regra a editar.
 * @param props.onClose - Fecha sem salvar.
 * @param props.onSaved - Chamado após salvar com sucesso.
 *
 * @returns O drawer de edição.
 */
export function RuleEditDrawer({
  rule,
  onClose,
  onSaved,
}: Readonly<{
  rule: AnomalyRuleInterface;
  onClose: () => void;
  onSaved: () => void
}>): JSX.Element {
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

      return () => {
        document.removeEventListener(
          'keydown',
          onKey,
        );
      };
    },
    [onClose],
  );

  const patch = (next: Partial<DraftInterface>): void => {
    setDraft((current) => ({
      ...current,
      ...next,
    }));
  };

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
      .then(() => { onSaved(); })
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
        onClick={(event) => { event.stopPropagation(); }}
        style={{
          width: 'min(520px, 100%)',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: cssVar.white,
          boxShadow: '-12px 0 40px rgba(0, 0, 0, 0.2)',
        }}
      >
        <div style={{
          padding: 'var(--at-space-20) var(--at-space-24)',
          borderBottom: cssVar.borderLine,
        }}
        >
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: cssVar.space8,
          }}
          >
            <Gear
              size={16}
              color={cssVar.primary}
            />
            <h2 style={{
              margin: 0,
              flex: 1,
              fontSize: cssVar.fs18,
              fontWeight: 600,
              color: cssVar.fg,
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
                color: cssVar.fgMuted,
                cursor: 'pointer',
              }}
            >
              <XIcon size={16} />
            </button>
          </div>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: cssVar.space8,
            marginTop: cssVar.space8,
          }}
          >
            <code style={{
              fontFamily: cssValue.fontMono,
              fontSize: cssVar.fs12,
              color: cssVar.fgMuted,
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
          gap: cssVar.space20,
        }}
        >
          <Field
            label="Nome da regra"
            required
          >
            <input
              value={draft.name}
              onChange={(event) => { patch({ name: event.target.value }); }}
              style={INPUT_STYLE}
            />
          </Field>

          <Field label="Tipo">
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: cssVar.space8,
              padding: '10px 12px',
              background: cssVar.bgSoft,
              border: cssVar.borderLine,
              borderRadius: cssVar.radius4,
              fontSize: cssVar.fs14,
              color: cssVar.fgMuted,
            }}
            >
              {RULE_TYPE_LABEL[rule.rule_type]}
              <span style={{
                marginLeft: 'auto',
                fontSize: cssVar.fs12,
              }}
              >
                imutável
              </span>
            </div>
            <span style={{
              fontSize: cssVar.fs12,
              color: cssVar.fgMuted,
              lineHeight: cssVar.lh22,
            }}
            >
              {ruleDescription(rule)}
            </span>
          </Field>

          <Field label="Dimensão de monitoramento">
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: cssVar.space4,
            }}
            >
              {DIMENSIONS.map((value) => (
                <SelectableButton
                  key={value}
                  selected={draft.dimension === value}
                  onClick={() => { patch({ dimension: value }); }}
                >
                  {DIMENSION_LABEL[value]}
                </SelectableButton>
              ))}
            </div>
          </Field>

          <Field label="Severidade do incidente disparado">
            <div style={{
              display: 'flex',
              gap: cssVar.space4,
            }}
            >
              {SEVERITIES.map((value) => (
                <SelectableButton
                  key={value}
                  selected={draft.severity === value}
                  onClick={() => { patch({ severity: value }); }}
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
              gap: cssVar.space8,
            }}
            >
              <input
                type="number"
                value={draft.threshold}
                min={0}
                step="any"
                onChange={(event) => { patch({ threshold: event.target.value }); }}
                style={{
                  ...INPUT_STYLE,
                  flex: 1,
                  height: 44,
                  fontFamily: cssVar.fontHeading,
                  fontSize: cssVar.fs18,
                  fontWeight: 600,
                  fontVariantNumeric: cssValue.tabularNums,
                }}
              />
              <div style={{
                width: 56,
                display: 'grid',
                placeItems: 'center',
                background: cssVar.bgSoft,
                border: cssVar.borderLine,
                borderRadius: cssVar.radius4,
                fontSize: cssVar.fs14,
                fontWeight: 600,
                color: cssVar.fgMuted,
              }}
              >
                {rule.threshold_unit}
              </div>
            </div>
          </Field>

          <Field label="Janela de avaliação">
            <div style={{
              display: 'flex',
              gap: cssVar.space8,
            }}
            >
              <input
                type="number"
                value={draft.windowMinutes}
                min={1}
                step={1}
                onChange={(event) => { patch({ windowMinutes: event.target.value }); }}
                style={{
                  ...INPUT_STYLE,
                  flex: 1,
                  fontVariantNumeric: cssValue.tabularNums,
                }}
              />
              <div style={{
                width: 80,
                display: 'grid',
                placeItems: 'center',
                background: cssVar.bgSoft,
                border: cssVar.borderLine,
                borderRadius: cssVar.radius4,
                fontSize: cssVar.fs13,
                color: cssVar.fgMuted,
              }}
              >
                minutos
              </div>
            </div>
          </Field>

          <div style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: cssVar.space12,
            padding: '12px',
            border: `1px solid ${draft.shadowMode
              ? cssVar.primary
              : cssVar.border}`,
            borderRadius: cssVar.radius4,
            background: draft.shadowMode
              ? cssVar.primaryLighter
              : cssVar.white,
          }}
          >
            <Switch
              checked={draft.shadowMode}
              onToggle={() => { patch({ shadowMode: !draft.shadowMode }); }}
            />
            <div>
              <div style={{
                fontSize: cssVar.fs13,
                fontWeight: 600,
                color: cssVar.fg,
              }}
              >
                Shadow mode (observação silenciosa)
              </div>
              <div style={{
                fontSize: cssVar.fs12,
                color: cssVar.fgMuted,
                marginTop: cssVar.space4,
                lineHeight: cssVar.lh22,
              }}
              >
                Detecta e registra o incidente, mas <b>não notifica</b> (sem WebSocket/banner). Use
                para calibrar thresholds antes de ligar o alerta.
              </div>
            </div>
          </div>

          <div style={{
            display: 'flex',
            gap: cssVar.space8,
            padding: '12px',
            background: cssVar.warning50,
            border: '1px solid var(--at-warning-200)',
            borderRadius: cssVar.radius4,
          }}
          >
            <Warning
              size={16}
              color={cssVar.warning200}
              style={{
                flexShrink: 0,
                marginTop: 2,
              }}
            />
            <div style={{
              fontSize: cssVar.fs12,
              color: cssVar.warning300,
              lineHeight: cssVar.lh22,
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
                borderRadius: cssVar.radius4,
                background: cssVar.danger50,
                border: '1px solid var(--at-danger-200)',
                fontSize: cssVar.fs12,
                color: cssVar.danger300,
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
          gap: cssVar.space8,
          padding: 'var(--at-space-16) var(--at-space-24)',
          borderTop: cssVar.borderLine,
          background: cssVar.bgSoft,
        }}
        >
          <Switch
            checked={draft.enabled}
            onToggle={() => { patch({ enabled: !draft.enabled }); }}
          />
          <span style={{
            fontSize: cssVar.fs13,
            fontWeight: 600,
            color: cssVar.fg,
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
              borderRadius: cssVar.radius4,
              border: cssVar.borderLine,
              background: cssVar.white,
              color: cssVar.fg,
              fontSize: cssVar.fs14,
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
              borderRadius: cssVar.radius4,
              border: 'none',
              background: valid && dirty && !submitting
                ? cssVar.primary
                : cssVar.bgSoft,
              color: valid && dirty && !submitting
                ? cssVar.white
                : cssVar.fgSubtle,
              fontSize: cssVar.fs14,
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
  borderRadius: cssVar.radius4,
  fontFamily: 'inherit',
  fontSize: cssVar.fs14,
  color: cssVar.fg,
  outline: 'none',
  background: cssVar.white,
} as const;

/** Campo rotulado (label acima do controle). */
function Field({
  label,
  required,
  children,
}: Readonly<{
  label: string;
  required?: boolean;
  children: React.ReactNode
}>): JSX.Element {
  return (
    <label style={{
      display: 'flex',
      flexDirection: 'column',
      gap: cssVar.space8,
    }}
    >
      <span style={{
        fontSize: cssVar.fs12,
        fontWeight: 600,
        color: cssVar.fg,
      }}
      >
        {label}
        {required
          ? <span style={{ color: cssVar.danger300 }}> *</span>
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
}: Readonly<{
  selected: boolean;
  onClick: () => void;
  grow?: boolean;
  children: React.ReactNode
}>): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: grow
          ? 1
          : undefined,
        display: cssValue.inlineFlex,
        alignItems: 'center',
        justifyContent: 'center',
        gap: cssVar.space4,
        padding: '8px 10px',
        borderRadius: cssVar.radius4,
        border: `1px solid ${selected
          ? cssVar.primary
          : cssVar.border}`,
        background: selected
          ? cssVar.primaryLighter
          : cssVar.white,
        color: selected
          ? cssVar.primaryDark
          : cssVar.fg,
        fontSize: cssVar.fs12,
        fontWeight: 600,
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

/** Chip de severidade (cor + rótulo) para o cabeçalho do drawer. */
function SeverityChip({ severity }: Readonly<{ severity: IncidentSeverityType }>): JSX.Element {
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
      onClick={onToggle}
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
        flexShrink: 0,
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
