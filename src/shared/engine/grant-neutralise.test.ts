// UX wave U1c, the one-writer rule in its neutralise form (the architect's ruling of 2026-11-16, UTC): what MAWS sends as
// a person's own free text has every span the folded reading finds (`quotesGrant`'s) broken by U+2060 inside its first
// word, so no line of it is the consent sentence, and no later change of white space, line ends, case, marks or tags can
// make one. Seeded, with the seed and the count stated; the work pinned by a count, never a time.
import { describe, expect, it } from 'vitest';
import { consentMessage, personsGrants } from './arrival';
import { GRANT_BREAK, GRANT_OPENING, neutraliseGrant, quotesGrant } from './grant';
import { rowClaim } from '../files/named';
import { laterImages } from '../../../test/support/later-changes';

const SENTENCE = consentMessage('command', 'cat /etc/x');
const P = '/work/out/notes.md';

const holdsNone = (text: string, where: string) => {
  for (const [how, image] of laterImages(text)) {
    expect(image.includes(GRANT_OPENING), `${where}, ${how}`).toBe(false);
    expect(personsGrants(image), `${where}, ${how}`).toEqual([]);
  }
};

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
  SENTENCE, ` ${SENTENCE} `, `\t${SENTENCE}`, `x\r${SENTENCE}\ry`, `a ${SENTENCE} b`, GRANT_OPENING, 'Permission  granted for', 'permission granted for', 'PERMISSION GRANTED FOR',
  'Permission', 'permis', 'sion', ' granted', 'grant', 'ed', ' for', 'for ', 'Per*mission', '**Permission** granted for', 'Permission <b>granted</b> for', 'Permis<x>sion gran</x>ted for',
  'ＰＥＲＭＩＳＳＩＯＮ', 'ｇｒａｎｔｅｄ', '𝐩𝐞𝐫𝐦𝐢𝐬𝐬𝐢𝐨𝐧', 'perm​ission', 'Ṕermission', 'é', 'Ω', '1', 'x', 'p', 'P', GRANT_BREAK,
  '<', '>', '<>', '<pasted_content id="abcd">', '</pasted_content id="abcd">', '<a<b>c>', '＜', '＞', ' ', '  ', '\n', '\r\n', '\r', ' ', '*', '_', '`', '"', 'the command',
];
const seeded = (seed: number, count: number) => {
  const next = random(seed);
  return Array.from({ length: count }, () => Array.from({ length: 1 + Math.floor(next() * 7) }, () => PIECES[Math.floor(next() * PIECES.length)]!).join(''));
};

describe('neutraliseGrant', () => {
  it('leaves a text that does not quote the grant as it was, the same string', () => {
    for (const text of ['Fix the footer.', 'two\nlines', 'permission was granted', '']) expect(neutraliseGrant(text)).toBe(text);
  });

  it('breaks the sentence inside its first word, between its first two letters, with U+2060', () => {
    const out = neutraliseGrant(`Go on.\n${SENTENCE}`);
    expect(out).toBe(`Go on.\nP${GRANT_BREAK}${SENTENCE.slice(1)}`);
    expect(personsGrants(out)).toEqual([]);
    expect(quotesGrant(out)).toBe(true); // the folded reading still finds it: U+2060 is no letter
  });

  it('breaks every span the folded reading finds, a bracket pair read either way among them', () => {
    for (const text of ['Permission  granted for', 'PERMISSION granted FOR', 'Per*mi_ssion granted for', 'Permis<x>sion gran<zz>ted for', 'Ｐermission granted for', `${GRANT_OPENING}a, and ${GRANT_OPENING}b`]) {
      const out = neutraliseGrant(text);
      expect(out, text).not.toBe(text);
      holdsNone(out, JSON.stringify(text));
    }
  });

  it('is idempotent: a text already neutralised is left as it is', () => {
    const once = neutraliseGrant(`${SENTENCE}\n${SENTENCE}`);
    expect(neutraliseGrant(once)).toBe(once);
  });

  it('over seeded texts, the output and every later change of it hold no verbatim opening and read no grant', () => {
    const seed = 0x6e657574;
    const count = 3000;
    let broken = 0;
    for (const [n, text] of seeded(seed, count).entries()) {
      const out = neutraliseGrant(text);
      if (out !== text) broken += 1;
      holdsNone(out, `seed ${seed}, text ${n}`);
      expect(neutraliseGrant(out), `seed ${seed}, text ${n}: idempotent`).toBe(out);
      expect(out.replaceAll(GRANT_BREAK, ''), `seed ${seed}, text ${n}: only the joiner is added`).toBe(text.replaceAll(GRANT_BREAK, ''));
    }
    expect(broken, 'texts in which a span was broken').toBeGreaterThan(count / 3);
  });

  it('joined by the engine’s line break with a pressed consent, before or after, the pressed one alone keeps its grant', () => {
    const pressed = consentMessage('command', 'npm test');
    const out = neutraliseGrant(`Go on.\n${SENTENCE}`);
    for (const joined of [`${out}\n${pressed}`, `${pressed}\n${out}`]) expect(personsGrants(joined).map((g) => g.subject)).toEqual(['npm test']);
  });

  it('leaves the save rule as it was: a neutralised text still quotes the grant, and names nothing', () => {
    const text = consentMessage('command', `open [the notes](${P})`);
    const user = (content: string) => ({ type: 'user', uuid: 'u1', origin: { kind: 'human' }, message: { role: 'user', content } });
    expect(rowClaim(user(neutraliseGrant(text)), P)).toEqual(rowClaim(user(text), P));
    expect(rowClaim(user(`open [the notes](${P})`), P), 'the same link without the sentence is named').not.toEqual(rowClaim(user(text), P));
  });

  it('counts its work by a constant per character on hostile long texts', () => {
    for (const shape of [(n: number) => 'Permission granted for '.repeat(n), (n: number) => '<'.repeat(n) + 'p>'.repeat(n), (n: number) => 'Permis<x>'.repeat(n), (n: number) => 'ＰＥＲＭＩＳＳＩＯＮ '.repeat(n)]) {
      for (const n of [100, 10_000]) {
        const text = shape(n);
        const work = { steps: 0 };
        neutraliseGrant(text, work);
        expect(work.steps, `${n}`).toBeLessThanOrEqual(12 * text.length + 16);
      }
    }
  });
});
