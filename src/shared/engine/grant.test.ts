// The grant's one test of a string (board ticket 711), read in linear work (UX wave U6e, ticket 675, the closing wave's
// item 1), and read wider by ticket 733's first landing (docs/doperpowers/plans/2026-11-17-ticket-733a-composed-forms.md,
// Design 1): it answers true for every string it answered true at that landing's pin, and also wherever the composer
// writer's reading (`neutraliseGrant`'s: each character folded by itself in both case images, any `<` to any later `>`
// with no typed `>` between) holds the opening. The work is pinned by the function's own count, never by a time.
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

// The function at ticket 733a's pin (1f1ab719b, src/shared/engine/grant.ts), copied: the differential's oracle
const LETTERS_AT_PIN = GRANT_OPENING.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const WHOLE_AT_PIN = 1 << (LETTERS_AT_PIN.length - 1);
const AT_PIN = new Int32Array(128);
for (let k = 0; k < LETTERS_AT_PIN.length; k += 1) AT_PIN[LETTERS_AT_PIN.charCodeAt(k)]! |= 1 << k;
const asciiLetter = (c: number): boolean => (c >= 0x30 && c <= 0x39) || (c >= 0x61 && c <= 0x7a);
function quotesGrantAtPin(text: string): boolean {
  const s = text.normalize('NFKC').toLowerCase();
  const lastClose = s.lastIndexOf('>');
  let reached = 1;
  let before = 0;
  let inPair = false;
  let i = 0;
  while (i < s.length) {
    const c = s.charCodeAt(i);
    let width = 1;
    if (c < 128) {
      if (inPair && c === 0x3e) {
        reached |= before;
        inPair = false;
      } else if (!inPair && c === 0x3c && i < lastClose) {
        before = reached;
        inPair = true;
      } else if (asciiLetter(c)) {
        const moved = reached & AT_PIN[c]!;
        if ((moved & WHOLE_AT_PIN) !== 0) return true;
        reached = 1 | (moved << 1);
      }
    } else {
      const point = s.codePointAt(i)!;
      if (point > 0xffff) width = 2;
      if (/^[\p{L}\p{N}]$/u.test(String.fromCodePoint(point))) reached = 1;
    }
    i += width;
  }
  return false;
}

// The composer writer's reading (`neutraliseGrant` at the pin: its folded stream and its pass from the end), copied and
// given the short opening as its one pattern: the second oracle. Each character folded by itself, in two case images; a
// `>` a combining mark follows, or a character that folds to `>`, closes without ending what a typed `>` saved.
const OTHER = -1;
const OPEN = -2;
const CLOSE = -3;
const FOLDED_CLOSE = -4;
function streamOf(text: string, image: 'lower' | 'upper'): number[] {
  const codes: number[] = [];
  let i = 0;
  while (i < text.length) {
    const point = text.codePointAt(i)!;
    const end = i + (point > 0xffff ? 2 : 1);
    if (point < 128) {
      const c = point >= 0x41 && point <= 0x5a ? point + 0x20 : point;
      const marked = /^\p{M}/u.test(text.slice(end, end + 2));
      const code = asciiLetter(c) ? c : c === 0x3c ? OPEN : c === 0x3e ? (marked ? FOLDED_CLOSE : CLOSE) : null;
      if (code !== null) codes.push(code);
    } else {
      const compatible = String.fromCodePoint(point).normalize('NFKC');
      for (const char of image === 'lower' ? compatible.toLowerCase() : compatible.toUpperCase().toLowerCase()) {
        const c = char.codePointAt(0)!;
        const code = c < 128 ? (asciiLetter(c) ? c : c === 0x3c ? OPEN : c === 0x3e ? FOLDED_CLOSE : null) : /^[\p{L}\p{N}]$/u.test(char) ? OTHER : null;
        if (code !== null) codes.push(code);
      }
    }
    i = end;
  }
  return codes;
}
const BACKWARDS = new Int32Array(128);
for (let k = 0; k < LETTERS_AT_PIN.length; k += 1) BACKWARDS[LETTERS_AT_PIN.charCodeAt(LETTERS_AT_PIN.length - 1 - k)]! |= 1 << k;
function writerReadsOpening(text: string): boolean {
  for (const image of ['lower', 'upper'] as const) {
    const codes = streamOf(text, image);
    let reached = 1;
    let saved = 0;
    for (let k = codes.length - 1; k >= 0; k -= 1) {
      const c = codes[k]!;
      if (c === CLOSE) saved = reached;
      else if (c === FOLDED_CLOSE) saved |= reached;
      else if (c === OPEN) reached |= saved;
      else if (c === OTHER) reached = 1;
      else {
        const moved = reached & BACKWARDS[c]!;
        if ((moved & WHOLE_AT_PIN) !== 0) return true;
        reached = 1 | (moved << 1);
      }
    }
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
  // ticket 733a: the shapes the wider reading adds
  'Permi\u00dfion granted for', ' gra<b>nted', '<i>\u0338 granted', '\uff1cPermission',
  'Permi\u00dfion', 'Perm\u0131ssion', 'Perm\u0131', '\u00dfion', '\u0338', '>\u0338', '<i>\u0338', '\ufe64', '\uff1e', 'pa\u017fs', '\u0301', 'e\u0301', '\u{1f14d}',
];

// The shapes of "For a comment on ticket 711" (the landing's Design 1): each answered false at the pin, read now
const SHAPES: [string, string][] = [
  ['a full-width bracket before the opening and a tag between its parts', '\uff1cPermission gra<b>nted for'],
  ['a small bracket before the opening and a tag between its parts', '\ufe64Permission gra<b>nted for'],
  ['a plain bracket before the opening and a tag between its parts', '<Permission gra<b>nted for'],
  ['a tag between its parts whose closing bracket carries a combining mark', 'Permission <i>\u0338 granted for'],
  ['a sharp s, which only an upper-casing makes "ss"', 'Permi\u00dfion granted for'],
  ['a dotless i, which only an upper-casing makes "i"', 'Perm\u0131ss\u0131on granted for'],
];

describe('quotesGrant reads the composer writer’s shapes too (ticket 733a)', () => {
  it.each(SHAPES)('reads the opening with %s', (_, text) => {
    expect(quotesGrantAtPin(text), 'answered false at the pin').toBe(false);
    expect(quotesGrant(text)).toBe(true);
    // the control: the same shape one letter from the opening is no quote of it
    expect(quotesGrant(text.replace('for', 'fur'))).toBe(false);
  });

  it('a seeded differential: nothing true at the pin is false now, and now is the pin’s reading or the writer’s', () => {
    const next = random(733);
    let atPin = 0;
    let added = 0;
    for (let n = 0; n < 4000; n += 1) {
      const count = 1 + Math.floor(next() * 14);
      let text = '';
      for (let i = 0; i < count; i += 1) text += PIECES[Math.floor(next() * PIECES.length)];
      const before = quotesGrantAtPin(text);
      const writer = writerReadsOpening(text);
      if (before) atPin += 1;
      else if (writer) added += 1;
      expect(quotesGrant(text), JSON.stringify(text)).toBe(before || writer);
    }
    expect(atPin, 'texts true at the pin').toBeGreaterThan(100);
    expect(added, 'texts only the wider reading reads').toBeGreaterThan(20);
  });
});

describe('quotesGrant reads in linear work, with the earlier answers', () => {
  it('answers true wherever the earlier reading did, on a few thousand strings from a fixed seed', () => {
    const next = random(675);
    let trues = 0;
    for (let n = 0; n < 4000; n += 1) {
      const count = 1 + Math.floor(next() * 14);
      let text = '';
      for (let i = 0; i < count; i += 1) text += PIECES[Math.floor(next() * PIECES.length)];
      const earlier = quotesGrantEarlier(text);
      if (earlier) trues += 1;
      expect(quotesGrantAtPin(text), JSON.stringify(text)).toBe(earlier); // the oracle copied right
      if (earlier) expect(quotesGrant(text), JSON.stringify(text)).toBe(true);
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
    for (const text of cases) expect(quotesGrant(text), text).toBe(quotesGrantEarlier(text) || writerReadsOpening(text));
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
