import { describeStatus, TONE_COLORS } from './format';

/**
 * Pill colorida por status de entrega (delivered=success, failed=danger,
 * pending=warning, demais=neutral).
 *
 * @param {{ status: string }} props - Status bruto vindo do `result`.
 * @returns {JSX.Element} A pill de status.
 */
export function StatusPill({ status }: { status: string }): JSX.Element {
  const {
    label,
    tone,
  } = describeStatus(status);

  const colors = TONE_COLORS[tone];

  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      borderRadius: 'var(--at-radius-full)',
      padding: '2px 8px',
      fontSize: 'var(--at-fs-12)',
      fontWeight: 600,
      color: colors.color,
      background: colors.background,
    }}
    >
      {label}
    </span>
  );
}
