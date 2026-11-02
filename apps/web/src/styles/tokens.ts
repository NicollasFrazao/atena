/**
 * The design tokens of `design-system/colors_and_type.css` as typed references, for inline styles.
 *
 * @remarks
 * The values are the CSS custom properties themselves (`var(--at-…)`), so the theme still lives in
 * one stylesheet; this map only spares each component from repeating the strings.
 */
export const cssVar = {
  bgSoft: 'var(--at-bg-soft)',
  border: 'var(--at-border)',
  /** The 1px hairline in the border color, used by cards, inputs and table rows. */
  borderLine: '1px solid var(--at-border)',
  danger50: 'var(--at-danger-50)',
  danger200: 'var(--at-danger-200)',
  danger300: 'var(--at-danger-300)',
  fg: 'var(--at-fg)',
  fgMuted: 'var(--at-fg-muted)',
  fgSubtle: 'var(--at-fg-subtle)',
  fontBody: 'var(--at-font-body)',
  fontHeading: 'var(--at-font-heading)',
  fs10: 'var(--at-fs-10)',
  fs12: 'var(--at-fs-12)',
  fs13: 'var(--at-fs-13)',
  fs14: 'var(--at-fs-14)',
  fs16: 'var(--at-fs-16)',
  fs18: 'var(--at-fs-18)',
  fs24: 'var(--at-fs-24)',
  fs28: 'var(--at-fs-28)',
  fs32: 'var(--at-fs-32)',
  info100: 'var(--at-info-100)',
  lh22: 'var(--at-lh-22)',
  /** Horizontal-only padding of the 12px step (buttons and pills). */
  paddingInline12: '0 var(--at-space-12)',
  plankton50: 'var(--at-plankton-50)',
  plankton700: 'var(--at-plankton-700)',
  primary: 'var(--at-primary)',
  primaryDark: 'var(--at-primary-dark)',
  primaryLighter: 'var(--at-primary-lighter)',
  radius4: 'var(--at-radius-4)',
  radius8: 'var(--at-radius-8)',
  radiusFull: 'var(--at-radius-full)',
  shadowLg: 'var(--at-shadow-lg)',
  shadowXs: 'var(--at-shadow-xs)',
  space2: 'var(--at-space-2)',
  space4: 'var(--at-space-4)',
  space8: 'var(--at-space-8)',
  space12: 'var(--at-space-12)',
  space16: 'var(--at-space-16)',
  space20: 'var(--at-space-20)',
  space24: 'var(--at-space-24)',
  space32: 'var(--at-space-32)',
  space40: 'var(--at-space-40)',
  success50: 'var(--at-success-50)',
  success200: 'var(--at-success-200)',
  success300: 'var(--at-success-300)',
  warning50: 'var(--at-warning-50)',
  warning200: 'var(--at-warning-200)',
  warning300: 'var(--at-warning-300)',
  white: 'var(--at-white)',
} as const;

/**
 * Plain CSS values that the inline styles repeat, named once so every component spells them the
 * same way.
 *
 * @remarks
 * These are not theme tokens: they do not change with the theme and live here only to keep the
 * literals in one place.
 */
export const cssValue = {
  fontMono: 'ui-monospace, Menlo, monospace',
  inlineFlex: 'inline-flex',
  spaceBetween: 'space-between',
  tabularNums: 'tabular-nums',
} as const;

/** Numeric font weights of the type scale, for inline styles that switch weight with a state. */
export const FONT_WEIGHT = {
  regular: 400,
  medium: 500,
  semibold: 600,
} as const;
