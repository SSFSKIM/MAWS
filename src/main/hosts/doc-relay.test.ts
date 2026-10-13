// P3-A M5: main's relay between a window's document port and a channel on the detached host's socket (S2's
// MainDocRelay): main reads no frame, it moves bytes; it tracks each channel's window and ends the window's port when
// the host ends the channel or the connection goes, which is what sends the renderer down its one reopen path.
import { describe, expect, it } from 'vitest';
import type { DocumentsClose, DocumentsOpen } from '@shared/host/socket-protocol';
import { MainDocRelay, type RelayLink, type RelayPort } from './doc-relay';

const ID = '11111111-1111-4111-8111-111111111111';
const doc = (channel: number) => ({ t: 'doc' as const, channel, artifactId: ID, actor: { kind: 'human' as const } });

// Main's end of a window's MessageChannelMain: what the window posts arrives through `fromWindow`; `closeFromWindow` is
// the window's end going (a closed or reloaded page).
class FakePort implements RelayPort {
  posted: unknown[] = [];
  closed = false;
  started = false;
  private messageListeners: ((event: { data: unknown }) => void)[] = [];
  private closeListeners: (() => void)[] = [];
  postMessage(message: unknown) {
    if (!this.closed) this.posted.push(message);
  }
  on(event: 'message' | 'close', listener: ((event: { data: unknown }) => void) | (() => void)) {
    if (event === 'message') this.messageListeners.push(listener as (event: { data: unknown }) => void);
    else this.closeListeners.push(listener as () => void);
    return this;
  }
  start() {
    this.started = true;
  }
  close() {
    this.closed = true;
  }
  fromWindow(data: unknown) {
    for (const listener of this.messageListeners) listener({ data });
  }
  closeFromWindow() {
    this.closed = true;
    for (const listener of this.closeListeners) listener();
  }
}

function link() {
  const lines: (DocumentsOpen | DocumentsClose)[] = [];
  const frames: [number, number[]][] = [];
  const value: RelayLink = {
    postMessage: (message) => void lines.push(message),
    postDoc: (channel, frame) => (frames.push([channel, [...frame]]), true),
  };
  return { value, lines, frames };
}

describe('MainDocRelay', () => {
  it('opens nothing while no connection is served', () => {
    const relay = new MainDocRelay();
    const port = new FakePort();
    expect(relay.open(doc(1), port, 7)).toBe(false);
    expect(port.started).toBe(false);
  });

  it('asks the host to open the channel, then moves frames both ways without reading them', () => {
    const relay = new MainDocRelay();
    const l = link();
    relay.connect(l.value);
    const port = new FakePort();
    expect(relay.open(doc(4), port, 7)).toBe(true);
    expect(port.started).toBe(true);
    expect(l.lines).toEqual([{ t: 'documents.open', channel: 4, artifactId: ID, actor: { kind: 'human' } }]);
    port.fromWindow(Uint8Array.from([1, 2]));
    port.fromWindow('not a frame');
    expect(l.frames).toEqual([[4, [1, 2]]]);
    relay.deliver(4, Uint8Array.from([3]));
    relay.deliver(5, Uint8Array.from([9])); // a channel main does not know: in flight across a close
    expect(port.posted).toEqual([Uint8Array.from([3])]);
  });

  it('tells the host when the window’s end goes, once', () => {
    const relay = new MainDocRelay();
    const l = link();
    relay.connect(l.value);
    const port = new FakePort();
    relay.open(doc(4), port, 7);
    port.closeFromWindow();
    port.closeFromWindow();
    expect(l.lines.slice(1)).toEqual([{ t: 'documents.close', channel: 4 }]);
    expect(relay.size).toBe(0);
  });

  it('ends the window’s port when the host ends the channel (host or reset), telling the host nothing back', () => {
    const relay = new MainDocRelay();
    const l = link();
    relay.connect(l.value);
    const port = new FakePort();
    relay.open(doc(4), port, 7);
    relay.closed(4);
    expect(port.closed).toBe(true);
    expect(l.lines).toHaveLength(1);
    port.closeFromWindow(); // the window's close event after main closed its end
    expect(l.lines).toHaveLength(1);
  });

  it('ends one window’s channels when it closes or reloads, and no other window’s', () => {
    const relay = new MainDocRelay();
    const l = link();
    relay.connect(l.value);
    const [a1, a2, b] = [new FakePort(), new FakePort(), new FakePort()];
    relay.open(doc(1), a1, 7);
    relay.open(doc(2), a2, 7);
    relay.open(doc(3), b, 8);
    relay.closeOwner(7);
    expect([a1.closed, a2.closed, b.closed]).toEqual([true, true, false]);
    expect(l.lines.slice(3)).toEqual([{ t: 'documents.close', channel: 1 }, { t: 'documents.close', channel: 2 }]);
    expect(relay.size).toBe(1);
  });

  it('ends every window’s port when the connection goes, and opens on the next one afresh', () => {
    const relay = new MainDocRelay();
    const first = link();
    relay.connect(first.value);
    const [a, b] = [new FakePort(), new FakePort()];
    relay.open(doc(1), a, 7);
    relay.open(doc(2), b, 8);
    relay.disconnect();
    expect([a.closed, b.closed]).toEqual([true, true]);
    expect(first.lines).toHaveLength(2); // nothing is said on a connection that is gone
    a.fromWindow(Uint8Array.from([1]));
    expect(first.frames).toEqual([]);
    expect(relay.open(doc(3), new FakePort(), 7)).toBe(false);

    const second = link();
    relay.connect(second.value);
    expect(relay.open(doc(3), new FakePort(), 7)).toBe(true);
    expect(second.lines).toEqual([{ t: 'documents.open', channel: 3, artifactId: ID, actor: { kind: 'human' } }]);
  });
});
