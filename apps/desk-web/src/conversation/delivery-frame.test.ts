// A delivered send's frame line, as the session view draws its row (DC9 M6, the owner's review of M4): the first line
// sminos writes for a delivery names its event, which the session read and the tail matched; the owner's own send drops
// it from view (its bubble already says who wrote it), and a peer's draws it as a label naming who sent it. A delivery
// queued into a running turn, or appended into it by the bridge (doperpowers #233), is drawn as MAWS draws a prompt
// queued there, under the message's own identity. The text the session read is unchanged otherwise, and a row that marks
// no delivery's provenance is never touched.
import type { JsonObject } from 'desk-hub/protocol';
import { describe, expect, it } from 'vitest';
import { createTranscriptStore } from '../../../../src/renderer/src/stores/transcript';
import type { Row } from '../../../../src/renderer/src/transcript/model/rows';
import { freshSource, subagentLookupOf } from '../depth/source/desk-transcript';
import { deliveredLines, deliveryAsDrawn, deliveryFrame } from './delivery-frame';

const SESSION = 'sess-1';
const BRIDGE = { kind: 'plugin', name: 'doperpowers', asUser: true };
/** The bridge's row appended into the running turn (`$.session.append`), as the engine keeps it: meta, the plugin's origin, no `asUser`. */
const APPENDED = { kind: 'plugin', name: 'doperpowers' };
const appended = (text: string, origin: JsonObject = APPENDED): JsonObject => row([{ type: 'text', text }], origin, { isMeta: true });
let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const row = (content: string | JsonObject[], origin: JsonObject | null, extra: JsonObject = {}): JsonObject => ({
  uuid: uuid(),
  parentUuid: null,
  timestamp: '2026-10-17T10:00:00.000Z',
  sessionId: SESSION,
  isSidechain: false,
  type: 'user',
  ...(origin && { origin }),
  message: { role: 'user', content },
  ...extra,
});
/** A prompt queued into a running turn as the engine writes it (2.1.300: `queued_command`, its own uuid in `source_uuid`). */
const queued = (prompt: string, kind: string, extra: JsonObject = {}): JsonObject => ({
  uuid: uuid(),
  parentUuid: null,
  timestamp: '2026-10-17T10:00:00.000Z',
  sessionId: SESSION,
  type: 'attachment',
  attachment: { type: 'queued_command', prompt, commandMode: 'prompt', origin: { kind }, ...extra },
});
const OWN = '[sminos chat MAWS hub/5e55e5e5:12 from human → @you]';
const PEER = '[sminos chat MAWS ab12cd34:3 from fakepeer → @you | unread 2]';
const MESSAGE = '[sminos message from human id=5e551e17]';
const text = (r: JsonObject): unknown => (r.message as JsonObject | undefined)?.content ?? (r.attachment as JsonObject).prompt;

async function drawn(rows: JsonObject[]): Promise<Row[]> {
  const store = createTranscriptStore();
  await store.getState().attach('fresh', freshSource(rows, SESSION, subagentLookupOf([])), { agentId: null as never });
  return store.getState().entries.fresh.rows;
}
const users = (rows: Row[]) => rows.filter((r): r is Extract<Row, { kind: 'user' }> => r.kind === 'user');

describe('a delivered send’s frame line', () => {
  it('names who sent it: the owner (`human`) or a peer, in either form sminos writes', () => {
    expect(deliveryFrame(row(`${OWN}\nRun the suites.`, BRIDGE))).toEqual({ from: 'human', own: true });
    expect(deliveryFrame(row(`${PEER}\nI read it.`, BRIDGE))).toEqual({ from: 'fakepeer', own: false });
    expect(deliveryFrame(row(`${MESSAGE}\nRe-run the suites.`, BRIDGE))).toEqual({ from: 'human', own: true });
    expect(deliveryFrame(row([{ type: 'text', text: `${PEER}\nI read it.` }], BRIDGE))).toEqual({ from: 'fakepeer', own: false });
    expect(deliveryFrame(queued(`${PEER}\nI read it.`, 'peer'))).toEqual({ from: 'fakepeer', own: false });
    expect(deliveryFrame(row('[sminos chat My Project ab12cd34:7 from a → b → @all]\nhi', BRIDGE))).toEqual({ from: 'a → b', own: false });
  });

  it('names who sent it on the bridge’s row appended into a running turn, in each form sminos writes', () => {
    expect(deliveryFrame(appended(`${OWN}\nRun the suites.`))).toEqual({ from: 'human', own: true });
    expect(deliveryFrame(appended(`${PEER}\nI read it.`))).toEqual({ from: 'fakepeer', own: false });
    expect(deliveryFrame(appended(`${MESSAGE}\nRe-run the suites.`))).toEqual({ from: 'human', own: true });
    expect(deliveryFrame(appended('[sminos message from kim id=5e551e17]\nRe-run the suites.'))).toEqual({ from: 'kim', own: false });
    expect(deliveredLines(appended(`${PEER}\nI read it.`))).toEqual([PEER]);
  });

  it("is drawn as nothing for the owner's own send and as a label naming a peer, the rest of what the session read unchanged", () => {
    expect(text(deliveryAsDrawn(row(`${OWN}\nRun the suites.\n\nThen tell me.`, BRIDGE)))).toBe('Run the suites.\n\nThen tell me.');
    expect(text(deliveryAsDrawn(row([{ type: 'text', text: `${PEER}\nI read it.` }, { type: 'text', text: 'More.' }], BRIDGE)))).toEqual([
      { type: 'text', text: '*From fakepeer*\n\nI read it.' },
      { type: 'text', text: 'More.' },
    ]);
    // A sender's name is text, never Markdown.
    expect(text(deliveryAsDrawn(row('[sminos chat MAWS ab12cd34:3 from *a*_[b](c) → @you]\nhi', BRIDGE)))).toBe('*From \\*a\\*\\_\\[b\\]\\(c\\)*\n\nhi');
  });

  it("is drawn, queued into a running turn, as a prompt queued there: MAWS's shape for it, under the queued message's own uuid", () => {
    const peer = deliveryAsDrawn(queued(`${PEER}\nI read it.`, 'peer', { source_uuid: 'src-peer', isMeta: true }));
    expect(peer.attachment).toEqual({ type: 'queued_command', prompt: '*From fakepeer*\n\nI read it.', commandMode: 'prompt', origin: { kind: 'human' }, source_uuid: 'src-peer' });
    // With no `source_uuid`, the row's own uuid stands for the message.
    const own = queued(`${MESSAGE}\nRe-run the suites.`, 'plugin');
    expect(deliveryAsDrawn(own).attachment).toMatchObject({ prompt: 'Re-run the suites.', origin: { kind: 'human' }, source_uuid: own.uuid });
  });

  it('is drawn, appended into a running turn by the bridge, as a prompt queued there: under the appended row’s own uuid', () => {
    const peer = appended(`${PEER}\nI read it.`);
    const drawnPeer = deliveryAsDrawn(peer);
    expect(drawnPeer).toEqual({
      uuid: peer.uuid, parentUuid: null, timestamp: peer.timestamp, sessionId: SESSION, isSidechain: false, type: 'attachment',
      attachment: { type: 'queued_command', prompt: [{ type: 'text', text: '*From fakepeer*\n\nI read it.' }], commandMode: 'prompt', origin: { kind: 'human' }, source_uuid: peer.uuid },
    });
    const own = appended(`${OWN}\nRun the suites.\n\nThen tell me.`);
    expect(deliveryAsDrawn(own).attachment).toMatchObject({ prompt: [{ type: 'text', text: 'Run the suites.\n\nThen tell me.' }], source_uuid: own.uuid });
    expect(peer.message).toEqual({ role: 'user', content: [{ type: 'text', text: `${PEER}\nI read it.` }] }); // the held row is untouched
  });

  it('is never read off a row that marks no delivery: typed, origin-less, another plugin’s meta row, a queued prompt typed at the terminal', () => {
    for (const r of [
      row(`${OWN}\nRun the suites.`, { kind: 'human' }),
      row(`${OWN}\nRun the suites.`, null),
      appended(`${OWN}\nRun the suites.`, { kind: 'plugin', name: 'another' }),
      row([{ type: 'text', text: `${OWN}\nRun the suites.` }], APPENDED), // the bridge's origin on a row the engine did not keep as its append
      queued(`${OWN}\nRun the suites.`, 'human'),
      queued(`${PEER}\nI read it.`, 'task-notification'),
    ]) {
      expect(deliveryFrame(r)).toBeNull();
      expect(deliveryAsDrawn(r)).toBe(r);
    }
  });

  it('is never a lookalike: a cut, unclosed, or quoted frame, or one past the first line', () => {
    for (const content of [
      '[sminos chat MAWS hub/5e55e5e5:12 from human]\nhi',
      '[sminos chat MAWS hub/5e55e5e5:12 from human → @you\nhi',
      'Look: [sminos chat MAWS hub/5e55e5e5:12 from human → @you]\nhi',
      `hi\n${OWN}`,
      '[sminos message from human]\nhi',
    ]) {
      const r = row(content, BRIDGE);
      expect(deliveryFrame(r)).toBeNull();
      expect(deliveryAsDrawn(r)).toBe(r);
      const q = queued(content, 'peer');
      expect(deliveryAsDrawn(q)).toBe(q);
      const a = appended(content);
      expect(deliveryFrame(a)).toBeNull();
      expect(deliveryAsDrawn(a)).toBe(a);
    }
  });

  it('is never read off the bridge’s other appended rows: a steer, the interrupt’s marker and note, a stop’s note, the record before #225', () => {
    for (const text of [
      'use the split store', // a steer
      `Run the suites.\n${OWN}`, // a steer quoting a frame past its first line
      '[Request interrupted by user]',
      'The interrupt came from the desk.\nTask bk3x9a1, the Bash command the interrupt moved to the background, was then stopped: it is not running, and no notification will come for it.',
      'Task bk3x9a1, a background task, was stopped from the desk: it is not running.',
      '[Request interrupted by user from the desk]',
    ]) {
      const a = appended(text);
      expect(deliveryFrame(a), text).toBeNull();
      expect(deliveryAsDrawn(a), text).toBe(a);
    }
  });

  it('through MAWS’s backfill and projection: a send between turns is a bubble of its words, a peer’s under its label', async () => {
    const rows = await drawn([row(`${OWN}\nRun the suites.`, BRIDGE), row(`${PEER}\nI read it.`, BRIDGE)]);
    expect(users(rows).map((u) => u.text)).toEqual(['Run the suites.', '*From fakepeer*\n\nI read it.']);
  });

  it('through MAWS’s backfill and projection: a delivery queued into a running turn is a bubble in that turn, keyed by its own uuid', async () => {
    const id = 'toolu_000001';
    const prompt = row('List the files.', { kind: 'human' }, { promptId: 'p1' });
    const call = { uuid: uuid(), parentUuid: prompt.uuid, timestamp: '2026-10-17T10:00:01.000Z', sessionId: SESSION, isSidechain: false, type: 'assistant', message: { id: 'msg_1', role: 'assistant', model: 'claude-opus-5-5', type: 'message', content: [{ type: 'tool_use', id, name: 'Bash', input: { command: 'ls' } }], stop_reason: null, usage: { input_tokens: 1, output_tokens: 1 } } };
    const result = row([{ type: 'tool_result', tool_use_id: id, content: 'a.txt', is_error: false }], null, { toolUseResult: { stdout: 'a.txt', stderr: '', interrupted: false, isImage: false } });
    const delivery = queued(`${PEER}\nI read it.`, 'peer', { source_uuid: 'b0b0b0b0-0000-4000-8000-000000000001' });
    const answer = { uuid: uuid(), parentUuid: result.uuid, timestamp: '2026-10-17T10:00:03.000Z', sessionId: SESSION, isSidechain: false, type: 'assistant', message: { id: 'msg_2', role: 'assistant', model: 'claude-opus-5-5', type: 'message', content: [{ type: 'text', text: 'Noted.' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } } };
    // Before the desk's drawing, MAWS's backfill keeps such a delivery as a synthetic peer message and draws no body.
    const drawnRows = await drawn([prompt, call, result, delivery, answer]);
    const bubbles = users(drawnRows);
    expect(bubbles.map((u) => u.text)).toEqual(['List the files.', '*From fakepeer*\n\nI read it.']);
    expect(bubbles[1]).toMatchObject({ messageUuid: 'b0b0b0b0-0000-4000-8000-000000000001', steer: true });
  });

  it('through MAWS’s backfill and projection: a delivery the bridge appended into a running turn is a bubble in that turn, keyed by its row’s uuid', async () => {
    for (const [frame, words, text] of [
      [OWN, 'Run the suites.', 'Run the suites.'],
      [PEER, 'I read it.', '*From fakepeer*\n\nI read it.'],
      [MESSAGE, 'Re-run the suites.', 'Re-run the suites.'],
    ]) {
      const id = `toolu_${String(++n).padStart(6, '0')}`;
      const prompt = row('List the files.', { kind: 'human' }, { promptId: 'p1' });
      const call = { uuid: uuid(), parentUuid: prompt.uuid, timestamp: '2026-10-17T10:00:01.000Z', sessionId: SESSION, isSidechain: false, type: 'assistant', message: { id: `msg_${n}a`, role: 'assistant', model: 'claude-opus-5-5', type: 'message', content: [{ type: 'tool_use', id, name: 'Bash', input: { command: 'ls' } }], stop_reason: null, usage: { input_tokens: 1, output_tokens: 1 } } };
      const result = row([{ type: 'tool_result', tool_use_id: id, content: 'a.txt', is_error: false }], null, { toolUseResult: { stdout: 'a.txt', stderr: '', interrupted: false, isImage: false } });
      const delivery = appended(`${frame}\n${words}`);
      const answer = { uuid: uuid(), parentUuid: delivery.uuid, timestamp: '2026-10-17T10:00:03.000Z', sessionId: SESSION, isSidechain: false, type: 'assistant', message: { id: `msg_${n}b`, role: 'assistant', model: 'claude-opus-5-5', type: 'message', content: [{ type: 'text', text: 'Noted.' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } } };
      // Before the desk's drawing, MAWS's backfill keeps the appended row as meta and draws nothing for it.
      const drawnRows = await drawn([prompt, call, result, delivery, answer]);
      const bubbles = users(drawnRows);
      expect(bubbles.map((u) => u.text), frame).toEqual(['List the files.', text]);
      expect(bubbles[1], frame).toMatchObject({ messageUuid: delivery.uuid, steer: true });
      expect(drawnRows.filter((r) => r.kind === 'divider'), frame).toHaveLength(1); // one turn: the delivery opened none
    }
  });
});
