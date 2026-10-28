// A carrier's send buffer (send-buffer.ts) over a real WebSocket pair on loopback, its peer pausing its socket to stop
// reading: the ceiling over every byte held, the budget over capped sends, the stall bound read from frames written (a
// slow reader that keeps reading is not a stalled one, however the socket batches), a close sent only after what it
// holds (or the socket ended at the stall bound), and a wait let go when its signal aborts.
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';
import { SendBuffer, type SendEnding, type SendLimits } from '../../src/endpoint/send-buffer';

const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

/** The endpoint's socket and its peer's, connected over loopback. */
async function pair(): Promise<{ socket: WebSocket; peer: WebSocket }> {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1', autoPong: false });
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const accepted = new Promise<WebSocket>((resolve) => server.once('connection', resolve));
  const peer = new WebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}`);
  const socket = await accepted;
  await new Promise<void>((resolve) => (peer.readyState === WebSocket.OPEN ? resolve() : peer.once('open', () => resolve())));
  closers.push(() => {
    peer.terminate();
    socket.terminate();
    server.close();
  });
  return { socket, peer };
}

function buffer(socket: WebSocket, limits: SendLimits) {
  const endings: SendEnding[] = [];
  let ending: (why: SendEnding) => void = () => {};
  const ended = new Promise<SendEnding>((resolve) => (ending = resolve));
  const b = new SendBuffer(socket, limits, (why) => {
    endings.push(why);
    ending(why);
  });
  return { b, endings, ended };
}

const frame = new Uint8Array(128 * 1024);

describe('a send buffer, against a peer that stops reading', () => {
  it('ends once a send would take what it holds past its ceiling, having held no more than it', async () => {
    const { socket, peer } = await pair();
    peer.pause();
    const limits: SendLimits = { soft: 64 * 1024, ceiling: 2 * 1024 * 1024, stallMs: 60_000 };
    const { b, ended } = buffer(socket, limits);
    let peak = 0;
    let sent = 0;
    while (sent < 512 && b.send(frame, { binary: true })) {
      sent++;
      peak = Math.max(peak, b.buffered);
    }
    expect(sent).toBeLessThan(512);
    expect(await ended).toBe('overflow');
    expect(peak).toBeLessThanOrEqual(limits.ceiling);
    expect(b.send(frame, { binary: true })).toBe(false);
  });

  it('refuses a capped send past its budget and goes on: other sends still go', async () => {
    const { socket, peer } = await pair();
    peer.pause();
    const { b, endings } = buffer(socket, { soft: 64 * 1024, budget: 1024 * 1024, ceiling: 8 * 1024 * 1024, stallMs: 60_000 });
    let sent = 0;
    while (sent < 512 && b.send(frame, { binary: true, capped: true })) sent++;
    expect(sent).toBeLessThan(512);
    expect(b.ended).toBe(false);
    expect(b.send(frame, { binary: true })).toBe(true);
    expect(endings).toEqual([]);
  });

  it('counts each frame written as progress: a peer that reads slowly but on is never stalled', async () => {
    const { socket, peer } = await pair();
    peer.pause();
    const { b, endings } = buffer(socket, { soft: 64 * 1024, ceiling: 64 * 1024 * 1024, stallMs: 1000 });
    const frames = 24; // 6 MiB of 256 KiB frames, read 256 KiB every 100 ms: about 2.4 s in all, far past the bound
    for (let i = 0; i < frames; i++) b.send(new Uint8Array(256 * 1024), { binary: true });
    let got = 0;
    let since = 0;
    const all = new Promise<void>((resolve) =>
      peer.on('message', (data: Buffer) => {
        got += data.length;
        since += data.length;
        if (got >= frames * 256 * 1024) return resolve();
        if (since >= 256 * 1024) {
          since = 0;
          peer.pause();
          setTimeout(() => peer.resume(), 100);
        }
      }),
    );
    peer.resume();
    await all;
    expect(endings).toEqual([]);
  }, 20_000);

  it('ends when it holds bytes and no frame has been written for its stall bound', async () => {
    const { socket, peer } = await pair();
    peer.pause();
    const { b, ended } = buffer(socket, { soft: 64 * 1024, ceiling: 64 * 1024 * 1024, stallMs: 200 });
    for (let i = 0; i < 128; i++) b.send(frame, { binary: true }); // 16 MiB: past any kernel's socket buffers
    expect(await ended).toBe('stalled');
  });

  it('closes only once the peer has taken what it holds, refusing every send after the close', async () => {
    const { socket, peer } = await pair();
    peer.pause();
    const { b, endings } = buffer(socket, { soft: 64 * 1024, ceiling: 64 * 1024 * 1024, stallMs: 60_000 });
    const frames = 64; // 8 MiB: past the kernel's buffers, so most of it is still held here at the close
    for (let i = 0; i < frames; i++) b.send(frame, { binary: true });
    b.close(1000, 'done');
    expect(b.send(frame, { binary: true })).toBe(false);
    let got = 0;
    peer.on('message', () => void got++);
    const closed = new Promise<{ code: number; reason: string; got: number }>((resolve) => peer.once('close', (code: number, reason: Buffer) => resolve({ code, reason: reason.toString(), got })));
    peer.resume();
    expect(await closed).toEqual({ code: 1000, reason: 'done', got: frames });
    expect(endings).toEqual([]);
  });

  it('ends a closing socket itself when its peer reads nothing for the stall bound', async () => {
    const { socket, peer } = await pair();
    peer.pause();
    const { b, ended } = buffer(socket, { soft: 64 * 1024, ceiling: 64 * 1024 * 1024, stallMs: 200 });
    for (let i = 0; i < 128; i++) b.send(frame, { binary: true });
    const gone = new Promise<void>((resolve) => socket.once('close', () => resolve()));
    b.close(1000, 'done');
    expect(await ended).toBe('stalled');
    await gone;
  });

  it('lets a writable() wait go when its signal aborts, unregistered, and every other at its end', async () => {
    const { socket, peer } = await pair();
    peer.pause();
    const { b } = buffer(socket, { soft: 64 * 1024, ceiling: 64 * 1024 * 1024, stallMs: 200 });
    for (let i = 0; i < 128; i++) b.send(frame, { binary: true });
    const abort = new AbortController();
    const aborted = b.writable(abort.signal);
    const other = b.writable();
    expect(b.waits).toBe(2);
    abort.abort();
    await aborted;
    expect(b.waits).toBe(1);
    await other; // at the stall's end
    expect(b.waits).toBe(0);
  });
});
