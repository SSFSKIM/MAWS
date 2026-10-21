import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { linkedArtifacts, linkedReadBlock, linkedReadOf, utf8Bytes, withoutLinkedReads } from './linked-read';

const DOC = '4c85e0e6-8cf5-4f06-a7eb-90a3e66fd806';
const DECK = '0b1a2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const READ = JSON.stringify({ status: 'read', artifactId: DOC, kind: 'document', title: 'Garden [plan]', revision: 25, markdown: 'Hello ^p1\n' }, null, 2);

describe('the links a message carries', () => {
  it('finds every maws-artifact link in the text, in link order, each artifact once, any fragment form', () => {
    const text = `In [the plan](maws-artifact:${DOC}#block=p1) and the deck maws-artifact:${DECK}#slide=s2, then [again](maws-artifact:${DOC}#v3) and [its tab](maws-artifact:${DOC.toUpperCase()}#tab=t1).`;
    expect(linkedArtifacts(text)).toEqual([{ artifactId: DOC }, { artifactId: DECK }]);
  });

  it('names a tab when the first link to the artifact does, so the read is of that tab', () => {
    expect(linkedArtifacts(`[a](maws-artifact:${DOC}#tab=t2&block=b1) [b](maws-artifact:${DOC})`)).toEqual([{ artifactId: DOC, tab: 't2' }]);
  });

  it('reads the text blocks only, never a read already attached, and nothing that is not a store id', () => {
    const content = [
      { type: 'text', text: `See [x](maws-artifact:${DECK}).` },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
      { type: 'text', text: linkedReadBlock(READ) },
      { type: 'text', text: 'maws-artifact:brief and maws-artifact://not-a-uuid/3/index.html' },
    ];
    expect(linkedArtifacts(content)).toEqual([{ artifactId: DECK }]);
    expect(linkedArtifacts('no links here')).toEqual([]);
  });
});

describe('the attached read', () => {
  it('is the read tool’s text whole, after a line naming the artifact by its link, and parses back to what it names', () => {
    const block = linkedReadBlock(READ);
    expect(block).toContain(`[Garden \\[plan\\]](maws-artifact:${DOC})`);
    expect(block).toContain(`\n${READ}\n`);
    expect(linkedReadOf(block)).toEqual({ artifactId: DOC, title: 'Garden [plan]', kind: 'document', revision: 25 });
  });

  it('is told from text the human typed: a near miss is not one', () => {
    expect(linkedReadOf('<system-reminder>\nhello\n</system-reminder>')).toBeNull();
    expect(linkedReadOf(linkedReadBlock(READ).replace('"status": "read"', '"status": "refused"'))).toBeNull();
    expect(linkedReadOf(`please ${linkedReadBlock(READ)}`)).toBeNull();
  });

  it('is taken out of a message for every reader of its words', () => {
    const typed = { type: 'text', text: `Rewrite [it](maws-artifact:${DOC}).` };
    expect(withoutLinkedReads([typed, { type: 'text', text: linkedReadBlock(READ) }])).toEqual([typed]);
    expect(withoutLinkedReads('plain')).toBe('plain');
  });

  it('is counted in UTF-8 bytes, a bound on its tokens however token-dense (a token is at least one byte)', () => {
    expect(utf8Bytes('abcdef')).toBe(6);
    expect(utf8Bytes('가나다')).toBe(9);
  });
});

// The wire's form (spikes/protocol-probe/fixtures/p4/p4-a3-linked-read.jsonl): the probe wrote this module's block, and
// the engine sent it to the model unchanged.
describe('the probe’s linked read', () => {
  const rows = readFileSync(fileURLToPath(new URL('../../../spikes/protocol-probe/fixtures/p4/p4-a3-linked-read.jsonl', import.meta.url)), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as { direction: string; frame: Record<string, unknown> });
  const sent = rows.find((r) => r.direction === 'meta' && r.frame.event === 'sent')!.frame as { words: string; read: string; block: string };

  it('is this module’s block for that read, and its links are the words’ alone', () => {
    expect(sent.block).toBe(linkedReadBlock(sent.read));
    expect(linkedArtifacts([{ type: 'text', text: sent.words }, { type: 'text', text: sent.block }])).toEqual(linkedArtifacts(sent.words));
    expect(linkedReadOf(sent.block)).toMatchObject({ revision: 25, kind: 'document' });
  });
});
