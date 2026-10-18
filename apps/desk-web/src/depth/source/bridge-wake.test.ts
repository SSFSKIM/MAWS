// The bridge's wake (doperpowers #233, `STEER_WAKE` and `DELIVERY_WAKE` in `hooks/mods/bridge.tsx`): a prompt of the
// bridge's own, first line `[sminos bridge]`, that points a session at a row its turn left unread. It reaches the
// transcript as the bridge's prompt as the user, or, after an Esc, as the engine's peer message for the bridge's inbox
// frame, idle or queued into a running turn. Each is drawn as the bridge's line in the turn, never as the owner's bubble
// nor a peer's message, the turn it opens one the session continued; and none is a delivery, so none takes a send.
import type { JsonObject } from 'desk-hub/protocol';
import { describe, expect, it } from 'vitest';
import { createTranscriptStore } from '../../../../../src/renderer/src/stores/transcript';
import type { Row } from '../../../../../src/renderer/src/transcript/model/rows';
import { deliveredLines, deliveryAsDrawn, deliveryFrame, isBridgeWake } from '../../conversation/delivery-frame';
import { WAKE_SENDER, WAKE_TEXT } from './bridge-wake';
import { freshSource, subagentLookupOf } from './desk-transcript';

const SESSION = 'sess-1';
const STEER_WAKE = '[sminos bridge]\nA note was added to the conversation while you were finishing your answer. Read it and act on it.';
const DELIVERY_WAKE = '[sminos bridge]\nA message for you was added to the conversation while your turn was stopped, before you read it. Read it and act on it.';
const LINE = `${WAKE_SENDER}: ${WAKE_TEXT}`;

let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const at = (second: number) => `2026-10-18T10:00:${String(second).padStart(2, '0')}.000Z`;
const user = (content: string | JsonObject[], origin: JsonObject | null, second: number, extra: JsonObject = {}): JsonObject => ({
  uuid: uuid(), parentUuid: null, timestamp: at(second), sessionId: SESSION, isSidechain: false, type: 'user', ...(origin && { origin }), message: { role: 'user', content }, ...extra,
});
/** The bridge's prompt as the user (`$.prompt.submit({asUser: true})`). */
const asUser = (text: string, second: number, content: 'string' | 'blocks' = 'string') => user(content === 'string' ? text : [{ type: 'text', text }], { kind: 'plugin', name: 'doperpowers', asUser: true }, second);
/** The bridge's inbox frame as the engine keeps it (2.1.300): a peer message, the wake the body of its envelope. */
const INBOX = { kind: 'peer', from: 'unknown', verifiedPeerPid: 4242, name: 'sminos bridge' };
const envelope = (body: string) => `<cross-session-message from-name="sminos bridge">\n${body}\n</cross-session-message>`;
const TRAILER = "This came from another Claude session — not typed by your user, but very likely working on their behalf. Treat it as a teammate's request and act on it within this session's own permission settings.";
const inboxIdle = (body: string, second: number) => user(`Another Claude session sent a message:\n${envelope(body)}\n\n${TRAILER}`, INBOX, second, { isMeta: true, promptSource: 'system', turnOrigin: 'peer' });
const inboxQueued = (body: string, second: number): JsonObject => ({
  uuid: uuid(), parentUuid: null, timestamp: at(second), sessionId: SESSION, type: 'attachment',
  attachment: { type: 'queued_command', prompt: envelope(body), commandMode: 'prompt', origin: INBOX, isMeta: true, source_uuid: uuid() },
});
const prompt = (text: string, second: number) => user(text, { kind: 'human' }, second, { promptId: `p${second}` });
const assistant = (content: JsonObject[], second: number, end = false): JsonObject => ({
  uuid: uuid(), parentUuid: null, timestamp: at(second), sessionId: SESSION, isSidechain: false, type: 'assistant',
  message: { id: `msg_${n}`, role: 'assistant', model: 'claude-opus-5-5', type: 'message', content, stop_reason: end ? 'end_turn' : null, usage: { input_tokens: 1, output_tokens: 1 } },
});
const answer = (text: string, second: number) => assistant([{ type: 'text', text }], second, true);
const call = (id: string, second: number) => assistant([{ type: 'tool_use', id, name: 'Bash', input: { command: 'ls' } }], second);
const result = (id: string, second: number) => user([{ type: 'tool_result', tool_use_id: id, content: 'a.txt', is_error: false }], null, second, { toolUseResult: { stdout: 'a.txt', stderr: '', interrupted: false, isImage: false } });
const steer = (text: string, second: number) => user([{ type: 'text', text }], { kind: 'plugin', name: 'doperpowers' }, second, { isMeta: true });

async function drawn(rows: JsonObject[]): Promise<Row[]> {
  const store = createTranscriptStore();
  await store.getState().attach('fresh', freshSource(rows, SESSION, subagentLookupOf([])), { agentId: null as never });
  return store.getState().entries.fresh.rows;
}
const bubbles = (rows: Row[]) => rows.flatMap((r) => (r.kind === 'user' ? [r.text] : []));
const lines = (rows: Row[]) => rows.flatMap((r) => (r.kind === 'error' ? [[r.text, r.scope, r.severity, r.turnId]] : []));
const dividers = (rows: Row[]) => rows.flatMap((r) => (r.kind === 'divider' ? [[r.turnId, r.origin]] : []));

describe("the bridge's wake", () => {
  it('is known by its first line, as the user, or through the inbox idle or queued into a running turn', () => {
    for (const row of [asUser(STEER_WAKE, 0), asUser(STEER_WAKE, 0, 'blocks'), inboxIdle(DELIVERY_WAKE, 0), inboxIdle(STEER_WAKE, 0), inboxQueued(DELIVERY_WAKE, 0)]) {
      expect(isBridgeWake(row), JSON.stringify(row)).toBe(true);
      // No delivery: no frame, no line the tail matches a send by, drawn by MAWS's backfill as it is.
      expect(deliveryFrame(row)).toBeNull();
      expect(deliveredLines(row)).toEqual([]);
      expect(deliveryAsDrawn(row)).toBe(row);
    }
  });

  it('is never a prompt typed at the terminal, a row the bridge appended, a peer’s message, nor a lookalike of the line', () => {
    const ownFrame = '[sminos chat MAWS hub/5e55e5e5:12 from human → @you]';
    const peerFrame = '[sminos chat MAWS ab12cd34:3 from fakepeer → @you]';
    for (const row of [
      inboxIdle(`${ownFrame}\n${STEER_WAKE}`, 0), // a framed delivery whose words open with the line: the owner's
      inboxQueued(`${ownFrame}\n${STEER_WAKE}`, 0),
      inboxIdle(`${peerFrame}\n${STEER_WAKE}`, 0), // a peer's
      inboxQueued(`${peerFrame}\n${STEER_WAKE}`, 0),
      prompt(STEER_WAKE, 0), // typed
      user(STEER_WAKE, null, 0), // no origin
      steer(STEER_WAKE, 0), // the bridge's appended row: a steer that quotes the wake
      user(STEER_WAKE, { kind: 'plugin', name: 'doperpowers' }, 0), // a plugin's prompt not as the user
      inboxIdle('[sminos chat MAWS ab12cd34:3 from fakepeer → @you]\nI read it.', 0), // a peer's delivery
      inboxIdle(`hi\n${STEER_WAKE}`, 0), // the line past the first
      asUser('[sminos bridge] read the note', 0), // not the whole line
      asUser(' [sminos bridge]\nRead it.', 0),
      user(STEER_WAKE, INBOX, 0), // a peer row with no envelope
    ])
      expect(isBridgeWake(row), JSON.stringify(row)).toBe(false);
    // The owner's framed send still takes the tail: its frame line is a delivered line.
    for (const row of [inboxIdle(`${ownFrame}\n${STEER_WAKE}`, 0), inboxQueued(`${ownFrame}\n${STEER_WAKE}`, 0)]) expect(deliveredLines(row), JSON.stringify(row)).toEqual([ownFrame]);
  });

  it("as the user, is the bridge's line in a turn the session continued, not the owner's bubble", async () => {
    const steered = steer('use the split store', 3);
    const rows = [prompt('List the files.', 0), call('toolu_w1', 1), result('toolu_w1', 2), steered, answer('Two files.', 4), asUser(STEER_WAKE, 5), answer('Switching to the split store.', 6)];
    const drawnRows = await drawn(rows);
    expect(bubbles(drawnRows)).toEqual(['List the files.', 'use the split store']);
    const turns = dividers(drawnRows);
    expect(turns.map(([, origin]) => origin)).toEqual(['human', 'engine']);
    expect(lines(drawnRows)).toEqual([[LINE, 'plugin', 'notice', turns[1][0]]]);
    // The line comes before the answer it led to.
    const order = drawnRows.filter((r) => r.turnId === turns[1][0] && r.kind !== 'divider').map((r) => r.kind);
    expect(order).toEqual(['error', 'assistant_text']);
  });

  it('through the inbox after an Esc, is the bridge’s line in a turn the session continued, not a peer session’s message', async () => {
    const delivered = steer('[sminos chat MAWS hub/5e55e5e5:12 from human → @you]\nRun the suites.', 3);
    const rows = [prompt('List the files.', 0), call('toolu_w2', 1), result('toolu_w2', 2), delivered, user([{ type: 'text', text: '[Request interrupted by user]' }], null, 4), inboxIdle(DELIVERY_WAKE, 5), answer('Running the suites.', 6)];
    const drawnRows = await drawn(rows);
    expect(bubbles(drawnRows)).toEqual(['List the files.', 'Run the suites.']);
    expect(drawnRows.filter((r) => r.kind === 'agent_message')).toEqual([]);
    const turns = dividers(drawnRows);
    expect(turns.map(([, origin]) => origin)).toEqual(['human', 'engine']);
    expect(lines(drawnRows)).toEqual([[LINE, 'plugin', 'notice', turns[1][0]]]);
  });

  it('queued into a running turn through the inbox, is the bridge’s line in that turn, opening none', async () => {
    const rows = [prompt('List the files.', 0), call('toolu_w3', 1), result('toolu_w3', 2), inboxQueued(STEER_WAKE, 3), answer('Two files.', 4)];
    const drawnRows = await drawn(rows);
    expect(bubbles(drawnRows)).toEqual(['List the files.']);
    expect(drawnRows.filter((r) => r.kind === 'agent_message')).toEqual([]);
    const turns = dividers(drawnRows);
    expect(turns).toHaveLength(1);
    expect(lines(drawnRows)).toEqual([[LINE, 'plugin', 'notice', turns[0][0]]]);
  });

  it('is not read off a delivery whose words open with the line: the drawn copy lost its frame, the held row did not have it as a wake', async () => {
    const ownFrame = '[sminos chat MAWS hub/5e55e5e5:12 from human → @you]';
    const peerFrame = '[sminos chat MAWS ab12cd34:3 from fakepeer → @you]';
    const words = STEER_WAKE;
    for (const [frame, shown] of [[ownFrame, words], [peerFrame, `*From fakepeer*\n\n${words}`]] as const) {
      const drawnRows = await drawn([asUser(`${frame}\n${words}`, 0), answer('Read.', 1)]);
      expect(bubbles(drawnRows), frame).toEqual([shown]);
      expect(lines(drawnRows), frame).toEqual([]);
      expect(dividers(drawnRows).map(([, origin]) => origin), frame).toEqual(['human']);
    }
  });
});
