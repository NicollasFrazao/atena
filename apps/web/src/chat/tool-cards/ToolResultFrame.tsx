import { type ReactNode } from 'react';
import { toolLabel } from '../tools-catalog';

/** Props da moldura compartilhada dos cards de resultado de tool. */
export interface ToolResultFrameProps {
  /** Ícone exibido no badge à esquerda do header. */
  icon: ReactNode;
  /** Nome técnico da tool (exibido como rótulo legível em PT-BR). */
  toolName: string;
  /** Título legível do card. */
  title: string;
  /** Subtítulo opcional (contexto da consulta). */
  subtitle?: string;
  /** Slot de ações alinhado à direita do header (ex.: link CSV). */
  actions?: ReactNode;
  /** Corpo do card. */
  children: ReactNode;
}

/**
 * Moldura compartilhada dos cards de resultado de tool: header com ícone, nome técnico
 * em monoespaçada, título, subtítulo opcional e slot de ações; corpo com os `children`.
 *
 * @param {ToolResultFrameProps} props - Conteúdo do header e corpo.
 * @returns {JSX.Element} A moldura do card.
 */
export function ToolResultFrame({
  icon,
  toolName,
  title,
  subtitle,
  actions,
  children,
}: ToolResultFrameProps): JSX.Element {
  return (
    <div style={{
      marginTop: 'var(--at-space-8)',
      background: 'var(--at-white)',
      border: '1px solid var(--at-border)',
      borderRadius: 'var(--at-radius-8)',
      overflow: 'hidden',
      boxShadow: 'var(--at-shadow-xs)',
    }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--at-space-8)',
        padding: '10px 14px',
        background: 'var(--at-primary-lighter)',
        borderBottom: '1px solid var(--at-border)',
      }}
      >
        <div style={{
          display: 'grid',
          placeItems: 'center',
          width: 22,
          height: 22,
          borderRadius: 'var(--at-radius-4)',
          background: 'var(--at-white)',
          color: 'var(--at-primary)',
          boxShadow: 'inset 0 0 0 1px var(--at-border)',
        }}
        >
          {icon}
        </div>
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          minWidth: 0,
        }}
        >
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--at-space-8)',
            flexWrap: 'wrap',
          }}
          >
            <span style={{
              fontSize: 'var(--at-fs-12)',
              fontWeight: 600,
              color: 'var(--at-primary)',
            }}
            >
              {toolLabel(toolName)}
            </span>
            <span style={{
              fontSize: 11,
              color: 'var(--at-fg-subtle)',
            }}
            >
              ·
            </span>
            <span style={{
              fontSize: 'var(--at-fs-12)',
              fontWeight: 600,
              color: 'var(--at-fg)',
            }}
            >
              {title}
            </span>
          </div>
          {subtitle
            ? <div style={{
              fontSize: 11,
              color: 'var(--at-fg-muted)',
            }}
            >
              {subtitle}
            </div>
            : null}
        </div>
        {actions}
      </div>
      <div>{children}</div>
    </div>
  );
}
