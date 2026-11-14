import { describe, expect, it } from 'vitest';
import { secretSpans, withSecretsHidden } from './secret-scan';

// Invented token shapes, assembled here so that no whole token sits in the source
const anthropic = ['sk', 'ant', ''].join('-') + 'a'.repeat(24);
const slack = ['xo', 'xb-'].join('') + 'b'.repeat(12);
const github = ['gh', 'p_'].join('') + 'c'.repeat(24);
const ZERO_WIDTH = String.fromCodePoint(0x200b);
const BACKSLASH = String.fromCodePoint(92);
const dots = (count: number) => '•'.repeat(count);
const masked = (token: string) => token.slice(0, 8) + dots(token.length - 8);

describe('withSecretsHidden', () => {
  it('hides a token but for its first eight characters', () => {
    expect(withSecretsHidden(`see ${anthropic} here`)).toBe(`see ${masked(anthropic)} here`);
  });

  it('finds a token glued into a word behind a digit or an underscore', () => {
    for (const token of [anthropic, slack, github]) {
      expect(withSecretsHidden(`1${token}`)).toBe(`1${masked(token)}`);
      expect(withSecretsHidden(`x_${token}`)).toBe(`x_${masked(token)}`);
    }
  });

  it('finds a token behind a written escape, but not behind a plain letter', () => {
    expect(secretSpans(`${BACKSLASH}n${anthropic}`)).toHaveLength(1);
    expect(secretSpans(`x${anthropic}`)).toHaveLength(0);
  });

  it('finds a token across an invisible character inside it', () => {
    const split = `${anthropic.slice(0, 12)}${ZERO_WIDTH}${anthropic.slice(12)}`;
    expect(secretSpans(split)).toHaveLength(1);
    expect(withSecretsHidden(split)).toBe(anthropic.slice(0, 8) + dots(split.length - 8));
  });

  it('hides a key but for its header and footer, its line breaks kept', () => {
    const header = ['-----BEGIN', 'PRIVATE', 'KEY-----'].join(' ');
    const footer = ['-----END', 'PRIVATE', 'KEY-----'].join(' ');
    expect(withSecretsHidden(`${header}\nQUJD\n${footer}`)).toBe(`${header}\n${dots(4)}\n${footer}`);
  });
});
