// The link's streams (P5 O7 M3, Interfaces §N, the link's half): opening under the peer's capability, credit both ways,
// 64 KiB chunks in unpadded base64url from the stream's own offset, and a stream's end with its channel, against a
// channel the test plays.
import { STREAM_CHUNK_BYTES, STREAM_CREDIT_MAX, type DeviceMessage } from 'org-protocol';
import { describe, expect, it } from 'vitest';
import { StreamTable, STREAM_OPEN_CREDIT, type StreamSink } from './streams';

function harness(peer: string[] = ['rl2.streams']) {
  const sent: DeviceMessage[] = [];
  const channel = { current: true, peer };
  const table = new StreamTable({ send: (m) => (channel.current ? (sent.push(m), true) : false), current: () => channel.current, peerCapabilities: () => (channel.current ? channel.peer : null), log: () => {} });
  const heard: Array<[string, ...unknown[]]> = [];
  const sink: StreamSink = {
    opened: (opened) => void heard.push(['opened', opened]),
    data: (offset, bytes) => void heard.push(['data', offset, Buffer.from(bytes).toString()]),
    credit: (bytes) => void heard.push(['credit', bytes]),
    closed: (reason) => void heard.push(['closed', reason]),
  };
  const of = (t: string) => sent.filter((m) => m.t === t) as Array<DeviceMessage & Record<string, unknown>>;
  return { table, sent, channel, heard, sink, of };
}

const PTY = { ptyId: 'pty-1', from: 0, inputEpoch: 'AAAAAAAAAAAAAAAAAAAAAA', inputFrom: 7 };
const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));
const b64 = (text: string) => Buffer.from(text).toString('base64url');

describe('opening', () => {
  it('sends `streamOpen` with a fresh 16-byte id, the act’s op and the default credit', () => {
    const h = harness();
    const s = h.table.open({ kind: 'pty', op: 'op-1', pty: PTY }, h.sink, null);
    expect(h.of('streamOpen')).toEqual([{ t: 'streamOpen', id: s.id, kind: 'pty', op: 'op-1', credit: STREAM_OPEN_CREDIT, pty: PTY }]);
    expect(Buffer.from(s.id, 'base64url')).toHaveLength(16);
    const t = h.table.open({ kind: 'tcp', op: 'op-2', credit: 9 * 1024 * 1024, tcp: { forward: 'f' } }, h.sink, null);
    expect(h.of('streamOpen')[1]).toEqual({ t: 'streamOpen', id: t.id, kind: 'tcp', op: 'op-2', credit: STREAM_CREDIT_MAX, tcp: { forward: 'f' } });
    expect(t.id).not.toBe(s.id);
  });

  it('closes `not-offered` at once, sending nothing, when the peer lists no `rl2.streams`', async () => {
    const h = harness([]);
    h.table.open({ kind: 'tcp', op: 'op-1', tcp: { forward: 'f' } }, h.sink, null);
    await tick();
    expect(h.heard).toEqual([['closed', 'not-offered']]);
    expect(h.sent).toEqual([]);
    expect(h.table.size).toBe(0);
  });

  it('waits for a channel when none is current, and opens on the next', () => {
    const h = harness();
    h.channel.current = false;
    const s = h.table.open({ kind: 'pty', op: 'op-1', pty: PTY }, h.sink, null);
    expect(h.sent).toEqual([]);
    h.channel.current = true;
    h.table.onCurrent();
    expect(h.of('streamOpen').map((m) => m.id)).toEqual([s.id]);
  });

  it('closes with the link’s end when the link has ended', async () => {
    const h = harness();
    h.table.open({ kind: 'pty', op: 'op-1', pty: PTY }, h.sink, 'removed');
    await tick();
    expect(h.heard).toEqual([['closed', 'removed']]);
  });

  it('reads a refusal as the stream’s close with its reason', () => {
    const h = harness();
    const s = h.table.open({ kind: 'pty', op: 'op-1', pty: PTY }, h.sink, null);
    h.table.receive({ t: 'streamRefused', id: s.id, reason: 'unknown' });
    expect(h.heard).toEqual([['closed', 'unknown']]);
    expect(h.table.size).toBe(0);
  });
});

describe('data', () => {
  it('delivers the endpoint’s chunks decoded at their offsets, and refunds only what the consumer gives back', () => {
    const h = harness();
    const s = h.table.open({ kind: 'pty', op: 'op-1', pty: PTY }, h.sink, null);
    h.table.receive({ t: 'streamOpened', id: s.id, pty: { info: { ptyId: 'pty-1' }, ringStart: 3, nextOffset: 5 }, credit: 1024 });
    h.table.receive({ t: 'streamData', id: s.id, offset: 3, data: b64('ab') });
    expect(h.heard).toEqual([
      ['opened', { pty: { info: { ptyId: 'pty-1' }, ringStart: 3, nextOffset: 5 }, credit: 1024 }],
      ['data', 3, 'ab'],
    ]);
    expect(h.of('streamCredit')).toEqual([]);
    s.credit(2);
    s.credit(0);
    expect(h.of('streamCredit')).toEqual([{ t: 'streamCredit', id: s.id, bytes: 2 }]);
  });

  it('holds a refund given before the stream opened until it has (the endpoint is still admitting it)', () => {
    const h = harness();
    const s = h.table.open({ kind: 'pty', op: 'op-1', pty: PTY }, h.sink, null);
    s.credit(10);
    expect(h.of('streamCredit')).toEqual([]);
    h.table.receive({ t: 'streamOpened', id: s.id, credit: 1 });
    expect(h.of('streamCredit')).toEqual([{ t: 'streamCredit', id: s.id, bytes: 10 }]);
  });

  it('splits a refund past the most one message carries', () => {
    const h = harness();
    const s = h.table.open({ kind: 'tcp', op: 'op-1', tcp: { forward: 'f' } }, h.sink, null);
    h.table.receive({ t: 'streamOpened', id: s.id, credit: 1 });
    s.credit(STREAM_CREDIT_MAX + 5);
    expect(h.of('streamCredit').map((m) => m.bytes)).toEqual([STREAM_CREDIT_MAX, 5]);
  });

  it('sends in chunks of at most 64 KiB, unpadded base64url, from the stream’s own offset, within the endpoint’s credit', () => {
    const h = harness();
    const s = h.table.open({ kind: 'pty', op: 'op-1', pty: PTY }, h.sink, null);
    const bytes = new Uint8Array(STREAM_CHUNK_BYTES + 10).map((_, i) => i % 251);
    s.send(bytes);
    expect(h.of('streamData')).toEqual([]); // no credit before it opens
    expect(s.queued()).toBe(bytes.byteLength);
    h.table.receive({ t: 'streamOpened', id: s.id, credit: STREAM_CHUNK_BYTES + 4 });
    const chunks = h.of('streamData');
    expect(chunks.map((m) => [m.offset, Buffer.from(m.data as string, 'base64url').byteLength])).toEqual([
      [7, STREAM_CHUNK_BYTES],
      [7 + STREAM_CHUNK_BYTES, 4],
    ]);
    expect(chunks.every((m) => !(m.data as string).includes('='))).toBe(true);
    expect(s.queued()).toBe(6);
    h.table.receive({ t: 'streamCredit', id: s.id, bytes: 100 });
    expect(h.of('streamData').at(-1)).toMatchObject({ offset: 7 + STREAM_CHUNK_BYTES + 4 });
    expect(Buffer.concat(h.of('streamData').map((m) => Buffer.from(m.data as string, 'base64url')))).toEqual(Buffer.from(bytes));
    expect(h.heard.at(-1)).toEqual(['credit', 100]);
    expect(s.queued()).toBe(0);
  });

  it('starts a tcp stream’s offsets at zero', () => {
    const h = harness();
    const s = h.table.open({ kind: 'tcp', op: 'op-1', tcp: { forward: 'f' } }, h.sink, null);
    h.table.receive({ t: 'streamOpened', id: s.id, credit: 100 });
    s.send(Buffer.from('GET /'));
    expect(h.of('streamData')).toEqual([{ t: 'streamData', id: s.id, offset: 0, data: b64('GET /') }]);
  });

  it('holds controls until the stream opens, then sends them in order', () => {
    const h = harness();
    const s = h.table.open({ kind: 'pty', op: 'op-1', pty: PTY }, h.sink, null);
    s.control({ resize: { cols: 100, rows: 30 } });
    expect(h.of('streamControl')).toEqual([]);
    h.table.receive({ t: 'streamOpened', id: s.id, credit: 1 });
    s.control({ resize: { cols: 90, rows: 20 } });
    expect(h.of('streamControl').map((m) => m.control)).toEqual([{ resize: { cols: 100, rows: 30 } }, { resize: { cols: 90, rows: 20 } }]);
  });
});

describe('ends', () => {
  it('ends every stream sent on a channel with that channel (`carrier`), and keeps one not yet sent', () => {
    const h = harness();
    const a = h.table.open({ kind: 'pty', op: 'op-1', pty: PTY }, h.sink, null);
    h.table.receive({ t: 'streamOpened', id: a.id, credit: 1 });
    h.table.open({ kind: 'tcp', op: 'op-2', tcp: { forward: 'f' } }, h.sink, null);
    h.channel.current = false;
    const waiting = h.table.open({ kind: 'tcp', op: 'op-3', tcp: { forward: 'f' } }, h.sink, null);
    h.heard.length = 0;
    h.table.onLost();
    expect(h.heard).toEqual([['closed', 'carrier'], ['closed', 'carrier']]);
    expect(h.table.size).toBe(1);
    // what the old channel's endpoint says of them later is not theirs
    h.table.receive({ t: 'streamData', id: a.id, offset: 0, data: b64('x') });
    expect(h.heard).toHaveLength(2);
    h.channel.current = true;
    h.table.onCurrent();
    expect(h.of('streamOpen').at(-1)?.id).toBe(waiting.id);
  });

  it('hears the endpoint’s close, and sends its own once, which nothing answers', () => {
    const h = harness();
    const a = h.table.open({ kind: 'pty', op: 'op-1', pty: PTY }, h.sink, null);
    h.table.receive({ t: 'streamOpened', id: a.id, credit: 1 });
    h.table.receive({ t: 'streamClose', id: a.id, reason: 'behind' });
    expect(h.heard.at(-1)).toEqual(['closed', 'behind']);
    const b = h.table.open({ kind: 'pty', op: 'op-1', pty: PTY }, h.sink, null);
    b.close();
    b.close();
    expect(h.of('streamClose')).toEqual([{ t: 'streamClose', id: b.id, reason: 'closed' }]);
    expect(h.heard.at(-1)).toEqual(['closed', 'behind']); // the consumer closed it: it hears nothing
    b.send(Buffer.from('late'));
    expect(h.of('streamData')).toEqual([]);
  });

  it('closes a stream not yet sent without a message', () => {
    const h = harness();
    h.channel.current = false;
    const s = h.table.open({ kind: 'pty', op: 'op-1', pty: PTY }, h.sink, null);
    s.close();
    h.channel.current = true;
    h.table.onCurrent();
    expect(h.sent).toEqual([]);
  });

  it('ends every stream, sent or waiting, with the link’s end', () => {
    const h = harness();
    h.table.open({ kind: 'pty', op: 'op-1', pty: PTY }, h.sink, null);
    h.channel.current = false;
    h.table.open({ kind: 'pty', op: 'op-1', pty: PTY }, h.sink, null);
    h.table.close('removed');
    expect(h.heard).toEqual([['closed', 'removed'], ['closed', 'removed']]);
    expect(h.table.size).toBe(0);
  });
});
