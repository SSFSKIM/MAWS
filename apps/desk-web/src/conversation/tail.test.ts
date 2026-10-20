// The sends at a session view's tail (the composite's §9.1, the DC9 plan's M4): each send to the session — an outbox item,
// a `human` addressed to it, a steer this tab issued — that no row of the transcript is yet known to be, with the state
// of its delivery. A send gives way only to its own row, matched by identity alone: a delivered prompt whose whole first
// line is the frame sminos writes for the send's event (`[sminos chat <project> <writer_short>:<seq> from <from> →
// @you]`, or `[sminos message from … id=<msg_id>]` for an event that carries one) on a row that marks a delivery's
// provenance (the bridge's prompt as the user, its row appended into a running turn, a peer's or plugin's queued
// command), or the row a steer's result names. No text is compared.
import { describe, expect, it } from 'vitest';
import type { Delivery, JsonObject, LogEvent, Rpc } from 'desk-hub/protocol';
import { deliveryKey, type OutboxItem, type RpcEntry } from '../project/conversation';
import { footOf, framePattern, sendRef, tailSends, type TailInput, type TailSend } from './tail';

const S = '67646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b'; // the session, on mini
const OTHER = '9b2e4c6d-1a3f-4e5b-8c7d-0f1e2d3c4b5a';
const M = '4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c';
const WEB = `hub/${M}`;

let offset = 0;
const human = (seq: number, text: string, ts = '2026-10-15T09:00:00.000Z', more: Record<string, unknown> = {}) => ({
  offset: ++offset,
  event: { ts, writer: WEB, seq, kind: 'human', from: 'human', member: M, to: [{ session: S, alias: 'maws-45' }], text, created: ts, mac: { nonce: `n${seq}`, value: 'v' }, ...more } as LogEvent,
});
const delivery = (seq: number, outcome: Delivery['outcome'], reason = '', writer = WEB): Record<string, Record<string, Delivery>> => ({
  [deliveryKey({ writer, seq })]: { [S]: { event: { writer, seq }, session: S, outcome, reason, mac: { nonce: 'd', value: 'v' } } },
});

let uuid = 0;
/** A prompt row; `origin` as the engine marks it (the bridge's submission is a plugin's, as user), none for an older engine. */
const userRow = (content: unknown, ts = '2026-10-15T09:00:05.000Z', origin: JsonObject | null = { kind: 'plugin', name: 'doperpowers', asUser: true }): JsonObject =>
  ({ type: 'user', uuid: `u${++uuid}`, timestamp: ts, message: { role: 'user', content }, ...(origin && { origin }) }) as JsonObject;
const typedRow = (content: string, ts?: string) => userRow(content, ts, { kind: 'human' });
/** A send through sminos's inbox as the engine (2.1.300 on) keeps it: a peer message, the frame inside its envelope. */
const INBOX = { kind: 'peer', from: 'unknown', verifiedPeerPid: 4242, name: 'maws-45' };
const envelope = (body: string) => `<cross-session-message from-name="maws-45">\n${body}\n</cross-session-message>`;
const inboxRow = (body: string): JsonObject => ({ ...userRow(`Another Claude session sent a message:\n${envelope(body)}\n\nThis came from another Claude session.`, undefined, INBOX), isMeta: true }) as JsonObject;
const inboxQueued = (body: string): JsonObject => ({ type: 'attachment', uuid: `q${++uuid}`, timestamp: '2026-10-15T09:00:05.000Z', attachment: { type: 'queued_command', prompt: envelope(body), source_uuid: `s${uuid}`, commandMode: 'prompt', origin: INBOX, isMeta: true } }) as JsonObject;
/** A row the bridge appended into the running turn (`$.session.append`), as the engine keeps it: meta, the plugin's origin. */
const appendedRow = (text: string, origin: JsonObject = { kind: 'plugin', name: 'doperpowers' }): JsonObject => ({ ...userRow([{ type: 'text', text }], undefined, origin), isMeta: true }) as JsonObject;
const assistantRow = (text: string, ts = '2026-10-15T08:59:00.000Z'): JsonObject => ({ type: 'assistant', uuid: `a${++uuid}`, timestamp: ts, message: { role: 'assistant', content: [{ type: 'text', text }] } }) as JsonObject;
/** The frame the bridge submits for a web send: its first line names the event, then the text. */
const framed = (seq: number, text: string, writer = WEB) => `[sminos chat MAWS ${writer}:${seq} from human → @you]\n${text}`;

const base = (over: Partial<TailInput> = {}): TailInput => ({
  session: S,
  machine: 'mini',
  entries: [],
  deliveries: {},
  outbox: [],
  rpcs: [],
  transcript: { rows: [assistantRow('earlier')], complete: false },
  ...over,
});
const shape = (sends: TailSend[]) => sends.map((s) => [s.text, s.state]);

describe('the frame a delivery names its send by', () => {
  it("is the event's writer, short where it names a session, and its seq — or its msg_id when it carries one", () => {
    expect(sendRef({ writer: WEB, seq: 3 })).toBe(`chat:${WEB}:3`);
    expect(sendRef({ writer: `mini/${S}`, seq: 7 })).toBe('chat:67646a1b:7');
    expect(sendRef({ writer: 'mini/human', seq: 1 })).toBe('chat:mini/human:1');
    expect(sendRef({ writer: 'mini/human', seq: 1, msg_id: '5e551e17' })).toBe('message:5e551e17');
  });

  it("is the whole first line sminos writes for the event, whatever the project's name and the unread count", () => {
    const chat = framePattern({ writer: WEB, seq: 3, from: 'human' });
    expect(chat.test(`[sminos chat MAWS ${WEB}:3 from human → @you]`)).toBe(true);
    expect(chat.test(`[sminos chat my project ${WEB}:3 from human → @you | unread 2]`)).toBe(true);
    expect(framePattern({ writer: WEB, seq: 3, from: 'human', wake: true }).test(`[sminos chat MAWS ${WEB}:3 from human → @all]`)).toBe(true);
    expect(framePattern({ writer: `mini/${S}`, seq: 7, from: 'maws-45' }).test('[sminos chat MAWS 67646a1b:7 from maws-45 → @you]')).toBe(true);
    const message = framePattern({ writer: 'mini/human', seq: 1, from: 'human', msg_id: '5e551e17' });
    expect(message.test('[sminos message from human id=5e551e17]')).toBe(true);
    expect(framePattern({ writer: 'mini/human', seq: 1, from: 'human', via: 'kim', msg_id: '5e551e17' }).test('[sminos message from kim id=5e551e17]')).toBe(true);
  });

  it('refuses a malformed or partial lookalike of either form', () => {
    const chat = framePattern({ writer: WEB, seq: 3, from: 'human' });
    for (const line of [
      `[sminos chat MAWS ${WEB}:3 from `, // cut after "from"
      `[sminos chat MAWS ${WEB}:3 from human`, // no arrow, no bracket
      `[sminos chat MAWS ${WEB}:3 from human → @you`, // no closing bracket
      `[sminos chat MAWS ${WEB}:3 from human → @you] and more`, // the line goes on
      `[sminos chat MAWS ${WEB}:3 from human → @maws-45]`, // a recipient sminos never writes
      `[sminos chat MAWS ${WEB}:3 from someone → @you]`, // another sender
      `[sminos chat MAWS ${WEB}:3 from human → @all]`, // a wake the event did not carry
      `[sminos chat MAWS ${WEB}:30 from human → @you]`, // another seq
      `[sminos chat MAWS ${WEB}:3 from human → @you | unread 0]`, // sminos writes no zero count
      `[sminos chat ${WEB}:3 from human → @you]`, // no project
    ])
      expect(chat.test(line), line).toBe(false);
    const message = framePattern({ writer: 'mini/human', seq: 1, from: 'human', msg_id: '5e551e17' });
    for (const line of ['[sminos message from human id=5e551e17', '[sminos message from human id=5e551e17] extra', '[sminos message from human id=5e551e1]', '[sminos message from other id=5e551e17]', '[sminos message id=5e551e17]'])
      expect(message.test(line), line).toBe(false);
  });

  // sminos 1.2.0's scoped broadcast names its scope where a bare broadcast says @all (`frame_of`'s `target_label`), each
  // project by the delivering machine's own name for it.
  it("names a scoped broadcast by its scope's label, the projects' names open", () => {
    const P = '7d3b9e40-52c4-4f1e-8f0a-2b6c5d4e3f22';
    const scoped = (scope: Record<string, unknown>) => framePattern({ writer: 'alpha/human', seq: 4, from: 'human', wake: true, scope });
    expect(scoped({ machines: ['beta'] }).test('[sminos chat projB alpha/human:4 from human → @all on beta]')).toBe(true);
    expect(scoped({}).test('[sminos chat projB alpha/human:4 from human → @org | unread 3]')).toBe(true);
    expect(scoped({ states: ['waiting'] }).test('[sminos chat projB alpha/human:4 from human → @org (waiting)]')).toBe(true);
    const named = scoped({ projects: [P, P], machines: ['beta'], here: 'alpha', states: ['busy', 'idle'] });
    expect(named.test('[sminos chat projB alpha/human:4 from human → @all in projB,beta on beta,alpha (busy,idle)]')).toBe(true);
    expect(named.test(`[sminos chat projB alpha/human:4 from human → @all in ${P},my project on beta,alpha (busy,idle)]`)).toBe(true);
    for (const line of [
      '[sminos chat projB alpha/human:4 from human → @all]', // a bare broadcast: not this one's scope
      '[sminos chat projB alpha/human:4 from human → @all on mini]', // another machine
      '[sminos chat projB alpha/human:4 from human → @all on beta (waiting)]', // a state it did not name
      '[sminos chat projB alpha/human:4 from human → @you]', // not a broadcast
    ])
      expect(scoped({ machines: ['beta'] }).test(line), line).toBe(false);
    // The names are one open run: a broad scope's frame is matched at once, where an open run per name backtracked for
    // seconds over 35 of them.
    const many = Array.from({ length: 35 }, (_, i) => `${P.slice(0, -2)}${String(i).padStart(2, '0')}`);
    const broad = scoped({ projects: many, machines: ['beta'] });
    expect(broad.test(`[sminos chat projB alpha/human:4 from human → @all in ${many.map((_, i) => `p${i}`).join(',')} on beta]`)).toBe(true);
    expect(broad.test(`[sminos chat projB alpha/human:4 from human → @all in ${many.map((_, i) => `p${i}`).join(',')} on mini]`)).toBe(false);
    // The line up to the names is taken at its first place: a line repeating it is refused at once too.
    const started = performance.now();
    expect(broad.test(`[sminos chat ${'x alpha/human:4 from human → @all in '.repeat(2000)}zzz on mini]`)).toBe(false);
    expect(performance.now() - started).toBeLessThan(200);
  });
});

describe("a send at the session view's tail", () => {
  it('stays, saying delivered, while its row has not arrived — the outcome comes before the row in a long turn', () => {
    const send = human(1, 'add the race case');
    const waiting = tailSends(base({ entries: [send], deliveries: delivery(1, 'delivered', 'submitted to the session') }));
    expect(shape(waiting)).toEqual([['add the race case', 'delivered']]);
    const arrived = tailSends(base({ entries: [send], deliveries: delivery(1, 'delivered'), transcript: { rows: [assistantRow('earlier'), userRow(framed(1, 'add the race case'))], complete: false } }));
    expect(arrived).toEqual([]);
  });

  it('is queued before any outcome, and a later outcome for the same send replaces the earlier (failed after delivered)', () => {
    const send = human(1, 'open the PR as a draft');
    expect(shape(tailSends(base({ entries: [send] })))).toEqual([['open the PR as a draft', 'queued']]);
    // The engine dropped the submission after the bridge took it: the daemon's second outcome is `failed`, with its reason.
    const [refused] = tailSends(base({ entries: [send], deliveries: delivery(1, 'failed', 'dropped: a compaction was running') }));
    expect(refused).toMatchObject({ state: 'failed', reason: 'dropped: a compaction was running' });
  });

  it('keeps a send that will not arrive with its state: recorded, refused by a read-only machine, failed', () => {
    const sends = [human(1, 'a'), human(2, 'b'), human(3, 'c')];
    const deliveries = { ...delivery(1, 'recorded', 'not running'), ...delivery(2, 'refused-read-only', 'read-only'), ...delivery(3, 'failed', 'no bridge') };
    expect(shape(tailSends(base({ entries: sends, deliveries })))).toEqual([
      ['a', 'recorded'],
      ['b', 'refused-read-only'],
      ['c', 'failed'],
    ]);
  });

  it('two identical sends each take only the row whose frame names it', () => {
    const sends = [human(1, 'continue'), human(2, 'continue')];
    const deliveries = { ...delivery(1, 'delivered'), ...delivery(2, 'delivered') };
    const firstRow = userRow(framed(1, 'continue'));
    expect(tailSends(base({ entries: sends, deliveries, transcript: { rows: [assistantRow('x'), firstRow], complete: false } })).map((s) => s.key)).toEqual([`chat:${WEB}:2`]);
    const both = [assistantRow('x'), firstRow, userRow(framed(2, 'continue'))];
    expect(tailSends(base({ entries: sends, deliveries, transcript: { rows: both, complete: false } }))).toEqual([]);
  });

  it('is never taken by a prompt typed at the terminal with the same words: it waits for its own framed row', () => {
    const typed = typedRow('continue', '2026-10-15T08:59:30.000Z'); // the terminal's, before the send
    const send = human(1, 'continue');
    const rows = [assistantRow('x'), typed];
    expect(shape(tailSends(base({ entries: [send], deliveries: delivery(1, 'delivered'), transcript: { rows, complete: false } })))).toEqual([['continue', 'delivered']]);
    const later = [...rows, typedRow('continue', '2026-10-15T09:00:10.000Z')]; // typed again: still not the send's
    expect(tailSends(base({ entries: [send], deliveries: delivery(1, 'delivered'), transcript: { rows: later, complete: false } }))).toHaveLength(1);
    expect(tailSends(base({ entries: [send], deliveries: delivery(1, 'delivered'), transcript: { rows: [...later, userRow(framed(1, 'continue'))], complete: false } }))).toEqual([]);
  });

  it('is never taken by a typed prompt shaped like its frame, nor by a malformed one', () => {
    const send = human(1, 'x');
    const lookalikes = [
      typedRow(framed(1, 'x')), // the whole frame, typed at the terminal
      userRow(`[sminos chat MAWS ${WEB}:1 from \nx`), // cut short
      userRow(`[sminos chat MAWS ${WEB}:1 from human → @you\nx`), // no closing bracket
      { type: 'attachment', uuid: 'q-typed', timestamp: '2026-10-15T09:00:05.000Z', attachment: { type: 'queued_command', prompt: framed(1, 'x'), commandMode: 'prompt', origin: { kind: 'human' } } } as JsonObject,
    ];
    for (const row of lookalikes) expect(tailSends(base({ entries: [send], transcript: { rows: [assistantRow('x'), row], complete: false } })), JSON.stringify(row)).toHaveLength(1);
    const machineHuman = { offset: ++offset, event: { ts: '2026-10-15T09:00:00.000Z', writer: 'mini/human', seq: 1, kind: 'human', from: 'human', to: [{ session: S, alias: 'maws-45' }], text: 'r', msg_id: '5e551e17', mac: { nonce: 'h2', value: 'v' } } as LogEvent };
    for (const row of [typedRow('[sminos message from human id=5e551e17]\nr'), userRow('[sminos message from human id=5e551e17 \nr')])
      expect(tailSends(base({ entries: [machineHuman], transcript: { rows: [assistantRow('x'), row], complete: false } }))).toHaveLength(1);
  });

  it('is never taken by a frame on a row that marks no delivery provenance, in either form', () => {
    const send = human(1, 'x');
    const machineHuman = { offset: ++offset, event: { ts: '2026-10-15T09:00:00.000Z', writer: 'mini/human', seq: 1, kind: 'human', from: 'human', to: [{ session: S, alias: 'maws-45' }], text: 'r', msg_id: '5e551e17', mac: { nonce: 'h3', value: 'v' } } as LogEvent };
    const queued = (prompt: string, origin?: unknown) => ({ type: 'attachment', uuid: `q${++uuid}`, timestamp: '2026-10-15T09:00:05.000Z', attachment: { type: 'queued_command', prompt, commandMode: 'prompt', ...(origin !== undefined && { origin }) } }) as JsonObject;
    const unmarked = (frame: string) => [
      userRow(frame, undefined, null), // no origin: an ordinary prompt to MAWS
      { ...userRow(frame), origin: 'plugin' } as JsonObject, // an origin that is not an object
      userRow(frame, undefined, { kind: 'plugin', name: 'doperpowers' }), // a plugin's prompt not submitted as the user
      queued(frame), // a queued command with no origin
      queued(frame, null),
    ];
    for (const row of unmarked(framed(1, 'x'))) expect(tailSends(base({ entries: [send], transcript: { rows: [assistantRow('x'), row], complete: false } })), JSON.stringify(row)).toHaveLength(1);
    for (const row of unmarked('[sminos message from human id=5e551e17]\nr'))
      expect(tailSends(base({ entries: [machineHuman], transcript: { rows: [assistantRow('x'), row], complete: false } })), JSON.stringify(row)).toHaveLength(1);
  });

  it('takes a frame from the bridge as the user, from a command the bridge queued, or from the peer message the engine made of one sent through the inbox, in either form', () => {
    const send = human(1, 'x');
    const machineHuman = { offset: ++offset, event: { ts: '2026-10-15T09:00:00.000Z', writer: 'mini/human', seq: 1, kind: 'human', from: 'human', to: [{ session: S, alias: 'maws-45' }], text: 'r', msg_id: '5e551e17', mac: { nonce: 'h4', value: 'v' } } as LogEvent };
    const queued = (prompt: string, kind: string) => ({ type: 'attachment', uuid: `q${++uuid}`, timestamp: '2026-10-15T09:00:05.000Z', attachment: { type: 'queued_command', prompt, commandMode: 'prompt', origin: { kind } } }) as JsonObject;
    const delivered = (frame: string) => [
      userRow(frame),
      queued(frame, 'plugin'),
      inboxRow(frame), // idle, through the inbox: the engine's peer message, the frame inside its envelope
      inboxQueued(frame), // busy, through the inbox: the bare envelope queued
      queued(frame, 'peer'), // busy, through the inbox, as engines through 2.1.289 queued it: the frame raw
    ];
    for (const row of delivered(framed(1, 'x'))) expect(tailSends(base({ entries: [send], transcript: { rows: [assistantRow('x'), row], complete: false } }))).toEqual([]);
    for (const row of delivered('[sminos message from human id=5e551e17]\nr')) expect(tailSends(base({ entries: [machineHuman], transcript: { rows: [assistantRow('x'), row], complete: false } }))).toEqual([]);
    // An operator's scoped broadcast (sminos 1.2.0, `say --machine mini --state idle`): its frame names the scope.
    const scoped = { offset: ++offset, event: { ts: '2026-10-15T09:00:00.000Z', writer: 'alpha/human', seq: 2, kind: 'human', from: 'human', to: [{ session: S, alias: 'maws-45' }], text: 'r', wake: true, scope: { machines: ['mini'], states: ['idle'] }, mac: { nonce: 'h6', value: 'v' } } as LogEvent };
    for (const row of delivered('[sminos chat MAWS alpha/human:2 from human → @all on mini (idle)]\nr')) expect(tailSends(base({ entries: [scoped], transcript: { rows: [assistantRow('x'), row], complete: false } }))).toEqual([]);
    expect(tailSends(base({ entries: [scoped], transcript: { rows: [assistantRow('x'), userRow('[sminos chat MAWS alpha/human:2 from human → @all]\nr')], complete: false } }))).toHaveLength(1);
  });

  it("takes a frame from the bridge's row appended into a running turn (doperpowers #233), in either form", () => {
    // While the main turn runs, the bridge appends a delivery (`$.session.append`, one text block), which the engine keeps
    // meta with the plugin's origin and no `asUser`: its frame is the only word that it is a delivery.
    const send = human(1, 'x');
    const machineHuman = { offset: ++offset, event: { ts: '2026-10-15T09:00:00.000Z', writer: 'mini/human', seq: 1, kind: 'human', from: 'human', to: [{ session: S, alias: 'maws-45' }], text: 'r', msg_id: '5e551e17', mac: { nonce: 'h5', value: 'v' } } as LogEvent };
    expect(tailSends(base({ entries: [send], deliveries: delivery(1, 'delivered'), transcript: { rows: [assistantRow('x'), appendedRow(framed(1, 'x'))], complete: false } }))).toEqual([]);
    expect(tailSends(base({ entries: [machineHuman], transcript: { rows: [assistantRow('x'), appendedRow('[sminos message from human id=5e551e17]\nr')], complete: false } }))).toEqual([]);
    // Two identical sends, each taken by its own appended row only.
    const sends = [human(2, 'continue'), human(3, 'continue')];
    expect(tailSends(base({ entries: sends, transcript: { rows: [assistantRow('x'), appendedRow(framed(3, 'continue'))], complete: false } })).map((s) => s.key)).toEqual([`chat:${WEB}:2`]);
  });

  it("is never taken by the bridge's wake (doperpowers #233), as the user or through the inbox; one appended again after an Esc is taken once", () => {
    const send = human(1, 'x');
    const STEER_WAKE = '[sminos bridge]\nA note was added to the conversation while you were finishing your answer. Read it and act on it.';
    const DELIVERY_WAKE = '[sminos bridge]\nA message for you was added to the conversation while your turn was stopped, before you read it. Read it and act on it.';
    for (const row of [userRow(STEER_WAKE), inboxRow(DELIVERY_WAKE), inboxQueued(STEER_WAKE)])
      expect(shape(tailSends(base({ entries: [send], deliveries: delivery(1, 'delivered'), transcript: { rows: [assistantRow('x'), row], complete: false } }))), JSON.stringify(row)).toEqual([['x', 'delivered']]);
    // The copy an Esc left on a dead branch and the one the bridge appended again carry one frame: one send, given way.
    const twice = [assistantRow('x'), appendedRow(framed(1, 'x')), appendedRow(framed(1, 'x')), userRow(STEER_WAKE)];
    expect(tailSends(base({ entries: [send, human(2, 'y')], deliveries: delivery(1, 'delivered'), transcript: { rows: twice, complete: false } })).map((s) => s.key)).toEqual([`chat:${WEB}:2`]);
  });

  it("is never taken by a steer's row, the bridge's other rows, nor a frame on a plugin's row the engine did not keep as the bridge's append", () => {
    const send = human(1, 'x');
    for (const row of [
      appendedRow('x'), // a steer with the send's words
      appendedRow(`continue\n${framed(1, 'x')}`), // a steer quoting the frame past its first line
      appendedRow('[Request interrupted by user]'),
      appendedRow('The interrupt came from the desk.'),
      appendedRow('Task bk3x9a1, a background task, was stopped from the desk: it is not running.'),
      appendedRow(framed(1, 'x').split('\n')[0]), // a steer whose whole text is the frame line: sminos writes its text after it
      appendedRow(framed(1, 'x'), { kind: 'plugin', name: 'another' }), // another plugin's meta row
      { ...appendedRow(framed(1, 'x')), isMeta: false } as JsonObject, // the bridge's origin, not kept as its append
      userRow([{ type: 'text', text: framed(1, 'x') }], undefined, null), // an append with no origin
    ])
      expect(tailSends(base({ entries: [send], transcript: { rows: [assistantRow('x'), row], complete: false } })).map((s) => s.key), JSON.stringify(row)).toEqual([`chat:${WEB}:1`]);
  });

  it("matches a steer by the row its result names, never by the bridge's row carrying its words", () => {
    const rpc: RpcEntry = {
      nonce: 'st',
      state: 'done',
      outcome: { state: 'done', result: { row: 'u-steered' } },
      rpc: { rpc: 'steer', project: 'p', machine: 'mini', member: M, created: '2026-10-15T09:00:00.000Z', nonce: 'st', args: { session: S, text: 'use the split store' }, mac: 'm' } as Rpc,
    };
    const lookalike = appendedRow('use the split store'); // its words, another row
    expect(tailSends(base({ rpcs: [rpc], transcript: { rows: [assistantRow('x'), lookalike], complete: false } })).map((s) => s.key)).toEqual(['steer:st']);
    const own = { ...appendedRow('use the split store'), uuid: 'u-steered' } as JsonObject;
    expect(tailSends(base({ rpcs: [rpc], transcript: { rows: [assistantRow('x'), own], complete: false } }))).toEqual([]);
  });

  it("matches a frame however the engine carries the prompt: the row's text, a text block, a queued command, a peer message's envelope", () => {
    const send = human(1, 'x');
    const forms = [userRow([{ type: 'text', text: framed(1, 'x') }]), { type: 'attachment', uuid: 'q1', timestamp: '2026-10-15T09:00:05.000Z', attachment: { type: 'queued_command', prompt: framed(1, 'x'), commandMode: 'prompt', origin: { kind: 'plugin' } } } as JsonObject, { ...inboxRow(framed(1, 'x')), message: { role: 'user', content: [{ type: 'text', text: `Another Claude session sent a message:\n${envelope(framed(1, 'x'))}` }] } } as JsonObject];
    for (const row of forms) expect(tailSends(base({ entries: [send], transcript: { rows: [assistantRow('x'), row], complete: false } })), JSON.stringify(row)).toEqual([]);
    // A tool's result quoting the frame (a log read back) is not a prompt.
    const quoted = userRow([{ type: 'tool_result', tool_use_id: 't', content: framed(1, 'x') }]);
    expect(tailSends(base({ entries: [send], transcript: { rows: [assistantRow('x'), quoted], complete: false } }))).toHaveLength(1);
  });

  it('is never taken by a peer message whose envelope does not open with its whole frame, nor by a peer message elsewhere in a row', () => {
    const send = human(1, 'x');
    for (const row of [
      inboxRow(`Look: ${framed(1, 'x')}`), // not the whole first line
      inboxRow(`hi\n${framed(1, 'x')}`), // not the first line
      inboxQueued(framed(1, 'x').split('\n')[0]), // the frame with no text after it
      { ...inboxRow(framed(1, 'x')), origin: { kind: 'human' } } as JsonObject, // an envelope typed at the terminal
      userRow(`Another Claude session sent a message:\n${envelope(framed(1, 'x'))}`, undefined, null), // no origin
    ])
      expect(tailSends(base({ entries: [send], transcript: { rows: [assistantRow('x'), row], complete: false } })), JSON.stringify(row)).toHaveLength(1);
  });

  it("matches a machine's own human by its msg_id frame", () => {
    const send = { offset: ++offset, event: { ts: '2026-10-15T09:00:00.000Z', writer: 'mini/human', seq: 1, kind: 'human', from: 'human', to: [{ session: S, alias: 'maws-45' }], text: 'Re-run the suites', msg_id: '5e551e17', mac: { nonce: 'h', value: 'v' } } as LogEvent };
    expect(tailSends(base({ entries: [send] }))).toHaveLength(1);
    expect(tailSends(base({ entries: [send], transcript: { rows: [assistantRow('x'), userRow('[sminos message from human id=5e551e17]\nRe-run the suites')], complete: false } }))).toEqual([]);
  });

  it('counts only sends addressed to the session', () => {
    const elsewhere = { offset: ++offset, event: { ...human(1, 'x').event, seq: 9, to: [{ session: OTHER, alias: 'maws-fe' }] } as LogEvent };
    const record = { offset: ++offset, event: { ...human(1, 'x').event, seq: 10, to: '*' } as LogEvent };
    expect(tailSends(base({ entries: [elsewhere, record] }))).toEqual([]);
  });

  it('leaves out an older send whose row may be in history not loaded, until the view holds the transcript back to its first row', () => {
    const rows = [assistantRow('earliest held', '2026-10-15T08:00:00.000Z')];
    const old = (seq: number) => human(seq, `older ${seq}`, '2026-10-08T09:00:00.000Z');
    const sends = [old(11), old(12), old(13)];
    const deliveries = { ...delivery(12, 'delivered'), ...delivery(13, 'uncertain') };
    expect(tailSends(base({ entries: sends, deliveries, transcript: { rows, complete: false } }))).toEqual([]);
    // Paged to the first row and its row still not there: it is at the tail.
    expect(shape(tailSends(base({ entries: sends, deliveries, transcript: { rows, complete: true } })))).toEqual([
      ['older 11', 'queued'],
      ['older 12', 'delivered'],
      ['older 13', 'uncertain'],
    ]);
    // Before the transcript loads, whether their rows are there is not known yet.
    expect(tailSends(base({ entries: [human(14, 'now')], deliveries: delivery(14, 'delivered'), transcript: null }))).toEqual([]);
  });

  it('keeps an older send that never gets a row — recorded, refused by a read-only machine, failed — against a partial history, and before the transcript loads', () => {
    const rows = [assistantRow('earliest held', '2026-10-15T08:00:00.000Z')];
    const sends = [human(21, 'kept for later', '2026-10-08T09:00:00.000Z'), human(22, 'read-only', '2026-10-08T09:01:00.000Z'), human(23, 'failed', '2026-10-08T09:02:00.000Z')];
    const deliveries = { ...delivery(21, 'recorded', 'not running'), ...delivery(22, 'refused-read-only', 'read-only'), ...delivery(23, 'failed', 'no bridge') };
    const expected = [
      ['kept for later', 'recorded'],
      ['read-only', 'refused-read-only'],
      ['failed', 'failed'],
    ];
    expect(shape(tailSends(base({ entries: sends, deliveries, transcript: { rows, complete: false } })))).toEqual(expected);
    expect(shape(tailSends(base({ entries: sends, deliveries, transcript: null })))).toEqual(expected);
  });

  it("draws this tab's sends on their way to the log, and one the hub refused", () => {
    const outbox: OutboxItem[] = [
      { nonce: 'o1', to: [{ session: S, alias: 'maws-45' }], text: 'on its way', wake: false, state: 'sending' },
      { nonce: 'o2', to: [{ session: S, alias: 'maws-45' }], text: 'refused', wake: false, state: 'refused', reason: 'bad-code' },
      { nonce: 'o3', to: [{ session: OTHER, alias: 'maws-fe' }], text: 'elsewhere', wake: false, state: 'sending' },
    ];
    expect(tailSends(base({ outbox, transcript: null })).map((s) => [s.text, s.state, s.reason])).toEqual([
      ['on its way', 'sending', null],
      ['refused', 'not-sent', 'bad-code'],
    ]);
  });

  it("draws a steer until the row its result names arrives; one with no row to name leaves once it is done", () => {
    const steer = (nonce: string, state: RpcEntry['state'], outcome?: RpcEntry['outcome'], session = S): RpcEntry => ({
      nonce,
      state,
      ...(outcome && { outcome }),
      rpc: { rpc: 'steer', project: 'p', machine: 'mini', member: M, created: '2026-10-15T09:00:00.000Z', nonce, args: { session, text: `steer ${nonce}` }, mac: 'm' } as Rpc,
    });
    const rpcs = [
      steer('s1', 'sending'),
      steer('s2', 'uncertain'),
      steer('s3', 'done', { state: 'done', result: { row: 'u-steer' } }),
      steer('s4', 'done', { state: 'done', result: { row: null } }),
      steer('s5', 'failed', { state: 'failed', error: { code: 'idle', message: '' } }),
      steer('s6', 'sending', undefined, OTHER),
    ];
    expect(tailSends(base({ rpcs })).map((s) => [s.text, s.via, s.state])).toEqual([
      ['steer s1', 'steer', 'sending'],
      ['steer s2', 'steer', 'uncertain'],
      ['steer s3', 'steer', 'delivered'],
      ['steer s5', 'steer', 'failed'],
    ]);
    const row: JsonObject = { type: 'user', uuid: 'u-steer', timestamp: '2026-10-15T09:00:02.000Z', message: { role: 'user', content: 'steer s3' } };
    expect(tailSends(base({ rpcs, transcript: { rows: [assistantRow('x'), row], complete: false } })).map((s) => s.text)).not.toContain('steer s3');
  });
});

describe("a tail send's foot", () => {
  const ctx = { running: true, ended: false, resumable: true };
  const send = (state: TailSend['state'], reason: string | null = null, via: TailSend['via'] = 'send'): TailSend => ({ key: 'k', via, text: 't', at: null, state, reason });

  it('says where the send is, in short words', () => {
    expect(footOf(send('queued'), ctx).words).toBe('Queued · delivers when the session is idle');
    expect(footOf(send('delivered'), ctx).words).toBe('Delivered · waiting in the session’s queue');
    expect(footOf(send('recorded', 'not running'), ctx)).toEqual({ state: 'recorded', words: 'Recorded, not delivered · Resume delivers it', reason: 'not running' });
    expect(footOf(send('refused-read-only', 'read-only'), ctx).words).toBe('Not delivered · the machine is read-only');
    expect(footOf(send('failed', 'dropped: a compaction was running'), ctx).words).toBe('Not delivered · “dropped: a compaction was running”');
    expect(footOf(send('uncertain', 'taken, never answered'), ctx).words).toBe('Possibly delivered');
    expect(footOf(send('sending'), ctx).words).toBe('Sending…');
    expect(footOf(send('not-sent', 'bad-code'), ctx).words).toBe('Not sent · the hub refused it');
  });

  it('says a delivered send whose row never came was not seen before the session ended, and offers no Resume a retired one lacks', () => {
    expect(footOf(send('delivered'), { ...ctx, running: false, ended: true }).words).toBe('Delivered · not seen in the transcript before the session ended');
    expect(footOf(send('recorded'), { ...ctx, running: false, ended: true, resumable: false }).words).toBe('Recorded, not delivered');
    expect(footOf(send('queued'), { ...ctx, running: false }).words).toBe('Queued');
  });

  it('shows a long reason cut to its first line and a foot’s width, keeping all of it for the tooltip', () => {
    const long = `the engine dropped the prompt: ${'a compaction was running and the queue was cleared; '.repeat(4)}`;
    const foot = footOf(send('failed', long), ctx);
    expect(foot.words).toBe(`Not delivered · “${long.slice(0, 60).trimEnd()}…”`);
    expect(foot.reason).toBe(long);
    expect(footOf(send('failed', 'first line\nsecond line'), ctx).words).toBe('Not delivered · “first line…”');
    expect(footOf(send('failed', long, 'steer'), ctx).words).toBe(`Steer not delivered · “${long.slice(0, 60).trimEnd()}…”`);
  });

  it("names a steer's own way", () => {
    expect(footOf(send('sending', null, 'steer'), ctx).words).toBe('Steer · sending');
    expect(footOf(send('delivered', null, 'steer'), ctx).words).toBe('Steer · read at the next model request');
    expect(footOf(send('uncertain', 'mini dropped before answering', 'steer'), ctx).words).toBe('Steer · possibly delivered');
    expect(footOf(send('failed', 'the session is idle', 'steer'), ctx).words).toBe('Steer not delivered · “the session is idle”');
  });
});
