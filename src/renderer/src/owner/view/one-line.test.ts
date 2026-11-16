// UX wave U2b (panel finding 5): a call's line joins its lines by the mod's rule (`oneLine`, folds.tsx 140: every run of
// whitespace that holds a line break becomes one space) in one pass over the text: the same output as the mod's pattern
// on every input, whitespace-heavy ones included, and one visit to each character, however long a run of spaces is.
// Counted, never timed. Every text is invented.
import { describe, expect, it } from 'vitest';
import { joinedChars, lineOf } from './label';

// The rule as the mod writes it, and as MAWS ran it before this fix: the reference.
const LINE_MAX = 120;
function referenceOneLine(text: string): string {
  const chars = Array.from(text.replace(/\s*[\r\n]+\s*/g, ' ').trim());
  return chars.length > LINE_MAX ? `${chars.slice(0, LINE_MAX - 1).join('')}…` : chars.join('');
}
const referenceLine = (text: string) => referenceOneLine(text.trim() === '' ? 'Bash' : text); // `lineOf('Bash', { description })`

function random(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Mostly whitespace of every kind the pattern's `\s` takes (line breaks among them, and the Unicode separators that are
// whitespace but no line break), with letters, an astral character and runs of spaces between.
const PIECES = [' ', ' ', ' ', '\t', '\n', '\r', '\r\n', ' ', ' ', ' ', '﻿', '　', '\v', '\f', 'a', 'Z', '.', '"', '\u{1F600}', '  \n  ', ' '.repeat(40), '\n'.repeat(3)];
function seeded(seed: number): string {
  const next = random(seed);
  const length = Math.floor(next() * 60);
  let text = '';
  for (let n = 0; n < length; n += 1) text += PIECES[Math.floor(next() * PIECES.length)];
  return text;
}

describe('a call’s line, joined in one pass', () => {
  it('reads as the mod’s pattern on every seeded text', () => {
    for (let seed = 1; seed <= 3000; seed += 1) {
      const text = seeded(seed);
      expect(lineOf('Bash', { description: text }), JSON.stringify(text)).toBe(referenceLine(text));
    }
  });

  // the reference is the quadratic pattern, so its runs stay short enough for it; the count below takes the long ones
  it('reads as the mod’s pattern on runs of spaces, with and without a line break after them', () => {
    for (const run of [1, 300, 1500]) {
      for (const text of [`a${' '.repeat(run)}b`, `a${' '.repeat(run)}\nb`, `a\n${' '.repeat(run)}b`, `${' '.repeat(run)}\n`, `a${'\t  '.repeat(run)}b`]) {
        expect(lineOf('Bash', { description: text })).toBe(referenceLine(text));
      }
    }
  });

  it('visits each character of the line once, however long its runs of spaces', () => {
    for (const run of [4000, 8000, 16000]) {
      const pattern = `a${' '.repeat(run)}b`;
      const before = joinedChars();
      expect(lineOf('Grep', { pattern })).toBe(referenceOneLine(`Search "${pattern}"`));
      expect(joinedChars() - before).toBe(`Search "${pattern}"`.length);
    }
  });
});
