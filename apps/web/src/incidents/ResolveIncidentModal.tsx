import { useEffect, useState } from 'react';
import { Flag, Info, X } from '@phosphor-icons/react';
import type {
  ActionCategoryType,
  IncidentInterface,
  ResolveIncidentPayload,
} from '@atena/types';
import { ApiError } from '../api/client';
import { resolveIncident } from '../api/incidents';
import { SEVERITY_COLOR, SEVERITY_LABEL } from './severity';

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
 * @param {object} props - Incidente + callbacks.
 * @param {IncidentInterface} props.incident - Incidente a resolver (id, severidade, regra).
 * @param {() => void} props.onClose - Fecha o modal sem resolver.
 * @param {() => void} props.onResolved - Chamado após resolver com sucesso (invalida/atualiza a lista).
 * @returns {JSX.Element} O modal de resolução.
 */
export function ResolveIncidentModal({
  incident,
  onClose,
  onResolved,
}: {
  incident: IncidentInterface;
  onClose: () => void;
  onResolved: () => void
}): JSX.Element {
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

      return () => document.removeEventListener(
        'keydown',
        onKey,
      );
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
      .then(() => onResolved())
      .catch((err: unknown) => {
        setError(err instanceof ApiError
          ? err.message
          : 'Não foi possível resolver o incidente.');

        setSubmitting(false);
      });
  };

  const removeTag = (tag: string): void => setTags((current) => current.filter((item) => item !== tag));

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
        padding: 'var(--at-space-16)',
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 640,
          maxHeight: '90vh',
          overflowY: 'auto',
          background: 'var(--at-white)',
          border: '1px solid var(--at-border)',
          borderRadius: 8,
          boxShadow: '0 20px 48px rgba(0, 0, 0, 0.2)',
        }}
      >
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--at-space-8)',
          padding: 'var(--at-space-20)',
          borderBottom: '1px solid var(--at-border)',
        }}
        >
          <Flag
            size={18}
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
              color: 'var(--at-fg-muted)',
              cursor: 'pointer',
            }}
          >
            <X size={16} />
          </button>
        </div>

        <div style={{ padding: 'var(--at-space-20)' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--at-space-8)',
            marginBottom: 'var(--at-space-20)',
          }}
          >
            <code style={{
              fontFamily: 'ui-monospace, Menlo, monospace',
              fontSize: 'var(--at-fs-12)',
              fontWeight: 600,
              color: 'var(--at-fg-muted)',
            }}
            >
              {incident.id}
            </code>
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 'var(--at-space-4)',
              padding: '2px 8px',
              borderRadius: 999,
              background: `${SEVERITY_COLOR[incident.severity]}1a`,
              color: SEVERITY_COLOR[incident.severity],
              fontSize: 'var(--at-fs-12)',
              fontWeight: 600,
            }}
            >
              {SEVERITY_LABEL[incident.severity]}
            </span>
            <span style={{
              fontSize: 'var(--at-fs-12)',
              color: 'var(--at-fg-muted)',
            }}
            >
              {incident.rule}
            </span>
          </div>

          <FieldLabel required>Categoria da ação</FieldLabel>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: 'var(--at-space-8)',
            marginTop: 'var(--at-space-8)',
            marginBottom: 'var(--at-space-16)',
          }}
          >
            {CATEGORIES.map((option) => (
              <CategoryCard
                key={option.value}
                option={option}
                selected={category === option.value}
                onSelect={() => setCategory(option.value)}
              />
            ))}
          </div>

          <div style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
          }}
          >
            <FieldLabel required>Descrição da ação</FieldLabel>
            <span style={{
              fontSize: 'var(--at-fs-12)',
              color: description.trim().length >= MIN_DESCRIPTION
                ? 'var(--at-fg-subtle)'
                : 'var(--at-danger-300)',
              fontVariantNumeric: 'tabular-nums',
            }}
            >
              Mínimo {MIN_DESCRIPTION} caracteres · {description.trim().length}/{MIN_DESCRIPTION}
            </span>
          </div>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="O que foi feito ou observado, em linguagem natural? Ex.: 'Contatei o fornecedor pelo canal comercial; confirmaram instabilidade e normalizaram às 14:18. Validei recuperação até 97% às 14:25.'"
            rows={4}
            style={{
              width: '100%',
              marginTop: 'var(--at-space-8)',
              padding: '10px 12px',
              resize: 'vertical',
              border: '1px solid var(--at-border)',
              borderRadius: 'var(--at-radius-4)',
              fontFamily: 'inherit',
              fontSize: 'var(--at-fs-14)',
              lineHeight: 'var(--at-lh-22)',
              color: 'var(--at-fg)',
            }}
          />

          {needsEscalation
            ? (
              <div style={{ marginTop: 'var(--at-space-16)' }}>
                <FieldLabel required>Para quem escalou</FieldLabel>
                <input
                  value={escalatedTo}
                  onChange={(event) => setEscalatedTo(event.target.value)}
                  placeholder="Ex.: Twilio Support — ticket #91234"
                  style={{
                    width: '100%',
                    marginTop: 'var(--at-space-8)',
                    height: 38,
                    padding: '0 12px',
                    border: '1px solid var(--at-border)',
                    borderRadius: 'var(--at-radius-4)',
                    fontFamily: 'inherit',
                    fontSize: 'var(--at-fs-14)',
                    color: 'var(--at-fg)',
                  }}
                />
              </div>
            )
            : null}

          <div style={{ marginTop: 'var(--at-space-16)' }}>
            <div style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: 'var(--at-space-8)',
            }}
            >
              <FieldLabel>Tags</FieldLabel>
              <span style={{
                fontSize: 'var(--at-fs-12)',
                color: 'var(--at-fg-subtle)',
              }}
              >
                Opcional — para organização e auditoria
              </span>
            </div>
            <div style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 'var(--at-space-4)',
              marginTop: 'var(--at-space-8)',
            }}
            >
              {tags.map((tag) => (
                <span
                  key={tag}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 'var(--at-space-4)',
                    height: 26,
                    padding: '0 4px 0 10px',
                    borderRadius: 999,
                    background: 'var(--at-primary-lighter)',
                    color: 'var(--at-primary-dark)',
                    border: '1px solid var(--at-primary-light)',
                    fontSize: 'var(--at-fs-12)',
                    fontWeight: 600,
                  }}
                >
                  {tag}
                  <button
                    type="button"
                    onClick={() => removeTag(tag)}
                    aria-label={`Remover ${tag}`}
                    style={{
                      display: 'grid',
                      placeItems: 'center',
                      width: 16,
                      height: 16,
                      border: 'none',
                      background: 'transparent',
                      color: 'var(--at-primary)',
                      cursor: 'pointer',
                    }}
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
              <input
                value={newTag}
                onChange={(event) => setNewTag(event.target.value)}
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
                  fontSize: 'var(--at-fs-12)',
                  color: 'var(--at-fg-muted)',
                }}
              />
            </div>
          </div>

          <div style={{
            display: 'flex',
            gap: 'var(--at-space-8)',
            marginTop: 'var(--at-space-16)',
            padding: '12px',
            background: 'var(--at-primary-lighter)',
            border: '1px solid var(--at-primary-light)',
            borderRadius: 'var(--at-radius-4)',
            fontSize: 'var(--at-fs-12)',
            color: 'var(--at-primary-dark)',
            lineHeight: 'var(--at-lh-22)',
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
                marginTop: 'var(--at-space-16)',
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
          justifyContent: 'flex-end',
          gap: 'var(--at-space-8)',
          padding: 'var(--at-space-16) var(--at-space-20)',
          borderTop: '1px solid var(--at-border)',
        }}
        >
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
            disabled={!valid || submitting}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 'var(--at-space-8)',
              height: 36,
              padding: '0 var(--at-space-16)',
              borderRadius: 'var(--at-radius-4)',
              border: 'none',
              background: valid && !submitting
                ? 'var(--at-primary)'
                : 'var(--at-bg-soft)',
              color: valid && !submitting
                ? 'var(--at-white)'
                : 'var(--at-fg-subtle)',
              fontSize: 'var(--at-fs-14)',
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
}: {
  children: string;
  required?: boolean
}): JSX.Element {
  return (
    <label style={{
      fontSize: 'var(--at-fs-12)',
      fontWeight: 600,
      color: 'var(--at-fg)',
    }}
    >
      {children}
      {required
        ? <span style={{ color: 'var(--at-danger-300)' }}> *</span>
        : null}
    </label>
  );
}

/** Card selecionável de categoria de ação. */
function CategoryCard({
  option,
  selected,
  onSelect,
}: {
  option: CategoryOptionInterface;
  selected: boolean;
  onSelect: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        textAlign: 'left',
        padding: '10px 12px',
        borderRadius: 'var(--at-radius-4)',
        border: `1px solid ${selected
          ? 'var(--at-primary)'
          : 'var(--at-border)'}`,
        background: selected
          ? 'var(--at-primary-lighter)'
          : 'var(--at-white)',
        cursor: 'pointer',
        font: 'inherit',
      }}
    >
      <span style={{
        display: 'block',
        fontSize: 'var(--at-fs-14)',
        fontWeight: 600,
        color: selected
          ? 'var(--at-primary-dark)'
          : 'var(--at-fg)',
      }}
      >
        {option.title}
      </span>
      <span style={{
        display: 'block',
        fontSize: 'var(--at-fs-12)',
        color: 'var(--at-fg-muted)',
        marginTop: 2,
      }}
      >
        {option.hint}
      </span>
    </button>
  );
}
