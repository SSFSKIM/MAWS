// The paste tags' one definition (ticket 704, the architect's condition at the chain re-merge of rule R, 2026-11-16):
// rule R's `pastedBodies` (shared/engine/arrival.ts), which holds its tags itself so that the search text's worker can
// run its source. Every other reader or writer of the tags in the source is pinned to it here, so a change to one
// fails until the others follow. `PASTED_BLOCK`, the transcript's reader, is pinned by rule R's seeded case in
// arrival.test.ts ("a sentence is skipped exactly where it stands inside a pasted segment…").
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pastedBodies } from '../engine/arrival';
import { framePasted, PASTED_BLOCK } from './pasted-content';
import { neutralisePastedTags, restorePastedTags } from './pasted-framing';

const ROOT = join(__dirname, '../../..');
const IDS = ['abcd', '1f3a', '0000', 'ffff'];
const BODIES = ['one line', 'line 1\nline 2\nline 3', '', 'a tag typed <pasted_content id="beef"> in the body'];
const opener = (id: string) => framePasted(id, 'x').split('\n')[0]!;
// A `const <name> = <literal>` of a source file, read from its text: the sites below export nothing of their tags
const literalIn = (path: string, name: string): string => {
  const line = readFileSync(join(ROOT, path), 'utf8').split('\n').find((candidate) => candidate.startsWith(`const ${name} = `));
  if (line === undefined) throw new Error(`no const ${name} in ${path}`);
  return line.slice(`const ${name} = `.length);
};

describe('every reader and writer of the paste tags agrees with pastedBodies', () => {
  it('framePasted (the composer’s writer): pastedBodies marks exactly the lines of each framed segment, and the transcript’s PASTED_BLOCK finds it', () => {
    for (const id of IDS) {
      for (const body of BODIES.map(neutralisePastedTags)) {
        const framed = framePasted(id, body).split('\n');
        const lines = ['Before.', ...framed, 'After.'];
        expect(pastedBodies(lines), `${id}: ${body}`).toEqual([false, ...framed.map(() => true), false]);
        expect([...lines.join('\n').matchAll(PASTED_BLOCK)].map((match) => match[1]), `${id}: ${body}`).toEqual([id]);
      }
    }
  });

  it('neutralisePastedTags and restorePastedTags (pasted-framing.ts): a neutralised segment opens nothing, and restoring gives the text back', () => {
    for (const id of IDS) {
      const framed = framePasted(id, 'line 1\nline 2');
      expect(pastedBodies(neutralisePastedTags(framed).split('\n'))).toEqual(framed.split('\n').map(() => false));
      expect(restorePastedTags(neutralisePastedTags(framed))).toBe(framed);
    }
  });

  it('PASTE_OPENING (shared/files/named.ts): the head of the opener framePasted writes, up to its id', () => {
    const head = /^'([^']*)';/.exec(literalIn('src/shared/files/named.ts', 'PASTE_OPENING'))?.[1];
    expect(head).toBeDefined();
    for (const id of IDS) expect(opener(id)).toBe(`${head}${id}">`);
  });

  it('OPEN_PASTED (services/index/sessions.ts): it matches the opener framePasted writes, at a segment’s start', () => {
    const literal = literalIn('src/services/index/sessions.ts', 'OPEN_PASTED').replace(/;$/, '');
    const source = /^\/(.*)\/([a-z]*)$/.exec(literal);
    expect(source, literal).not.toBeNull();
    const open = new RegExp(source![1]!, source![2]);
    for (const id of IDS) expect(open.exec(`Before. ${framePasted(id, 'line 1')}`)?.index).toBe('Before. '.length);
    expect(open.exec(`Before. ${neutralisePastedTags(framePasted('abcd', 'line 1'))}`)).toBeNull();
  });
});
