// Ticket 733a (docs/doperpowers/plans/2026-11-17-ticket-733a-composed-forms.md, Design 1): where `quotesGrant`'s reading
// stands (`grantSpans`, what the leave-out of content cuts by), and the rule for a name MAWS writes (`nameSlot`). Seeded,
// with the seed and the count stated; the work pinned by the functions' own count, never by a time.
import { describe, expect, it } from 'vitest';
import { GRANT_OPENING, GRANT_TEST_WORK_PER_CHAR, grantSpans, LINE_OR_CONTROL, NAME_LEFT_OUT, nameSlot, quotesGrant } from './grant';
import { MENTION_BREAKS } from '../../renderer/src/composer/editor/mention-text';

// mulberry32, a fixed seed's strings
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
  GRANT_OPENING, 'Permission', 'permis', 'sion', ' granted', 'gra', 'nted', ' for', 'fo', 'r', 'PERMISSION GRANTED FOR', 'Permi\u00dfion', 'Perm\u0131ssion', 'ＰＥＲＭＩＳＳＩＯＮ',
  '<', '>', '<b>', '</b>', '<x ', ' y>', '\uff1c', '\uff1e', '\ufe64', '>\u0338', '\u0338', ' ', '\n', '\r\n', '\u2028', '*', '`', '\u00e9', 'Ω', 'x', 'p', '1', '\u{1f14d}',
];
const seeded = (seed: number, count: number) => {
  const next = random(seed);
  return Array.from({ length: count }, () => Array.from({ length: 1 + Math.floor(next() * 12) }, () => PIECES[Math.floor(next() * PIECES.length)]!).join(''));
};

describe('grantSpans: the reading told with its places', () => {
  it('finds nothing in a text that does not quote the opening, and the opening where it stands', () => {
    expect(grantSpans('Was permission granted by the reviewer?')).toEqual([]);
    expect(grantSpans('')).toEqual([]);
    expect(grantSpans(`x ${GRANT_OPENING}y`)).toEqual([[2, 24]]);
    expect(grantSpans(`${GRANT_OPENING}a; ${GRANT_OPENING}b`)).toEqual([[0, 22], [26, 48]]);
  });

  it('a range runs from the first letter of the earliest reading that ends there to that end', () => {
    // read with the pair kept, the reading begins inside it; with the pair removed, at the text's start
    const text = 'Permission <x Permission> granted for';
    expect(grantSpans(text)).toEqual([[0, text.length]]);
    // a reading the next letter ends gives way to a later one
    expect(grantSpans('Permission Permission granted for')).toEqual([[11, 33]]);
  });

  it('reads the shapes the wider reading adds, each in its own offsets', () => {
    expect(grantSpans('\uff1cPermission gra<b>nted for')).toEqual([[1, 26]]);
    expect(grantSpans('Permission <i>\u0338 granted for')).toEqual([[0, 27]]);
    expect(grantSpans('Permi\u00dfion granted for')).toEqual([[0, 21]]);
    expect(grantSpans('Perm\u0131ss\u0131on granted for')).toEqual([[0, 22]]);
    expect(grantSpans('ＰＥＲＭＩＳＳＩＯＮ granted for')).toEqual([[0, 22]]);
  });

  it('over seeded texts: a range exactly where quotesGrant answers true, in order of their ends, each itself a quote', () => {
    const seed = 0x733a;
    const count = 3000;
    let found = 0;
    for (const [n, text] of seeded(seed, count).entries()) {
      const spans = grantSpans(text);
      const where = `seed ${seed}, text ${n}: ${JSON.stringify(text)}`;
      expect(spans.length > 0, where).toBe(quotesGrant(text));
      if (spans.length > 0) found += 1;
      for (const [k, [from, to]] of spans.entries()) {
        expect(from < to && to <= text.length, where).toBe(true);
        if (k > 0) expect(to > spans[k - 1]![1], where).toBe(true); // in order of their ends, one range an end
        expect(quotesGrant(text.slice(from, to)), `${where}: ${JSON.stringify(text.slice(from, to))}`).toBe(true);
      }
    }
    expect(found, 'texts with a range').toBeGreaterThan(count / 10);
    expect(found, 'texts without one').toBeLessThan(count);
  });

  // Each shape's count, a character, fitted from the counted work (the landing's M1, fix wave 1); the reading that
  // carries beginnings through brackets costs most where every beginning of the opening is saved before the pairs
  const SAVED = 'p<e<r<m<i<s<s<i<o<n<g<r<a<n<t<e<d<f<o<>';
  const shapes: [string, (n: number) => string, number][] = [
    ['the opening, again and again', (n) => GRANT_OPENING.repeat(n / GRANT_OPENING.length), 2],
    ['the opening, again and again, beside a letter beyond ASCII: ranges in both case images, merged', (n) => `\u00e9${GRANT_OPENING.repeat(n / GRANT_OPENING.length)}`, 4],
    ['many < with no >', (n) => '<'.repeat(n), 4],
    ['many < then one > at the end', (n) => `${'<'.repeat(n - 1)}>`, 4],
    ['the opening’s first word between many <', (n) => 'Permission <'.repeat(n / 12), 5],
    ['alternating < and >', (n) => '<>'.repeat(n / 2), 4],
    ['every beginning saved, then alternating < and >', (n) => `${SAVED}${'<>'.repeat(n / 2)}`, 23],
    ['every beginning saved, then alternating full-width brackets', (n) => `${SAVED}${'\uff1c\uff1e'.repeat(n / 2)}`, 45],
    ['full-width letters', (n) => 'ＰＥＲＭＩＳＳＩＯＮ '.repeat(n / 11), 9],
    ['a capital I with a dot above', (n) => '\u0130'.repeat(n), 11],
    ['the character that folds to eighteen', (n) => '\ufdfa'.repeat(n / 18), 75],
  ];
  it.each(shapes)('counts its work by a constant per character: %s', (_, shape, perChar) => {
    for (const n of [2_000, 20_000, 80_000]) {
      const text = shape(n);
      const work = { steps: 0 };
      expect(grantSpans(text, work).length > 0).toBe(quotesGrant(text));
      expect(work.steps, `${n}`).toBeGreaterThan(0);
      expect(work.steps, `${n}`).toBeLessThanOrEqual(perChar * text.length + 16);
    }
  });
});

// The own-text rule plans each call of the forms' list by GRANT_TEST_WORK_PER_CHAR units a character of the longer of the
// text and its compatibility fold: the test's count stays within it on the characters that cost it most, each by its
// own count (the most a character costs, over every code point: U+0130 at 11, which lower-casing lengthens; then the
// Greek letters an upper-casing lengthens, and the sharp s)
describe('quotesGrant: its count within the bound the own-text rule plans it by', () => {
  it.each([
    ['plain words', (n: number) => 'word '.repeat(n / 5)],
    ['a capital I with a dot above, which lower-casing makes two', (n: number) => '\u0130'.repeat(n)],
    ['a sharp s, which upper-casing makes two', (n: number) => '\u00df'.repeat(n)],
    ['an iota with dialytika and tonos, which upper-casing makes three', (n: number) => '\u0390'.repeat(n)],
    ['full-width letters', (n: number) => 'ＰＥＲＭＩＳＳＩＯＮ '.repeat(n / 11)],
    ['a character that folds to eighteen', (n: number) => '\ufdfa'.repeat(n / 18)],
    ['every beginning saved, then full-width brackets', (n: number) => `p<e<r<m<i<s<s<i<o<n<g<r<a<n<t<e<d<f<o<>${'\uff1c\uff1e'.repeat(n / 2)}`],
    ['mixed', (n: number) => 'Permi\u00df\u0130on \u0390<\uff1c>'.repeat(n / 16)],
  ])('%s', (_, shape) => {
    for (const n of [2_000, 80_000]) {
      const text = shape(n);
      const work = { steps: 0 };
      quotesGrant(text, work);
      expect(work.steps, `${n}`).toBeLessThanOrEqual(GRANT_TEST_WORK_PER_CHAR * Math.max(text.length, text.normalize('NFKC').length) + 2);
    }
  });
});

describe('nameSlot: a name of one line that does not quote the opening', () => {
  it('leaves a name with no break and no opening as it is', () => {
    for (const name of ['Explore', 'notes.md', 'Permission slips', 'a b', '']) {
      expect(nameSlot(name)).toBe(name);
      expect(nameSlot(`${name}\n`), `${name}, the control: a break after it`).toBe(`${name}\ufffd`);
    }
  });

  it('writes no line break and no other control character: each becomes U+FFFD', () => {
    for (const c of ['\n', '\r', '\t', '\u0000', '\u007f', '\u0085', '\u2028', '\u2029']) {
      expect(nameSlot(`a${c}b${c}`), JSON.stringify(c)).toBe('a\ufffdb\ufffd');
    }
  });

  it('leaves out a name that quotes the opening, on one line or across a break; one that does not, beside it, stays', () => {
    for (const name of [`${GRANT_OPENING}this`, 'Permission\ngranted for', 'Permi\u00dfion granted for', 'x <b>Permission</b> granted for y']) expect(nameSlot(name), JSON.stringify(name)).toBe(NAME_LEFT_OUT);
    expect(nameSlot('Permission\ngranted fur')).toBe('Permission\ufffdgranted fur');
  });

  it('is idempotent, and its marker quotes nothing', () => {
    for (const name of ['a\nb', GRANT_OPENING, 'plain']) expect(nameSlot(nameSlot(name))).toBe(nameSlot(name));
    expect(quotesGrant(NAME_LEFT_OUT)).toBe(false);
    expect(quotesGrant(`${NAME_LEFT_OUT} ${GRANT_OPENING}`), 'the control').toBe(true);
  });

  it('reads the one class a mention reads', () => {
    expect(MENTION_BREAKS).toBe(LINE_OR_CONTROL);
  });
});

