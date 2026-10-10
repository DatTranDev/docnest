import { describe, expect, it } from 'vitest';
import { parsePreferences, preferenceKey } from '../hooks/usePreferences';
describe('account preferences', () => {
  it('isolates account storage keys', () => {
    expect(preferenceKey('first')).not.toBe(preferenceKey('second'));
  });
  it('reads valid language and explicit light/dark themes', () => {
    expect(parsePreferences('{"locale":"vi","theme":"dark"}')).toEqual({
      locale: 'vi',
      theme: 'dark',
    });
    expect(parsePreferences('{"locale":"en","theme":"light"}')).toEqual({
      locale: 'en',
      theme: 'light',
    });
  });
  it('defaults corrupt, null and unknown preferences to browser appearance', () => {
    for (const value of [null, '{}', 'null', 'broken', '{"locale":"zz","theme":"invalid"}'])
      expect(parsePreferences(value)).toEqual({ theme: 'system' });
  });
});
