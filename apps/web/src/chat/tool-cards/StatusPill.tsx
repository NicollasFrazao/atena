import type { JSX } from 'react';
import { describeStatus, TONE_COLORS } from './format';
import { cssValue, cssVar } from '../../styles/tokens';

/**
 * Pill colorida por status de entrega (delivered=success, failed=danger,
 * pending=warning, demais=neutral).
 *
 * @param props - Status bruto vindo do `result`.
 *
 * @returns A pill de status.
 */
export function StatusPill({ status }: Readonly<{ status: string }>): JSX.Element {
  const {
    label,
    tone,
  } = describeStatus(status);

  const colors = TONE_COLORS[tone];

  return (
    <span style={{
      display: cssValue.inlineFlex,
      alignItems: 'center',
      borderRadius: cssVar.radiusFull,
      padding: '2px 8px',
      fontSize: cssVar.fs12,
      fontWeight: 600,
      color: colors.color,
      background: colors.background,
    }}
    >
      {label}
    </span>
  );
}
