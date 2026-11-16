// The grant's one test of a string (board ticket 711), read in linear work (UX wave U6e, ticket 675, the closing wave's
// item 1): the answers are the earlier reading's on every string, and the work grows by a constant per character on the
// shapes that made the earlier reading quadratic. The work is pinned by the function's own count, never by a time.
import { describe, expect, it } from 'vitest';
import { GRANT_OPENING, quotesGrant } from './grant';

// The earlier reading, as board ticket 711 wrote it (src/shared/engine/grant.ts before ticket 675): the reference
const folded = (text: string): string => text.replace(/[^\p{L}\p{N}]/gu, '');
const FOLDED_GRANT = folded(GRANT_OPENING.normalize('NFKC').toLowerCase());
function after(reached: ReadonlySet<number>, letters: string): Set<number> | null {
  let now = reached;
  for (const letter of letters) {
    const next = new Set([0]);
    for (const length of now) {
      if (FOLDED_GRANT[length] !== letter) continue;
      if (length + 1 === FOLDED_GRANT.length) return null;
      next.add(length + 1);
    }
    now = next;
  }
  return new Set(now);
}
function quotesGrantEarlier(text: string): boolean {
  let reached: ReadonlySet<number> = new Set([0]);
  for (const [index, part] of text.normalize('NFKC').toLowerCase().split(/(<[^>]*>)/).entries()) {
    const read = after(reached, folded(part));
    if (read === null) return true;
    reached = index % 2 === 1 ? new Set([...reached, ...read]) : read;
  }
  return false;
}

// A fixed seed's strings (mulberry32)
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const PIECES = [
  GRANT_OPENING, 'permission granted for', 'PERMISSION GRANTED FOR', 'Permission', 'permis', 'sion', ' granted', 'grant', 'ed', ' for', 'for ', 'fo', 'r',
  'ＰＥＲＭＩＳＳＩＯＮ', 'ｇｒａｎｔｅｄ', '𝐩𝐞𝐫𝐦𝐢𝐬𝐬𝐢𝐨𝐧', 'perm​ission', 'per mission', 'é', 'Ω', '1', 'x', 'p',
  '<', '>', '<>', '<b>', '</b>', '<granted>', '<x granted y>', '< for >', '<<', '>>', '<<>>', '<a<b>c>', '＜', '＞', '＜ｂ＞',
  ' ', '*', '_', '`', '~~', '\n', '"', '(', ')', '[', ']', '&lt;', 'Yes, ', 'the command',
];

describe('quotesGrant reads in linear work, with the earlier answers', () => {
  it('answers as the earlier reading on a few thousand strings from a fixed seed', () => {
    const next = random(675);
    let trues = 0;
    for (let n = 0; n < 4000; n += 1) {
      const count = 1 + Math.floor(next() * 14);
      let text = '';
      for (let i = 0; i < count; i += 1) text += PIECES[Math.floor(next() * PIECES.length)];
      const earlier = quotesGrantEarlier(text);
      if (earlier) trues += 1;
      expect(quotesGrant(text), JSON.stringify(text)).toBe(earlier);
    }
    expect(trues).toBeGreaterThan(100); // the set holds both answers
  });

  it('keeps the answers on the shapes the closing wave names', () => {
    const cases = [
      `${GRANT_OPENING}x`,
      'Permission <b>granted</b> for',
      'Permission <x>granted for', // a pair removed with its words, or read with them
      'Permis<granted>sion granted for',
      'Permission <granted for>', // the opening's words inside a pair
      'Permission granted <for',
      '<<<Permission granted for',
      'Permission granted f<>or',
      'Permission granted fo',
      '',
      '<>',
    ];
    for (const text of cases) expect(quotesGrant(text), text).toBe(quotesGrantEarlier(text));
  });

  const shapes: [string, (n: number) => string][] = [
    ['many < with no >', (n) => `[r](/work/out/notes.md) ${'<'.repeat(n)}`],
    ['many pairs', (n) => '<b>x</b>'.repeat(n / 8)],
    ['alternating < and >', (n) => '<>'.repeat(n / 2)],
    ['many < then one > at the end', (n) => `${'<'.repeat(n - 1)}>`],
    ['letters of the opening between unclosed <', (n) => 'permission<granted<'.repeat(n / 19)],
  ];
  it.each(shapes)('counts its work by a constant per character: %s', (_, shape) => {
    for (const n of [2_000, 20_000, 80_000]) {
      const text = shape(n);
      const work = { steps: 0 };
      expect(quotesGrant(text, work)).toBe(false);
      expect(work.steps, `${n}`).toBeGreaterThan(0);
      expect(work.steps, `${n}`).toBeLessThanOrEqual(4 * text.length + 16);
    }
  });
});
