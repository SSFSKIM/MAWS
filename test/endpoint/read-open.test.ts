// The read open at the endpoint (P5 O7 M5b, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M5 "The read
// open" and "The `http` stream"; Interfaces §L's M5b rows, §N): a `streamOpen` that names no `op`, behind `rl2.read-open`,
// admitted by a stream row of the offer table through authorization's eight steps at the row's grade, on the `artifact`
// rule. The `http` plane over a real artifact endpoint (the scheme's own handler over a scratch store: its headers, its
// ranges, its not-found), the body pulled within the device's credit; the `document` opens' grades and `read-only` (their
// plane is the next task's); a read stream authorized again at the record change and the relink that withdraw it; and
// the act open beside it, unchanged, with `browser.screencast` reserved.
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { SessionRecord } from '../../src/endpoint/sources';
import { OFFERS, READ_OPENS } from '../../src/endpoint/offers';
import { scratchArtifacts } from './fake-services';
import { FakePtyHost } from './fake-pty-host';
import { act, done, makeOrg, openRemote, sleep, startEndpoint, stopAll, until, waitFor, type Fixture, type Msg, type Org, type Remote } from './sub-harness';

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

describe('the document read open’s grades (its plane is M5b’s next task)', () => {
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

describe('the act open beside it', () => {
  it('still opens a pty stream under its act (`op`), and the validator refuses a pty open naming none and any `browser.screencast` open, closing the channel `malformed`', async () => {
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
      { t: 'streamOpen', id: id16(), kind: 'browser.screencast', credit: 1024, browser: { appSessionId: 'app-1', epoch: 'e1', tabId: 't1' } },
    ]) {
      const r = await openRemote(f, org.a1, org.A, { capabilities: READ });
      const closed = closedChannel(r);
      await r.channel.send(open);
      expect(await closed).toBe('malformed');
    }
  });
});
