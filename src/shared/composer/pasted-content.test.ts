// The linear reader of pasted blocks (board ticket 734): `pastedSegments` finds what `PASTED_BLOCK` finds, in work
// linear in the text, and every reader of a user text's pasted blocks goes through it.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { framePasted, PASTED_BLOCK, pastedSegments, replacePasted } from './pasted-content';
import { neutralisePastedTags, wrapPasted } from './pasted-framing';

const byPattern = (text: string) => [...text.matchAll(PASTED_BLOCK)].map((m) => ({ index: m.index, match: m[0], id: m[1]!, body: m[2]! }));

// A seeded generator (mulberry32), so a failing text can be named by its seed.
function random(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('pastedSegments reads what PASTED_BLOCK reads', () => {
  it('on texts the writer makes: typed words around blocks the composer wrapped, bodies with tags of their own', () => {
    const next = random(734);
    const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!;
    const words = ['Fix the header.', 'see <pasted_content id="1a2b"> here', '', 'two\n\nlines', '</pasted_content id="1a2b">', 'thanks'];
    const bodies = ['one line', 'a\nb\nc', '', '\n', 'trailing\n', '<pasted_content id="1a2b">\nnested\n</pasted_content id="1a2b">', 'a log\n\n\nwith gaps'];
    for (let n = 0; n < 400; n += 1) {
      const parts: string[] = [];
      for (let k = Math.floor(next() * 5); k >= 0; k -= 1) parts.push(next() < 0.5 ? neutralisePastedTags(pick(words)) : wrapPasted(pick(['1a2b', 'ffff', '0000']), pick(bodies)));
      const text = parts.join(pick(['', '\n', '\n\n', ' ']));
      expect(pastedSegments(text), text).toEqual(byPattern(text));
    }
  });

  it('on texts no writer makes: tags in any order, unclosed, of other ids, with any newlines around them', () => {
    const next = random(616);
    const pieces = ['<pasted_content id="abcd">\n', '\n</pasted_content id="abcd">', '<pasted_content id="beef">\n', '\n</pasted_content id="beef">\n', '<pasted_content id="ABCD">\n', '<pasted_content id="abc">\n', 'x', '\n', '\n\n\n', '">', framePasted('abcd', 'body'), framePasted('beef', '')];
    for (let n = 0; n < 2000; n += 1) {
      const text = Array.from({ length: 1 + Math.floor(next() * 12) }, () => pieces[Math.floor(next() * pieces.length)]!).join('');
      expect(pastedSegments(text), JSON.stringify(text)).toEqual(byPattern(text));
    }
  });

  it('replacePasted replaces as String.replace with the pattern does', () => {
    const text = `before\n\n${framePasted('abcd', 'one\ntwo')}\n\nafter ${framePasted('beef', 'x')} end`;
    const replace = (_match: string, id: string, body: string) => `[${id}:${body.split('\n').length}]`;
    expect(replacePasted(text, (segment) => replace(segment.match, segment.id, segment.body))).toBe(text.replace(PASTED_BLOCK, replace));
  });
});

describe('the work of reading pasted blocks', () => {
  // The pattern's form, an opening tag that scans to the text's end for its closing tag, costs the square of these
  const counted = (text: string) => {
    const work = { steps: 0 };
    pastedSegments(text, work);
    return work.steps;
  };

  it('is linear in the text for many opening tags that never close, and for closing tags that every opening passes', () => {
    const unclosed = '<pasted_content id="abcd">\nline\n'.repeat(4000);
    expect(pastedSegments(unclosed)).toEqual([]);
    expect(counted(unclosed)).toBeLessThanOrEqual(2 * unclosed.length);
    const early = `${'\n</pasted_content id="abcd">'.repeat(2000)}${'<pasted_content id="abcd">\n'.repeat(2000)}`;
    expect(counted(early)).toBeLessThanOrEqual(3 * early.length);
    const ids = Array.from({ length: 2000 }, (_, i) => `<pasted_content id="${i.toString(16).padStart(4, '0')}">\nx\n`).join('') + '\n</pasted_content id="0000">';
    expect(counted(ids)).toBeLessThanOrEqual(3 * ids.length);
  });
});

// Every reader of a user text's pasted blocks reads them through `pastedSegments`: the transcript's split, the session
// index's title text, the first message and the queue's entry text (ticket 734). The pattern stays the grammar's
// statement, read by tests alone.
describe('the readers of pasted blocks', () => {
  it('match no text with PASTED_BLOCK', () => {
    const root = join(__dirname, '..', '..');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) files.push(path);
      }
    };
    walk(root);
    const users = files.filter((path) => /\bPASTED_BLOCK\b/.test(readFileSync(path, 'utf8').replace(/\/\/.*$/gm, ''))).map((path) => relative(root, path));
    expect(users).toEqual([join('shared', 'composer', 'pasted-content.ts')]);
  });
});
