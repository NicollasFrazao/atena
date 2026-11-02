import { nonEmpty } from './text.util';

describe('nonEmpty', () => {
  it('keeps a non-empty text', () => {
    expect(nonEmpty('value')).toBe('value');
    expect(nonEmpty(' ')).toBe(' ');
  });

  it('turns an empty, null or undefined text into undefined', () => {
    expect(nonEmpty('')).toBeUndefined();
    expect(nonEmpty(null)).toBeUndefined();
    expect(nonEmpty(undefined)).toBeUndefined();
  });
});
