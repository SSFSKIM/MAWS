// The phone's Machine socket (P5 O13 M4, §C; RL1's multiplex, O11 M6) against a stand-in for the hub's relay object, a
// WebSocket server in this process: a dial is `open [tag][empty]`, answered `open [id][tag]`, then one byte duplex per
// channel over `data [id]`, ended by `close [id][reason]` either way; the socket's end ends every channel `app-gone`
// and the socket reconnects on its backoff; `presence` frames are kept per machine.
import { closeReasonName, decodeChannelFrame, encodeChannelFrame, tagBytes, CHANNEL_CLOSE, type ByteDuplex, type ChannelCloseReason, type RelayPresence } from 'org-protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket as ServerSocket } from 'ws';
import { machineSocket, type MachineSocket } from './carrier';

type Seen = { type: string; channel: number; payload: Uint8Array };

/** The relay's side: numbers each opened channel, keeps every frame and request path, and answers as told. */
class Relay {
  readonly server: WebSocketServer;
  readonly seen: Seen[] = [];
  readonly paths: string[] = [];
  readonly sockets: ServerSocket[] = [];
  /** Refuse the next opens with this reason (answered, then closed at once, as the hub does). */
  refuse: ChannelCloseReason | null = null;
  /** Leave opens unanswered. */
  silent = false;
  #next = 100;

  constructor(readonly port: Promise<number>, server: WebSocketServer) {
    this.server = server;
    server.on('connection', (socket, request) => {
      this.paths.push(request.url ?? '');
      this.sockets.push(socket);
      socket.on('message', (data: Buffer, binary: boolean) => {
        if (!binary) return;
        const frame = decodeChannelFrame(new Uint8Array(data))!;
        this.seen.push({ type: frame.type, channel: frame.channel, payload: frame.payload.slice() });
        if (frame.type !== 'open' || this.silent) return;
        const id = this.#next;
        this.#next += 1;
        socket.send(encodeChannelFrame('open', id, tagBytes(frame.channel)));
        if (this.refuse !== null) socket.send(encodeChannelFrame('close', id, CHANNEL_CLOSE[this.refuse]));
      });
    });
  }

  static start(): Relay {
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    const port = new Promise<number>((resolve) => server.once('listening', () => resolve((server.address() as { port: number }).port)));
    return new Relay(port, server);
  }

  async url(): Promise<string> {
    return `http://127.0.0.1:${await this.port}`;
  }

  get current(): ServerSocket {
    return this.sockets.at(-1)!;
  }

  data(channel: number, bytes: number[]): void {
    this.current.send(encodeChannelFrame('data', channel, Uint8Array.from(bytes)));
  }

  stop(): Promise<void> {
    for (const socket of this.sockets) socket.terminate();
    return new Promise((resolve) => this.server.close(() => resolve()));
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until<T>(probe: () => T | undefined | null | false, what: string, ms = 3000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = probe();
    if (value !== undefined && value !== null && value !== false) return value;
    if (Date.now() > deadline) throw new Error(`no ${what} within ${ms} ms`);
    await sleep(5);
  }
}

/** A duplex's bytes and its end, as they arrive. */
function watch(io: ByteDuplex) {
  const got: number[][] = [];
  const ended: string[] = [];
  io.onBytes((bytes) => got.push([...bytes]));
  io.onClose?.((reason) => ended.push(reason));
  return { got, ended };
}

const relays: Relay[] = [];
const sockets: MachineSocket[] = [];
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  for (const relay of relays.splice(0)) await relay.stop();
});

async function setup(options: Parameters<typeof machineSocket>[2] = {}) {
  const relay = Relay.start();
  relays.push(relay);
  const socket = machineSocket(await relay.url(), 'ref/one', { delay: () => 20, ...options });
  sockets.push(socket);
  return { relay, socket };
}

describe('a dial', () => {
  it('opens with its own tag and an empty payload, and resolves at the hub’s answer with a duplex over that channel id', async () => {
    const { relay, socket } = await setup();
    const io = await socket.dial();
    expect(relay.paths).toEqual(['/api/machines/ref%2Fone/socket']);
    const [open] = relay.seen;
    expect(open.type).toBe('open');
    expect(open.payload).toEqual(new Uint8Array(0));
    const seen = watch(io);
    io.send(Uint8Array.from([1, 2, 3]));
    await until(() => relay.seen.find((s) => s.type === 'data'), 'the data frame');
    expect(relay.seen.find((s) => s.type === 'data')).toMatchObject({ channel: 100, payload: Uint8Array.from([1, 2, 3]) });
    relay.data(100, [9, 8]);
    relay.data(999, [7]); // another channel's: not this duplex's
    await until(() => seen.got.length === 1, 'the data back');
    expect(seen.got).toEqual([[9, 8]]);
    io.close('done');
    await until(() => relay.seen.find((s) => s.type === 'close'), 'the close frame');
    expect(closeReasonName(relay.seen.find((s) => s.type === 'close')!.payload)).toBe('closed');
    io.send(Uint8Array.from([4])); // after its close: nothing goes
    await sleep(30);
    expect(relay.seen.filter((s) => s.type === 'data')).toHaveLength(1);
  });

  it('gives each channel its own tag and id', async () => {
    const { relay, socket } = await setup();
    const [a, b] = await Promise.all([socket.dial(), socket.dial()]);
    const tags = relay.seen.filter((s) => s.type === 'open').map((s) => s.channel);
    expect(new Set(tags).size).toBe(2);
    const [wa, wb] = [watch(a), watch(b)];
    relay.data(100, [1]);
    relay.data(101, [2]);
    await until(() => wa.got.length + wb.got.length === 2, 'both');
    expect([wa.got, wb.got].sort()).toEqual([[[1]], [[2]]]);
  });

  it('ends with the hub’s reason when the hub closes its channel, a refused open included', async () => {
    const { relay, socket } = await setup();
    relay.refuse = 'too-many-channels';
    const io = await socket.dial();
    const seen = watch(io);
    await until(() => seen.ended.length === 1, 'the end');
    expect(seen.ended).toEqual(['too-many-channels']);
  });

  it('waits a bounded time for the hub’s answer', async () => {
    const { relay, socket } = await setup({ dialMs: 50 });
    relay.silent = true;
    await expect(socket.dial()).rejects.toThrow(/no answer/);
  });

  it('waits a bounded time for a socket that never opens', async () => {
    const socket = machineSocket('http://127.0.0.1:9', 'ref', { delay: () => 10, dialMs: 100 });
    sockets.push(socket);
    await expect(socket.dial()).rejects.toThrow();
  });
});

describe('the socket', () => {
  it('ends every channel `app-gone` when it drops, and reconnects on its backoff for the next dial', async () => {
    const delays: number[] = [];
    const { relay, socket } = await setup({ delay: (attempt) => (delays.push(attempt), 20) });
    const io = await socket.dial();
    const seen = watch(io);
    relay.current.terminate();
    await until(() => seen.ended.length === 1, 'the end');
    expect(seen.ended).toEqual(['app-gone']);
    const again = await socket.dial();
    expect(relay.sockets).toHaveLength(2);
    expect(delays[0]).toBe(0);
    watch(again);
    relay.data(101, [5]);
  });

  it('keeps the hub’s presence frames, tells each one, and forgets presence while it is down', async () => {
    const { relay, socket } = await setup();
    await socket.dial();
    const told: Array<RelayPresence | null> = [];
    const off = socket.onPresence((p) => told.push(p));
    const presence: RelayPresence = { t: 'presence', online: true, pending: { 'la-1': { project: 'p', kind: 'waiting', pending: 2 } } };
    relay.current.send(JSON.stringify(presence));
    await until(() => told.length === 1, 'the presence');
    expect(socket.presence()).toEqual(presence);
    relay.current.terminate();
    await until(() => told.length === 2, 'the presence forgotten');
    expect(told[1]).toBeNull();
    expect(socket.presence()).toBeNull();
    off();
  });

  it('closes for good: its channels end, a dial is refused, and it does not reconnect', async () => {
    const { relay, socket } = await setup();
    const seen = watch(await socket.dial());
    socket.close();
    await until(() => seen.ended.length === 1, 'the end');
    await expect(socket.dial()).rejects.toThrow(/closed/);
    await sleep(80);
    expect(relay.sockets).toHaveLength(1);
  });
});
