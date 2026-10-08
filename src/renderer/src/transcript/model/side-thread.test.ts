// E3 (M3): the anchored prompt and the side-thread row through the transcript model (E3 execution document, Design §2,
// §5 and §6). The anchored prompt draws from its own text, the same from the live `user.message`, the engine's queued
// steer on disk and a held entry; the side-thread row is one per child, in the turn or loose block its first event
// landed in, updated in place by every later summary, and the same whether the stream carried each summary or a
// snapshot only the latest.
import { describe, expect, it } from 'vitest';
import { anchoredMessage, promotionMessage } from '@shared/anchor/message';
import type { Anchor } from '@shared/anchor/anchor';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId, SessionId } from '@shared/graph/ids';
import { ChainFollower } from '../../../../engine-host/fs/chain-follower';
import { loadJournal } from '../../../../../test/support/fixtures';
import { MemoryFileReader } from '../../../../../test/support/memory-reader';
import { journalToEvents } from '../dev/journal';
import { rowsOf } from './derive';
import { applyEvents, createState, type TranscriptState } from './reduce';
import type { Row } from './rows';
import { RowSchema } from './schema';
import { builder, uuid, type Builder } from './test-events';
import { anchoredTextOf, userTextOf } from './user-text';

type RowOf<K extends Row['kind']> = Extract<Row, { kind: K }>;
const ofKind = <K extends Row['kind']>(rows: Row[], kind: K) => rows.filter((row): row is RowOf<K> => row.kind === kind);
const stateOf = (events: SessionEvent[]) => applyEvents(createState(null, null), events);
const folded = (state: TranscriptState) => rowsOf(state);

const ANCHOR: Anchor = { kind: 'file-line', locator: '/repo/src/x.ts#L42', label: 'x.ts:42', path: '/repo/src/x.ts', line: 42 };
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR4nGP4z8DwHwyBNBAGADWLC/WeCk2QAAAAAElFTkSuQmCC';
const PARENT = 'parent-app' as AppSessionId;
const CHILD = 'child-app' as AppSessionId;

// main's app-synthesised events (`seq: null`, the ids of Interfaces "X1 events")
function opened(b: Builder, child = CHILD, anchor: Anchor | null = ANCHOR): void {
  const event = b.emit('side.thread.opened', { childAppSessionId: child, childEngineSessionId: 'child-engine' as SessionId, anchor, openedBy: anchor === null ? 'btw' : 'comment' }, { id: `${PARENT}:side-thread:${child}:opened` });
  (event as { seq: number | null }).seq = null;
}
function summarised(b: Builder, turns: number, text: string | null, isError = false, child = CHILD): void {
  const event = b.emit('side.thread.summarised', { childAppSessionId: child, text, isError, turns }, { id: `${PARENT}:side-thread:${child}:summarised:${turns}` });
  (event as { seq: number | null }).seq = null;
}

describe('the anchored prompt', () => {
  const comment = 'Why is this null-checked twice?';

  it('a live `[image, text]` steer: the anchor, the comment alone as text, and the screenshot as one image attachment', () => {
    const text = anchoredMessage({ anchor: ANCHOR, text: comment, destination: 'main', screenshot: true });
    const parsed = userTextOf([{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } }, { type: 'text', text }]);
    expect(parsed.anchor).toEqual(ANCHOR);
    expect(parsed.text).toBe(comment);
    expect(parsed.lines).toBe(1);
    expect(parsed.attachments).toEqual([{ kind: 'image', name: 'Image 1', bytes: expect.any(Number), dataUrl: `data:image/png;base64,${PNG}`, mediaType: 'image/png', text: null }]);
  });

  it('a side thread’s first prompt (string content) loses its lead, preamble and tag', () => {
    const parsed = userTextOf(anchoredMessage({ anchor: ANCHOR, text: `${comment}\nAnd here.`, destination: 'thread', screenshot: false }));
    expect(parsed).toMatchObject({ anchor: ANCHOR, text: `${comment}\nAnd here.`, lines: 2, attachments: [] });
  });

  it('a look-alike stays text: a tag mid-message, a malformed tag, a lead with no tag', () => {
    const middle = `Comment on "x.ts:42" (file /repo/src/x.ts, line 42):\n<maws_anchor kind="file-line" label="x.ts:42" locator="/repo/src/x.ts#L42"/>\nthen more`;
    const malformed = 'hello\n\n<maws_anchor kind="x"/>';
    const leadOnly = 'Comment on "x.ts:42" (file /repo/src/x.ts, line 42):\nhello';
    for (const text of [middle, malformed, leadOnly]) {
      const parsed = userTextOf(text);
      expect(parsed.anchor).toBeNull();
      expect(parsed.text).toBe(text);
    }
  });

  it('the framing is kept beside the anchor, so the comment framed again is the message as sent (scale-review C scalpel-2#1)', () => {
    const sent: [string, { destination: 'thread' | 'main' | null; screenshot: boolean }][] = [
      [anchoredMessage({ anchor: ANCHOR, text: comment, destination: 'thread', screenshot: false }), { destination: 'thread', screenshot: false }],
      [anchoredMessage({ anchor: ANCHOR, text: comment, destination: 'main', screenshot: true }), { destination: 'main', screenshot: true }],
      [promotionMessage([{ question: 'Why?', response: 'Because.' }], comment), { destination: null, screenshot: false }],
    ];
    for (const [text, frame] of sent) {
      const parsed = userTextOf(text);
      expect(parsed.frame).toEqual(frame);
      expect(anchoredTextOf({ anchor: parsed.anchor!, ...parsed.frame! }, parsed.text)).toBe(text);
    }
    expect(userTextOf('plain prompt').frame).toBeNull();
  });

  it('the user row carries the anchor only when the prompt has one (no field on an ordinary prompt)', () => {
    const b = builder();
    b.emit('turn.started', { userMessageUuid: uuid('u1'), origin: 'human' });
    b.emit('user.message', { messageUuid: uuid('u1'), content: anchoredMessage({ anchor: ANCHOR, text: comment, destination: 'main', screenshot: false }), isReplay: false, isSynthetic: false, origin: 'human', bash: null });
    b.end(['u1']);
    b.turn('u2', 'plain prompt');
    const users = ofKind(folded(stateOf(b.events)), 'user');
    expect(users.map((row) => [row.text, row.anchor, row.anchorFrame])).toEqual([[comment, ANCHOR, { destination: 'main', screenshot: false }], ['plain prompt', undefined, undefined]]);
    expect('anchor' in users[1]).toBe(false);
    expect('anchorFrame' in users[1]).toBe(false);
    for (const row of users) expect(RowSchema.safeParse(row).success).toBe(true);
  });

  it('M0’s steer draws the same from the live stream and from the engine’s JSONL (a queued_command attachment): anchor, text, one image', async () => {
    const journal = loadJournal('pass3', 'p1-side-thread-live');
    const live = ofKind(folded(stateOf(journalToEvents(journal))), 'user').find((row) => row.anchor !== undefined);
    const snapshot = journal.find((row) => row.direction === 'meta' && (row.frame as { label?: string } | null)?.label === 'side-thread-parent')!;
    const bytes = Buffer.from(`${(snapshot.frame as { records: unknown[] }).records.map((record) => JSON.stringify(record)).join('\n')}\n`);
    const events: SessionEvent[] = [];
    const follower = new ChainFollower(new MemoryFileReader(bytes), 'cb92d80b-9d77-4e69-be1f-a0cc42e03da0' as SessionId, null, (e) => e.t === 'events' && events.push(...e.events), { holders: () => 0 });
    await follower.start();
    follower.stop();
    const disk = ofKind(folded(stateOf(events)), 'user').find((row) => row.anchor !== undefined);
    expect(live).toBeDefined();
    expect(disk).toBeDefined();
    expect(live!.anchor).toMatchObject({ kind: 'file-line', label: 'probe.txt:1', line: 1 });
    expect(live!.text).toBe('When the command has finished, end your reply with the word I asked you to remember.');
    expect(live!.attachments.map((a) => a.kind)).toEqual(['image']);
    expect([disk!.anchor, disk!.text, disk!.attachments, disk!.steer]).toEqual([live!.anchor, live!.text, live!.attachments, live!.steer]);
  });
});

describe('the side-thread row', () => {
  it('opened while the parent is idle: one loose row after the last turn, opened, no turns', () => {
    const b = builder();
    b.turn('u1');
    b.text('m1', 0, 'answer');
    b.end(['u1']);
    opened(b);
    const rows = folded(stateOf(b.events));
    const side = ofKind(rows, 'side_thread');
    expect(side).toEqual([{ id: `side:${CHILD}`, turnId: null, at: b.events.at(-1)!.at, kind: 'side_thread', childAppSessionId: CHILD, label: 'x.ts:42', anchorKind: 'file-line', openedBy: 'comment', state: 'opened', text: null, turns: 0 }]);
    expect(rows.at(-1)).toBe(side[0]);
    expect(RowSchema.safeParse(side[0]).success).toBe(true);
  });

  it('opened mid-turn: the row sits in that turn and stays in view when it folds; two summaries update it in place to finished (2 turns)', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('t1', 'Bash', { command: 'sleep 20' });
    opened(b);
    b.result('t1', 'ok');
    b.text('m2', 0, 'done');
    b.end(['u1']);
    summarised(b, 1, 'First answer.');
    summarised(b, 2, 'Second answer.');
    const state = stateOf(b.events);
    const rows = folded(state); // a closed turn reads folded: only its persistent rows
    const side = ofKind(rows, 'side_thread');
    expect(side).toHaveLength(1);
    expect(side[0]).toMatchObject({ turnId: state.order[0], state: 'finished', text: 'Second answer.', turns: 2, label: 'x.ts:42' });
  });

  it('a summary arriving during a later parent turn updates the row in the turn where it opened, not a second row', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('t1', 'Bash', { command: 'sleep 20' });
    opened(b);
    b.result('t1', 'ok');
    b.end(['u1']);
    b.turn('u2');
    b.toolUse('t2', 'Read', { file_path: '/a' });
    summarised(b, 1, 'Thread answer.');
    const state = stateOf(b.events);
    const side = ofKind(folded(state), 'side_thread');
    expect(side).toHaveLength(1);
    expect(side[0]).toMatchObject({ turnId: state.order[0], state: 'finished', turns: 1, text: 'Thread answer.' });
  });

  it('opened loose, summarised during a later turn: still one loose row where it opened', () => {
    const b = builder();
    b.turn('u1');
    b.end(['u1']);
    opened(b);
    b.turn('u2');
    b.toolUse('t2', 'Read', { file_path: '/a' });
    summarised(b, 1, 'Loose answer.');
    const rows = folded(stateOf(b.events));
    const side = ofKind(rows, 'side_thread');
    expect(side).toHaveLength(1);
    expect(side[0]).toMatchObject({ turnId: null, state: 'finished', text: 'Loose answer.' });
    expect(rows.indexOf(side[0])).toBeLessThan(rows.findIndex((row) => row.kind === 'user' && row.messageUuid === uuid('u2')));
  });

  it('a summary before its opened (a fast thread) creates the row; the opened fills its label and anchor', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('t1', 'Bash', { command: 'sleep 20' });
    summarised(b, 1, 'Fast.');
    const before = ofKind(folded(stateOf(b.events)), 'side_thread');
    expect(before).toEqual([expect.objectContaining({ label: null, anchorKind: null, openedBy: null, state: 'finished', turns: 1 })]);
    opened(b);
    b.end(['u1']);
    const side = ofKind(folded(stateOf(b.events)), 'side_thread');
    expect(side).toHaveLength(1);
    expect(side[0]).toMatchObject({ label: 'x.ts:42', anchorKind: 'file-line', openedBy: 'comment', state: 'finished', text: 'Fast.', turns: 1, at: before[0].at });
  });

  it('a failed turn reads failed; a btw thread has no anchor; a later summary with no text keeps none and the state follows the latest', () => {
    const b = builder();
    b.turn('u1');
    b.end(['u1']);
    opened(b, 'btw-child' as AppSessionId, null);
    summarised(b, 1, 'Boom.', true, 'btw-child' as AppSessionId);
    const side = ofKind(folded(stateOf(b.events)), 'side_thread');
    expect(side).toEqual([expect.objectContaining({ childAppSessionId: 'btw-child', label: null, anchorKind: null, openedBy: 'btw', state: 'failed', text: 'Boom.', turns: 1 })]);
  });

  it('two threads are two rows; the same events again (a disk-form duplicate, same ids) add nothing', () => {
    const b = builder();
    b.turn('u1');
    b.end(['u1']);
    opened(b);
    opened(b, 'other' as AppSessionId);
    summarised(b, 1, 'One.');
    const state = stateOf(b.events);
    const once = folded(state);
    expect(ofKind(once, 'side_thread').map((row) => row.childAppSessionId)).toEqual([CHILD, 'other']);
    const again = folded(applyEvents(state, b.events.filter((event) => event.kind.startsWith('side.thread.'))));
    expect(again).toEqual(once);
  });

  // M3's review (M4): the row re-derives on an increment, keeps its text through a summary without one, and is never
  // rolled back by an older summary arriving late
  it('incremental: rows derived after the opened, then a summary applied to that state, re-derive the row in place', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('t1', 'Bash', { command: 'sleep 20' });
    opened(b);
    const first = stateOf(b.events);
    expect(ofKind(rowsOf(first), 'side_thread')).toEqual([expect.objectContaining({ state: 'opened', turns: 0, text: null })]);
    const before = b.events.length;
    summarised(b, 1, 'Done here.');
    const second = applyEvents(first, b.events.slice(before));
    const side = ofKind(rowsOf(second), 'side_thread');
    expect(side).toHaveLength(1);
    expect(side[0]).toMatchObject({ turnId: second.order[0], state: 'finished', turns: 1, text: 'Done here.' });
  });

  it('a second summary with no text keeps the first one’s text and counts the turn', () => {
    const b = builder();
    b.turn('u1');
    b.end(['u1']);
    opened(b);
    summarised(b, 1, 'First answer.');
    summarised(b, 2, null);
    expect(ofKind(folded(stateOf(b.events)), 'side_thread')).toEqual([expect.objectContaining({ state: 'finished', turns: 2, text: 'First answer.' })]);
  });

  it('an older summary arriving after a newer one (lower turns) changes nothing', () => {
    const b = builder();
    b.turn('u1');
    b.end(['u1']);
    opened(b);
    summarised(b, 2, 'Second answer.');
    summarised(b, 1, 'First answer.', true);
    expect(ofKind(folded(stateOf(b.events)), 'side_thread')).toEqual([expect.objectContaining({ state: 'finished', turns: 2, text: 'Second answer.' })]);
  });

  it('parity: a snapshot holding the opened and only the latest summary draws the row the live stream drew', () => {
    const live = builder();
    live.turn('u1');
    live.toolUse('t1', 'Bash', { command: 'sleep 20' });
    opened(live);
    live.result('t1', 'ok');
    live.end(['u1']);
    summarised(live, 1, 'One.');
    summarised(live, 2, 'Two.');
    const snapshot = live.events.filter((event) => event.id !== `${PARENT}:side-thread:${CHILD}:summarised:1`);
    expect(ofKind(folded(stateOf(snapshot)), 'side_thread')).toEqual(ofKind(folded(stateOf(live.events)), 'side_thread'));
  });
});
