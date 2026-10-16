// The fake machine's reconnect, against what M5 saw on the deployment: minutes after a deploy, Cloudflare restarted the
// `Machine` object for new requests while the old instance kept the machine's stream open and beating. Every POST then
// reached an object with no stream and was refused `409 stale-generation`, the hb-acks too, and nothing ever closed the
// stream from the client's side. A `503 delivery-failed` says the same of a stream the hub could not write to. A machine
// that reconnects by itself must take either refusal, on a write or on a heartbeat's ack, as its cue to reconnect.
// The hub here is a stub speaking DX2's stream and POST, which can play that rollover.
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeMachine } from '../../fake-machine';
import type { DownFrame, UpFrame } from '../../src/protocol/machine';

const PROJECT = '5d4e0a8e-3b2d-4c5e-9f70-0000000000ff';
const REFUSALS = { 409: 'stale-generation', 503: 'delivery-failed' } as const;

/** A stub hub: one stream per generation; `refuse(status)` refuses every later POST on the current stream with that
 * status while the stream itself stays open, as after a deploy's rollover. */
async function stubHub() {
  let generation = 0;
  let current = 0;
  let refused: { generation: number; status: keyof typeof REFUSALS } | null = null;
  /** Streams to end at once, before their welcome; POSTs to cut at the transport, unanswered. */
  let endStreams = 0;
  let cutPosts = 0;
  let have: Record<string, number> = {};
  const streams = new Map<number, ServerResponse>();
  const posted: Array<{ generation: number; frames: UpFrame[] }> = [];
  const send = (g: number, frame: DownFrame) => streams.get(g)?.write(`event: ${frame.t}\ndata: ${JSON.stringify(frame)}\n\n`);
  const server = createServer((request, response) => {
    if (request.url === '/machine/stream') {
      if (endStreams > 0) {
        endStreams--;
        response.writeHead(200, { 'Content-Type': 'text/event-stream' }).end();
        return;
      }
      const g = ++generation;
      current = g;
      streams.set(g, response);
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      send(g, { t: 'welcome', org: 'o', machine: 'm', generation: g, heartbeat_ms: 15_000 });
      return;
    }
    if (cutPosts > 0) {
      cutPosts--;
      request.socket.destroy();
      return;
    }
    let body = '';
    request.on('data', (chunk: Buffer) => (body += chunk.toString()));
    request.on('end', () => {
      const g = Number(request.headers['x-desk-generation']);
      const status = refused?.generation === g ? refused.status : g !== current ? 409 : null;
      if (status) {
        response.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: REFUSALS[status] }));
        return;
      }
      const frames = body.split('\n').filter(Boolean).map((line) => JSON.parse(line) as UpFrame);
      posted.push({ generation: g, frames });
      for (const frame of frames) if (frame.t === 'hello') send(g, { t: 'have', project: PROJECT, have, archive: false });
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true, frames: frames.length }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    posted,
    get generation() {
      return current;
    },
    /** The next `count` streams end at once, with no welcome. */
    endNextStreams(count: number) {
      endStreams = count;
    },
    /** Ends the current stream from the hub's side. */
    endCurrent() {
      streams.get(current)?.end();
    },
    /** The next `count` POSTs are cut at the transport: the client's fetch fails, unanswered. */
    cutNextPosts(count: number) {
      cutPosts = count;
    },
    /** The vector the hub answers `hello` with. */
    set have(vector: Record<string, number>) {
      have = vector;
    },
    refuse(status: keyof typeof REFUSALS) {
      refused = { generation: current, status };
    },
    /** A heartbeat on the stream that is still open, which the machine acks. */
    beat() {
      send(current, { t: 'hb', at: new Date().toISOString() });
    },
    close() {
      for (const s of streams.values()) s.end();
      server.closeAllConnections();
      server.close();
    },
  };
}

let close: () => void = () => {};
afterEach(() => close());

async function until(test: () => boolean, what: string, ms = 10_000) {
  const deadline = Date.now() + ms;
  while (!test()) {
    if (Date.now() > deadline) throw new Error(`no ${what} within ${ms} ms`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function connected() {
  const hub = await stubHub();
  const fm = new FakeMachine({ hub: hub.url, machine: 'm', credentials: { clientId: 'c', clientSecret: 's' }, orgKey: new Uint8Array(32).fill(1), project: PROJECT, reconnect: true });
  close = () => {
    void fm.close();
    hub.close();
  };
  await fm.connect();
  expect(fm.generation).toBe(1);
  return { hub, fm };
}

describe('the fake machine reconnecting by itself', () => {
  for (const status of [409, 503] as const) {
    it(`takes a ${status} on a write as its cue to reconnect, and the write lands on the new stream`, async () => {
      const { hub, fm } = await connected();
      hub.refuse(status);
      await fm.write('w1', 'm/feed', { kind: 'say', from: 'm', to: '*', text: 'one' });
      await until(() => fm.generation === 2 && hub.generation === 2, `a reconnect after a ${status}`);
      // The new stream's hello carries the vector, the stub answers `have {}`, and the machine uploads its own suffix.
      await until(() => hub.posted.some((p) => p.generation === 2 && p.frames.some((f) => f.t === 'events' && f.events.some((e) => e.seq === 1))), 'the write uploaded again');
    });

    it(`takes a ${status} on a heartbeat's ack alone as its cue to reconnect`, async () => {
      const { hub, fm } = await connected();
      hub.refuse(status);
      hub.beat();
      await until(() => fm.generation === 2 && hub.generation === 2, `a reconnect after an hb-ack's ${status}`);
      // The generation moves at the new stream's welcome; its hello follows.
      await until(() => hub.posted.some((p) => p.generation === 2 && p.frames.some((f) => f.t === 'hello')), 'the hello on the new stream');
    });
  }
});

describe('the handshake and the uploads, at their edges (the branch panel’s findings)', () => {
  it('rejects a connect whose stream ends before its welcome, and a reconnect loop gets past such a stream', async () => {
    const { hub, fm } = await connected();
    // A connect of its own, on a stream that ends at once: it settles, rejected, rather than hang.
    hub.endNextStreams(1);
    const lone = new FakeMachine({ hub: hub.url, machine: 'm2', credentials: { clientId: 'c', clientSecret: 's' }, orgKey: new Uint8Array(32).fill(1), project: PROJECT });
    const settled = await Promise.race([lone.connect().then(() => 'connected', () => 'rejected'), new Promise((r) => setTimeout(() => r('pending'), 3000))]);
    expect(settled).toBe('rejected');
    // The machine's stream ends; its first reconnect meets a stream that ends before welcome; the loop goes on.
    const before = hub.generation;
    hub.endNextStreams(1);
    hub.endCurrent();
    await until(() => hub.generation > before && fm.generation === hub.generation, 'a reconnect past the dead stream');
    await until(() => hub.posted.some((p) => p.generation === hub.generation && p.frames.some((f) => f.t === 'hello')), 'the hello on the new stream');
  });

  it("takes the next seq past the hub's vector for its own feed, even before any of the hub's events are imported", async () => {
    const hub = await stubHub();
    hub.have = { 'm/feed': 100 };
    const fm = new FakeMachine({ hub: hub.url, machine: 'm', credentials: { clientId: 'c', clientSecret: 's' }, orgKey: new Uint8Array(32).fill(1), project: PROJECT });
    close = () => {
      void fm.close();
      hub.close();
    };
    await fm.connect();
    const event = await fm.write('w', 'm/feed', { kind: 'say', from: 'm', to: '*', text: 'after a hundred' });
    expect(event.seq).toBe(101);
  });

  it('recovers a write whose POST failed at the transport: it reconnects, and the write lands', async () => {
    const { hub, fm } = await connected();
    hub.cutNextPosts(1);
    await fm.write('w', 'm/feed', { kind: 'say', from: 'm', to: '*', text: 'cut once' });
    await until(() => hub.posted.some((p) => p.frames.some((f) => f.t === 'events' && f.events.some((e) => e.text === 'cut once'))), 'the write uploaded after the cut');
    expect(fm.postErrors.some((e) => e instanceof TypeError)).toBe(true);
  });
});
