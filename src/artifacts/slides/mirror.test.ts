// P3-C M3 fix wave 1 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md D7): the mirror's token values are the
// ones a deck's stage draws with: P3-D's literal resolver over the system at the deck's scale with the deck's
// overrides, a cycle dropped whole (each member keeps its system value) and an override depending on a cycle member
// reading that member's system value.
import { describe, expect, it } from 'vitest';
import { tokenProperties } from '../design-system/css';
import { literalValues } from '../design-system/literals';
import { builtinView } from '../design-system/view';
import { deckTokenValues } from './mirror';

const tokens = builtinView().tokens;
const system = tokenProperties(tokens, 'deck');

/** Every name D's resolver sets, read through the mirror's lookup, equals D's value. */
function expectParity(overrides: Record<string, string>): void {
  const d = literalValues(tokens, 'deck', overrides);
  const mirror = deckTokenValues(tokens, overrides);
  for (const [name, value] of d) expect(mirror(name), name).toBe(value);
}

describe('the mirror’s token values (parity with P3-D’s resolver)', () => {
  it('drops a cycle whole: each member keeps its own system value', () => {
    const overrides = { '--ds-color-bg': 'var(--ds-color-text, #101010)', '--ds-color-text': 'var(--ds-color-bg)' };
    const values = deckTokenValues(tokens, overrides);
    expect(values('--ds-color-bg')).toBe(system.get('--ds-color-bg'));
    expect(values('--ds-color-text')).toBe(system.get('--ds-color-text'));
    expectParity(overrides);
  });

  it('gives an override outside a cycle that names a member the member’s system value', () => {
    const overrides = { '--ds-color-bg': 'var(--ds-color-text)', '--ds-color-text': 'var(--ds-color-bg)', '--ds-color-accent': 'var(--ds-color-bg)' };
    expect(deckTokenValues(tokens, overrides)('--ds-color-accent')).toBe(system.get('--ds-color-bg'));
    expectParity(overrides);
  });

  it('follows a chain of overrides and drops one that resolves to nothing', () => {
    const overrides = { '--ds-color-bg': '#101010', '--ds-color-text': 'var(--ds-color-bg)', '--ds-color-accent': 'var(--ds-nowhere)' };
    const values = deckTokenValues(tokens, overrides);
    expect([values('--ds-color-bg'), values('--ds-color-text'), values('--ds-color-accent')]).toEqual(['#101010', '#101010', system.get('--ds-color-accent')]);
    expectParity(overrides);
  });

  it('applies the overrides alone when there is no system to read', () => {
    expect(deckTokenValues(null, { '--ds-color-bg': '#101010' })('--ds-color-bg')).toBe('#101010');
    expect(deckTokenValues(null, {})('--ds-color-bg')).toBeUndefined();
  });
});
