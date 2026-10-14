// P3-A M5: the detached host's document channels (S2's HostDocChannels): one port-like end per channel main opens,
// handed to the engine host's document handler exactly as a utility host hands it a MessagePort; frames in and out;
// either end closes; the 8 MB high-water reset.
import { describe, expect, it, vi } from 'vitest';
import type { HostDoc } from '../ipc/host-protocol';
import { DOC_HIGH_WATER, HostDocChannels, type DocWire } from './doc-channels';
import type { DocPortEnd } from './runtime';
import type { DocumentsClosed } from './socket-protocol';

const ID = '11111111-1111-4111-8111-111111111111';
const open = (channel: number) => ({ t: 'documents.open' as const, channel, artifactId: ID, actor: { kind: 'human' as const } });

function harness(options: { highWater?: number } = {}) {
  const written: [number, number[]][] = [];
  const lines: DocumentsClosed[] = [];
  let queued = 0;
  const wire: DocWire = {
    postDoc: (channel, frame) => (written.push([channel, [...frame]]), true),
    queuedBytes: () => queued,
    postMessage: (message) => (lines.push(message), true),
  };
  const opened: { message: HostDoc; end: DocPortEnd }[] = [];
  let handler: (message: HostDoc, end: DocPortEnd) => void = (message, end) => void opened.push({ message, end });
  const channels = new HostDocChannels(wire, (message, end) => handler(message, end), { ...options, log: () => {} });
  // What the document service does with a port: listen, start, and note its close.
  const attach = (end: DocPortEnd) => {
    const received: number[][] = [];
    const closed = vi.fn();
    end.on('message', ({ data }) => void received.push([...(data as Uint8Array)]));
    end.on('close', closed);
    end.start();
    return { received, closed };
  };
  return { channels, written, lines, opened, attach, setQueued: (n: number) => (queued = n), setHandler: (h: typeof handler) => (handler = h) };
}

describe('HostDocChannels', () => {
  it('hands each opened channel to the document handler as a doc message with a port of its own', () => {
    const h = harness();
    h.channels.open(open(4));
    expect(h.opened.map((o) => o.message)).toEqual([{ t: 'doc', channel: 4, artifactId: ID, actor: { kind: 'human' } }]);
    expect(h.channels.size).toBe(1);
    h.channels.open({ ...open(5), doc: 'suggestions' }); // P3-A M8
    expect(h.opened.at(-1)!.message).toEqual({ t: 'doc', channel: 5, artifactId: ID, actor: { kind: 'human' }, doc: 'suggestions' });
  });

  it('delivers frames in order, holding those that arrive before the port is started; drops a frame for an unknown channel', () => {
    const h = harness();
    h.channels.open(open(4));
    h.channels.deliver(4, Uint8Array.from([1]));
    const { received } = h.attach(h.opened[0].end);
    h.channels.deliver(4, Uint8Array.from([2]));
    h.channels.deliver(9, Uint8Array.from([3]));
    expect(received).toEqual([[1], [2]]);
    expect(h.channels.counts).toMatchObject({ framesIn: 2, dropped: 1 });
  });

  it('writes what the service sends on the channel, and nothing that is not a frame', () => {
    const h = harness();
    h.channels.open(open(4));
    h.opened[0].end.postMessage(Uint8Array.from([5, 6]));
    h.opened[0].end.postMessage('not a frame');
    expect(h.written).toEqual([[4, [5, 6]]]);
  });

  it('main’s close ends the channel quietly: the service sees the close, main is told nothing, later frames are dropped', () => {
    const h = harness();
    h.channels.open(open(4));
    const { closed } = h.attach(h.opened[0].end);
    h.channels.close(4);
    expect(closed).toHaveBeenCalledTimes(1);
    expect(h.lines).toEqual([]);
    h.opened[0].end.postMessage(Uint8Array.from([1]));
    h.channels.deliver(4, Uint8Array.from([1]));
    expect(h.written).toEqual([]);
    expect(h.channels.size).toBe(0);
  });

  it('the service’s close ends the channel and tells main `documents.closed {host}`, once', () => {
    const h = harness();
    h.channels.open(open(4));
    const { closed } = h.attach(h.opened[0].end);
    h.opened[0].end.close();
    h.opened[0].end.close();
    expect(h.lines).toEqual([{ t: 'documents.closed', channel: 4, reason: 'host' }]);
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('a handler that closes the port at once (no document to serve) tells main the channel is closed', () => {
    const h = harness();
    h.setHandler((_message, end) => end.close());
    h.channels.open(open(6));
    expect(h.lines).toEqual([{ t: 'documents.closed', channel: 6, reason: 'host' }]);
    expect(h.channels.size).toBe(0);
  });

  it('past the high-water mark a frame is not queued: the channel is reset and main told `reset`', () => {
    expect(DOC_HIGH_WATER).toBe(8 * 1024 * 1024);
    const h = harness({ highWater: 100 });
    h.channels.open(open(4));
    h.channels.open(open(5));
    const { closed } = h.attach(h.opened[0].end);
    h.setQueued(100);
    h.opened[0].end.postMessage(new Uint8Array(1_000)); // at the mark: written, however large
    h.setQueued(101);
    h.opened[0].end.postMessage(Uint8Array.from([1]));
    expect(h.written.map(([channel, frame]) => [channel, frame.length])).toEqual([[4, 1_000]]);
    expect(h.lines).toEqual([{ t: 'documents.closed', channel: 4, reason: 'reset' }]);
    expect(closed).toHaveBeenCalledTimes(1);
    expect(h.channels.counts.resets).toBe(1);
    expect(h.channels.size).toBe(1); // the other channel is untouched until it writes
  });

  it('a second open of a channel number ends the first quietly and opens afresh', () => {
    const h = harness();
    h.channels.open(open(4));
    const first = h.attach(h.opened[0].end);
    h.channels.open(open(4));
    expect(first.closed).toHaveBeenCalledTimes(1);
    expect(h.lines).toEqual([]);
    expect(h.opened).toHaveLength(2);
    expect(h.channels.size).toBe(1);
  });

  it('the socket’s close ends every channel, telling main nothing', () => {
    const h = harness();
    h.channels.open(open(1));
    h.channels.open(open(2));
    const a = h.attach(h.opened[0].end);
    const b = h.attach(h.opened[1].end);
    h.channels.endAll();
    expect([a.closed.mock.calls.length, b.closed.mock.calls.length]).toEqual([1, 1]);
    expect(h.lines).toEqual([]);
    expect(h.channels.size).toBe(0);
  });
});
