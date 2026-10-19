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
import { deliveredLines, deliveryAsDrawn, deliveryFrame, isBridgeRow, supersededDeliveries } from './delivery-frame';

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
const REPLY = '[To reply, run in Bash: /Users/new/.claude/plugins/cache/doperpowers/doperpowers/7.175.0/skills/sminos/scripts/sminos say "@MAWS/ab12cd34 <your reply>"]';
/** A send through sminos's inbox as the engine keeps it (2.1.300 on): a peer message whose origin names no address. */
const INBOX = { kind: 'peer', from: 'unknown', verifiedPeerPid: 4242, name: 'fakepeer' };
const envelope = (body: string) => `<cross-session-message from-name="fakepeer">\n${body}\n</cross-session-message>`;
const TRAILER = "This came from another Claude session — not typed by your user, but very likely working on their behalf. Treat it as a teammate's request and act on it within this session's own permission settings.";
/** Idle: a user row, the engine's header and trailer around the envelope. */
const inboxRow = (body: string): JsonObject => row(`Another Claude session sent a message:\n${envelope(body)}\n\n${TRAILER}`, INBOX, { isMeta: true, promptSource: 'system', turnOrigin: 'peer' });
/** Busy: a queued command whose prompt is the bare envelope. */
const inboxQueued = (body: string, extra: JsonObject = {}): JsonObject => queued(envelope(body), 'peer', { origin: INBOX, isMeta: true, ...extra });
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
    expect(deliveryFrame(row('[sminos chat My Project ab12cd34:7 from a → b → @all]\nhi', BRIDGE))).toEqual({ from: 'a → b', own: false });
  });

  it('names who sent it through the inbox: the first line of the envelope’s body, idle or queued into a running turn', () => {
    for (const [frame, words, from] of [
      [OWN, 'Run the suites.', 'human'],
      [MESSAGE, 'Re-run the suites.', 'human'],
      [PEER, `I read it.\n${REPLY}`, 'fakepeer'],
    ]) {
      for (const r of [inboxRow(`${frame}\n${words}`), inboxQueued(`${frame}\n${words}`)]) {
        expect(deliveryFrame(r), frame).toEqual({ from, own: from === 'human' });
        expect(deliveredLines(r), frame).toEqual([frame]);
      }
    }
  });

  it('names who sent it on the bridge’s row appended into a running turn, in each form sminos writes', () => {
    expect(deliveryFrame(appended(`${OWN}\nRun the suites.`))).toEqual({ from: 'human', own: true });
    expect(deliveryFrame(appended(`${PEER}\nI read it.`))).toEqual({ from: 'fakepeer', own: false });
    expect(deliveryFrame(appended(`${MESSAGE}\nRe-run the suites.`))).toEqual({ from: 'human', own: true });
    expect(deliveryFrame(appended('[sminos message from kim id=5e551e17]\nRe-run the suites.'))).toEqual({ from: 'kim', own: false });
    expect(deliveredLines(appended(`${PEER}\nI read it.`))).toEqual([PEER]);
  });

  it('reads the bridge’s appended row under either plugin it runs in: doperpowers before the roll, sminos after', () => {
    // The sminos plugin (doperpowers' sminos plugin design, §11): the bridge moves out of doperpowers, and the engine names
    // its rows by the plugin that appended them.
    for (const name of ['doperpowers', 'sminos']) {
      const r = appended(`${OWN}\nRun the suites.`, { kind: 'plugin', name });
      expect(isBridgeRow(r), name).toBe(true);
      expect(deliveryFrame(r), name).toEqual({ from: 'human', own: true });
      expect(deliveryAsDrawn(r).attachment, name).toMatchObject({ prompt: [{ type: 'text', text: 'Run the suites.' }], source_uuid: r.uuid });
    }
    expect(isBridgeRow(appended(`${OWN}\nRun the suites.`, { kind: 'plugin', name: 'another' }))).toBe(false);
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
    // The shape engines through 2.1.289 wrote for a send through the inbox, still in transcripts: the frame raw.
    const peer = deliveryAsDrawn(queued(`${PEER}\nI read it.`, 'peer', { source_uuid: 'src-peer', isMeta: true }));
    expect(peer.attachment).toEqual({ type: 'queued_command', prompt: '*From fakepeer*\n\nI read it.', commandMode: 'prompt', origin: { kind: 'human' }, source_uuid: 'src-peer' });
    // With no `source_uuid`, the row's own uuid stands for the message.
    const own = queued(`${MESSAGE}\nRe-run the suites.`, 'plugin');
    expect(deliveryAsDrawn(own).attachment).toMatchObject({ prompt: 'Re-run the suites.', origin: { kind: 'human' }, source_uuid: own.uuid });
  });

  it("draws the owner's send through the inbox as the owner's own prompt, idle or queued, without its frame; a peer's as the peer message it is", () => {
    const idle = inboxRow(`${OWN}\nRun the suites.\n\nThen tell me.`);
    const drawnIdle = deliveryAsDrawn(idle);
    expect(drawnIdle.message).toEqual({ role: 'user', content: 'Run the suites.\n\nThen tell me.' });
    expect(drawnIdle.origin).toBeUndefined();
    expect(drawnIdle.isMeta).toBeUndefined();
    const busy = inboxQueued(`${MESSAGE}\nRe-run the suites.`, { source_uuid: 'src-own' });
    expect(deliveryAsDrawn(busy).attachment).toEqual({ type: 'queued_command', prompt: 'Re-run the suites.', commandMode: 'prompt', origin: { kind: 'human' }, source_uuid: 'src-own' });
    for (const r of [inboxRow(`${PEER}\nI read it.\n${REPLY}`), inboxQueued(`${PEER}\nI read it.\n${REPLY}`)]) expect(deliveryAsDrawn(r)).toBe(r);
    expect(idle.origin).toEqual(INBOX); // the held row is untouched
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
      for (const q of [inboxRow(content), inboxQueued(content)]) {
        expect(deliveryFrame(q)).toBeNull();
        expect(deliveryAsDrawn(q)).toBe(q);
      }
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
    const delivery = inboxQueued(`${OWN}\nRun the suites.`, { source_uuid: 'b0b0b0b0-0000-4000-8000-000000000001' });
    const answer = { uuid: uuid(), parentUuid: result.uuid, timestamp: '2026-10-17T10:00:03.000Z', sessionId: SESSION, isSidechain: false, type: 'assistant', message: { id: 'msg_2', role: 'assistant', model: 'claude-opus-5-5', type: 'message', content: [{ type: 'text', text: 'Noted.' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } } };
    // Before the desk's drawing, MAWS's backfill draws the owner's send as a peer's message, from the engine's name.
    const drawnRows = await drawn([prompt, call, result, delivery, answer]);
    const bubbles = users(drawnRows);
    expect(bubbles.map((u) => u.text)).toEqual(['List the files.', 'Run the suites.']);
    expect(bubbles[1]).toMatchObject({ messageUuid: 'b0b0b0b0-0000-4000-8000-000000000001', steer: true });
    expect(drawnRows.filter((r) => r.kind === 'agent_message')).toEqual([]);
  });

  it("through MAWS's backfill and projection: the owner's send through the inbox to an idle session is their prompt, a peer's a message between agents", async () => {
    const own = inboxRow(`${OWN}\nRun the suites.`);
    const peer = inboxRow(`${PEER}\nI read it.\n${REPLY}`);
    const drawnRows = await drawn([own, peer]);
    expect(users(drawnRows).map((u) => [u.text, u.steer])).toEqual([['Run the suites.', false]]);
    const messages = drawnRows.filter((r): r is Extract<Row, { kind: 'agent_message' }> => r.kind === 'agent_message');
    expect(messages.map((m) => [m.peer?.sender?.name, m.peer?.body])).toEqual([['fakepeer', 'I read it.']]);
    expect(JSON.stringify(drawnRows)).not.toContain('[sminos');
    expect(JSON.stringify(drawnRows)).not.toContain('To reply, run in Bash');
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

  it("keeps the frame on the owner's send whose words are the engine's interrupt marker: a bubble, never a stop", async () => {
    for (const marker of ['[Request interrupted by user]', '[Request interrupted by user for tool use]']) {
      expect(text(deliveryAsDrawn(row(`${OWN}\n${marker}`, BRIDGE))), marker).toBe(`${OWN}\n${marker}`);
      const id = `toolu_${String(++n).padStart(6, '0')}`;
      const prompt = row('List the files.', { kind: 'human' }, { promptId: 'p1' });
      const call = { uuid: uuid(), parentUuid: prompt.uuid, timestamp: '2026-10-17T10:00:01.000Z', sessionId: SESSION, isSidechain: false, type: 'assistant', message: { id: `msg_${n}a`, role: 'assistant', model: 'claude-opus-5-5', type: 'message', content: [{ type: 'tool_use', id, name: 'Bash', input: { command: 'ls' } }], stop_reason: null, usage: { input_tokens: 1, output_tokens: 1 } } };
      const result = row([{ type: 'tool_result', tool_use_id: id, content: 'a.txt', is_error: false }], null, { toolUseResult: { stdout: 'a.txt', stderr: '', interrupted: false, isImage: false } });
      const delivery = appended(`${OWN}\n${marker}`);
      const answer = { uuid: uuid(), parentUuid: delivery.uuid, timestamp: '2026-10-17T10:00:03.000Z', sessionId: SESSION, isSidechain: false, type: 'assistant', message: { id: `msg_${n}b`, role: 'assistant', model: 'claude-opus-5-5', type: 'message', content: [{ type: 'text', text: 'Noted.' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } } };
      const drawnRows = await drawn([prompt, call, result, delivery, answer, row('Next.', { kind: 'human' }, { promptId: 'p2' })]);
      expect(users(drawnRows).map((u) => u.text), marker).toEqual(['List the files.', `${OWN}\n${marker}`, 'Next.']);
      expect(drawnRows.flatMap((r) => (r.kind === 'divider' ? [r.state] : [])), marker).not.toContain('stopped');
    }
  });

  it('is drawn once when the bridge appended it again after an Esc: the later copy, the one the engine read, in the turn that read it', async () => {
    // An Esc before the model answered handed the owner's prompt back; the prompt sent next went in under the same parent,
    // leaving the first copy on a branch no request reads, and the bridge appended the delivery again (doperpowers #233).
    const at = (second: number) => `2026-10-17T10:00:${String(second).padStart(2, '0')}.000Z`;
    for (const [frame, words, text] of [
      [OWN, 'Run the suites.', 'Run the suites.'],
      [PEER, 'I read it.', '*From fakepeer*\n\nI read it.'],
      [MESSAGE, 'Re-run the suites.', 'Re-run the suites.'],
    ]) {
      const first = row('List the files.', { kind: 'human' }, { promptId: 'p1', timestamp: at(0) });
      const answer = { uuid: uuid(), parentUuid: first.uuid, timestamp: at(1), sessionId: SESSION, isSidechain: false, type: 'assistant', message: { id: `msg_${n}a`, role: 'assistant', model: 'claude-opus-5-5', type: 'message', content: [{ type: 'text', text: 'Two files.' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } } };
      const prompt = row('Now the tests.', { kind: 'human' }, { promptId: 'p2', parentUuid: answer.uuid, timestamp: at(2) });
      const dead: JsonObject = { ...appended(`${frame}\n${words}`), parentUuid: prompt.uuid, timestamp: at(3) };
      const marker = row([{ type: 'text', text: '[Request interrupted by user]' }], null, { parentUuid: dead.uuid, timestamp: at(4) });
      const again = row('Now the tests.', { kind: 'human' }, { promptId: 'p3', parentUuid: answer.uuid, timestamp: at(5) });
      const read: JsonObject = { ...appended(`${frame}\n${words}`), parentUuid: again.uuid, timestamp: at(6) };
      const reply = { uuid: uuid(), parentUuid: read.uuid, timestamp: at(7), sessionId: SESSION, isSidechain: false, type: 'assistant', message: { id: `msg_${n}b`, role: 'assistant', model: 'claude-opus-5-5', type: 'message', content: [{ type: 'text', text: 'Running them.' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } } };
      const rows = [first, answer, prompt, dead, marker, again, read, reply];
      expect(supersededDeliveries(rows), frame).toEqual(new Set([dead.uuid]));
      const bubbles = users(await drawn(rows));
      // The owner's own prompt sent again is on disk twice too, and drawn twice (tech debt: the dead branch in general).
      expect(bubbles.map((u) => u.text), frame).toEqual(['List the files.', 'Now the tests.', 'Now the tests.', text]);
      expect(bubbles[3], frame).toMatchObject({ messageUuid: read.uuid, steer: true });
      expect(bubbles[3].turnId, frame).toBe(bubbles[2].turnId);
    }
  });

  it('draws every delivery whose frame line no later row repeats: two sends of the same words are two rows', () => {
    const one = appended(`${OWN}\ncontinue`);
    const two = appended('[sminos chat MAWS hub/5e55e5e5:13 from human → @you]\ncontinue');
    const typed = row(`${OWN}\ncontinue`, { kind: 'human' }); // a frame typed at the terminal marks no delivery
    expect(supersededDeliveries([one, two, typed])).toEqual(new Set());
    // The same frame through another door (the inbox, after the bridge's prompt was refused) is the same delivery.
    const inbox = inboxRow(`${OWN}\ncontinue`);
    expect(supersededDeliveries([one, two, inbox])).toEqual(new Set([one.uuid]));
  });

  it("keeps the frame on any words MAWS's backfill reads as a marker, idle through the inbox or as the user, so the owner's message stays drawn", async () => {
    for (const marker of ['[Request interrupted by user]', '[Request interrupted by user from the desk]', '[Request interrupted by user from outside the terminal]', ' [Request interrupted by user for tool use] ']) {
      for (const delivery of [inboxRow(`${OWN}\n${marker}`), row(`${OWN}\n${marker}`, BRIDGE)]) {
        const drawnRows = await drawn([delivery]);
        expect(users(drawnRows).map((u) => u.text), marker).toEqual([`${OWN}\n${marker}`]);
      }
    }
    // Words that only begin with a marker are a prompt: drawn without the frame.
    expect(text(deliveryAsDrawn(inboxRow(`${OWN}\n[Request interrupted by user] then carry on`)))).toBe('[Request interrupted by user] then carry on');
  });
});
