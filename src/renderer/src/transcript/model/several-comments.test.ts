// UX wave U5a (M5; docs/doperpowers/plans/2026-11-12-ux-wave-U5a-comment-card.md, Interfaces §H, decision 13): a
// message of several comments is one user row carrying each comment's anchor and text in the order made, each
// screenshot paired with the comment whose lead announced it when the counts agree, and no Edit. The same row comes from
// the live prompt, a steer taken into a running turn, the engine's queued steer on disk, a held entry and both forms a
// terminal session's bridge stores (P7: a prompt row while idle; a meta row during a turn and after an Esc). A message of
// one comment is today's row.
import { describe, expect, it } from 'vitest';
import { commentsMessage, type MessageComment } from '@shared/anchor/message';
import type { Anchor } from '@shared/anchor/anchor';
import type { ContentBlock, SessionEvent } from '@shared/graph/events';
import type { SessionId } from '@shared/graph/ids';
import { parseTranscriptRecord } from '@shared/wire/transcript';
import { createBackfillContext, recordToEvents } from '../../../../engine-host/fs/backfill';
import { heldRow, rowsOf } from './derive';
import { applyEvents, createState } from './reduce';
import type { Row } from './rows';
import { RowSchema } from './schema';
import { serializeRows } from './serialize';
import { builder, uuid, type Builder } from './test-events';
import { copiedUserText, userTextOf } from './user-text';

type User = Extract<Row, { kind: 'user' }>;
const users = (rows: Row[]) => rows.filter((row): row is User => row.kind === 'user');
const drawn = (events: SessionEvent[]) => users(rowsOf(applyEvents(createState(null, null), events)));

const SAVE: Anchor = { kind: 'browser-element', label: 'Save button', locator: 'form > button.save', pageUrl: 'https://example.com/signup' };
const TITLE: Anchor = { kind: 'browser-element', label: 'Page title', locator: 'main > h1', pageUrl: 'https://example.com/signup' };
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR4nGP4z8DwHwyBNBAGADWLC/WeCk2QAAAAAElFTkSuQmCC';
const image = (data = PNG): ContentBlock => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data } });

const two = (screenshots: [boolean, boolean] = [false, false]): MessageComment[] => [
  { anchor: SAVE, text: 'Make this the primary action.', screenshot: screenshots[0] },
  { anchor: TITLE, text: 'Shorter, please.\nOne line at most.', screenshot: screenshots[1] },
];
const TEXTS = 'Make this the primary action.\n\nShorter, please.\nOne line at most.';
const COMMENTS = [{ anchor: SAVE, text: 'Make this the primary action.' }, { anchor: TITLE, text: 'Shorter, please.\nOne line at most.' }];
const COPIED = 'Comment on "Save button" (element form > button.save on https://example.com/signup):\nMake this the primary action.\n\nComment on "Page title" (element main > h1 on https://example.com/signup):\nShorter, please.\nOne line at most.';

describe('the text of a message of several comments', () => {
  it('reads every comment in the order made, with no anchor, no framing and the texts joined as the row’s text', () => {
    for (const destination of ['main', 'thread'] as const) {
      const read = userTextOf(commentsMessage(two(), destination));
      expect(read).toMatchObject({ comments: COMMENTS, commentsTo: destination === 'thread' ? 'thread' : null, anchor: null, frame: null, text: TEXTS, lines: 4, attachments: [], placeholders: [] });
    }
  });

  it('a message of one comment, and a plain prompt, carry no comments', () => {
    const one = userTextOf(commentsMessage([two()[0]!], 'main'));
    expect(one).toMatchObject({ comments: null, anchor: SAVE, frame: { destination: 'main', screenshot: false }, text: 'Make this the primary action.' });
    expect(userTextOf('plain prompt').comments).toBeNull();
  });

  it('pairs each image with the comment whose lead announced a screenshot, the k-th image the k-th such comment’s', () => {
    const both = userTextOf([image(), image('AAAA'), { type: 'text', text: commentsMessage(two([true, true]), 'main') }]);
    expect(both.comments).toEqual([{ ...COMMENTS[0], attachment: 0 }, { ...COMMENTS[1], attachment: 1 }]);
    expect(both.attachments.map((attachment) => attachment.kind)).toEqual(['image', 'image']);
    const second = userTextOf([image(), { type: 'text', text: commentsMessage(two([false, true]), 'thread') }]);
    expect(second.comments).toEqual([COMMENTS[0], { ...COMMENTS[1], attachment: 0 }]);
  });

  it('pairs nothing when the counts differ: one image for two announcing comments, or images no comment announced', () => {
    const fewer = userTextOf([image(), { type: 'text', text: commentsMessage(two([true, true]), 'main') }]);
    expect(fewer.comments).toEqual(COMMENTS);
    expect(fewer.attachments).toHaveLength(1);
    const unannounced = userTextOf([image(), image('AAAA'), { type: 'text', text: commentsMessage(two(), 'main') }]);
    expect(unannounced.comments).toEqual(COMMENTS);
    expect(unannounced.attachments).toHaveLength(2);
    const none = userTextOf(commentsMessage(two([true, true]), 'main')); // a terminal session's files travel apart from its words
    expect(none.comments).toEqual(COMMENTS);
  });

  it('Copy and the markdown export give each comment’s lead and text, a blank line between', () => {
    const row = userTextOf(commentsMessage(two([true, false]), 'main'));
    expect(copiedUserText({ text: row.text, attachments: row.attachments, placeholders: row.placeholders, comments: row.comments! })).toBe(COPIED);
  });
});

describe('the user row of several comments', () => {
  const sent = (b: Builder, u: string, content: string | ContentBlock[]) => b.emit('user.message', { messageUuid: uuid(u), content, isReplay: false, isSynthetic: false, origin: 'human', bash: null });
  const check = (row: User | undefined) => {
    expect(row).toBeDefined();
    expect(row).toMatchObject({ comments: COMMENTS, text: TEXTS, editable: false });
    expect('anchor' in row!).toBe(false);
    expect('anchorFrame' in row!).toBe(false);
    expect('commentsTo' in row!).toBe(false); // sent to the main conversation
    expect(RowSchema.safeParse(row).success).toBe(true);
  };

  it('from the live prompt: one row, its comments in order, no anchor, not offered Edit; the export gives both leads', () => {
    const b = builder();
    b.emit('turn.started', { userMessageUuid: uuid('u1'), origin: 'human' });
    sent(b, 'u1', commentsMessage(two(), 'main'));
    b.end(['u1']);
    const [row] = drawn(b.events);
    check(row);
    expect(serializeRows([row!])).toBe(`**You**\n\n${COPIED}`);
  });

  it('from a steer taken into the running turn', () => {
    const b = builder();
    b.turn('u1', 'tidy the form');
    b.toolUse('t1', 'Bash', { command: 'ls' });
    sent(b, 'u2', [image(), image('AAAA'), { type: 'text', text: commentsMessage(two([true, true]), 'main') }]);
    b.result('t1', 'ok');
    b.emit('turn.started', { userMessageUuid: uuid('u2'), origin: 'human' });
    const rows = drawn(b.events);
    expect(rows.map((row) => row.steer)).toEqual([false, true]);
    expect(rows[1]).toMatchObject({ comments: [{ ...COMMENTS[0], attachment: 0 }, { ...COMMENTS[1], attachment: 1 }], editable: false });
    expect(RowSchema.safeParse(rows[1]).success).toBe(true);
  });

  it('a thread’s first message of several comments says so (`commentsTo`), which only a thread can open with', () => {
    const b = builder();
    b.emit('turn.started', { userMessageUuid: uuid('u1'), origin: 'human' });
    sent(b, 'u1', commentsMessage(two(), 'thread'));
    const [row] = drawn(b.events);
    expect(row).toMatchObject({ comments: COMMENTS, commentsTo: 'thread', editable: false });
    expect(RowSchema.safeParse(row).success).toBe(true);
  });

  it('from a held entry', () => {
    check(heldRow({ queueId: 'q-1', content: commentsMessage(two(), 'main'), createdAt: '2026-09-28T10:00:09.000Z' }));
  });

  // The engine's records, read from disk as a reloaded session reads them (`recordToEvents`).
  const fromDisk = (records: Record<string, unknown>[]) => {
    const ctx = createBackfillContext({ sessionId: 'S' as SessionId, agent: null });
    return drawn(records.flatMap((record) => recordToEvents(parseTranscriptRecord(record), ctx)));
  };
  const t = (n: number) => `2026-11-12T09:30:${String(n).padStart(2, '0')}.000Z`;
  const prompt = (id: string, n: number, content: unknown, extra: Record<string, unknown> = {}) => ({ type: 'user', uuid: id, parentUuid: null, cwd: '/d', timestamp: t(n), ...extra, message: { role: 'user', content } });
  const toolCall = (id: string, n: number, parent: string) => ({ type: 'assistant', uuid: id, parentUuid: parent, timestamp: t(n), message: { id: `msg_${id}`, model: 'x', content: [{ type: 'tool_use', id: `toolu_${id}`, name: 'Bash', input: { command: 'ls' } }] } });

  it('from the engine’s queued steer on disk (a queued_command attachment), as the live steer draws it', () => {
    const rows = fromDisk([
      prompt('p1', 0, 'tidy the form', { origin: { kind: 'human' } }),
      toolCall('a1', 1, 'p1'),
      { type: 'user', uuid: 'r1', parentUuid: 'a1', timestamp: t(2), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_a1', content: 'ok' }] } },
      { type: 'attachment', uuid: 'q1', parentUuid: 'r1', timestamp: t(3), attachment: { type: 'queued_command', prompt: commentsMessage(two(), 'main'), source_uuid: 's1', commandMode: 'prompt', origin: { kind: 'human' }, humanTurn: true } },
    ]);
    expect(rows.map((row) => row.steer)).toEqual([false, true]);
    check(rows[1]);
  });

  // P7 (Decision Log 23; the shapes of spikes/protocol-probe/fixtures/uxwave/u5-terminal-text-*.rows.ndjson): what a
  // terminal session's bridge stores for a ticked comment.
  const SMINOS_AS_USER = { kind: 'plugin', name: 'sminos', asUser: true };
  const SMINOS = { kind: 'plugin', name: 'sminos' };
  const delivered = (id: string, n: number, parent: string | null) => ({ type: 'system', subtype: 'informational', uuid: id, parentUuid: parent, isMeta: false, timestamp: t(n), content: `sminos: delivered: ${commentsMessage(two(), 'main').replaceAll('\n', ' ')}`, level: 'notice' });

  it('from a terminal session while idle: a prompt row of string content, origin sminos as the user', () => {
    const rows = fromDisk([prompt('p1', 0, commentsMessage(two(), 'main'), { origin: SMINOS_AS_USER })]);
    expect(rows).toHaveLength(1);
    check(rows[0]);
  });

  it('from a terminal session during a turn: a meta row of one text block, origin sminos, drawn as a steer', () => {
    const rows = fromDisk([
      prompt('p1', 0, 'tidy the form', { origin: { kind: 'human' } }),
      toolCall('a1', 1, 'p1'),
      prompt('d1', 2, [{ type: 'text', text: commentsMessage(two(), 'main') }], { parentUuid: 'a1', isMeta: true, origin: SMINOS }),
      delivered('n1', 3, 'd1'),
    ]);
    expect(rows.map((row) => row.steer)).toEqual([false, true]);
    check(rows[1]);
  });

  it('from a terminal session after an Esc: the same meta row, drawn as the prompt of the wake’s turn', () => {
    const body = '[sminos bridge]\nA message for you was added to the conversation after your turn was stopped. It is the user message before this message: read it and act on it now.';
    const wake = `Another Claude session sent a message:\n<cross-session-message from-name="sminos bridge">\n${body}\n</cross-session-message>\n\nThis came from another Claude session.`;
    const rows = fromDisk([
      prompt('p1', 0, 'count slowly to 300, one line each', { origin: { kind: 'human' } }),
      { type: 'assistant', uuid: 'a1', parentUuid: 'p1', timestamp: t(1), message: { id: 'msg_a1', model: 'x', content: [{ type: 'thinking', thinking: 'Counting.', signature: 'sig' }] } },
      prompt('i1', 2, [{ type: 'text', text: '[Request interrupted by user]' }], { parentUuid: 'a1' }),
      prompt('d1', 3, [{ type: 'text', text: commentsMessage(two(), 'main') }], { parentUuid: 'i1', isMeta: true, origin: SMINOS }),
      delivered('n1', 4, 'd1'),
      prompt('w1', 5, wake, { parentUuid: 'n1', isMeta: true, origin: { kind: 'peer', from: 'unknown', name: 'sminos bridge', body } }),
      { type: 'assistant', uuid: 'a2', parentUuid: 'w1', timestamp: t(6), message: { id: 'msg_a2', model: 'x', content: [{ type: 'text', text: 'Noted.' }] } },
    ]);
    const row = rows.find((user) => user.comments !== undefined);
    check(row);
    expect(row!.steer).toBe(false);
    expect(rows.some((user) => user.text.includes('sminos: delivered'))).toBe(false);
  });

  it('a message of one comment is today’s row: its anchor and framing, no comments, editable', () => {
    const b = builder();
    b.emit('turn.started', { userMessageUuid: uuid('u1'), origin: 'human' });
    sent(b, 'u1', commentsMessage([two()[0]!], 'main'));
    const [row] = drawn(b.events);
    expect(row).toMatchObject({ anchor: SAVE, anchorFrame: { destination: 'main', screenshot: false }, text: 'Make this the primary action.', editable: true });
    expect('comments' in row!).toBe(false);
  });
});
