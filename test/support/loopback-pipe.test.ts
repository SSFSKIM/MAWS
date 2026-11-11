// The scene's loopback pipe (test/support/loopback-pipe.ts) over real loopback sockets: what each state does to the
// connections through it and to a new connect, and what `requests` records.
import { connect, createServer, type AddressInfo, type Server, type Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { pipeTo, requestTarget, type LoopbackPipe } from './loopback-pipe';

const QUIET_MS = 150; // long enough for a byte or a close that should not come to have come

// An echo listener that keeps its sockets, so a test can see what reached it and end one from its side.
async function echo(): Promise<{ url: string; accepted: Socket[]; received: () => string; close(): Promise<void> }> {
  const accepted: Socket[] = [];
  let received = '';
  const server: Server = createServer((socket) => {
    accepted.push(socket);
    socket.on('error', () => undefined);
    socket.on('data', (chunk) => {
      received += chunk.toString();
      socket.write(chunk);
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', () => done()));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    accepted,
    received: () => received,
    close: () =>
      new Promise<void>((done) => {
        for (const socket of accepted) socket.destroy();
        server.close(() => done());
      }),
  };
}

type Client = { socket: Socket; heard: () => string; closed: () => boolean };
function dial(url: string): Promise<Client> {
  return new Promise((done, fail) => {
    let heard = '';
    let closed = false;
    const socket = connect({ host: '127.0.0.1', port: Number(new URL(url).port) });
    socket.on('data', (chunk) => void (heard += chunk.toString()));
    socket.on('close', () => void (closed = true));
    socket.once('error', fail);
    socket.once('connect', () => {
      socket.off('error', fail);
      socket.on('error', () => undefined);
      done({ socket, heard: () => heard, closed: () => closed });
    });
  });
}
const refused = (url: string) =>
  new Promise<string>((done) => {
    const socket = connect({ host: '127.0.0.1', port: Number(new URL(url).port) });
    socket.once('connect', () => {
      socket.destroy();
      done('connected');
    });
    socket.once('error', (error: NodeJS.ErrnoException) => done(error.code ?? error.message));
  });
const quiet = () => new Promise((resolve) => setTimeout(resolve, QUIET_MS));
const until = async (check: () => boolean, ms = 2_000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

const opened: { close(): Promise<void> }[] = [];
const clients: Client[] = [];
afterEach(async () => {
  for (const client of clients.splice(0)) client.socket.destroy();
  for (const one of opened.splice(0).reverse()) await one.close();
});
async function scene(): Promise<{ upstream: Awaited<ReturnType<typeof echo>>; pipe: LoopbackPipe; client(): Promise<Client> }> {
  const upstream = await echo();
  opened.push(upstream);
  const pipe = await pipeTo(upstream.url);
  opened.push(pipe);
  return {
    upstream,
    pipe,
    client: async () => {
      const client = await dial(pipe.url);
      clients.push(client);
      return client;
    },
  };
}

describe('the loopback pipe', () => {
  it('pipes both ways from the start and records each connection with its first line', async () => {
    const { pipe, client } = await scene();
    const before = Date.now();
    const one = await client();
    one.socket.write('GET /api/registry/socket?app=1 HTTP/1.1\r\nHost: hub\r\n\r\n');
    await until(() => one.heard().includes('Host: hub'));
    const silent = await client();
    await until(() => pipe.requests().length === 2);
    const [first, second] = pipe.requests();
    expect(first!.firstLine).toBe('GET /api/registry/socket?app=1 HTTP/1.1');
    expect(first!.at).toBeGreaterThanOrEqual(before);
    expect(second!.firstLine).toBeNull();
    silent.socket.destroy();
  });

  it('stall: a connection through it is dead both ways and stays open, a new connect is refused, and restore listens again at the same address', async () => {
    const { upstream, pipe, client } = await scene();
    const one = await client();
    one.socket.write('hello\n');
    await until(() => one.heard() === 'hello\n');
    pipe.stall();
    one.socket.write('lost\n');
    upstream.accepted[0]!.write('also lost\n');
    await quiet();
    expect(one.heard(), 'nothing reaches the client').toBe('hello\n');
    expect(upstream.received(), 'nothing reaches the listener').toBe('hello\n');
    expect(await refused(pipe.url)).toBe('ECONNREFUSED');
    // the listener's own end of a dead connection is not passed on
    upstream.accepted[0]!.destroy();
    await quiet();
    expect(one.closed(), 'the dead connection stays open on the client’s side').toBe(false);

    pipe.restore();
    const two = await client();
    two.socket.write('back\n');
    await until(() => two.heard() === 'back\n');
    expect(one.closed()).toBe(false);
    expect(pipe.requests().map((r) => r.firstLine)).toEqual(['hello', 'back']);
  });

  it('hold: a connect succeeds and what it sends is recorded and goes unanswered; a piped connection is dead; restore pipes what comes after and keeps the held one', async () => {
    const { upstream, pipe, client } = await scene();
    const piped = await client();
    await until(() => upstream.accepted.length === 1); // accepted and piped before the hold
    pipe.hold();
    const held = await client();
    held.socket.write('GET /socket HTTP/1.1\r\n\r\n');
    piped.socket.write('lost\n');
    await quiet();
    expect(held.heard()).toBe('');
    expect(piped.heard()).toBe('');
    expect(upstream.accepted, 'the held connection never reached the listener').toHaveLength(1);
    expect(pipe.requests().at(-1)!.firstLine).toBe('GET /socket HTTP/1.1');

    pipe.restore();
    const after = await client();
    after.socket.write('ping\n');
    await until(() => after.heard() === 'ping\n');
    held.socket.write('still nothing\n');
    await quiet();
    expect(held.heard()).toBe('');
    expect(held.closed()).toBe(false);
  });

  it('hold after a stall listens again', async () => {
    const { pipe, client } = await scene();
    pipe.stall();
    expect(await refused(pipe.url)).toBe('ECONNREFUSED');
    pipe.hold();
    const held = await client();
    held.socket.write('x\n');
    await quiet();
    expect(held.heard()).toBe('');
  });

  it('cut: ends every connection and each new one until restore', async () => {
    const { pipe, client } = await scene();
    const one = await client();
    pipe.cut();
    await until(() => one.closed());
    const next = await client();
    await until(() => next.closed());
    pipe.restore();
    const back = await client();
    back.socket.write('ok\n');
    await until(() => back.heard() === 'ok\n');
  });

  it('close ends the dead and the held connections too', async () => {
    const upstream = await echo();
    opened.push(upstream);
    const pipe = await pipeTo(upstream.url);
    const dead = await dial(pipe.url);
    await until(() => upstream.accepted.length === 1);
    pipe.hold();
    const held = await dial(pipe.url);
    await pipe.close();
    await until(() => dead.closed() && held.closed());
  });
});

describe('requestTarget', () => {
  it('reads the target of a request line and nothing else', () => {
    expect(requestTarget('GET /api/machines/m%3Ab/socket HTTP/1.1')).toBe('/api/machines/m%3Ab/socket');
    expect(requestTarget('GET / HTTP/1.1')).toBe('/');
    expect(requestTarget(null)).toBeNull();
    expect(requestTarget('\u0016\u0003\u0001')).toBeNull();
  });
});
