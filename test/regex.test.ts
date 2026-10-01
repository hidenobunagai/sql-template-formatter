import { describe, expect, test } from 'bun:test';
import { DEFAULT_PLACEHOLDER_PATTERNS } from '../src/format';
import { canMatchEmpty } from '../src/regex';

describe('canMatchEmpty', () => {
  test('accepts the default placeholder patterns', () => {
    for (const pattern of DEFAULT_PLACEHOLDER_PATTERNS) expect([pattern, canMatchEmpty(pattern)]).toEqual([pattern, false]);
  });

  test.each([
    'a',
    'a+$',
    '@\\w+',
    ':[A-Za-z_]\\w*',
    '\\$\\d+',
    '(?:ab|c)',
    '(?<name>x)\\k<name>',
    '[^]',
    '\\u{1F600}',
    '\\p{L}+',
    'a{2,}',
    '(?=a)a',
    '%s(?![A-Za-z0-9_])',
    '\\{\\{[\\s\\S]*?\\}\\}',
  ])('never empty: %s', (pattern) => {
    expect(canMatchEmpty(pattern)).toBe(false);
  });

  test.each([
    '',
    'x*',
    'x?',
    'a{0,3}',
    '(?=b)',
    '(?<=a)(?=b)',
    '(?!a)',
    '^',
    '$',
    '\\b',
    'a|',
    '(?:a|)',
    '(a?)\\1',
    '(?<n>a*)',
  ])('can be empty: %s', (pattern) => {
    expect(canMatchEmpty(pattern)).toBe(true);
  });

  test('agrees with the regex engine on the empty input', () => {
    // Soundness spot-check: whenever the engine finds an empty match, the
    // analysis must have said "can match empty".
    for (const pattern of ['x*', 'a|', '(?:)', '(?=)', '[a-z]*?', '(?:a|b?)c?']) {
      const engine = new RegExp(`(?:${pattern})`, 'u').exec('')?.[0] === '';
      if (engine) expect(canMatchEmpty(pattern)).toBe(true);
    }
  });
});
