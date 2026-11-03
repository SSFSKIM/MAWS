// The read open at the endpoint (P5 O7 M5b, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M5 "The read
// open" and "The `http` stream"; Interfaces §L's M5b rows, §N): a `streamOpen` that names no `op`, behind `rl2.read-open`,
// admitted by a stream row of the offer table through authorization's eight steps at the row's grade, on the `artifact`
// rule. The `http` plane over a real artifact endpoint (the scheme's own handler over a scratch store: its headers, its
// ranges, its not-found), the body pulled within the device's credit; the `document` opens' grades and `read-only`, and
// their plane over a fake host port (the endpoint's document channel, its frames relayed both ways length-prefixed under
// each side's credit, a `view` open's writes dropped, the channel's end and the stream's); a read stream authorized again
// at the record change and the relink that withdraw it; and the act open beside it, unchanged (P5 O17 M9a's
// `browser.screencast` read open has its own suite, test/endpoint/browser-screencast.test.ts).
import { randomBytes, randomUUID } from 'node:crypto';
import { generateSigningKey, signRecord, SIGNING_DOMAINS, WITHHELD_SESSION } from 'org-protocol';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { decodeFrame, encodeFrame } from '../../src/artifacts/provider/frames';
import type { SessionRecord } from '../../src/endpoint/sources';
import { OFFERS, READ_OPENS } from '../../src/endpoint/offers';
import type { RemoteChannel } from '../../src/endpoint/channels';
import { STREAM_INPUT_CREDIT, type ReadOpening, type Stream } from '../../src/endpoint/stream-base';
import { httpPlane } from '../../src/endpoint/stream-http';
import type { StreamWindow } from '../../src/endpoint/stream-window';
import { fakeAssetHolds, fakeDocuments, fakeServices, mintRef, scratchArtifacts } from './fake-services';
import { FakePtyHost } from './fake-pty-host';
import { act, done, makeOrg, openRemote, ORG, sleep, startEndpoint, stopAll, until, waitFor, type Fixture, type Msg, type Org, type Remote } from './sub-harness';

let org: Org;
const started: Fixture[] = [];

beforeAll(async () => {
  org = await makeOrg();
});
afterEach(() => stopAll(started));
afterAll(() => stopAll(started));

const READ = ['rl2.read-open'];
const id16 = () => randomBytes(16).toString('base64url');
const url = (artifactId: string, path = 'index.html', revision: number | 'live' = 'live') => `maws-artifact://${artifactId}/${revision}/${path}`;
const PAGE = '<!doctype html><html><head><title>t</title></head><body>hello</body></html>';

async function start(options: { pty?: FakePtyHost } = {}) {
  const f = await startEndpoint(org, started, options);
  return { f, store: scratchArtifacts(f.services) };
}

/** A lane B session: its engine host row, its spine record and its member record (A owns the machine). */
function session(f: Fixture, app: string, owners: string[], fields: Partial<SessionRecord> = {}): string {
  const s = f.host.add(app);
  f.spine.set(app, s.engineSessionId);
  f.records.set({ lane: 'B', session: s.engineSessionId!, owners, access: 'private', ...fields }, app);
  return s.engineSessionId!;
}
const shared = (member: string): Partial<SessionRecord> => ({ shares: [{ member, grade: 'view' }] });

type Http = { url: string; method?: 'GET' | 'HEAD'; range?: string };
/** An `http` read open and the endpoint's answer (`streamOpened` or `streamRefused`). */
async function openHttp(r: Remote, http: Http, credit = 1024 * 1024): Promise<{ id: string; answer: Msg }> {
  const id = id16();
  const from = r.inbox.length;
  await r.channel.send({ t: 'streamOpen', id, kind: 'http', credit, http: { method: 'GET', ...http } });
  return { id, answer: await waitFor(r, (m) => m.id === id && (m.t === 'streamOpened' || m.t === 'streamRefused'), `the answer to stream ${id}`, from) };
}
async function openDocument(r: Remote, document: { artifactId: string; mode: 'edit' | 'view' }): Promise<Msg> {
  const id = id16();
  const from = r.inbox.length;
  await r.channel.send({ t: 'streamOpen', id, kind: 'document', credit: 1024 * 1024, document });
  return waitFor(r, (m) => m.id === id && (m.t === 'streamOpened' || m.t === 'streamRefused'), `the answer to stream ${id}`, from);
}

const ofStream = (r: Remote, id: string) => r.inbox.filter((m) => (m as Msg).id === id) as Msg[];
/** The stream's body so far, each chunk checked to follow the one before from offset 0. */
function body(r: Remote, id: string): Buffer {
  const parts: Buffer[] = [];
  let at = 0;
  for (const m of ofStream(r, id).filter((m) => m.t === 'streamData')) {
    expect(m.offset).toBe(at);
    const bytes = Buffer.from(m.data as string, 'base64url');
    parts.push(bytes);
    at += bytes.byteLength;
  }
  return Buffer.concat(parts);
}
const closeOf = (r: Remote, id: string) => ofStream(r, id).find((m) => m.t === 'streamClose')?.reason;

/** A certificate set the hub serves under the same head, changed (a certificate of another machine added). */
async function certificatesChanged(f: Fixture): Promise<void> {
  const key = await generateSigningKey();
  const cert = await signRecord(SIGNING_DOMAINS.machineCert, { org: ORG, machine: mintRef(), name: 'vm-other', pub: key.pub, delegation: 'd-other', use: 1, issued: new Date().toISOString() }, key.privateKey, key.pub);
  const view = { head: f.chain.at(-1)!, chain: [], transitions: [], certificates: { certs: [cert], retirements: [] }, more: false };
  expect((await f.endpoint.parts!.org.sync(() => Promise.resolve(view))).refused).toBeUndefined();
}
/** The authorizer made to wait until `release`: a re-check begun meanwhile stays pending. */
function gated(f: Fixture): { release(): void; streams: () => number } {
  const authorizer = f.endpoint.authorizer;
  const authorize = authorizer.authorize.bind(authorizer);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let streams = 0;
  authorizer.authorize = async (request, who, now) => {
    if (request.kind === 'stream') streams++;
    await gate;
    return authorize(request, who, now);
  };
  return { release, streams: () => streams };
}
/** A body the suite feeds a chunk at a time (`null` ends it). */
function fedBody(): { body: ReadableStream<Uint8Array>; feed(chunk: Uint8Array | null): void } {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start: (c) => void (controller = c) }, { highWaterMark: 0 });
  return { body, feed: (chunk) => (chunk === null ? controller.close() : controller.enqueue(chunk)) };
}
const closedChannel = (r: Remote) => new Promise<string>((resolve) => r.channel.onClose(resolve));

describe('the stream rows (§L, M5b)', () => {
  it('offers `artifacts.fetch` for `http` at `view` and `documents.open` for `document` at `view` by effect, both on the `artifact` rule', () => {
    expect(OFFERS.commands['artifacts.fetch']).toMatchObject({ kind: 'stream', stream: 'http', executor: 'endpoint', target: 'artifact', grade: 'view' });
    expect(OFFERS.commands['documents.open']).toMatchObject({ kind: 'stream', stream: 'document', executor: 'endpoint', target: 'artifact', grade: { floor: 'view', byEffect: true } });
    for (const [kind, name] of Object.entries(READ_OPENS)) expect([kind, OFFERS.commands[name].stream]).toEqual([kind, kind]);
  });

  it('takes neither name as a call nor as an act', async () => {
    const { f } = await start();
    const x = randomUUID();
    f.host.artifact(x);
    const a = await openRemote(f, org.a1, org.A, { capabilities: READ });
    const id = 'c-fetch';
    await a.channel.send({ t: 'call', id, name: 'artifacts.fetch', input: { url: url(x), method: 'GET' } });
    expect((await waitFor(a, (m) => m.t === 'result' && m.id === id, 'the call')).error).toMatchObject({ code: 'not-offered' });
    expect(await act(a, a.device.action({ machine: f.ref, action: 'documents.open', args: { artifactId: x, mode: 'edit' } }))).toBe('not-offered');
  });
});

describe('the http read open', () => {
  it('admits an open naming no `op` at `view` on its artifact, and refuses `grade`, fetching nothing, to a member who views none of its sessions', async () => {
    const { f, store } = await start();
    session(f, 'app-1', ['@machine'], shared(org.B));
    session(f, 'app-2', ['@machine']);
    const [seen, hidden] = [randomUUID(), randomUUID()];
    f.host.artifact(seen, ['app-1']);
    f.host.artifact(hidden, ['app-2']);
    store.put(seen, 'index.html', PAGE);
    store.put(hidden, 'index.html', PAGE);
    const b = await openRemote(f, org.b1, org.B, { capabilities: READ });
    expect((await openHttp(b, { url: url(seen) })).answer).toMatchObject({ t: 'streamOpened', http: { status: 200 } });
    expect((await openHttp(b, { url: url(hidden) })).answer).toMatchObject({ t: 'streamRefused', reason: 'grade' });
    expect((await openHttp(b, { url: url(randomUUID()) })).answer).toMatchObject({ t: 'streamRefused', reason: 'grade' });
    const c = await openRemote(f, org.c1, org.C, { capabilities: READ });
    expect((await openHttp(c, { url: url(seen) })).answer).toMatchObject({ t: 'streamRefused', reason: 'grade' });
    expect(store.fetches()).toBe(1);
  });

  it('refuses `malformed` a URL that is not exactly the scheme’s shape, and any read open from a device that listed no `rl2.read-open`; the channel kept', async () => {
    const { f, store } = await start();
    const x = randomUUID();
    f.host.artifact(x);
    store.put(x, 'index.html', PAGE);
    const a = await openRemote(f, org.a1, org.A, { capabilities: READ });
    for (const bad of ['https://example.com/index.html', url(x, '../secret'), url(x, 'a//b'), `maws-artifact://not-a-uuid/live/index.html`, `maws-artifact://${x}/v1/index.html`])
      expect([bad, (await openHttp(a, { url: bad })).answer.reason]).toEqual([bad, 'malformed']);
    const old = await openRemote(f, org.a1, org.A);
    expect((await openHttp(old, { url: url(x) })).answer).toMatchObject({ t: 'streamRefused', reason: 'malformed' });
    expect(store.fetches()).toBe(0);
    expect(a.channel.closed || old.channel.closed).toBe(false);
  });

  it('answers a GET’s status and headers, then its body from offset 0 within the device’s credit, pulled no further than it, and closes `closed`', async () => {
    const { f, store } = await start();
    const x = randomUUID();
    f.host.artifact(x);
    const file = randomBytes(200 * 1024);
    store.put(x, 'data.bin', file);
    // What the endpoint pulled from the answer's body, through a reader that reads only when asked.
    let pulled = 0;
    const fetch = f.services.artifacts.fetch;
    f.services.artifacts.fetch = async (request) => {
      const answer = await fetch(request);
      const reader = answer.body!.getReader();
      const counted = new ReadableStream<Uint8Array>(
        {
          async pull(controller) {
            const next = await reader.read();
            if (next.done) return controller.close();
            pulled += next.value.byteLength;
            controller.enqueue(next.value);
          },
          cancel: (reason) => reader.cancel(reason),
        },
        { highWaterMark: 0 },
      );
      return { ...answer, body: counted };
    };
    const a = await openRemote(f, org.a1, org.A, { capabilities: READ });
    const credit = 16 * 1024;
    const { id, answer } = await openHttp(a, { url: url(x, 'data.bin') }, credit);
    expect(answer).toMatchObject({
      t: 'streamOpened',
      http: { status: 200, headers: { 'content-length': String(file.byteLength), 'content-type': 'application/octet-stream', 'x-content-type-options': 'nosniff', 'cache-control': 'no-store', 'accept-ranges': 'bytes' } },
    });
    await until(() => body(a, id).byteLength === credit || undefined, 'the credit spent');
    await sleep(60);
    // Paused while the credit is spent: nothing more sent, and at most one read past what was sent.
    expect(body(a, id).byteLength).toBe(credit);
    expect(closeOf(a, id)).toBeUndefined();
    expect(pulled).toBeLessThanOrEqual(credit + 64 * 1024);
    await a.channel.send({ t: 'streamCredit', id, bytes: 4 * 1024 * 1024 });
    await until(() => closeOf(a, id), 'the close');
    expect(closeOf(a, id)).toBe('closed');
    expect(body(a, id).equals(file)).toBe(true);
    expect(ofStream(a, id).at(-1)).toMatchObject({ t: 'streamClose', reason: 'closed' });
  });

  it('answers a range `206` with its part, and a HEAD with its headers alone, closed right after `streamOpened`', async () => {
    const { f, store } = await start();
    const x = randomUUID();
    f.host.artifact(x);
    store.put(x, 'data.txt', 'abcdefghijklmnopqrstuvwxyz');
    const a = await openRemote(f, org.a1, org.A, { capabilities: READ });
    const ranged = await openHttp(a, { url: url(x, 'data.txt'), range: 'bytes=2-5' });
    expect(ranged.answer).toMatchObject({ http: { status: 206, headers: { 'content-range': 'bytes 2-5/26', 'content-length': '4' } } });
    await until(() => closeOf(a, ranged.id), 'the close');
    expect([body(a, ranged.id).toString(), closeOf(a, ranged.id)]).toEqual(['cdef', 'closed']);
    const head = await openHttp(a, { url: url(x, 'data.txt'), method: 'HEAD' });
    expect(head.answer).toMatchObject({ http: { status: 200, headers: { 'content-length': '26' } } });
    await until(() => closeOf(a, head.id), 'the close');
    expect(ofStream(a, head.id).map((m) => m.t)).toEqual(['streamOpened', 'streamClose']);
    const past = await openHttp(a, { url: url(x, 'data.txt'), range: 'bytes=99-' });
    expect(past.answer).toMatchObject({ http: { status: 416, headers: { 'content-range': 'bytes */26' } } });
    await until(() => closeOf(a, past.id), 'the close');
    expect(ofStream(a, past.id).map((m) => m.t)).toEqual(['streamOpened', 'streamClose']);
  });

  it('passes the artifact endpoint’s 404 through, closed right after `streamOpened`', async () => {
    const { f, store } = await start();
    const x = randomUUID();
    f.host.artifact(x);
    store.put(x, 'index.html', PAGE);
    const a = await openRemote(f, org.a1, org.A, { capabilities: READ });
    const { id, answer } = await openHttp(a, { url: url(x, 'missing.png') });
    expect(answer).toMatchObject({ t: 'streamOpened', http: { status: 404 } });
    await until(() => closeOf(a, id), 'the close');
    expect(ofStream(a, id).map((m) => m.t)).toEqual(['streamOpened', 'streamClose']);
    expect(closeOf(a, id)).toBe('closed');
  });

  it('closes `closed` a body that spends the device’s credit exactly, with no more credit given, the close behind the data', async () => {
    const { f, store } = await start();
    const x = randomUUID();
    f.host.artifact(x);
    const file = randomBytes(1024);
    store.put(x, 'data.bin', file);
    const a = await openRemote(f, org.a1, org.A, { capabilities: READ });
    const { id } = await openHttp(a, { url: url(x, 'data.bin') }, 1024);
    await until(() => closeOf(a, id), 'the close');
    expect(body(a, id).equals(file)).toBe(true);
    expect(ofStream(a, id).at(-1)).toMatchObject({ t: 'streamClose', reason: 'closed' });
  });

  it('sends a bridged html page larger than a chunk in order, every piece at the offset after the one before, under ample credit', async () => {
    const { f, store } = await start();
    const x = randomUUID();
    f.host.artifact(x);
    const page = `<!doctype html><html><head><title>t</title></head><body>${randomBytes(300 * 1024).toString('hex')}</body></html>`;
    store.put(x, 'index.html', page);
    const a = await openRemote(f, org.a1, org.A, { capabilities: READ });
    const { id, answer } = await openHttp(a, { url: url(x) }, 4 * 1024 * 1024);
    await until(() => closeOf(a, id), 'the close');
    const length = Number((answer.http as { headers: Record<string, string> }).headers['content-length']);
    expect(body(a, id).byteLength).toBe(length);
    expect(body(a, id).toString().endsWith(page.slice(-1024))).toBe(true);
  });

  it('queues no more of a buffer-backed html page than the device’s credit (one 2 MiB source chunk, 1 KiB of credit), the rest read on as credit comes', async () => {
    const services = fakeServices();
    try {
      const store = scratchArtifacts(services);
      const x = randomUUID();
      const page = `<!doctype html><html><head><title>t</title></head><body>${'x'.repeat(2 * 1024 * 1024)}</body></html>`;
      store.put(x, 'index.html', page);
      // The plane alone, over the scheme's own handler: its stream's queue is what the window would send next.
      const sent: Msg[] = [];
      let stream: Stream | null = null;
      const input = { url: url(x), method: 'GET' };
      const opening: ReadOpening = {
        channel: { closed: false, send: (m: Msg) => void sent.push(m) } as unknown as RemoteChannel,
        id: 'h1',
        credit: 1024,
        act: 'artifacts.fetch',
        input,
        binding: { member: 'm', device: 'd' },
        window: { ready: () => {} } as unknown as StreamWindow,
        over: () => {},
        cancelled: () => false,
        decide: async (publish) => ({ ok: true as const, value: publish({ input, stands: () => true }) }),
        install: (s) => void (stream = s),
        refuse: () => {},
        log: () => {},
      };
      await httpPlane((request) => services.artifacts.fetch(request), services.dispatch)(opening);
      await sleep(40);
      const opened = stream as unknown as Stream;
      expect(sent[0]).toMatchObject({ t: 'streamOpened', http: { status: 200 } });
      expect(opened.backlog).toBeLessThanOrEqual(1024);
      // What the window sends, credit given a chunk at a time: the page whole, each queue within the credit.
      const bytes: Buffer[] = [];
      for (let guard = 0; guard < 200 && !sent.some((m) => m.t === 'streamClose'); guard++) {
        for (let next = opened.next(); next !== null; next = opened.next()) {
          sent.push(next.message as Msg);
          if (next.message.t === 'streamData') bytes.push(Buffer.from(next.message.data, 'base64url'));
        }
        opened.credit(64 * 1024);
        await sleep(1);
        expect(opened.backlog).toBeLessThanOrEqual(64 * 1024);
      }
      expect(Buffer.concat(bytes).toString()).toContain(page.slice(-64));
      expect(sent.at(-1)).toMatchObject({ t: 'streamClose', reason: 'closed' });
    } finally {
      services.cleanup();
    }
  });

  it('closes the stream `malformed` on the device’s data, and keeps the channel', async () => {
    const { f, store } = await start();
    const x = randomUUID();
    f.host.artifact(x);
    store.put(x, 'data.bin', randomBytes(64 * 1024));
    const a = await openRemote(f, org.a1, org.A, { capabilities: READ });
    const { id } = await openHttp(a, { url: url(x, 'data.bin') }, 1024);
    await a.channel.send({ t: 'streamData', id, offset: 0, data: Buffer.from('nope').toString('base64url') });
    await until(() => closeOf(a, id), 'the close');
    expect(closeOf(a, id)).toBe('malformed');
    expect(a.channel.closed).toBe(false);
  });
});

describe('an http read of a dashboard’s query snapshot (E3’s asset hold)', () => {
  const snapshot = () => `assets/query-${randomUUID()}.json`;
  /** A store whose retention sweeps every unheld query snapshot between the lookup and the open, and the host's holds. */
  async function startHeld() {
    const services = fakeServices();
    const f = await startEndpoint(org, started, { services });
    const holds = fakeAssetHolds(f.services);
    const store = scratchArtifacts(f.services, { sweep: (artifactId, path) => /^assets\/query-/.test(path) && !holds.held(artifactId, path) });
    return { f, holds, store };
  }

  it('holds the snapshot across the read, so a sweep inside the window still serves its bytes, and releases the hold once the body is done', async () => {
    const { f, holds, store } = await startHeld();
    const x = randomUUID();
    f.host.artifact(x);
    const ref = snapshot();
    store.put(x, ref, '{"rows":[[1,2]]}');
    const a = await openRemote(f, org.a1, org.A, { capabilities: READ });
    const { id, answer } = await openHttp(a, { url: url(x, ref) });
    expect(answer).toMatchObject({ t: 'streamOpened', http: { status: 200 } });
    await until(() => closeOf(a, id), 'the close');
    expect(body(a, id).toString()).toBe('{"rows":[[1,2]]}');
    await until(() => holds.released() === 1 || undefined, 'the release');
    expect([holds.taken(), holds.released()]).toEqual([1, 1]);
  });

  it('releases the hold once on a close mid-body, and on a refusal at the publication', async () => {
    const { f, holds, store } = await startHeld();
    const engine = session(f, 'app-1', ['@machine'], shared(org.B));
    const x = randomUUID();
    f.host.artifact(x, ['app-1']);
    const big = snapshot();
    store.put(x, big, randomBytes(200 * 1024));
    const a = await openRemote(f, org.a1, org.A, { capabilities: READ });
    const mid = await openHttp(a, { url: url(x, big) }, 1024);
    await until(() => body(a, mid.id).byteLength === 1024 || undefined, 'the first chunk');
    expect(holds.taken() - holds.released()).toBe(1);
    await a.channel.send({ t: 'streamClose', id: mid.id, reason: 'closed' });
    await until(() => holds.released() === 1 || undefined, 'the release at the close');

    const small = snapshot();
    store.put(x, small, '{}');
    const fetch = f.services.artifacts.fetch;
    f.services.artifacts.fetch = async (request) => {
      const answer = await fetch(request);
      f.records.set({ lane: 'B', session: engine, owners: ['@machine'], access: 'private' }, 'app-1');
      return answer;
    };
    const b = await openRemote(f, org.b1, org.B, { capabilities: READ });
    expect((await openHttp(b, { url: url(x, small) })).answer).toMatchObject({ t: 'streamRefused', reason: 'grade' });
    await until(() => holds.released() === 2 || undefined, 'the release at the refusal');
    await sleep(30);
    expect([holds.taken(), holds.released()]).toEqual([2, 2]);
  });

  it('reads on without a hold the host can’t take, and logs it; anything but a query snapshot is read with none', async () => {
    const services = fakeServices();
    const f = await startEndpoint(org, started, { services });
    const holds = fakeAssetHolds(f.services);
    const store = scratchArtifacts(f.services);
    const x = randomUUID();
    f.host.artifact(x);
    const ref = snapshot();
    store.put(x, ref, '{}');
    store.put(x, 'index.html', PAGE);
    store.put(x, 'assets/logo.png', randomBytes(64));
    const a = await openRemote(f, org.a1, org.A, { capabilities: READ });
    for (const path of ['index.html', 'assets/logo.png']) expect((await openHttp(a, { url: url(x, path) })).answer).toMatchObject({ http: { status: 200 } });
    expect(holds.taken()).toBe(0);
    holds.refuse = true;
    const { id, answer } = await openHttp(a, { url: url(x, ref) });
    expect(answer).toMatchObject({ http: { status: 200 } });
    await until(() => closeOf(a, id), 'the close');
    expect(body(a, id).toString()).toBe('{}');
    expect(f.services.lines.some((line) => line.includes('held'))).toBe(true);
  });
});

describe('the document read open’s grades', () => {
  const who = (member: string, device: string) => ({ member, device, clientClass: 'native-mac' as const });
  const decide = (f: Fixture, member: string, device: string, input: Record<string, unknown>) => f.endpoint.authorizer.authorize({ kind: 'stream', name: 'documents.open', input }, who(member, device), Date.now());

  it('admits an `edit` open at `manage` and a `view` open at `view`, and refuses `grade` an `edit` by a `view` holder', async () => {
    const { f } = await start();
    session(f, 'app-1', ['@machine'], shared(org.B));
    session(f, 'app-b', [org.B]);
    const [viewed, owned] = [randomUUID(), randomUUID()];
    f.host.artifact(viewed, ['app-1']);
    f.host.artifact(owned, ['app-b']);
    expect(await decide(f, org.A, 'a1', { artifactId: viewed, mode: 'edit' })).toMatchObject({ ok: true, artifact: { artifactId: viewed } });
    expect(await decide(f, org.B, 'b1', { artifactId: owned, mode: 'edit' })).toMatchObject({ ok: true, artifact: { artifactId: owned } });
    expect(await decide(f, org.B, 'b1', { artifactId: viewed, mode: 'view' })).toMatchObject({ ok: true, artifact: { artifactId: viewed } });
    expect(await decide(f, org.B, 'b1', { artifactId: viewed, mode: 'edit' })).toEqual({ ok: false, reason: 'grade' });
    expect(await decide(f, org.B, 'b1', { artifactId: viewed, mode: 'edit', extra: 1 })).toEqual({ ok: false, reason: 'malformed' });
    const b = await openRemote(f, org.b1, org.B, { capabilities: READ });
    expect(await openDocument(b, { artifactId: viewed, mode: 'edit' })).toMatchObject({ t: 'streamRefused', reason: 'grade' });
    const c = await openRemote(f, org.c1, org.C, { capabilities: READ });
    expect(await openDocument(c, { artifactId: viewed, mode: 'view' })).toMatchObject({ t: 'streamRefused', reason: 'grade' });
  });

  it('refuses an `edit` open `read-only` while the machine is read-only, the word passing the device’s validator, and admits a `view` one', async () => {
    const { f } = await start();
    const x = randomUUID();
    f.host.artifact(x);
    f.endpoint.policy.fromSminos({ read_only: true, ceiling: 'plan' });
    const a = await openRemote(f, org.a1, org.A, { capabilities: READ });
    expect(await openDocument(a, { artifactId: x, mode: 'edit' })).toMatchObject({ t: 'streamRefused', reason: 'read-only' });
    expect(a.channel.closed).toBe(false);
    expect(await decide(f, org.A, 'a1', { artifactId: x, mode: 'view' })).toMatchObject({ ok: true });
  });
});

describe('the document stream', () => {
  async function startDocuments() {
    const services = fakeServices();
    const docs = fakeDocuments(services);
    const f = await startEndpoint(org, started, { services });
    return { f, docs };
  }
  type Doc = { artifactId: string; mode: 'edit' | 'view' };
  /** A `document` read open and the endpoint's answer. */
  async function openDoc(r: Remote, document: Doc, credit = 1024 * 1024): Promise<{ id: string; answer: Msg }> {
    const id = id16();
    const from = r.inbox.length;
    await r.channel.send({ t: 'streamOpen', id, kind: 'document', credit, document });
    return { id, answer: await waitFor(r, (m) => m.id === id && (m.t === 'streamOpened' || m.t === 'streamRefused'), `the answer to stream ${id}`, from) };
  }
  /** Frames as the stream carries them: each prefixed by its u32be length. */
  const prefixed = (...frames: Uint8Array[]) =>
    Buffer.concat(
      frames.flatMap((frame) => {
        const length = Buffer.alloc(4);
        length.writeUInt32BE(frame.byteLength);
        return [length, Buffer.from(frame)];
      }),
    );
  /** The whole frames the device read on a stream so far. */
  function framesOf(r: Remote, id: string): Buffer[] {
    const bytes = body(r, id);
    const frames: Buffer[] = [];
    for (let at = 0; at + 4 <= bytes.byteLength; ) {
      const length = bytes.readUInt32BE(at);
      if (at + 4 + length > bytes.byteLength) break;
      frames.push(bytes.subarray(at + 4, at + 4 + length));
      at += 4 + length;
    }
    return frames;
  }
  const sent = new Map<string, number>();
  /** The device's bytes on a stream, cut first at `cuts` (sizes), then in chunks of at most 64 KiB, at its running offset. */
  async function write(r: Remote, id: string, bytes: Buffer, cuts: number[] = []): Promise<void> {
    let at = 0;
    const sizes = [...cuts];
    while (at < bytes.byteLength) {
      const size = Math.min(sizes.shift() ?? 64 * 1024, bytes.byteLength - at);
      const offset = sent.get(id) ?? 0;
      await r.channel.send({ t: 'streamData', id, offset, data: bytes.subarray(at, at + size).toString('base64url') });
      sent.set(id, offset + size);
      at += size;
    }
  }
  const asBuffers = (frames: Uint8Array[]) => frames.map((frame) => Buffer.from(frame));
  const step1 = encodeFrame({ type: 'step1', sv: Uint8Array.of(0) });
  const awareness = encodeFrame({ type: 'awareness', update: Uint8Array.of(1, 2, 3) });
  const update = (size: number) => encodeFrame({ type: 'update', update: randomBytes(size) });
  const step2 = (size: number) => encodeFrame({ type: 'step2', update: randomBytes(size), revision: 4 });

  it('opens an endpoint document channel as the human and answers `streamOpened` with its credit alone', async () => {
    const { f, docs } = await startDocuments();
    const x = randomUUID();
    f.host.artifact(x);
    const a = await openRemote(f, org.a1, org.A, { capabilities: READ });
    const { id, answer } = await openDoc(a, { artifactId: x, mode: 'edit' });
    expect(answer).toEqual({ t: 'streamOpened', id, credit: STREAM_INPUT_CREDIT });
    const { channel, open } = docs.last();
    expect(channel).toBeGreaterThanOrEqual(2 ** 31);
    expect(channel).toBeLessThanOrEqual(0xffff_ffff);
    expect(open).toEqual({ t: 'documents.open', channel, artifactId: x, actor: { kind: 'human' } });
    await openDoc(a, { artifactId: x, mode: 'view' });
    expect(docs.last().channel).not.toBe(channel);
  });

  it('relays the document frames both ways, each prefixed by its u32be length, across chunk boundaries; the stream’s close closes the channel', async () => {
    const { f, docs } = await startDocuments();
    const x = randomUUID();
    f.host.artifact(x);
    const a = await openRemote(f, org.a1, org.A, { capabilities: READ });
    const { id } = await openDoc(a, { artifactId: x, mode: 'edit' });
    const { channel } = docs.last();
    // The host's: a step 2 larger than a chunk, then an ack.
    const host = [step2(100 * 1024), encodeFrame({ type: 'ack', frames: 1, revision: 4 })];
    for (const frame of host) docs.send(channel, frame);
    await until(() => framesOf(a, id).length === 2 || undefined, 'the host’s frames');
    expect(framesOf(a, id)).toEqual(asBuffers(host));
    expect(ofStream(a, id).filter((m) => m.t === 'streamData').length).toBeGreaterThan(1);
    // The device's: cut inside a length prefix, inside a frame, and across frames.
    const device = [step1, update(70 * 1024), awareness];
    await write(a, id, prefixed(...device), [2, 3, 1, 30_000]);
    await until(() => docs.channels.get(channel)!.received.length === 3 || undefined, 'the device’s frames');
    expect(asBuffers(docs.channels.get(channel)!.received)).toEqual(asBuffers(device));
    expect(docs.channels.get(channel)!.ended).toBeNull();
    await a.channel.send({ t: 'streamClose', id, reason: 'closed' });
    await until(() => docs.channels.get(channel)!.ended, 'the channel closed');
    expect(docs.channels.get(channel)!.ended).toBe('endpoint');
  });

  it('in a `view` open forwards only the device’s step 1 and awareness, dropping its update and step 2 (counted, logged), and closes `read-only` past 64 KiB dropped', async () => {
    const { f, docs } = await startDocuments();
    session(f, 'app-1', ['@machine'], shared(org.B));
    const x = randomUUID();
    f.host.artifact(x, ['app-1']);
    const b = await openRemote(f, org.b1, org.B, { capabilities: READ });
    const { id, answer } = await openDoc(b, { artifactId: x, mode: 'view' });
    expect(answer).toMatchObject({ t: 'streamOpened' });
    const { channel } = docs.last();
    await write(b, id, prefixed(step1, update(100), awareness, step2(100)));
    await until(() => docs.channels.get(channel)!.received.length === 2 || undefined, 'the forwarded frames');
    await sleep(30);
    expect(asBuffers(docs.channels.get(channel)!.received)).toEqual(asBuffers([step1, awareness]));
    expect(f.services.lines.some((line) => /dropped/.test(line))).toBe(true);
    expect(closeOf(b, id)).toBeUndefined();
    await write(b, id, prefixed(update(40 * 1024), update(40 * 1024)));
    await until(() => closeOf(b, id), 'the close');
    expect(closeOf(b, id)).toBe('read-only');
    expect(docs.channels.get(channel)!.received).toHaveLength(2);
    expect(docs.channels.get(channel)!.ended).toBe('endpoint');
    expect(b.channel.closed).toBe(false);
  });

  it('closes an open stream `removed` at the record change that withdraws the member’s share (no `caps` refresh), the channel with it and nothing it held sent', async () => {
    const { f, docs } = await startDocuments();
    const engine = session(f, 'app-1', ['@machine'], shared(org.B));
    const x = randomUUID();
    f.host.artifact(x, ['app-1']);
    const b = await openRemote(f, org.b1, org.B, { capabilities: READ });
    const { id } = await openDoc(b, { artifactId: x, mode: 'view' }, 16);
    const { channel } = docs.last();
    docs.send(channel, step2(1024));
    await until(() => body(b, id).byteLength === 16 || undefined, 'the credit spent');
    const caps = b.inbox.filter((m) => m.t === 'caps').length;
    f.records.set({ lane: 'B', session: engine, owners: ['@machine'], access: 'private' }, 'app-1');
    await until(() => closeOf(b, id), 'the close');
    expect(closeOf(b, id)).toBe('removed');
    expect(b.inbox.filter((m) => m.t === 'caps')).toHaveLength(caps);
    expect(docs.channels.get(channel)!.ended).toBe('endpoint');
    await b.channel.send({ t: 'streamCredit', id, bytes: 1024 * 1024 });
    await sleep(40);
    expect(body(b, id).byteLength).toBe(16);
  });

  it('asks the decision before each forward either way: a withdrawal no trigger reported still sends nothing, and the stream closes `removed`', async () => {
    const { f, docs } = await startDocuments();
    const engine = session(f, 'app-1', ['@machine'], shared(org.B));
    const x = randomUUID();
    f.host.artifact(x, ['app-1']);
    const b = await openRemote(f, org.b1, org.B, { capabilities: READ });
    const { id } = await openDoc(b, { artifactId: x, mode: 'view' });
    const { channel } = docs.last();
    f.endpoint.streams.accessMoved = () => {}; // the record change's trigger, missed
    f.records.set({ lane: 'B', session: engine, owners: ['@machine'], access: 'private' }, 'app-1');
    docs.send(channel, step2(100));
    await write(b, id, prefixed(step1));
    await until(() => closeOf(b, id), 'the close');
    expect(closeOf(b, id)).toBe('removed');
    expect(body(b, id).byteLength).toBe(0);
    expect(docs.channels.get(channel)!.received).toHaveLength(0);
    expect(docs.channels.get(channel)!.ended).toBe('endpoint');
  });

  it('refuses an `edit` open `read-only` while the machine’s store is read-only (a newer build wrote it), opening no channel, and admits a `view` one', async () => {
    const { f, docs } = await startDocuments();
    const x = randomUUID();
    f.host.artifact(x);
    const dispatch = f.services.dispatch;
    let status = 'readOnly';
    f.services.dispatch = async (owner, name, input, client) =>
      owner === 'engine-host' && name === 'artifacts.status' ? { t: 'res', id: '0', ok: true, value: { status, reason: 'a newer app wrote the store' } } : dispatch(owner, name, input, client);
    const a = await openRemote(f, org.a1, org.A, { capabilities: READ });
    expect((await openDoc(a, { artifactId: x, mode: 'edit' })).answer).toMatchObject({ t: 'streamRefused', reason: 'read-only' });
    expect(docs.channels.size).toBe(0);
    expect((await openDoc(a, { artifactId: x, mode: 'view' })).answer).toMatchObject({ t: 'streamOpened' });
    status = 'ok';
    expect((await openDoc(a, { artifactId: x, mode: 'edit' })).answer).toMatchObject({ t: 'streamOpened' });
    expect(a.channel.closed).toBe(false);
  });

  it('opens no channel when the share is withdrawn while the open is read: the decision is asked again in the step the channel would open', async () => {
    const { f, docs } = await startDocuments();
    const engine = session(f, 'app-1', ['@machine'], shared(org.B));
    const x = randomUUID();
    f.host.artifact(x, ['app-1']);
    const dispatch = f.services.dispatch;
    f.services.dispatch = async (owner, name, input, client) => {
      const answer = await dispatch(owner, name, input, client);
      if (name === 'artifacts.get') f.records.set({ lane: 'B', session: engine, owners: ['@machine'], access: 'private' }, 'app-1');
      return answer;
    };
    const b = await openRemote(f, org.b1, org.B, { capabilities: READ });
    const { id, answer } = await openDoc(b, { artifactId: x, mode: 'view' });
    expect(answer).toMatchObject({ t: 'streamRefused', reason: 'grade' });
    await sleep(30);
    expect(ofStream(b, id).map((m) => m.t)).toEqual(['streamRefused']);
    expect(docs.channels.size).toBe(0);
  });

  it('closes the stream with the channel’s own word when the host ends it (`documents.onClosed {host}`), after the frames before it', async () => {
    const { f, docs } = await startDocuments();
    const x = randomUUID();
    f.host.artifact(x);
    const a = await openRemote(f, org.a1, org.A, { capabilities: READ });
    const { id } = await openDoc(a, { artifactId: x, mode: 'edit' });
    const { channel } = docs.last();
    const ack = encodeFrame({ type: 'ack', frames: 2, revision: 7 });
    docs.send(channel, ack);
    docs.end(channel, 'host');
    await until(() => closeOf(a, id), 'the close');
    expect(closeOf(a, id)).toBe('host');
    expect(framesOf(a, id)).toEqual(asBuffers([ack]));
    expect(ofStream(a, id).at(-1)).toMatchObject({ t: 'streamClose', reason: 'host' });
    expect(a.channel.closed).toBe(false);
  });

  it('sends the host’s frames within the device’s credit, and holds the device’s unrefunded while a re-check holds the stream, past the endpoint’s credit `malformed`', async () => {
    const { f, docs } = await startDocuments();
    const x = randomUUID();
    f.host.artifact(x);
    const a = await openRemote(f, org.a1, org.A, { capabilities: READ });
    // The device's credit: 1000 bytes, then what it refunds.
    const { id } = await openDoc(a, { artifactId: x, mode: 'edit' }, 1000);
    const { channel } = docs.last();
    const big = step2(3000);
    docs.send(channel, big);
    await until(() => body(a, id).byteLength === 1000 || undefined, 'the credit spent');
    await sleep(40);
    expect(body(a, id).byteLength).toBe(1000);
    await a.channel.send({ t: 'streamCredit', id, bytes: 1024 * 1024 });
    await until(() => framesOf(a, id).length === 1 || undefined, 'the rest');
    expect(framesOf(a, id)).toEqual(asBuffers([big]));

    // The endpoint's: what the device sends while a re-check holds the stream waits, unrefunded.
    const authorizer = f.endpoint.authorizer;
    const authorize = authorizer.authorize.bind(authorizer);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    authorizer.authorize = async (...request) => (await gate, authorize(...request));
    f.endpoint.streams.recheck();
    const frame = update(STREAM_INPUT_CREDIT - 100);
    const bytes = prefixed(frame);
    const credits = () => ofStream(a, id).filter((m) => m.t === 'streamCredit').length;
    const before = credits();
    await write(a, id, bytes.subarray(0, STREAM_INPUT_CREDIT));
    await sleep(40);
    expect(credits()).toBe(before);
    expect(docs.channels.get(channel)!.received).toHaveLength(0);
    release();
    await until(() => credits() > before || undefined, 'the refund');
    await write(a, id, bytes.subarray(STREAM_INPUT_CREDIT));
    await until(() => docs.channels.get(channel)!.received.length === 1 || undefined, 'the frame');
    expect(asBuffers(docs.channels.get(channel)!.received)).toEqual(asBuffers([frame]));

    // Past the endpoint's credit while held: `malformed`.
    let again!: () => void;
    const held = new Promise<void>((resolve) => (again = resolve));
    authorizer.authorize = async (...request) => (await held, authorize(...request));
    f.endpoint.streams.recheck();
    await write(a, id, Buffer.alloc(STREAM_INPUT_CREDIT + 1));
    await until(() => closeOf(a, id), 'the close');
    expect(closeOf(a, id)).toBe('malformed');
    again();
    expect(docs.channels.get(channel)!.ended).toBe('endpoint');
  });

  it('carries a host frame of exactly the largest size whole, under ample credit, never `behind`', async () => {
    const { f, docs } = await startDocuments();
    const x = randomUUID();
    f.host.artifact(x);
    const a = await openRemote(f, org.a1, org.A, { capabilities: READ });
    const { id } = await openDoc(a, { artifactId: x, mode: 'edit' }, 4 * 1024 * 1024);
    const largest = randomBytes(8 * 1024 * 1024);
    largest[0] = 0;
    docs.send(docs.last().channel, largest);
    let granted = 4 * 1024 * 1024;
    await until(
      () => {
        if (closeOf(a, id) !== undefined) return true;
        const got = ofStream(a, id).filter((m) => m.t === 'streamData').reduce((n, m) => n + Buffer.from(m.data as string, 'base64url').byteLength, 0);
        if (got === largest.byteLength + 4) return true;
        if (got === granted) {
          granted += 4 * 1024 * 1024;
          void a.channel.send({ t: 'streamCredit', id, bytes: 4 * 1024 * 1024 });
        }
        return undefined;
      },
      'the frame',
      20_000,
    );
    expect(closeOf(a, id)).toBeUndefined();
    expect(framesOf(a, id)).toHaveLength(1);
    expect(framesOf(a, id)[0].equals(largest)).toBe(true);
  });

  it('carries a host frame past the 8 MiB high-water mark (a 20 MiB first sync, within the host’s 64 MiB) and the frames after it, never `behind`; frames held past 8 MiB, none oversized, close `behind`', async () => {
    const { f, docs } = await startDocuments();
    const x = randomUUID();
    f.host.artifact(x);
    const a = await openRemote(f, org.a1, org.A, { capabilities: READ });
    const { id } = await openDoc(a, { artifactId: x, mode: 'edit' }, 4 * 1024 * 1024);
    const first = randomBytes(20 * 1024 * 1024);
    first[0] = 0;
    const ack = encodeFrame({ type: 'ack', frames: 1, revision: 9 });
    docs.send(docs.last().channel, first);
    docs.send(docs.last().channel, ack);
    let granted = 4 * 1024 * 1024;
    const want = first.byteLength + 4 + ack.byteLength + 4;
    await until(
      () => {
        if (closeOf(a, id) !== undefined) return true;
        const got = ofStream(a, id).filter((m) => m.t === 'streamData').reduce((n, m) => n + Buffer.from(m.data as string, 'base64url').byteLength, 0);
        if (got === want) return true;
        if (got === granted) {
          granted += 4 * 1024 * 1024;
          void a.channel.send({ t: 'streamCredit', id, bytes: 4 * 1024 * 1024 });
        }
        return undefined;
      },
      'the frames',
      30_000,
    );
    expect(closeOf(a, id)).toBeUndefined();
    expect(framesOf(a, id).map((frame) => frame.byteLength)).toEqual([first.byteLength, ack.byteLength]);

    // The threshold is the frames the stream holds, each whole: a device that takes nothing is closed past 8 MiB of them.
    const slow = await openDoc(a, { artifactId: x, mode: 'edit' }, 1024);
    const mebibyte = randomBytes(1024 * 1024);
    mebibyte[0] = 0;
    for (let i = 0; i < 8; i++) docs.send(docs.last().channel, mebibyte);
    await sleep(30);
    expect(closeOf(a, slow.id)).toBeUndefined();
    docs.send(docs.last().channel, mebibyte);
    await until(() => closeOf(a, slow.id), 'the close');
    expect(closeOf(a, slow.id)).toBe('behind');
  });

  it('holds a link’s retained document bytes within 64 MiB: a stream whose next frame finds the rest of the link past it closes `behind`, outbound or inbound, and a closed stream gives its bytes back', async () => {
    const { f, docs } = await startDocuments();
    const x = randomUUID();
    f.host.artifact(x);
    const a = await openRemote(f, org.a1, org.A, { capabilities: READ });
    const nine = randomBytes(9 * 1024 * 1024);
    nine[0] = 0;
    // Ten streams whose device takes nothing, each sent a 9 MiB first sync at once.
    const opened: Array<{ id: string; channel: number }> = [];
    for (let i = 0; i < 10; i++) {
      const { id } = await openDoc(a, { artifactId: x, mode: 'edit' }, 1024);
      opened.push({ id, channel: docs.last().channel });
    }
    for (const { channel } of opened) docs.send(channel, nine);
    await until(() => opened.filter(({ id }) => closeOf(a, id) !== undefined).length === 2 || undefined, 'the two past the budget');
    await sleep(30);
    expect(opened.map(({ id }) => closeOf(a, id) ?? 'open')).toEqual([...Array(8).fill('open'), 'behind', 'behind']);
    // Inbound counts too: a stream that holds nothing, whose device begins a 1 MiB frame, finds the link past the budget.
    const inbound = await openDoc(a, { artifactId: x, mode: 'edit' });
    const begun = Buffer.concat([Buffer.from([0, 0x10, 0, 0]), randomBytes(64 * 1024)]);
    await write(a, inbound.id, begun);
    await until(() => closeOf(a, inbound.id), 'the inbound close');
    expect(closeOf(a, inbound.id)).toBe('behind');
    // A stream closed gives its bytes back: the next one's first sync is taken.
    await a.channel.send({ t: 'streamClose', id: opened[0].id, reason: 'closed' });
    await sleep(30);
    const next = await openDoc(a, { artifactId: x, mode: 'edit' }, 1024);
    docs.send(docs.last().channel, nine);
    await sleep(60);
    expect(closeOf(a, next.id)).toBeUndefined();
  });

  it('opens a 60 MiB document on a link that is otherwise busy (other streams holding 27 MiB): its first sync and the frames after it go, never looping `behind`', async () => {
    const { f, docs } = await startDocuments();
    const x = randomUUID();
    f.host.artifact(x);
    const a = await openRemote(f, org.a1, org.A, { capabilities: READ });
    const nine = randomBytes(9 * 1024 * 1024);
    nine[0] = 0;
    const busy: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { id } = await openDoc(a, { artifactId: x, mode: 'edit' }, 1024);
      busy.push(id);
      docs.send(docs.last().channel, nine);
    }
    const { id } = await openDoc(a, { artifactId: x, mode: 'edit' }, 4 * 1024 * 1024);
    const big = randomBytes(60 * 1024 * 1024);
    big[0] = 0;
    const channel = docs.last().channel;
    docs.send(channel, big);
    const ack = encodeFrame({ type: 'ack', frames: 1, revision: 3 });
    docs.send(channel, ack);
    const got = () => ofStream(a, id).filter((m) => m.t === 'streamData').reduce((n, m) => n + Buffer.from(m.data as string, 'base64url').byteLength, 0);
    await until(() => got() === 4 * 1024 * 1024 || closeOf(a, id) !== undefined || undefined, 'the first credit’s worth');
    for (let more = 0; more < 4 && closeOf(a, id) === undefined; more++) {
      await a.channel.send({ t: 'streamCredit', id, bytes: 4 * 1024 * 1024 });
      await until(() => got() === (more + 2) * 4 * 1024 * 1024 || closeOf(a, id) !== undefined || undefined, 'more of it', 10_000);
      docs.send(channel, awareness);
    }
    expect(closeOf(a, id)).toBeUndefined();
    expect(busy.map((other) => closeOf(a, other) ?? 'open')).toEqual(['open', 'open', 'open']);
  });

  it('counts a frame against the link budget at its whole size until its last byte goes: tails a device leaves unread still hold their frames', async () => {
    const { f, docs } = await startDocuments();
    const x = randomUUID();
    f.host.artifact(x);
    const a = await openRemote(f, org.a1, org.A, { capabilities: READ });
    const got = (id: string) => ofStream(a, id).filter((m) => m.t === 'streamData').reduce((n, m) => n + Buffer.from(m.data as string, 'base64url').byteLength, 0);
    // A 40 MiB frame taken but for its last KiB: the whole frame is still held.
    const forty = randomBytes(40 * 1024 * 1024);
    forty[0] = 0;
    const tail = await openDoc(a, { artifactId: x, mode: 'edit' }, 4 * 1024 * 1024);
    docs.send(docs.last().channel, forty);
    const leave = forty.byteLength + 4 - 1024;
    for (let taken = 4 * 1024 * 1024; taken < leave; taken += 4 * 1024 * 1024) {
      await until(() => got(tail.id) === taken || undefined, 'the credit taken', 10_000);
      await a.channel.send({ t: 'streamCredit', id: tail.id, bytes: Math.min(4 * 1024 * 1024, leave - taken) });
    }
    await until(() => got(tail.id) === leave || undefined, 'all but the tail', 10_000);
    // A 30 MiB frame on a second stream is admitted (the rest of the link holds 40 MiB); a third stream's next frame then
    // finds 70 MiB held, past the budget.
    const thirty = randomBytes(30 * 1024 * 1024);
    thirty[0] = 0;
    const second = await openDoc(a, { artifactId: x, mode: 'edit' }, 1024);
    docs.send(docs.last().channel, thirty);
    const third = await openDoc(a, { artifactId: x, mode: 'edit' }, 1024);
    docs.send(docs.last().channel, encodeFrame({ type: 'ack', frames: 1, revision: 1 }));
    await until(() => closeOf(a, third.id), 'the close');
    expect(closeOf(a, third.id)).toBe('behind');
    expect([closeOf(a, tail.id), closeOf(a, second.id)]).toEqual([undefined, undefined]);
  });

  it('exempts one oversized frame wherever it sits in the queue: a step 1 still queued, then a 60 MiB step 2, then an ack, all go', async () => {
    const { f, docs } = await startDocuments();
    const x = randomUUID();
    f.host.artifact(x);
    const a = await openRemote(f, org.a1, org.A, { capabilities: READ });
    // One byte of credit: the step 1 stays queued at the head.
    const { id } = await openDoc(a, { artifactId: x, mode: 'edit' }, 1);
    const channel = docs.last().channel;
    docs.send(channel, step1);
    const big = randomBytes(60 * 1024 * 1024);
    big[0] = 0;
    docs.send(channel, big);
    const ack = encodeFrame({ type: 'ack', frames: 1, revision: 2 });
    docs.send(channel, ack);
    await sleep(60);
    expect(closeOf(a, id)).toBeUndefined();
    await a.channel.send({ t: 'streamCredit', id, bytes: 4 * 1024 * 1024 });
    await until(() => body(a, id).byteLength === 4 * 1024 * 1024 + 1 || closeOf(a, id) !== undefined || undefined, 'the credit taken');
    docs.send(channel, awareness);
    await sleep(60);
    expect(closeOf(a, id)).toBeUndefined();
    expect(framesOf(a, id)[0].equals(Buffer.from(step1))).toBe(true);
  });

  it('answers a malformed length prefix or frame from the device `malformed`, the channel closed and the device’s channel kept', async () => {
    const { f, docs } = await startDocuments();
    const x = randomUUID();
    f.host.artifact(x);
    const a = await openRemote(f, org.a1, org.A, { capabilities: READ });
    const zero = Buffer.alloc(4);
    const huge = Buffer.from([0xff, 0xff, 0xff, 0xff]);
    const garbled = Buffer.from([0, 0, 0, 3, 9, 9, 9]);
    for (const bad of [zero, huge, garbled]) {
      const { id } = await openDoc(a, { artifactId: x, mode: 'edit' });
      const { channel } = docs.last();
      await write(a, id, bad);
      await until(() => closeOf(a, id), 'the close');
      expect([bad.toString('hex'), closeOf(a, id)]).toEqual([bad.toString('hex'), 'malformed']);
      expect(docs.channels.get(channel)!.received).toHaveLength(0);
      expect(docs.channels.get(channel)!.ended).toBe('endpoint');
    }
    expect(a.channel.closed).toBe(false);
  });

  it('withholds the session an agent’s provisional frame names, its other fields as the host sent them', async () => {
    const { f, docs } = await startDocuments();
    const x = randomUUID();
    f.host.artifact(x);
    const a = await openRemote(f, org.a1, org.A, { capabilities: READ });
    const { id } = await openDoc(a, { artifactId: x, mode: 'edit' });
    const layer = { toolUseId: 'toolu_1', appSessionId: 'app-hidden', artifactId: x, kind: 'document', state: 'streaming', at: 1, name: 'Claude', color: 'var(--author-1)', ops: [] };
    docs.send(docs.last().channel, encodeFrame({ type: 'provisional', json: JSON.stringify(layer) }));
    await until(() => framesOf(a, id).length === 1 || undefined, 'the frame');
    const frame = decodeFrame(new Uint8Array(framesOf(a, id)[0]));
    expect(frame.type).toBe('provisional');
    expect(JSON.parse((frame as { json: string }).json)).toEqual({ ...layer, appSessionId: WITHHELD_SESSION });
  });

  it('answers `unavailable` while the machine’s engine host can take no document channel', async () => {
    const { f, docs } = await startDocuments();
    const x = randomUUID();
    f.host.artifact(x);
    docs.refuse = true;
    const a = await openRemote(f, org.a1, org.A, { capabilities: READ });
    expect((await openDoc(a, { artifactId: x, mode: 'edit' })).answer).toMatchObject({ t: 'streamRefused', reason: 'unavailable' });
    expect(docs.channels.size).toBe(0);
  });
});

describe('a read stream authorized again', () => {
  it('closes `removed` at the record change that withdraws the member’s last share (no `caps` refresh), and keeps an owner’s stream on it open', async () => {
    const { f, store } = await start();
    const engine = session(f, 'app-1', ['@machine'], shared(org.B));
    const x = randomUUID();
    f.host.artifact(x, ['app-1']);
    store.put(x, 'data.bin', randomBytes(64 * 1024));
    const a = await openRemote(f, org.a1, org.A, { capabilities: READ });
    const b = await openRemote(f, org.b1, org.B, { capabilities: READ });
    const mine = await openHttp(a, { url: url(x, 'data.bin') }, 1024);
    const theirs = await openHttp(b, { url: url(x, 'data.bin') }, 1024);
    expect(theirs.answer).toMatchObject({ t: 'streamOpened' });
    await until(() => body(b, theirs.id).byteLength === 1024 || undefined, 'the first chunk');
    const caps = b.inbox.filter((m) => m.t === 'caps').length;
    f.records.set({ lane: 'B', session: engine, owners: ['@machine'], access: 'private' }, 'app-1');
    await until(() => closeOf(b, theirs.id), 'the close');
    expect(closeOf(b, theirs.id)).toBe('removed');
    expect(b.inbox.filter((m) => m.t === 'caps')).toHaveLength(caps);
    // What it held goes with it: credit given after the close sends nothing.
    await b.channel.send({ t: 'streamCredit', id: theirs.id, bytes: 1024 * 1024 });
    await sleep(40);
    expect(body(b, theirs.id).byteLength).toBe(1024);
    expect(closeOf(a, mine.id)).toBeUndefined();
    expect((await openHttp(b, { url: url(x, 'data.bin') })).answer).toMatchObject({ t: 'streamRefused', reason: 'grade' });
  });

  it('opens nothing when the share is withdrawn while the page is fetched: the decision is asked again in the step it would publish, and refuses `grade`', async () => {
    const { f, store } = await start();
    const engine = session(f, 'app-1', ['@machine'], shared(org.B));
    const x = randomUUID();
    f.host.artifact(x, ['app-1']);
    store.put(x, 'index.html', PAGE);
    const fetch = f.services.artifacts.fetch;
    f.services.artifacts.fetch = async (request) => {
      const answer = await fetch(request);
      f.records.set({ lane: 'B', session: engine, owners: ['@machine'], access: 'private' }, 'app-1');
      return answer;
    };
    const b = await openRemote(f, org.b1, org.B, { capabilities: READ });
    const { id, answer } = await openHttp(b, { url: url(x) });
    expect(answer).toMatchObject({ t: 'streamRefused', reason: 'grade' });
    await sleep(30);
    expect(ofStream(b, id).map((m) => m.t)).toEqual(['streamRefused']);
  });

  it('sends no body on a decision that moved: a certificate change no trigger reported holds the next chunk until a current decision grants it', async () => {
    const { f } = await start();
    const x = randomUUID();
    f.host.artifact(x);
    const fed = fedBody();
    f.services.artifacts.fetch = async () => ({ status: 200, headers: { 'content-length': '2048' }, body: fed.body });
    const a = await openRemote(f, org.a1, org.A, { capabilities: READ });
    const { id } = await openHttp(a, { url: url(x, 'data.bin') });
    fed.feed(new Uint8Array(1024).fill(1));
    await until(() => body(a, id).byteLength === 1024 || undefined, 'the first chunk');
    // The triggers, missed: only the stream's own ask before it sends stands between the change and the bytes.
    f.endpoint.streams.recheck = () => {};
    f.endpoint.streams.accessMoved = () => {};
    const gate = gated(f);
    await certificatesChanged(f);
    fed.feed(new Uint8Array(1024).fill(2));
    fed.feed(null);
    await sleep(60);
    expect(body(a, id).byteLength).toBe(1024);
    expect(gate.streams()).toBeGreaterThan(0);
    gate.release();
    await until(() => closeOf(a, id), 'the close');
    expect([body(a, id).byteLength, closeOf(a, id)]).toEqual([2048, 'closed']);
  });

  it('holds every open stream at a certificate change under the same head and authorizes it again at once, as a `caps` refresh does', async () => {
    const { f } = await start();
    const x = randomUUID();
    f.host.artifact(x);
    const fed = fedBody();
    f.services.artifacts.fetch = async () => ({ status: 200, headers: {}, body: fed.body });
    const a = await openRemote(f, org.a1, org.A, { capabilities: READ });
    const { id } = await openHttp(a, { url: url(x, 'data.bin') });
    const gate = gated(f);
    await certificatesChanged(f);
    expect(gate.streams()).toBe(1);
    fed.feed(new Uint8Array(512));
    await sleep(40);
    expect(body(a, id).byteLength).toBe(0);
    gate.release();
    await until(() => body(a, id).byteLength === 512 || undefined, 'the chunk, once granted');
  });

  it('follows a relink: an open refused before the link is admitted after it, and the stream closes `removed` at the unlink', async () => {
    const { f, store } = await start();
    session(f, 'app-1', ['@machine'], shared(org.B));
    session(f, 'app-2', ['@machine']);
    const x = randomUUID();
    f.host.artifact(x, ['app-2']);
    store.put(x, 'data.bin', randomBytes(64 * 1024));
    const b = await openRemote(f, org.b1, org.B, { capabilities: READ });
    expect((await openHttp(b, { url: url(x, 'data.bin') })).answer).toMatchObject({ t: 'streamRefused', reason: 'grade' });
    f.host.link(x, 'app-1');
    const { id, answer } = await openHttp(b, { url: url(x, 'data.bin') }, 1024);
    expect(answer).toMatchObject({ t: 'streamOpened' });
    f.host.unlink(x, ['app-2']);
    await until(() => closeOf(b, id), 'the close');
    expect(closeOf(b, id)).toBe('removed');
  });
});

describe('a stream’s re-checks', () => {
  it('takes only the latest re-check’s verdict: a superseded check answering after a newer one began releases nothing, and the newer refusal ends the stream `removed`', async () => {
    const pty = new FakePtyHost();
    const { f } = await start({ pty });
    const ptyId = pty.spawn('app-1');
    const a = await openRemote(f, org.a1, org.A, { capabilities: READ });
    const attach = await a.device.stepUp(a.device.action({ machine: f.ref, action: 'pty.attach', args: { ptyId } }));
    const from = a.inbox.length;
    expect(await act(a, attach)).toBe('ok');
    await done(a, attach, from);
    const id = id16();
    await a.channel.send({ t: 'streamOpen', id, kind: 'pty', op: attach.opId, credit: 1024 * 1024, pty: { ptyId, from: 0, inputEpoch: id16(), inputFrom: 0 } });
    expect(await waitFor(a, (m) => m.id === id && m.t !== 'streamData', 'the pty open')).toMatchObject({ t: 'streamOpened' });
    // Each re-check's authorization answered when the suite says, with the real decision or the one it names.
    const authorizer = f.endpoint.authorizer;
    const authorize = authorizer.authorize.bind(authorizer);
    const pending: Array<(answer?: { ok: false; reason: 'grade' }) => void> = [];
    authorizer.authorize = (request, who, now) =>
      request.kind !== 'stream' ? authorize(request, who, now) : new Promise((resolve) => pending.push((answer) => resolve(answer ?? authorize(request, who, now))));
    const data = () => ofStream(a, id).filter((m) => m.t === 'streamData').length;
    f.endpoint.streams.recheck(); // A
    f.endpoint.streams.recheck(); // B, superseding A
    pending[1](); // B grants
    await sleep(30);
    f.endpoint.streams.recheck(); // C: the stream held again
    pending[0](); // A's late grant
    await sleep(30);
    const before = data();
    pty.emit(ptyId, 'secret output');
    await sleep(60);
    expect(data()).toBe(before);
    pending[2]({ ok: false, reason: 'grade' }); // C refuses
    await until(() => closeOf(a, id), 'the close');
    expect(closeOf(a, id)).toBe('removed');
    expect(data()).toBe(before);
  });

  it('decides again a grant whose decision no longer stands when it is heard, releasing nothing on it', async () => {
    const pty = new FakePtyHost();
    const { f } = await start({ pty });
    const ptyId = pty.spawn('app-1');
    const a = await openRemote(f, org.a1, org.A, { capabilities: READ });
    const attach = await a.device.stepUp(a.device.action({ machine: f.ref, action: 'pty.attach', args: { ptyId } }));
    const from = a.inbox.length;
    expect(await act(a, attach)).toBe('ok');
    await done(a, attach, from);
    const id = id16();
    await a.channel.send({ t: 'streamOpen', id, kind: 'pty', op: attach.opId, credit: 1024 * 1024, pty: { ptyId, from: 0, inputEpoch: id16(), inputFrom: 0 } });
    expect(await waitFor(a, (m) => m.id === id && m.t !== 'streamData', 'the pty open')).toMatchObject({ t: 'streamOpened' });
    const authorizer = f.endpoint.authorizer;
    const authorize = authorizer.authorize.bind(authorizer);
    const pending: Array<(answer: Awaited<ReturnType<typeof authorize>>) => void> = [];
    authorizer.authorize = (request, who, now) => (request.kind !== 'stream' ? authorize(request, who, now) : new Promise((resolve) => pending.push(resolve)));
    const data = () => ofStream(a, id).filter((m) => m.t === 'streamData').length;
    f.endpoint.streams.recheck();
    pending[0]({ ok: true, stands: () => false }); // granted on what has moved since
    await sleep(30);
    const before = data();
    pty.emit(ptyId, 'secret output');
    await sleep(60);
    expect(data()).toBe(before);
    expect(pending).toHaveLength(2);
    pending[1]({ ok: false, reason: 'grade' });
    await until(() => closeOf(a, id), 'the close');
    expect(closeOf(a, id)).toBe('removed');
  });
});

describe('the act open beside it', () => {
  it('still opens a pty stream under its act (`op`), and the validator refuses a pty open naming none and a `browser.screencast` open naming one, closing the channel `malformed`', async () => {
    const pty = new FakePtyHost();
    const { f } = await start({ pty });
    const ptyId = pty.spawn('app-1');
    const a = await openRemote(f, org.a1, org.A, { capabilities: READ });
    const attach = await a.device.stepUp(a.device.action({ machine: f.ref, action: 'pty.attach', args: { ptyId } }));
    const from = a.inbox.length;
    expect(await act(a, attach)).toBe('ok');
    await done(a, attach, from);
    const id = id16();
    await a.channel.send({ t: 'streamOpen', id, kind: 'pty', op: attach.opId, credit: 1024, pty: { ptyId, from: 0, inputEpoch: id16(), inputFrom: 0 } });
    expect(await waitFor(a, (m) => m.id === id && m.t !== 'streamData', 'the pty open')).toMatchObject({ t: 'streamOpened' });

    for (const open of [
      { t: 'streamOpen', id: id16(), kind: 'pty', credit: 1024, pty: { ptyId, from: 0, inputEpoch: id16(), inputFrom: 0 } },
      // P5 O17 M9a admits the kind as a read open (test/endpoint/browser-screencast.test.ts): never under an `op`
      { t: 'streamOpen', id: id16(), kind: 'browser.screencast', op: attach.opId, credit: 1024, browser: { appSessionId: 'app-1', epoch: 'e1', tabId: 't1' } },
    ]) {
      const r = await openRemote(f, org.a1, org.A, { capabilities: READ });
      const closed = closedChannel(r);
      await r.channel.send(open);
      expect(await closed).toBe('malformed');
    }
  });
});
