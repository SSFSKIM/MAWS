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

  it('places a pending request after the log it was first seen behind, and joins an async question to its event', () => {
    const items = buildStream({ kind: 'group' }, log(), aliases, [
      { request: 'toolu_9', session: S2, at: 2 },
      { request: 'toolu_1', session: S1, at: 7 },
      { request: 'toolu_late', session: S1, at: 99 },
    ]);
    expect(shape(items)).toEqual(['system:1', 'message:2', 'request:toolu_9', 'agents:3,4,5', 'human:6', 'question:7', 'agents:8', 'system:10', 'request:toolu_late']);
  });
});

describe('a direct channel', () => {
  it("holds the session's exchange with the human and its own lifecycle, the working record folded before each of its messages", () => {
    const items = buildStream({ kind: 'session', session: S1 }, log(), aliases, [{ request: 'toolu_2', session: S1, at: 9 }, { request: 'toolu_x', session: S2, at: 9 }]);
    expect(shape(items)).toEqual(['system:1', 'work:2', 'message:2', 'agents:3,4', 'human:6', 'work:7', 'question:7', 'agents:8', 'request:toolu_2', 'system:10']);
  });

  it("draws a human event addressed elsewhere nowhere in this channel, and an untagged one only in the group", () => {
    offset = 0;
    const entries = [ev(`hub/${M}`, 'human', { from: 'human', member: M, to: '*', text: 'status', created: 'x' })];
    expect(buildStream({ kind: 'session', session: S1 }, entries, aliases, [])).toEqual([]);
    expect(shape(buildStream({ kind: 'group' }, entries, aliases, []))).toEqual(['human:1']);
  });
});
