import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HubSocket } from './socket';

class Wire {
  static OPEN = 1;
  static instances: Wire[] = [];
  readyState = 1;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  close = vi.fn(); // A frozen/half-open connection need never finish its close handshake.
  send = vi.fn();
  constructor(readonly url: string) { Wire.instances.push(this); }
}
beforeEach(() => { Wire.instances = []; vi.stubGlobal('WebSocket', Wire); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('wake replaces a socket, not its buffered history', () => {
  it('opens a fresh generation immediately and fences queued messages from the old wire before decoding them', () => {
    const frames: unknown[] = [];
    const socket = new HubSocket<{ t: string }, object>({ url: 'ws://fixture', open() {}, status() {}, frame: (frame) => frames.push(frame) });
    socket.start();
    const old = Wire.instances[0];
    old.onopen!();
    socket.restart();
    expect(Wire.instances).toHaveLength(2);
    const fresh = Wire.instances[1];
    // Old buffered messages and its eventual close cannot corrupt or close the new generation.
    old.onmessage!({ data: '{malformed old frame' });
    old.onmessage!({ data: '{"t":"old-stream-chunk"}' });
    old.onclose!();
    fresh.onopen!();
    fresh.onmessage!({ data: '{"t":"fresh-snapshot"}' });
    expect(frames).toEqual([{ t: 'fresh-snapshot' }]);
    expect(fresh.close).not.toHaveBeenCalled();
    socket.stop();
  });

  it('does not wait out an existing retry timer when the network returns', () => {
    vi.useFakeTimers();
    const socket = new HubSocket<{ t: string }, object>({ url: 'ws://fixture', open() {}, status() {}, frame() {}, delay: () => 15_000 });
    socket.start();
    Wire.instances[0].onopen!();
    Wire.instances[0].onclose!();
    socket.restart();
    expect(Wire.instances).toHaveLength(2);
    vi.advanceTimersByTime(15_000);
    expect(Wire.instances).toHaveLength(2);
    socket.stop();
  });

  it('never resurrects an explicitly stopped connection', () => {
    const socket = new HubSocket<{ t: string }, object>({ url: 'ws://fixture', open() {}, status() {}, frame() {} });
    socket.start(); socket.stop(); socket.restart();
    expect(Wire.instances).toHaveLength(1);
  });
});
