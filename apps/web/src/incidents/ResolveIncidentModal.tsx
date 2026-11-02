import { useEffect, useState, type JSX } from 'react';
import { FlagIcon as Flag, InfoIcon as Info, XIcon } from '@phosphor-icons/react';
import type {
  ActionCategoryType,
  IncidentInterface,
  ResolveIncidentPayload,
} from '@atena/types';
import { ApiError } from '../api/client';
import { resolveIncident } from '../api/incidents';
import { SEVERITY_COLOR, SEVERITY_LABEL } from './severity';
import { cssValue, cssVar } from '../styles/tokens';

/** Comprimento mínimo da descrição da ação (regra §D; o servidor revalida). */
const MIN_DESCRIPTION = 20;

/** Categoria de ação ao resolver: rótulo, descrição e se exige destino de escalonamento. */
interface CategoryOptionInterface {
  value: ActionCategoryType;
  title: string;
  hint: string;
  escalation?: boolean;
}

/** Opções de categoria (ordem e textos do protótipo). */
const CATEGORIES: CategoryOptionInterface[] = [
  {
    value: 'provider_recovered',
    title: 'Fornecedor se recuperou sozinho',
    hint: 'Anomalia voltou ao normal sem ação.',
  },
  {
    value: 'provider_escalated',
    title: 'Escalado para o fornecedor',
    hint: 'Ticket / contato comercial aberto.',
    escalation: true,
  },
  {
    value: 'internal_escalated',
    title: 'Escalado para outro time interno',
    hint: 'Tech, infra, comercial…',
    escalation: true,
  },
  {
    value: 'false_positive',
    title: 'Falso positivo',
    hint: 'Regra precisa ser ajustada.',
  },
  {
    value: 'customer_communicated',
    title: 'Cliente(s) comunicado(s)',
    hint: 'Aviso enviado pelo canal apropriado.',
  },
  {
    value: 'monitoring_only',
    title: 'Apenas monitoramento',
    hint: 'Sem ação necessária no momento.',
  },
  {
    value: 'other',
    title: 'Outro motivo',
    hint: 'Exige descrição mais detalhada.',
  },
];

/** Categorias que exigem o campo `escalated_to`. */
const ESCALATION_CATEGORIES = new Set<ActionCategoryType>([
  'provider_escalated',
  'internal_escalated',
]);

/**
 * Modal de resolução manual de incidente (§D): escolha de categoria, descrição (≥ 20 chars) e, quando
 * escalonado, o destino. Ao confirmar, chama `POST /incidents/:id/resolve` e devolve via `onResolved`.
 *
 * @param props - Incidente + callbacks.
 * @param props.incident - Incidente a resolver (id, severidade, regra).
 * @param props.onClose - Fecha o modal sem resolver.
 * @param props.onResolved - Chamado após resolver com sucesso (invalida/atualiza a lista).
 *
 * @returns O modal de resolução.
 */
export function ResolveIncidentModal({
  incident,
  onClose,
  onResolved,
}: Readonly<{
  incident: IncidentInterface;
  onClose: () => void;
  onResolved: () => void
}>): JSX.Element {
  const [
    category,
    setCategory,
  ] = useState<ActionCategoryType | null>(null);

  const [
    description,
    setDescription,
  ] = useState('');

  const [
    escalatedTo,
    setEscalatedTo,
  ] = useState('');

  const [
    tags,
    setTags,
  ] = useState<string[]>([]);

  const [
    newTag,
    setNewTag,
  ] = useState('');

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

  const needsEscalation = category !== null && ESCALATION_CATEGORIES.has(category);

  const valid = category !== null
    && description.trim().length >= MIN_DESCRIPTION
    && (!needsEscalation || escalatedTo.trim().length > 0);

  const submit = (): void => {
    if (
      category === null
      || !valid
      || submitting
    ) {
      return;
    }

    setSubmitting(true);
    setError(null);

    const payload: ResolveIncidentPayload = {
      action_category: category,
      action_description: description.trim(),
      ...(needsEscalation
        ? { escalated_to: escalatedTo.trim() }
        : {}),
      ...(tags.length > 0
        ? { tags }
        : {}),
    };

    resolveIncident(
      incident.id,
      payload,
    )
      .then(() => { onResolved(); })
      .catch((err: unknown) => {
        setError(err instanceof ApiError
          ? err.message
          : 'Não foi possível resolver o incidente.');

        setSubmitting(false);
      });
  };

  const removeTag = (tag: string): void => {
    setTags((current) => current.filter((item) => item !== tag));
  };

  const addTag = (): void => {
    const value = newTag.trim();

    if (!value) {
      return;
    }

    setTags((current) => [
      ...current,
      value,
    ]);

    setNewTag('');
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Resolver incidente"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'rgba(0, 0, 0, 0.4)',
        display: 'grid',
        placeItems: 'center',
        padding: cssVar.space16,
      }}
    >
      <div
        onClick={(event) => { event.stopPropagation(); }}
        style={{
          width: '100%',
          maxWidth: 640,
          maxHeight: '90vh',
          overflowY: 'auto',
          background: cssVar.white,
          border: cssVar.borderLine,
          borderRadius: 8,
          boxShadow: '0 20px 48px rgba(0, 0, 0, 0.2)',
        }}
      >
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: cssVar.space8,
          padding: cssVar.space20,
          borderBottom: cssVar.borderLine,
        }}
        >
          <Flag
            size={18}
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
            Resolver incidente
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

        <div style={{ padding: cssVar.space20 }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: cssVar.space8,
            marginBottom: cssVar.space20,
          }}
          >
            <code style={{
              fontFamily: cssValue.fontMono,
              fontSize: cssVar.fs12,
              fontWeight: 600,
              color: cssVar.fgMuted,
            }}
            >
              {incident.id}
            </code>
            <span style={{
              display: cssValue.inlineFlex,
              alignItems: 'center',
              gap: cssVar.space4,
              padding: '2px 8px',
              borderRadius: 999,
              background: `${SEVERITY_COLOR[incident.severity]}1a`,
              color: SEVERITY_COLOR[incident.severity],
              fontSize: cssVar.fs12,
              fontWeight: 600,
            }}
            >
              {SEVERITY_LABEL[incident.severity]}
            </span>
            <span style={{
              fontSize: cssVar.fs12,
              color: cssVar.fgMuted,
            }}
            >
              {incident.rule}
            </span>
          </div>

          <FieldLabel required>Categoria da ação</FieldLabel>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: cssVar.space8,
            marginTop: cssVar.space8,
            marginBottom: cssVar.space16,
          }}
          >
            {CATEGORIES.map((option) => (
              <CategoryCard
                key={option.value}
                option={option}
                selected={category === option.value}
                onSelect={() => { setCategory(option.value); }}
              />
            ))}
          </div>

          <div style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: cssValue.spaceBetween,
          }}
          >
            <FieldLabel required>Descrição da ação</FieldLabel>
            <span style={{
              fontSize: cssVar.fs12,
              color: description.trim().length >= MIN_DESCRIPTION
                ? cssVar.fgSubtle
                : cssVar.danger300,
              fontVariantNumeric: cssValue.tabularNums,
            }}
            >
              Mínimo {MIN_DESCRIPTION} caracteres · {description.trim().length}/{MIN_DESCRIPTION}
            </span>
          </div>
          <textarea
            value={description}
            onChange={(event) => { setDescription(event.target.value); }}
            placeholder="O que foi feito ou observado, em linguagem natural? Ex.: 'Contatei o fornecedor pelo canal comercial; confirmaram instabilidade e normalizaram às 14:18. Validei recuperação até 97% às 14:25.'"
            rows={4}
            style={{
              width: '100%',
              marginTop: cssVar.space8,
              padding: '10px 12px',
              resize: 'vertical',
              border: cssVar.borderLine,
              borderRadius: cssVar.radius4,
              fontFamily: 'inherit',
              fontSize: cssVar.fs14,
              lineHeight: cssVar.lh22,
              color: cssVar.fg,
            }}
          />

          {needsEscalation
            ? (
              <div style={{ marginTop: cssVar.space16 }}>
                <FieldLabel required>Para quem escalou</FieldLabel>
                <input
                  value={escalatedTo}
                  onChange={(event) => { setEscalatedTo(event.target.value); }}
                  placeholder="Ex.: Twilio Support — ticket #91234"
                  style={{
                    width: '100%',
                    marginTop: cssVar.space8,
                    height: 38,
                    padding: '0 12px',
                    border: cssVar.borderLine,
                    borderRadius: cssVar.radius4,
                    fontFamily: 'inherit',
                    fontSize: cssVar.fs14,
                    color: cssVar.fg,
                  }}
                />
              </div>
            )
            : null}

          <div style={{ marginTop: cssVar.space16 }}>
            <div style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: cssValue.spaceBetween,
              gap: cssVar.space8,
            }}
            >
              <FieldLabel>Tags</FieldLabel>
              <span style={{
                fontSize: cssVar.fs12,
                color: cssVar.fgSubtle,
              }}
              >
                Opcional — para organização e auditoria
              </span>
            </div>
            <div style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: cssVar.space4,
              marginTop: cssVar.space8,
            }}
            >
              {tags.map((tag) => (
                <span
                  key={tag}
                  style={{
                    display: cssValue.inlineFlex,
                    alignItems: 'center',
                    gap: cssVar.space4,
                    height: 26,
                    padding: '0 4px 0 10px',
                    borderRadius: 999,
                    background: cssVar.primaryLighter,
                    color: cssVar.primaryDark,
                    border: '1px solid var(--at-primary-light)',
                    fontSize: cssVar.fs12,
                    fontWeight: 600,
                  }}
                >
                  {tag}
                  <button
                    type="button"
                    onClick={() => { removeTag(tag); }}
                    aria-label={`Remover ${tag}`}
                    style={{
                      display: 'grid',
                      placeItems: 'center',
                      width: 16,
                      height: 16,
                      border: 'none',
                      background: 'transparent',
                      color: cssVar.primary,
                      cursor: 'pointer',
                    }}
                  >
                    <XIcon size={11} />
                  </button>
                </span>
              ))}
              <input
                value={newTag}
                onChange={(event) => { setNewTag(event.target.value); }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addTag();
                  }
                }}
                placeholder="+ tag"
                style={{
                  height: 26,
                  width: 90,
                  padding: '0 8px',
                  background: 'transparent',
                  border: '1px dashed var(--at-border)',
                  borderRadius: 999,
                  outline: 'none',
                  fontFamily: 'inherit',
                  fontSize: cssVar.fs12,
                  color: cssVar.fgMuted,
                }}
              />
            </div>
          </div>

          <div style={{
            display: 'flex',
            gap: cssVar.space8,
            marginTop: cssVar.space16,
            padding: '12px',
            background: cssVar.primaryLighter,
            border: '1px solid var(--at-primary-light)',
            borderRadius: cssVar.radius4,
            fontSize: cssVar.fs12,
            color: cssVar.primaryDark,
            lineHeight: cssVar.lh22,
          }}
          >
            <Info
              size={15}
              style={{
                flexShrink: 0,
                marginTop: 1,
              }}
            />
            <span>
              Esta ação será registrada no audit log e usada nos relatórios gerenciais. O assistente{' '}
              <b>não</b> resolve incidentes — apenas você pode fechar com a categoria correta.
            </span>
          </div>

          {error !== null
            ? (
              <div style={{
                marginTop: cssVar.space16,
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
          justifyContent: 'flex-end',
          gap: cssVar.space8,
          padding: 'var(--at-space-16) var(--at-space-20)',
          borderTop: cssVar.borderLine,
        }}
        >
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
            disabled={!valid || submitting}
            style={{
              display: cssValue.inlineFlex,
              alignItems: 'center',
              gap: cssVar.space8,
              height: 36,
              padding: '0 var(--at-space-16)',
              borderRadius: cssVar.radius4,
              border: 'none',
              background: valid && !submitting
                ? cssVar.primary
                : cssVar.bgSoft,
              color: valid && !submitting
                ? cssVar.white
                : cssVar.fgSubtle,
              fontSize: cssVar.fs14,
              fontWeight: 600,
              cursor: valid && !submitting
                ? 'pointer'
                : 'not-allowed',
            }}
          >
            <Flag size={15} />
            {submitting
              ? 'Resolvendo…'
              : 'Resolver incidente'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Rótulo de campo do formulário (com asterisco quando obrigatório). */
function FieldLabel({
  children,
  required,
}: Readonly<{
  children: string;
  required?: boolean
}>): JSX.Element {
  return (
    <label style={{
      fontSize: cssVar.fs12,
      fontWeight: 600,
      color: cssVar.fg,
    }}
    >
      {children}
      {required
        ? <span style={{ color: cssVar.danger300 }}> *</span>
        : null}
    </label>
  );
}

/** Card selecionável de categoria de ação. */
function CategoryCard({
  option,
  selected,
  onSelect,
}: Readonly<{
  option: CategoryOptionInterface;
  selected: boolean;
  onSelect: () => void
}>): JSX.Element {
  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        textAlign: 'left',
        padding: '10px 12px',
        borderRadius: cssVar.radius4,
        border: `1px solid ${selected
          ? cssVar.primary
          : cssVar.border}`,
        background: selected
          ? cssVar.primaryLighter
          : cssVar.white,
        cursor: 'pointer',
        font: 'inherit',
      }}
    >
      <span style={{
        display: 'block',
        fontSize: cssVar.fs14,
        fontWeight: 600,
        color: selected
          ? cssVar.primaryDark
          : cssVar.fg,
      }}
      >
        {option.title}
      </span>
      <span style={{
        display: 'block',
        fontSize: cssVar.fs12,
        color: cssVar.fgMuted,
        marginTop: 2,
      }}
      >
        {option.hint}
      </span>
    </button>
  );
}
