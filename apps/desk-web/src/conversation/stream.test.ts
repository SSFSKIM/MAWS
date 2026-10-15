// A channel's stream (§4): the group chat shows what is addressed to the human — messages, questions (with their answer
// once given), what humans posted, lifecycle as system lines — with agent-to-agent traffic folded into one row per run;
// a direct channel is one session's exchange with the human, the working record between folded. Pending requests sit
// where they were first seen; an async question's request is its `question` event's.
import { describe, expect, it } from 'vitest';
import type { LogEvent } from 'desk-hub/protocol';
import { buildStream, type StreamItem } from './stream';

const S1 = '67646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b'; // maws-45 @mini
const S2 = '9b2e4c6d-1a3f-4e5b-8c7d-0f1e2d3c4b5a'; // maws-fe @SK.local
const M = '4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c';
let offset = 0;
const ev = (writer: string, kind: string, fields: Record<string, unknown>) => ({
  offset: ++offset,
  event: { ts: '2026-10-15T08:00:00.000Z', writer, seq: offset, kind, mac: { nonce: `n${offset}`, value: 'v' }, ...fields } as LogEvent,
});
const aliases = new Map([
  [S1, 'maws-45'],
  [S2, 'maws-fe'],
]);

function log() {
  offset = 0;
  return [
    ev(`mini/${S1}`, 'joined', { session: S1, alias: 'maws-45', machine: 'mini', seat: '' }), // 1
    ev(`mini/${S1}`, 'message', { from: 'maws-45', to: 'host', text: 'migration merged', src: 'r1#0' }), // 2
    ev(`SK.local/${S2}`, 'say', { from: 'maws-fe', to: [{ session: S1, alias: 'maws-45' }], text: 'you renamed a column' }), // 3
    ev(`mini/${S1}`, 'say', { from: 'maws-45', to: [{ session: S2, alias: 'maws-fe' }], text: 'yes, user_id' }), // 4
    ev(`SK.local/${S2}`, 'say', { from: 'maws-fe', to: '*', text: 'rebasing' }), // 5
    ev(`hub/${M}`, 'human', { from: 'human', member: M, to: [{ session: S1, alias: 'maws-45' }], text: '@maws-45 keep user_id', created: 'x' }), // 6
    ev(`mini/${S1}`, 'question', { from: 'maws-45', to: 'host', text: 'Which column?', choices: ['user_id', 'owner_id'], src: 'toolu_1' }), // 7
    ev(`SK.local/${S2}`, 'say', { from: 'maws-fe', to: [{ session: S1, alias: 'maws-45' }], text: 'done' }), // 8
    ev(`mini/${S1}`, 'answered', { from: 'maws-45', src: 'toolu_1', text: 'user_id' }), // 9
    ev(`mini/${S1}`, 'retired', { session: S1, by: 'human', reason: 'retire' }), // 10
  ];
}

const shape = (items: StreamItem[]) => items.map((i) => (i.kind === 'agents' ? `agents:${i.says.map((s) => s.offset).join(',')}` : i.kind === 'request' ? `request:${i.request}` : `${i.kind}:${i.offset}`));

describe('the group chat', () => {
  it('draws messages, humans, questions with their answer, and system lines, folding each run of agent traffic', () => {
    const items = buildStream({ kind: 'group' }, log(), aliases, []);
    expect(shape(items)).toEqual(['system:1', 'message:2', 'agents:3,4,5', 'human:6', 'question:7', 'agents:8', 'system:10']);
    const question = items.find((i) => i.kind === 'question');
    expect(question).toMatchObject({ kind: 'question', session: S1, request: 'toolu_1', answered: { text: 'user_id' } });
    expect(items.find((i) => i.kind === 'system' && i.offset === 10)).toMatchObject({ text: 'maws-45 retired by human' });
  });

  it('names who retired a session: you, another member of the org by its id, or what sminos recorded', () => {
    const OTHER = '0f1e2d3c4b5a69788796a5b4c3d2e1f0';
    const retired = (by: string) => [...log().slice(0, 1), ev(`mini/${S1}`, 'retired', { session: S1, by, reason: 'retire' })];
    const line = (by: string) => buildStream({ kind: 'group' }, retired(by), aliases, [], { member: M }).find((i) => i.kind === 'system' && i.event.kind === 'retired');
    expect(line(M)).toMatchObject({ text: 'maws-45 retired by you' });
    expect(line(OTHER)).toMatchObject({ text: 'maws-45 retired by another member (0f1e2d3c)' });
    expect(line('maws-fe')).toMatchObject({ text: 'maws-45 retired by maws-fe' });
    expect(line('')).toMatchObject({ text: 'maws-45 retired' });
  });

  it('places a pending request after the log it was first seen behind, and joins an async question to its event', () => {
    const items = buildStream({ kind: 'group' }, log(), aliases, [
      { request: 'toolu_9', session: S2, at: 2 },
      { request: 'toolu_1', session: S1, at: 7 },
      { request: 'toolu_late', session: S1, at: 99 },
    ]);
    expect(shape(items)).toEqual(['system:1', 'message:2', 'request:toolu_9', 'agents:3,4,5', 'human:6', 'question:7', 'agents:8', 'system:10', 'request:toolu_late']);
  });
});

describe('status and state', () => {
  function lifecycle() {
    offset = 0;
    return [
      ev(`mini/${S1}`, 'joined', { session: S1, alias: 'maws-45', machine: 'mini', seat: '' }), // 1
      ev(`mini/${S1}`, 'state', { session: S1, state: 'busy', machine: 'mini' }), // 2: running, as joined said
      ev(`mini/${S1}`, 'status', { session: S1, text: 'fixture 8/8' }), // 3
      ev(`mini/${S1}`, 'state', { session: S1, state: 'idle', machine: 'mini' }), // 4: still running
      ev(`mini/${S1}`, 'state', { session: S1, state: 'stopped', machine: 'mini' }), // 5: stopped
      ev(`mini/${S1}`, 'state', { session: S1, state: 'gone', machine: 'mini' }), // 6: still not running
      ev(`SK.local/${S2}`, 'state', { session: S2, state: 'stopped', machine: 'SK.local' }), // 7: another session
      ev(`mini/${S1}`, 'state', { session: S1, state: 'busy', machine: 'mini' }), // 8: running again
      ev(`mini/${S1}`, 'status', { session: S1, text: '' }), // 9
    ];
  }

  it('draws a status line, and a state only where the session starts or stops running, in the group chat', () => {
    const items = buildStream({ kind: 'group' }, lifecycle(), aliases, []);
    expect(shape(items)).toEqual(['system:1', 'system:3', 'system:5', 'system:7', 'system:8', 'system:9']);
    const text = (o: number) => (items.find((i) => i.kind === 'system' && i.offset === o) as { text: string }).text;
    expect(text(3)).toBe('maws-45 status: fixture 8/8');
    expect(text(5)).toBe('maws-45 stopped on mini');
    expect(text(7)).toBe('maws-fe stopped on SK.local');
    expect(text(8)).toBe('maws-45 is running again on mini');
    expect(text(9)).toBe('maws-45 cleared its status');
  });

  it("draws the same lines for the session's own channel, and none of another's", () => {
    expect(shape(buildStream({ kind: 'session', session: S1 }, lifecycle(), aliases, []))).toEqual(['system:1', 'system:3', 'system:5', 'system:8', 'system:9']);
  });
});

describe('a direct channel', () => {
  it("holds the session's exchange with the human and its own lifecycle, the working record folded before each of its messages", () => {
    const items = buildStream({ kind: 'session', session: S1 }, log(), aliases, [{ request: 'toolu_2', session: S1, at: 9 }, { request: 'toolu_x', session: S2, at: 9 }]);
    expect(shape(items)).toEqual(['system:1', 'work:2', 'message:2', 'agents:3,4', 'human:6', 'work:7', 'question:7', 'agents:8', 'request:toolu_2', 'system:10']);
    expect(items.find((i) => i.kind === 'question')).toMatchObject({ answered: { text: 'user_id' } });
    // Each fold bounds the working record by the `src` of the session's exchange items around it (null for an open end).
    expect(items.filter((i) => i.kind === 'work').map((i) => (i as { range: unknown }).range)).toEqual([
      { from: null, to: 'r1#0' },
      { from: 'r1#0', to: 'toolu_1' },
    ]);
  });

  it('folds the working record after its last exchange item, open-ended, while the session is live', () => {
    const items = buildStream({ kind: 'session', session: S1 }, log().slice(0, 9), aliases, [], { live: true });
    expect(items.at(-1)).toMatchObject({ kind: 'work', range: { from: 'toolu_1', to: null } });
    expect(buildStream({ kind: 'session', session: S1 }, log().slice(0, 9), aliases, []).at(-1)?.kind).not.toBe('work');
  });

  it('bounds the working record at a native question, which is a request with no question event, by its call id', () => {
    const items = buildStream({ kind: 'session', session: S1 }, log().slice(0, 2), aliases, [{ request: 'toolu_native', session: S1, at: 2, question: true }], { live: true });
    expect(shape(items)).toEqual(['system:1', 'work:2', 'message:2', 'work:2', 'request:toolu_native', 'work:9007199254740991']);
    expect(items.filter((i) => i.kind === 'work').map((i) => (i as { range: unknown }).range)).toEqual([
      { from: null, to: 'r1#0' },
      { from: 'r1#0', to: 'toolu_native' },
      { from: 'toolu_native', to: null },
    ]);
  });

  it('makes one bound of a question that is pending and in the log, and none of a permission prompt', () => {
    const items = buildStream({ kind: 'session', session: S1 }, log(), aliases, [
      { request: 'toolu_1', session: S1, at: 2, question: true }, // also the `question` event at 7
      { request: 'toolu_perm', session: S1, at: 7, question: false },
    ]);
    expect(items.filter((i) => i.kind === 'work').map((i) => (i as { range: unknown }).range)).toEqual([
      { from: null, to: 'r1#0' },
      { from: 'r1#0', to: 'toolu_1' },
    ]);
    expect(shape(items).filter((k) => k.startsWith('request'))).toEqual(['request:toolu_perm']);
  });

  it("draws a human event addressed elsewhere nowhere in this channel, and an untagged one only in the group", () => {
    offset = 0;
    const entries = [ev(`hub/${M}`, 'human', { from: 'human', member: M, to: '*', text: 'status', created: 'x' })];
    expect(buildStream({ kind: 'session', session: S1 }, entries, aliases, [])).toEqual([]);
    expect(shape(buildStream({ kind: 'group' }, entries, aliases, []))).toEqual(['human:1']);
  });
});
