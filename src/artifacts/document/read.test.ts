// The agent's read (D7 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md; S5's `s5-read.mjs` checks that need no
// writer or tool): one tab as the dialect, ranged by a block id and a count, open comments as milestones that overlap
// without nesting, resolved ones unmarked, and a footer of open threads and orphans. `sinceRevision` is the host's (M7).
import type { JSONContent } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { applyV1, applyV2, diffV1, newDoc, stateV2, stateVector, type Doc, type Node } from '../yjs';
import { stripMilestones } from './markdown';
import { readDocument, ReadError } from './read';
import { schemaFor } from './schema';
import { addTab, createDocument, tabBody } from './tabs';
import { addThread, anchorOfMark, getThread, liveThreadIds, locate, reply, resolve, threadStates } from './threads';
import type { Actor } from '@shared/artifacts/actor';

const schema = schemaFor();
const owner: Actor = { kind: 'human' };
let clock = 1_760_000_000_000;
const now = () => (clock += 1000);
const comment = (threadId: string) => ({ type: 'comment', attrs: { threadId } });
const text = (value: string, marks?: JSONContent['marks']): JSONContent => ({ type: 'text', text: value, ...(marks ? { marks } : {}) });

/** S5's read world: bold inside a comment, t1 and t2 overlapping, t3 to be resolved, t4 to be orphaned. */
function world(): { doc: Doc; tab: string } {
  const doc = newDoc();
  const tab = createDocument(doc, {
    title: 'Plan',
    body: schema.nodeFromJSON({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { id: 'h1', level: 1 }, content: [text('Plan')] },
        {
          type: 'paragraph',
          attrs: { id: 'p1' },
          content: [
            text('The plan '),
            text('ships ', [comment('t1')]),
            text('quarterly', [{ type: 'bold' }, comment('t1')]),
            text(' with ', [comment('t1')]),
            text('design review', [comment('t1'), comment('t2')]),
            text(' notes', [comment('t2')]),
            text('. Owners track the budget.'),
          ],
        },
        { type: 'paragraph', attrs: { id: 'p2' }, content: [text('Second paragraph '), text('keeps going', [comment('t3')]), text(' here.')] },
        { type: 'paragraph', attrs: { id: 'p3' }, content: [text('Third', [comment('t4')]), text(' paragraph.')] },
      ],
    }),
  });
  const body = tabBody(doc, tab)!;
  const quote: Record<string, string> = { t1: 'ships quarterly with design review', t2: 'design review notes', t3: 'keeps going' };
  quote.t4 = 'Third';
  for (const id of ['t1', 't2', 't3', 't4']) addThread(doc, { threadId: id, tabId: tab, blockId: ({ t3: 'p2', t4: 'p3' } as Record<string, string>)[id] ?? 'p1', quote: quote[id], anchor: anchorOfMark(body, id)!, by: owner, at: now(), body: `On ${id}` });
  // t4's text deleted: orphaned
  (body.toArray()[3] as Node).delete(0, 'Third '.length);
  return { doc, tab };
}

describe('the read with comments (S5’s read checks)', () => {
  it('writes open comments as milestones, the overlap by named closing tags', () => {
    const { doc } = world();
    const { markdown } = readDocument(doc);
    expect(markdown).toContain('The plan <c:t1>ships **quarterly** with <c:t2>design review</c:t1> notes</c:t2>. Owners track the budget. ^p1');
  });

  it('leaves a resolved thread unmarked', () => {
    const { doc } = world();
    resolve(doc, 't3', owner, now());
    const { markdown } = readDocument(doc);
    expect(markdown).not.toContain('c:t3>');
    expect(markdown).toContain('Second paragraph keeps going here. ^p2');
  });

  it('lists open threads and orphans in a footer, the orphan with its quote and nearest block, and counts the resolved', () => {
    const { doc } = world();
    resolve(doc, 't3', owner, now());
    const { markdown } = readDocument(doc);
    const footer = markdown.split('\n---\n')[1];
    expect(footer).toBe(
      [
        'Comments: 3 open (1 orphaned), 1 resolved (not shown; artifact_comments {status: "all"})',
        '- c:t1 on ^p1 · "ships quarterly with design review" · 1 message',
        '- c:t2 on ^p1 · "design review notes" · 1 message',
        '- c:t4 orphaned, near ^p3 · "Third" · 1 message',
        '',
      ].join('\n'),
    );
  });

  it('gives the plain markdown once the milestones are stripped', () => {
    const { doc } = world();
    expect(stripMilestones(readDocument(doc).markdown.split('\n---\n')[0])).toContain('The plan ships **quarterly** with design review notes. Owners track the budget. ^p1');
  });

  it('marks nothing of a thread once it is resolved, and the other stays marked', () => {
    const { doc } = world();
    resolve(doc, 't1', owner, now());
    const { markdown } = readDocument(doc);
    expect(markdown).not.toContain('c:t1>');
    expect(markdown).toContain('<c:t2>design review notes</c:t2>');
  });
});

// S5's read checks 5, 7 and 8 on the model: what artifact_comments lists (M7 shapes the tool), a reply and a resolve
// written on the agent's replica reaching the owner's. Checks 6 and 10 (an edit answering a thread, `old` matching
// plain text) need the writer and are M2's.
describe('the agent’s turn on the threads (S5’s read checks on the model)', () => {
  const agent = { kind: 'session', appSessionId: 'session-1' } as Actor;
  const replicaOf = (doc: Doc): Doc => {
    const copy = newDoc();
    applyV2(copy, stateV2(doc));
    return copy;
  };
  const sync = (from: Doc, to: Doc) => applyV1(to, diffV1(from, stateVector(to)));
  const states = (doc: Doc) =>
    threadStates(doc, liveThreadIds(doc))
      .map((thread) => `${thread.id}:${thread.status}${thread.orphan ? ':orphan' : ''}`)
      .join(' ');

  it('lists the open threads with their quote, block and messages, the orphan with the block near it', () => {
    const { doc } = world();
    resolve(doc, 't3', owner, now());
    const open = threadStates(doc, liveThreadIds(doc)).filter((thread) => thread.status === 'open');
    expect(open.map((thread) => `${thread.id}:${thread.orphan ? `orphan@${locate(doc, thread).blockId}` : thread.blockId}`)).toEqual(['t1:p1', 't2:p1', 't4:orphan@p3']);
    expect(open.map((thread) => [thread.quote, thread.messages.length])).toEqual([
      ['ships quarterly with design review', 1],
      ['design review notes', 1],
      ['Third', 1],
    ]);
  });

  it('carries the agent’s reply and resolve from its replica to the owner’s, the read following', () => {
    const { doc } = world();
    resolve(doc, 't3', owner, now());
    const replica = replicaOf(doc);
    reply(replica, 't1', { id: 't1:m1', by: agent, at: now(), body: 'Edited ^p1.' });
    resolve(replica, 't1', agent, now());
    reply(replica, 't2', { id: 't2:m1', by: agent, at: now(), body: 'Which notes?' });
    sync(replica, doc);
    expect(getThread(doc, 't1')!.messages.map((message) => message.by)).toEqual([owner, agent]);
    expect(states(doc)).toBe('t1:resolved t2:open t3:resolved t4:open:orphan');
    const { markdown } = readDocument(doc);
    expect(markdown).not.toContain('c:t1>');
    expect(markdown).toContain('<c:t2>design review notes</c:t2>');
    expect(markdown).toContain('- c:t2 on ^p1 · "design review notes" · 2 messages');
  });
});

describe('ranges and tabs', () => {
  function long(): { doc: Doc; first: string; second: string } {
    const doc = newDoc();
    const content = Array.from({ length: 12 }, (_, i) => ({ type: 'paragraph', attrs: { id: `b${i}` }, content: [text(`Block ${i}.`)] }));
    content.splice(3, 0, { type: 'bulletList', attrs: { id: 'ul' }, content: [{ type: 'listItem', attrs: { id: 'li' }, content: [{ type: 'paragraph', attrs: { id: 'lip' }, content: [text('Item')] }] }] } as never);
    const first = createDocument(doc, { title: 'One', body: schema.nodeFromJSON({ type: 'doc', content }) });
    const second = addTab(doc, { title: 'Two', body: schema.nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph', attrs: { id: 'z1' }, content: [text('Other tab.')] }] }) });
    return { doc, first, second };
  }

  it('reads the first tab by default, every tab listed with its block count, and no footer without comments', () => {
    const { doc, first, second } = long();
    const read = readDocument(doc);
    expect(read).toMatchObject({ kind: 'document', tab: first, next: null, tabs: [{ id: first, title: 'One', blocks: 13 }, { id: second, title: 'Two', blocks: 1 }] });
    expect(read.markdown.startsWith('Block 0. ^b0\n\nBlock 1. ^b1')).toBe(true);
    expect(read.markdown).not.toContain('---');
  });

  it('reads from a block, inclusive, for a count, and names where the next range starts', () => {
    const { doc } = long();
    const read = readDocument(doc, { from: 'b2', count: 3 });
    expect(read.markdown).toBe('Block 2. ^b2\n\n- Item ^li\n^ul\n\nBlock 3. ^b3\n');
    expect(read.next).toBe('b4');
    expect(readDocument(doc, { from: 'b10', count: 5 }).next).toBeNull();
  });

  it('starts a range at the top-level block that holds a nested id', () => {
    const { doc } = long();
    expect(readDocument(doc, { from: 'li', count: 1 }).markdown).toBe('- Item ^li\n^ul\n');
  });

  it('reads another tab', () => {
    const { doc, second } = long();
    expect(readDocument(doc, { tab: second }).markdown).toBe('Other tab. ^z1\n');
  });

  it('refuses an unknown tab or block, and a count outside 1 to 1,000', () => {
    const { doc } = long();
    expect(() => readDocument(doc, { tab: 'nope' })).toThrow(ReadError);
    expect(() => readDocument(doc, { from: 'nope' })).toThrow(/nope/);
    expect(() => readDocument(doc, { count: 0 })).toThrow(ReadError);
    expect(() => readDocument(doc, { count: 1001 })).toThrow(ReadError);
    try {
      readDocument(doc, { from: 'nope' });
    } catch (error) {
      expect(error).toMatchObject({ reason: 'notFound', target: 'nope' });
    }
  });

  it('lists in the footer only the threads of the range, and counts the rest', () => {
    const { doc } = world();
    const read = readDocument(doc, { from: 'p2', count: 2 });
    expect(read.markdown.split('\n---\n')[1]).toBe(
      ['Comments: 4 open (1 orphaned); 2 outside this range', '- c:t3 on ^p2 · "keeps going" · 1 message', '- c:t4 orphaned, near ^p3 · "Third" · 1 message', ''].join('\n'),
    );
  });
});
