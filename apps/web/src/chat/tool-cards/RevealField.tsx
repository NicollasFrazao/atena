import { useEffect, useState } from 'react';
import { CircleNotch, Eye, ShieldWarning } from '@phosphor-icons/react';
import { ApiError } from '../../api/client';
import { revealContent, revealPhone, type RevealWindowInterface } from '../reveal';
import { formatPhone } from './format';

/** Tipo de PII a revelar: telefone completo ou conteúdo bruto do envio. */
type RevealKindType = 'phone' | 'content';

/**
 * Estados do reveal. `confirming` abre o modal de confirmação (PII é auditada); `unavailable` é
 * distinto de `error` — indica que o dado NÃO existe nesta fonte (ex.: o detailed report não carrega
 * o texto do envio), então não adianta "tentar de novo".
 */
type RevealStateType = 'idle' | 'confirming' | 'loading' | 'revealed' | 'error' | 'unavailable';

const MONO = {
  fontFamily: 'ui-monospace, Menlo, monospace',
  fontVariantNumeric: 'tabular-nums',
} as const;

/** Botão-ícone do olho (gatilho do reveal): só o ícone, sem moldura, alinhado ao texto ao lado. */
const EYE_BUTTON = {
  appearance: 'none',
  border: 'none',
  background: 'none',
  padding: 2,
  margin: 0,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  borderRadius: 'var(--at-radius-4)',
  color: 'var(--at-fg-subtle)',
} as const;

/**
 * Revela PII (telefone/conteúdo) sob demanda. O gatilho é um botão com um "olho"; ao clicar, abre um
 * modal de confirmação (a ação é auditada). Só após confirmar é que o endpoint auditado é chamado e o
 * valor aparece em claro. O valor revelado vive só no estado local (efêmero, nunca logado).
 *
 * @param {object} props - Propriedades do campo.
 * @param {string} props.shippingId - Id do envio (id da linha de busca / shipping_id da trilha).
 * @param {RevealKindType} props.kind - `phone` (mostra o mascarado + olho) ou `content` (só o olho).
 * @param {string} [props.masked] - Valor mascarado exibido enquanto não revelado (telefone).
 * @param {RevealWindowInterface} [props.window] - Janela do contexto (search/trilha) que escopa o lookup.
 * @returns {JSX.Element} O campo de reveal no estado atual.
 */
export function RevealField({
  shippingId,
  kind,
  masked,
  window,
}: {
  shippingId: string;
  kind: RevealKindType;
  masked?: string;
  window?: RevealWindowInterface
}): JSX.Element {
  const [
    state,
    setState,
  ] = useState<RevealStateType>('idle');

  const [
    value,
    setValue,
  ] = useState<string | null>(null);

  const reveal = async (): Promise<void> => {
    setState('loading');

    try {
      const revealed = kind === 'phone'
        ? formatPhone((await revealPhone(
          shippingId,
          window,
        )).phone_full)
        : (await revealContent(
          shippingId,
          window,
        )).content_preview;

      setValue(revealed);
      setState('revealed');
    } catch (err) {
      const code = err instanceof ApiError
        ? err.code
        : null;

      // `not_found` = o registro não está na janela do contexto (ex.: sessão antiga sem janela, ou
      // dado fora da fonte). Tentar de novo não ajuda → estado terminal `unavailable` (sem retry).
      const terminal = code === 'content_unavailable'
        || code === 'not_found';

      setState(terminal
        ? 'unavailable'
        : 'error');
    }
  };

  if (
    state === 'revealed'
    && value !== null
  ) {
    return (
      <span
        title="PII revelada — ação auditada"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 'var(--at-space-4)',
          color: 'var(--at-fg)',
          ...(kind === 'phone'
            ? MONO
            : {}),
        }}
      >
        <Eye
          size={13}
          style={{
            color: 'var(--at-primary)',
            flexShrink: 0,
          }}
        />
        {value}
      </span>
    );
  }

  if (state === 'loading') {
    return (
      <span
        title="Revelando…"
        aria-label="Revelando…"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          color: 'var(--at-fg-subtle)',
        }}
      >
        <CircleNotch
          size={13}
          className="at-spin"
        />
      </span>
    );
  }

  if (state === 'unavailable') {
    const unavailableText = kind === 'phone'
      ? 'telefone indisponível nesta janela'
      : 'conteúdo não disponível nesta fonte';

    const unavailableTitle = kind === 'phone'
      ? 'O registro deste envio não está na janela do contexto (ex.: sessão antiga). Reabra a busca/trilha no período do envio para revelar.'
      : 'O relatório de auditoria registra status e metadados de entrega, não o texto do envio.';

    return (
      <span
        title={unavailableTitle}
        style={{
          fontSize: 11,
          color: 'var(--at-fg-subtle)',
          fontStyle: 'italic',
        }}
      >
        {unavailableText}
      </span>
    );
  }

  const failed = state === 'error';

  const kindLabel = kind === 'phone'
    ? 'telefone'
    : 'conteúdo';

  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 'var(--at-space-4)',
    }}
    >
      {masked
        ? <span style={MONO}>{masked}</span>
        : null}
      <button
        type="button"
        onClick={() => setState('confirming')}
        aria-label={`Revelar ${kindLabel}`}
        title={failed
          ? 'Não foi possível revelar — clique para tentar de novo'
          : `Revelar ${kindLabel} · ação auditada`}
        style={{
          ...EYE_BUTTON,
          color: failed
            ? 'var(--at-danger-300)'
            : 'var(--at-fg-subtle)',
        }}
      >
        <Eye size={14} />
      </button>
      {state === 'confirming'
        ? (
          <ConfirmRevealModal
            kind={kind}
            onConfirm={() => void reveal()}
            onCancel={() => setState('idle')}
          />
        )
        : null}
    </span>
  );
}

/**
 * Modal de confirmação do reveal: explica que a ação é auditada e pede confirmação explícita antes de
 * expor a PII. Fecha no backdrop, no "Cancelar" ou com Esc.
 *
 * @param {object} props - Propriedades do modal.
 * @param {RevealKindType} props.kind - O que será revelado (telefone/conteúdo), para o texto.
 * @param {() => void} props.onConfirm - Confirma e dispara o reveal auditado.
 * @param {() => void} props.onCancel - Cancela e fecha o modal.
 * @returns {JSX.Element} O modal.
 */
function ConfirmRevealModal({
  kind,
  onConfirm,
  onCancel,
}: {
  kind: RevealKindType;
  onConfirm: () => void;
  onCancel: () => void
}): JSX.Element {
  useEffect(
    () => {
      const onKey = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') {
          onCancel();
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
    [onCancel],
  );

  const target = kind === 'phone'
    ? 'o telefone completo'
    : 'o conteúdo do envio';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Confirmar reveal de PII"
      onClick={onCancel}
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
          maxWidth: 380,
          background: 'var(--at-white)',
          border: '1px solid var(--at-border)',
          borderRadius: 8,
          boxShadow: '0 16px 40px rgba(0, 0, 0, 0.18)',
          padding: 'var(--at-space-20)',
          textAlign: 'left',
        }}
      >
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--at-space-8)',
          marginBottom: 'var(--at-space-12)',
        }}
        >
          <span style={{
            width: 28,
            height: 28,
            borderRadius: 'var(--at-radius-4)',
            background: 'var(--at-warning-50)',
            color: 'var(--at-warning-200)',
            display: 'grid',
            placeItems: 'center',
            flexShrink: 0,
          }}
          >
            <ShieldWarning size={16} />
          </span>
          <span style={{
            fontSize: 'var(--at-fs-14)',
            fontWeight: 600,
            color: 'var(--at-fg)',
          }}
          >
            Revelar PII · ação auditada
          </span>
        </div>
        <p style={{
          margin: 0,
          fontSize: 'var(--at-fs-12)',
          color: 'var(--at-fg-muted)',
          lineHeight: 'var(--at-lh-22)',
        }}
        >
          Você vai revelar {target}. Esta ação é registrada no audit log (usuário, horário e
          contexto). Revele apenas com necessidade investigativa real.
        </p>
        <div style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 'var(--at-space-8)',
          marginTop: 'var(--at-space-20)',
        }}
        >
          <button
            type="button"
            onClick={onCancel}
            style={{
              height: 32,
              padding: '0 var(--at-space-12)',
              borderRadius: 'var(--at-radius-4)',
              border: '1px solid var(--at-border)',
              background: 'var(--at-white)',
              color: 'var(--at-fg)',
              fontSize: 'var(--at-fs-12)',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 'var(--at-space-4)',
              height: 32,
              padding: '0 var(--at-space-12)',
              borderRadius: 'var(--at-radius-4)',
              border: 'none',
              background: 'var(--at-primary)',
              color: 'var(--at-white)',
              fontSize: 'var(--at-fs-12)',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <Eye size={13} />
            Revelar e registrar
          </button>
        </div>
      </div>
    </div>
  );
}
