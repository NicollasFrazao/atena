import { type ReactNode, type JSX } from 'react';
import { toolLabel } from '../tools-catalog';
import { cssVar } from '../../styles/tokens';

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
 * @param props - Conteúdo do header e corpo.
 *
 * @returns A moldura do card.
 */
export function ToolResultFrame({
  icon,
  toolName,
  title,
  subtitle,
  actions,
  children,
}: Readonly<ToolResultFrameProps>): JSX.Element {
  return (
    <div style={{
      marginTop: cssVar.space8,
      background: cssVar.white,
      border: cssVar.borderLine,
      borderRadius: cssVar.radius8,
      overflow: 'hidden',
      boxShadow: cssVar.shadowXs,
    }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: cssVar.space8,
        padding: '10px 14px',
        background: cssVar.primaryLighter,
        borderBottom: cssVar.borderLine,
      }}
      >
        <div style={{
          display: 'grid',
          placeItems: 'center',
          width: 22,
          height: 22,
          borderRadius: cssVar.radius4,
          background: cssVar.white,
          color: cssVar.primary,
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
            gap: cssVar.space8,
            flexWrap: 'wrap',
          }}
          >
            <span style={{
              fontSize: cssVar.fs12,
              fontWeight: 600,
              color: cssVar.primary,
            }}
            >
              {toolLabel(toolName)}
            </span>
            <span style={{
              fontSize: 11,
              color: cssVar.fgSubtle,
            }}
            >
              ·
            </span>
            <span style={{
              fontSize: cssVar.fs12,
              fontWeight: 600,
              color: cssVar.fg,
            }}
            >
              {title}
            </span>
          </div>
          {subtitle
            ? <div style={{
              fontSize: 11,
              color: cssVar.fgMuted,
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
