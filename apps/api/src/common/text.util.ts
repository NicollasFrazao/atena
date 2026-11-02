/**
 * Treats an empty string as absent, so a fallback can be chosen with `??` for both a missing and an
 * empty value (an env var set to `''`, a blank config entry, a text that trims to nothing).
 *
 * @param value - The text, possibly empty or absent.
 *
 * @returns The text itself, or `undefined` when it is `''`, `null` or `undefined`.
 *
 * @example
 * nonEmpty('') ?? 'default';    // 'default'
 * nonEmpty('value') ?? 'default'; // 'value'
 */
export function nonEmpty(value: string | null | undefined): string | undefined {
  return value === null || value === ''
    ? undefined
    : value;
}
