// The sends at a session view's tail (the composite's §9.1, the DC9 plan's M4): each send to the session — an outbox item,
// a `human` addressed to it, a steer this tab issued — that no row of the transcript is yet known to be, with the state
// of its delivery. A send gives way only to its own row, matched by identity alone: the delivery frame's first line
// naming the send's event (`[sminos chat <project> <writer_short>:<seq> from …]`, or `[sminos message from … id=<msg_id>]`
// for an event that carries one), or the row a steer's result names. No text is compared.
import { describe, expect, it } from 'vitest';
import type { Delivery, JsonObject, LogEvent, Rpc } from 'desk-hub/protocol';
import { deliveryKey, type OutboxItem, type RpcEntry } from '../project/conversation';
import { footOf, frameRef, sendRef, tailSends, type TailInput, type TailSend } from './tail';

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
const userRow = (content: unknown, ts = '2026-10-15T09:00:05.000Z'): JsonObject => ({ type: 'user', uuid: `u${++uuid}`, timestamp: ts, message: { role: 'user', content } }) as JsonObject;
const assistantRow = (text: string, ts = '2026-10-15T08:59:00.000Z'): JsonObject => ({ type: 'assistant', uuid: `a${++uuid}`, timestamp: ts, message: { role: 'assistant', content: [{ type: 'text', text }] } }) as JsonObject;
/** The frame the bridge submits for a web send: its first line names the event, then the text. */
const framed = (seq: number, text: string, writer = WEB) => `[sminos chat MAWS ${writer}:${seq} from human → @maws-45]\n${text}`;

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

  it("is read from a row's first line only, whatever the project's name, and never from text that only quotes one", () => {
    expect(frameRef(framed(3, 'keep user_id'))).toBe(`chat:${WEB}:3`);
    expect(frameRef(`[sminos chat my project ${WEB}:4 from human → @maws-45 | unread 2]\nhi`)).toBe(`chat:${WEB}:4`);
    expect(frameRef('[sminos message from human id=5e551e17]\nRe-run the suites')).toBe('message:5e551e17');
    expect(frameRef(`Another session sent a message:\n${framed(3, 'x')}`)).toBeNull();
    expect(frameRef('continue')).toBeNull();
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
    const typed = userRow('continue', '2026-10-15T08:59:30.000Z'); // the terminal's, before the send
    const send = human(1, 'continue');
    const rows = [assistantRow('x'), typed];
    expect(shape(tailSends(base({ entries: [send], deliveries: delivery(1, 'delivered'), transcript: { rows, complete: false } })))).toEqual([['continue', 'delivered']]);
    const later = [...rows, userRow('continue', '2026-10-15T09:00:10.000Z')]; // typed again: still not the send's
    expect(tailSends(base({ entries: [send], deliveries: delivery(1, 'delivered'), transcript: { rows: later, complete: false } }))).toHaveLength(1);
    expect(tailSends(base({ entries: [send], deliveries: delivery(1, 'delivered'), transcript: { rows: [...later, userRow(framed(1, 'continue'))], complete: false } }))).toEqual([]);
  });

  it("matches a frame however the engine carries the prompt: the row's text, a text block, a queued command", () => {
    const send = human(1, 'x');
    const forms = [userRow([{ type: 'text', text: framed(1, 'x') }]), { type: 'attachment', uuid: 'q1', timestamp: '2026-10-15T09:00:05.000Z', attachment: { type: 'queued_command', prompt: framed(1, 'x'), commandMode: 'prompt' } } as JsonObject];
    for (const row of forms) expect(tailSends(base({ entries: [send], transcript: { rows: [assistantRow('x'), row], complete: false } }))).toEqual([]);
    // A tool's result quoting the frame (a log read back) is not a prompt.
    const quoted = userRow([{ type: 'tool_result', tool_use_id: 't', content: framed(1, 'x') }]);
    expect(tailSends(base({ entries: [send], transcript: { rows: [assistantRow('x'), quoted], complete: false } }))).toHaveLength(1);
  });

  it("matches a machine's own human by its msg_id frame", () => {
    const send = { offset: ++offset, event: { ts: '2026-10-15T09:00:00.000Z', writer: 'mini/human', seq: 1, kind: 'human', from: 'human', to: [{ session: S, alias: 'maws-45' }], text: 'Re-run the suites', msg_id: '5e551e17', mac: { nonce: 'h', value: 'v' } } as LogEvent };
    expect(tailSends(base({ entries: [send] }))).toHaveLength(1);
    expect(tailSends(base({ entries: [send], transcript: { rows: [assistantRow('x'), userRow('[sminos message from human id=5e551e17]\nRe-run the suites')], complete: false } }))).toEqual([]);
  });

  it('counts only sends addressed to the session, and only inside the history the view holds unless it holds all of it', () => {
    const elsewhere = { offset: ++offset, event: { ...human(1, 'x').event, seq: 9, to: [{ session: OTHER, alias: 'maws-fe' }] } as LogEvent };
    const record = { offset: ++offset, event: { ...human(1, 'x').event, seq: 10, to: '*' } as LogEvent };
    const old = human(11, 'from last week', '2026-10-08T09:00:00.000Z');
    const rows = [assistantRow('earliest held', '2026-10-15T08:00:00.000Z')];
    expect(tailSends(base({ entries: [elsewhere, record, old], transcript: { rows, complete: false } }))).toEqual([]);
    // Paged to the first row: a send older than everything held was never matched, so it is at the tail.
    expect(shape(tailSends(base({ entries: [old], transcript: { rows, complete: true } })))).toEqual([['from last week', 'queued']]);
    // Before the transcript loads, the log's sends are not placed: whether their rows are there is not known yet.
    expect(tailSends(base({ entries: [human(12, 'now')], transcript: null }))).toEqual([]);
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
  const ctx = { name: 'maws-45', machine: 'mini', running: true, ended: false, resumable: true };
  const send = (state: TailSend['state'], reason: string | null = null, via: TailSend['via'] = 'send'): TailSend => ({ key: 'k', via, text: 't', at: null, state, reason });

  it('says where the send is, in short words', () => {
    expect(footOf(send('queued'), ctx).words).toBe('Queued · delivers when maws-45 is idle');
    expect(footOf(send('delivered'), ctx).words).toBe("Delivered · waiting in maws-45's queue");
    expect(footOf(send('recorded', 'not running'), ctx)).toEqual({ state: 'recorded', words: 'Recorded, not delivered · Resume delivers it', reason: 'not running' });
    expect(footOf(send('refused-read-only', 'read-only'), ctx).words).toBe('Not delivered · mini is read-only');
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

  it("names a steer's own way", () => {
    expect(footOf(send('sending', null, 'steer'), ctx).words).toBe('Steer · sending');
    expect(footOf(send('delivered', null, 'steer'), ctx).words).toBe('Steer · read at the next model request');
    expect(footOf(send('uncertain', 'mini dropped before answering', 'steer'), ctx).words).toBe('Steer · possibly delivered');
    expect(footOf(send('failed', 'the session is idle', 'steer'), ctx).words).toBe('Steer not delivered · “the session is idle”');
  });
});
