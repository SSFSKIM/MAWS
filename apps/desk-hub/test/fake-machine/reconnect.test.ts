// The fake machine's reconnect, against what M5 saw on the deployment: minutes after a deploy, Cloudflare restarted the
// `Machine` object for new requests while the old instance kept the machine's stream open and beating. Every POST then
// reached an object with no stream and was refused `409 stale-generation`, the hb-acks too, and nothing ever closed the
// stream from the client's side. A machine that reconnects by itself must take that refusal as its cue to reconnect.
// The hub here is a stub speaking DX2's stream and POST, which can play that rollover.
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeMachine } from '../../fake-machine';
import type { DownFrame, UpFrame } from '../../src/protocol/machine';

const PROJECT = '5d4e0a8e-3b2d-4c5e-9f70-0000000000ff';

/** A stub hub: one stream per generation; `rollover()` makes every later POST stale while the old stream beats on. */
async function stubHub() {
  let generation = 0;
  let current = 0;
  const streams = new Map<number, ServerResponse>();
  const posted: Array<{ generation: number; frames: UpFrame[] }> = [];
  const send = (g: number, frame: DownFrame) => streams.get(g)?.write(`event: ${frame.t}\ndata: ${JSON.stringify(frame)}\n\n`);
  const server = createServer((request, response) => {
    if (request.url === '/machine/stream') {
      const g = ++generation;
      current = g;
      streams.set(g, response);
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      send(g, { t: 'welcome', org: 'o', machine: 'm', generation: g, heartbeat_ms: 15_000 });
      return;
    }
    let body = '';
    request.on('data', (chunk: Buffer) => (body += chunk.toString()));
    request.on('end', () => {
      const g = Number(request.headers['x-desk-generation']);
      if (g !== current) {
        response.writeHead(409, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'stale-generation' }));
        return;
      }
      const frames = body.split('\n').filter(Boolean).map((line) => JSON.parse(line) as UpFrame);
      posted.push({ generation: g, frames });
      for (const frame of frames) if (frame.t === 'hello') send(g, { t: 'have', project: PROJECT, have: {}, archive: false });
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
    /** New requests reach a fresh object, which holds no stream: the old one stays open and beats. */
    rollover() {
      current = -1;
      send(1, { t: 'hb', at: new Date().toISOString() });
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

describe('the fake machine reconnecting by itself', () => {
  it('takes a 409 stale-generation, on a write or on an hb-ack, as a cue to reconnect, and its writes land on the new stream', async () => {
    const hub = await stubHub();
    const fm = new FakeMachine({ hub: hub.url, machine: 'm', credentials: { clientId: 'c', clientSecret: 's' }, orgKey: new Uint8Array(32).fill(1), project: PROJECT, reconnect: true });
    close = () => {
      void fm.close();
      hub.close();
    };
    await fm.connect();
    expect(fm.generation).toBe(1);

    hub.rollover();
    await fm.write('w1', 'm/feed', { kind: 'say', from: 'm', to: '*', text: 'one' });
    await until(() => fm.generation === 2 && hub.generation === 2, 'a reconnect after the stale refusal');
    // The new stream's hello carries the vector, the stub answers `have {}`, and the machine uploads its own suffix.
    await until(() => hub.posted.some((p) => p.generation === 2 && p.frames.some((f) => f.t === 'events' && f.events.some((e) => e.seq === 1))), 'the write uploaded again');
  });
});
