// A loopback TCP pipe in front of a listener (e2e/support/remote-scene.ts's ways to the hub and to B's direct listener,
// P5 O7 M4 and M7), so a spec can take a path away and give it back as a network would. P5 O15 M2b §I
// (docs/doperpowers/plans/2026-11-10-p5-o15-recomposition.md) gives it the states a sleep leaves behind:
//
// - `cut()`: every connection through the pipe ended, and each new one ended as it is accepted, until `restore`. The
//   forced drop's (e2e:remote, the first test of e2e:remote-latency): what a lost network that resets does.
// - `stall()`: every connection open through it is dead from then on, its bytes discarded both ways and neither side
//   closed until the pipe closes, and the pipe stops listening, so a new connect is refused. The dead connections are
//   what a half-open socket is after a sleep; the refused connect stands in for a SYN nobody answers, which loopback
//   cannot produce.
// - `hold()`: the pipe listens and accepts, and forwards nothing either way: a TCP connect succeeds and whatever is sent
//   on it goes unanswered, a path that answers TCP and hangs above it. A connection piped until then is dead too.
// - `restore()`: the pipe listens and pipes every connection made from then on; the dead and the held ones stay as they
//   are.
// - `requests()`: every connection accepted since the pipe was made, with the time it was accepted (this Mac's wall
//   clock, the clock the logs' lines carry) and the first line its client sent, or null for one that sent nothing (a
//   probe that connects and closes).
//
// A stalled pipe listens again on the port it had, so a URL handed out before the stall stays its address. Should that
// listen fail, every later call throws the reason, so a spec does not read a refused path as the product's.
import { connect, createServer, type AddressInfo, type Server, type Socket } from 'node:net';

export interface PipeRequest {
  /** When the pipe accepted the connection (Date.now()). */
  at: number;
  /** The first line its client sent, its CR left off; null while it has sent none. */
  firstLine: string | null;
}

export interface LoopbackPipe {
  /** `http://127.0.0.1:<port>`: the pipe's address, the same across a stall. */
  url: string;
  cut(): void;
  stall(): void;
  hold(): void;
  restore(): void;
  requests(): PipeRequest[];
  close(): Promise<void>;
}

/** A first line is read no further than this: a client that writes this much with no newline has it as its line. */
const FIRST_LINE_MAX = 1_024;

type Pair = { client: Socket; upstream: Socket; dead: boolean };

/** A pipe on a free loopback port to `target` (an `http://127.0.0.1:<port>` URL), piping from the start. */
export async function pipeTo(target: string, deps: { now?(): number } = {}): Promise<LoopbackPipe> {
  const now = deps.now ?? Date.now;
  const upstreamPort = Number(new URL(target).port);
  const piped = new Set<Pair>();
  const kept = new Set<Socket>(); // the dead and the held: open, read and discarded, never closed by the pipe
  const recorded: PipeRequest[] = [];
  let accepting: 'pipe' | 'end' | 'hold' = 'pipe';
  let server: Server | null = null;
  let port = 0;
  let failure: Error | null = null;

  const discard = () => undefined;
  const keep = (socket: Socket) => {
    kept.add(socket);
    socket.on('data', discard);
    socket.on('close', () => kept.delete(socket));
    socket.resume();
  };
  const kill = (pair: Pair) => {
    pair.dead = true;
    pair.client.unpipe(pair.upstream);
    pair.upstream.unpipe(pair.client);
    piped.delete(pair);
    keep(pair.client);
    keep(pair.upstream);
  };
  const firstLineOf = (socket: Socket, request: PipeRequest) => {
    let read = '';
    const onData = (chunk: Buffer) => {
      read += chunk.toString('latin1');
      const end = read.indexOf('\n');
      if (end < 0 && read.length < FIRST_LINE_MAX) return;
      request.firstLine = (end < 0 ? read.slice(0, FIRST_LINE_MAX) : read.slice(0, end)).replace(/\r$/, '');
      socket.off('data', onData);
    };
    socket.on('data', onData);
  };

  const accept = (socket: Socket) => {
    const request: PipeRequest = { at: now(), firstLine: null };
    recorded.push(request);
    socket.on('error', discard); // a reset, on either side
    if (accepting === 'end') return void socket.destroy();
    firstLineOf(socket, request);
    if (accepting === 'hold') return keep(socket);
    const upstream = connect({ host: '127.0.0.1', port: upstreamPort });
    upstream.on('error', discard);
    const pair: Pair = { client: socket, upstream, dead: false };
    piped.add(pair);
    for (const [side, other] of [[socket, upstream], [upstream, socket]] as const) {
      side.on('close', () => {
        if (pair.dead) return; // a dead connection's end is its own: the other side never hears of it
        piped.delete(pair);
        other.destroy();
      });
    }
    socket.pipe(upstream).pipe(socket);
  };

  const failed = (error: Error) => void (failure ??= new Error(`the pipe on 127.0.0.1:${port}: ${error.message}`));
  const listen = () => {
    if (server !== null) return;
    const next = createServer(accept);
    next.on('error', failed);
    next.listen(port, '127.0.0.1'); // bound a tick later (the address's lookup), well inside a probe's 100 ms
    server = next;
  };
  const unlisten = () => {
    server?.close();
    server = null;
  };
  const endAll = () => {
    for (const pair of [...piped]) {
      pair.client.destroy();
      pair.upstream.destroy();
    }
    for (const socket of [...kept]) socket.destroy();
  };
  const live = () => {
    if (failure !== null) throw failure;
  };

  await new Promise<void>((done, fail) => {
    const first = createServer(accept);
    first.once('error', fail);
    first.listen(0, '127.0.0.1', () => {
      first.off('error', fail);
      first.on('error', failed);
      port = (first.address() as AddressInfo).port;
      server = first;
      done();
    });
  });

  return {
    url: `http://127.0.0.1:${port}`,
    cut() {
      live();
      accepting = 'end';
      endAll();
      listen();
    },
    stall() {
      live();
      for (const pair of [...piped]) kill(pair);
      unlisten();
    },
    hold() {
      live();
      for (const pair of [...piped]) kill(pair);
      accepting = 'hold';
      listen();
    },
    restore() {
      live();
      accepting = 'pipe';
      listen();
    },
    requests() {
      live();
      return recorded.map((request) => ({ ...request }));
    },
    close: () =>
      new Promise<void>((done) => {
        accepting = 'end';
        endAll();
        const last = server;
        server = null;
        if (last === null) return done();
        last.close(() => done());
      }),
  };
}

/** The request target of an HTTP request line (`GET /api/registry/socket?app=1 HTTP/1.1`), or null for any other line. */
export function requestTarget(firstLine: string | null): string | null {
  const match = firstLine === null ? null : /^[A-Z]+ (\S+) HTTP\/\d(?:\.\d)?$/.exec(firstLine);
  return match === null ? null : match[1]!;
}
