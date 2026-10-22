// The log plane (DC3.G2) on the local runtime: machines speaking DX2 and browsers speaking DX3 through the stand-in.
// The hub holds no org key, so machines' events here carry codes it never checks; a browser's `human` is sealed for
// real, since its position must pass DX1's check once the hub assigns it. The hub does check that every code is spelled
// canonically (DX1), so the machines' codes here are random 32 bytes in canonical base64url.
import { get as httpGet, request as httpRequest } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BROWSER_SET_LIMIT, BROWSER_SET_PARTS, type ProjectDown } from '../src/protocol/browser';
import { base64urlEncode } from '../src/protocol/base64url';
import { importOrgKey, newNonce, seal, verify } from '../src/protocol/codes';
import { isHubPosition, withoutPosition, type HumanDraft, type LogEvent } from '../src/protocol/log';
import { GENERATION_HEADER, type DownFrame } from '../src/protocol/machine';
import { FRAME_LIMIT, toWire } from '../src/protocol/parts';
import type { SessionMessage } from '../src/protocol/session';
import { BrowserClient, enroll, MachineClient, sorted } from './support/clients';
import { ADMIN, credentials, ORG, startLocalHub, type LocalHub } from './support/local';

let hub: LocalHub;
let memberId: string;
beforeAll(async () => {
  hub = await startLocalHub();
  memberId = ((await (await hub.fetchAs(ADMIN, '/api/me')).json()) as { member: { id: string } }).member.id;
});
afterAll(() => hub?.close());

let projects = 0;
/** A fresh project id per test, so the suites share one runtime without sharing a log. */
const newProject = () => `6f1c0a8e-3b2d-4c5e-9f70-${(++projects).toString(16).padStart(12, '0')}`;
const SESSION = 'e0ad139c-18bc-45bd-9489-be8653145f80';

let machines = 0;
async function machine(prefix: string): Promise<MachineClient> {
  const name = `${prefix}-${++machines}`;
  const client = new MachineClient(hub, name, await enroll(hub, ADMIN, name));
  await client.connect();
  return client;
}

/** A `say` written on `machine`, with a code the hub carries and never checks. */
function say(machine: MachineClient, project: string, seq: number, text = `say ${seq}`, session = SESSION): LogEvent {
  const event: LogEvent = {
    ts: `2026-10-15T08:00:${String(seq % 60).padStart(2, '0')}.000Z`,
    writer: `${machine.name}/${session}`,
    seq,
    kind: 'say',
    from: machine.name,
    to: '*',
    text,
    mac: { nonce: newNonce(), value: base64urlEncode(crypto.getRandomValues(new Uint8Array(32))) },
  };
  machine.store(project, event);
  return event;
}

const KEY = importOrgKey(new Uint8Array(32).fill(5));
async function human(project: string, member: string, text: string): Promise<HumanDraft & { mac: { nonce: string; value: string } }> {
  const draft: HumanDraft = { kind: 'human', from: 'human', member, to: '*', text, created: new Date().toISOString() };
  return seal(await KEY, 'log', project, draft);
}

/** The hub's view of a project, as a browser resuming at 0 sees it: `{writer: count}` and `{writer: last seq}`. */
async function hubCounts(project: string) {
  const browser = await BrowserClient.open(hub, ADMIN, project);
  browser.send({ t: 'resume', after: 0 });
  await browser.next((f) => f.t === 'caught-up', 'caught-up');
  const counts: Record<string, number> = {};
  const last: Record<string, number> = {};
  for (const { event } of browser.logged) {
    counts[event.writer] = (counts[event.writer] ?? 0) + 1;
    last[event.writer] = Math.max(last[event.writer] ?? 0, event.seq);
  }
  const offsets = browser.logged.map((e) => e.offset);
  browser.close();
  return { counts: sorted(counts), last: sorted(last), offsets };
}

const countsOf = (m: MachineClient, project: string) =>
  sorted(Object.fromEntries([...(m.log.get(project) ?? new Map())].map(([writer, feed]) => [writer, (feed as Map<number, LogEvent>).size])));

describe('registration and the project socket', () => {
  it("refuses a browser on a project the registry does not hold; a machine's hello registers it under its .smns name", async () => {
    const project = newProject();
    expect(await upgrade(`/api/projects/${project}/socket`, ADMIN)).toEqual({ status: 404, body: { error: 'unknown-project' } });

    const mini = await machine('reg');
    const have = await mini.sync(project, 'MAWS');
    expect(have).toEqual({ t: 'have', project, have: {}, archive: false });
    const listed = (await (await hub.fetchAs(ADMIN, '/api/projects')).json()) as { projects: Array<{ id: string; name: string; registered_by: string }> };
    expect(listed.projects.find((p) => p.id === project)).toMatchObject({ name: 'MAWS', registered_by: mini.name });
    const browser = await BrowserClient.open(hub, ADMIN, project);
    expect(browser.frames[0]).toEqual({ t: 'welcome', project, member: memberId, head: 0 });
    browser.close();
    await mini.close();
  });

  it("tells the designated archive machine so in `have`, and lets only it upload a legacy/ feed", async () => {
    const project = newProject();
    const archive = await machine('archive');
    const other = await machine('other');
    await archive.sync(project);
    await other.sync(project);
    const designated = await hub.fetchAs(ADMIN, `/api/projects/${project}/archive`, { method: 'PUT', body: { machine: archive.name } });
    expect(designated.status).toBe(200);
    expect(((await designated.json()) as { project: { archive_machine: string } }).project.archive_machine).toBe(archive.name);
    expect((await archive.sync(project)).archive).toBe(true);
    expect((await other.sync(project)).archive).toBe(false);

    const legacy = (seq: number): LogEvent => ({
      ts: '2025-01-01T00:00:00.000Z',
      writer: 'legacy/seat-7',
      seq,
      kind: 'say',
      from: 'old',
      to: '*',
      text: 'pre-.smns',
      mac: { nonce: newNonce(), value: base64urlEncode(new Uint8Array(32).fill(seq)) },
    });
    const from = other.frames.length;
    await other.postOk([{ t: 'events', project, events: [legacy(1)] }]);
    expect(await other.next((f) => f.t === 'refused', 'refused', from)).toMatchObject({ refusal: { reason: 'writer-not-yours', writer: 'legacy/seat-7' } });
    await archive.postOk([{ t: 'events', project, events: [legacy(1), legacy(2)] }]);
    expect((await hubCounts(project)).counts).toEqual({ 'legacy/seat-7': 2 });
    expect((await hub.fetchAs(ADMIN, `/api/projects/${project}/archive`, { method: 'PUT', body: { machine: 'no-such-machine' } })).status).toBe(409);
    await archive.close();
    await other.close();
  });
});

describe('sync', () => {
  it('two machines and a hub/ writer interleaving end with every per-writer count and last seq equal on all sides', async () => {
    const project = newProject();
    const a = await machine('a');
    const b = await machine('b');
    await a.sync(project);
    await b.sync(project);
    const browser = await BrowserClient.open(hub, ADMIN, project);
    browser.send({ t: 'resume', after: 0 });
    await browser.next((f) => f.t === 'caught-up', 'caught-up');

    for (let round = 1; round <= 5; round++) {
      await a.postOk([{ t: 'events', project, events: [say(a, project, 2 * round - 1), say(a, project, 2 * round)] }]);
      browser.send({ t: 'human', event: await human(project, memberId, `round ${round}`) });
      await b.postOk([{ t: 'events', project, events: [say(b, project, round)] }]);
    }
    await browser.next((f) => f.t === 'human-ack' && f.writer === `hub/${memberId}` && f.seq === 5, 'the fifth human-ack');

    const expected = { [`${a.name}/${SESSION}`]: 10, [`${b.name}/${SESSION}`]: 5, [`hub/${memberId}`]: 5 };
    await a.reaches(project, expected);
    await b.reaches(project, expected);
    const seen = await hubCounts(project);
    expect(seen.counts).toEqual(sorted(expected));
    expect(seen.last).toEqual(sorted(expected));
    expect(countsOf(a, project)).toEqual(sorted(expected));
    expect(countsOf(b, project)).toEqual(sorted(expected));
    expect(seen.offsets).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    // The live browser saw each event once, in offset order.
    expect(browser.logged.map((e) => e.offset)).toEqual(seen.offsets);
    browser.close();
    await a.close();
    await b.close();
  });

  it('a gap asks for a resend from it; the writer is stored to the gap and nothing after it', async () => {
    const project = newProject();
    const a = await machine('gap');
    await a.sync(project);
    const events = [1, 2, 3, 4, 5, 6].map((seq) => say(a, project, seq));
    const from = a.frames.length;
    await a.postOk([{ t: 'events', project, events: [events[0], events[1], events[4], events[5]] }]);
    expect(await a.next((f) => f.t === 'resend', 'resend', from)).toEqual({ t: 'resend', project, writer: `${a.name}/${SESSION}`, from: 3 });
    expect((await hubCounts(project)).last).toEqual({ [`${a.name}/${SESSION}`]: 2 });
    await a.postOk([{ t: 'events', project, events: events.slice(2) }]);
    expect((await hubCounts(project)).counts).toEqual({ [`${a.name}/${SESSION}`]: 6 });
    await a.close();
  });

  it('a connection dropped mid-suffix resumes with nothing lost and nothing duplicated', async () => {
    const project = newProject();
    const a = await machine('writer');
    await a.sync(project);
    const events = Array.from({ length: 400 }, (_, i) => say(a, project, i + 1, `${'x'.repeat(8000)} ${i + 1}`));
    for (let i = 0; i < events.length; i += 100) await a.postOk([{ t: 'events', project, events: events.slice(i, i + 100) }]);

    // A second machine bootstraps the project (3.2 MB of backlog) and its stream is cut while the backlog is arriving.
    const b = await machine('reader');
    const hello = b.post([{ t: 'hello', project, name: 'demo', have: {} }]);
    await b.next((f) => f.t === 'events', 'the first backlog frame');
    await b.close();
    await hello;
    const partial = b.vector(project)[`${a.name}/${SESSION}`] ?? 0;
    expect(partial).toBeGreaterThan(0);
    await b.connect();
    expect(b.generation).toBe(2);
    await b.sync(project);
    await b.reaches(project, { [`${a.name}/${SESSION}`]: 400 });
    expect(countsOf(b, project)).toEqual({ [`${a.name}/${SESSION}`]: 400 });
    // The resumed backlog started where the mirror stood (the hub sends only what the hello's vector lacks).
    const resumed = b.frames.slice(b.frames.findLastIndex((f) => f.t === 'have'));
    const firstSeq = (resumed.find((f) => f.t === 'events') as Extract<DownFrame, { t: 'events' }> | undefined)?.events[0]?.seq;
    expect(firstSeq).toBe(partial < 400 ? partial + 1 : undefined);

    // And an uploader whose POST answer was lost uploads again: the hub keeps one copy.
    await a.postOk([{ t: 'events', project, events: events.slice(390) }]);
    expect((await hubCounts(project)).counts).toEqual({ [`${a.name}/${SESSION}`]: 400 });
    await a.close();
    await b.close();
  });

  it('an object restart between two uploads loses and duplicates nothing', async () => {
    const project = newProject();
    const a = await machine('restart');
    await a.sync(project);
    await a.postOk([{ t: 'events', project, events: [1, 2, 3].map((seq) => say(a, project, seq)) }]);
    await hub.restart();
    expect(a.isEnded || (await a.post([{ t: 'hello', project, name: 'demo', have: {} }])).status === 409).toBe(true);
    await a.connect();
    for (const seq of [4, 5, 6]) say(a, project, seq);
    const have = await a.sync(project);
    expect(have.have).toEqual({ [`${a.name}/${SESSION}`]: 3 });
    const seen = await hubCounts(project);
    expect(seen.counts).toEqual({ [`${a.name}/${SESSION}`]: 6 });
    expect(seen.offsets).toEqual([1, 2, 3, 4, 5, 6]);
    await a.close();
  });
});

describe('a stream a newer one outlived, and a long backlog', () => {
  it('an upload that a newer stream outlived while it waited on the archive lookup stores nothing and is refused stale (scalpel-2#1)', async () => {
    const project = newProject();
    const m = await machine('outlived');
    await m.sync(project);
    const legacy: LogEvent = {
      ts: '2025-01-01T00:00:00.000Z',
      writer: 'legacy/seat-9',
      seq: 1,
      kind: 'say',
      from: 'old',
      to: '*',
      text: 'pre-.smns',
      mac: { nonce: newNonce(), value: base64urlEncode(new Uint8Array(32).fill(9)) },
    };
    const own = say(m, project, 1);
    m.log.get(project)!.delete(own.writer); // posted by hand below, never uploaded by a sync
    const calls = (await hub.projectCalls(project)).calls;
    await hub.holdArchiveLookups(project, true);
    const pending = m.post([{ t: 'events', project, events: [legacy, own] }]);
    while ((await hub.projectCalls(project)).calls === calls) await new Promise((resolve) => setTimeout(resolve, 20));
    // A newer stream opens the project while the upload waits on the lookup.
    await m.connect();
    await m.sync(project);
    await hub.holdArchiveLookups(project, false);
    const answer = await pending;
    expect(answer.status).toBe(409);
    expect(await answer.json()).toMatchObject({ error: 'stale-generation', frames: 0 });
    expect((await hubCounts(project)).counts).toEqual({});
    await m.close();
  });

  it("a hello's backlog is read a page at a time, the next once the page before it is written (scalpel-5#3)", async () => {
    const project = newProject();
    const a = await machine('pages-a');
    await a.sync(project);
    const events = Array.from({ length: 8 }, (_, i) => say(a, project, i + 1, 'x'.repeat(100_000)));
    await a.postOk([{ t: 'events', project, events }]);
    const b = await machine('pages-b');
    const before = await hub.backlogPages(project);
    await hub.holdSend(b.name, 'events');
    const hello = b.post([{ t: 'hello', project, name: 'demo', have: {} }]);
    await b.next((f) => f.t === 'have', 'have');
    // The first page waits at the machine's object; nothing past it has been read.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect((await hub.backlogPages(project)) - before).toBe(1);
    await hub.releaseSend(b.name);
    expect((await hello).status).toBe(200);
    await b.reaches(project, a.vector(project));
    expect((await hub.backlogPages(project)) - before).toBeGreaterThan(1);
    await a.close();
    await b.close();
  });
});

describe('refusals', () => {
  it("refuses a forged writer at that connection and records it in the project's audit record", async () => {
    const project = newProject();
    const a = await machine('honest');
    await a.sync(project);
    const browser = await BrowserClient.open(hub, ADMIN, project);
    const forged: LogEvent = { ...say(a, project, 1), writer: `someone-else/${SESSION}` };
    const asHub: LogEvent = { ...say(a, project, 1), writer: `hub/${memberId}` };
    const from = a.frames.length;
    await a.postOk([{ t: 'events', project, events: [forged, asHub] }]);
    const refusals = await waitFrames(a, 2, (f) => f.t === 'refused', from);
    expect(refusals.map((f) => (f as Extract<DownFrame, { t: 'refused' }>).refusal)).toEqual([
      expect.objectContaining({ reason: 'writer-not-yours', writer: `someone-else/${SESSION}`, seq: 1 }),
      expect.objectContaining({ reason: 'writer-not-yours', writer: `hub/${memberId}`, seq: 1 }),
    ]);
    const audited = await browser.next((f) => f.t === 'refused', 'the audit record');
    expect(audited).toMatchObject({ refusal: { reason: 'writer-not-yours', machine: a.name, id: expect.any(Number), at: expect.any(String) } });
    expect((await hubCounts(project)).counts).toEqual({});
    browser.close();
    await a.close();
  });

  it('refuses and reports a different payload at an existing (writer, seq), and keeps the first', async () => {
    const project = newProject();
    const a = await machine('conflict');
    await a.sync(project);
    const first = say(a, project, 1, 'the original');
    await a.postOk([{ t: 'events', project, events: [first] }]);
    // The same event again, its keys in another order, is the same canonical form: stored once, refused never.
    const reordered = Object.fromEntries(Object.entries(first).reverse()) as LogEvent;
    const from = a.frames.length;
    await a.postOk([{ t: 'events', project, events: [reordered, { ...first, text: 'a rewrite' }] }]);
    expect(await a.next((f) => f.t === 'refused', 'refused', from)).toMatchObject({ refusal: { reason: 'conflict', writer: first.writer, seq: 1 } });
    expect(a.frames.slice(from).filter((f) => f.t === 'refused')).toHaveLength(1);

    // A browser that connects later sees the refusal in the audit record after catching up.
    const browser = await BrowserClient.open(hub, ADMIN, project);
    browser.send({ t: 'resume', after: 0 });
    await browser.next((f) => f.t === 'caught-up', 'caught-up');
    const audit = await browser.next((f) => f.t === 'refused', 'the replayed audit record');
    expect(audit).toMatchObject({ refusal: { reason: 'conflict', machine: a.name } });
    expect(browser.logged.map((e) => e.event.text)).toEqual(['the original']);
    browser.close();
    await a.close();
  });

  it('refuses an event whose code is not in its one canonical spelling, and stores nothing in its place', async () => {
    const project = newProject();
    const a = await machine('spelling');
    await a.sync(project);
    const event = say(a, project, 1);
    const value = event.mac.value;
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const respelled = value.slice(0, -1) + alphabet[alphabet.indexOf(value.at(-1)!) + 1];
    const from = a.frames.length;
    await a.postOk([{ t: 'events', project, events: [{ ...event, mac: { ...event.mac, value: respelled } }] }]);
    expect(await a.next((f) => f.t === 'refused', 'refused', from)).toMatchObject({ refusal: { reason: 'bad-shape', writer: event.writer, seq: 1 } });
    await a.postOk([{ t: 'events', project, events: [event] }]);
    expect((await hubCounts(project)).counts).toEqual({ [event.writer]: 1 });
    await a.close();
  });

  it('stops a writer at a malformed event that names it: the rest of its batch is neither stored nor asked for again', async () => {
    const project = newProject();
    const a = await machine('stopped');
    await a.sync(project);
    const [first, second, third] = [say(a, project, 1), say(a, project, 2), say(a, project, 3)];
    const from = a.frames.length;
    await a.postOk([{ t: 'events', project, events: [first, { ...second, mac: undefined } as never, third] }]);
    expect(await a.next((f) => f.t === 'refused', 'refused', from)).toMatchObject({ refusal: { reason: 'bad-shape', writer: first.writer, seq: 2 } });
    expect((await hubCounts(project)).counts).toEqual({ [first.writer]: 1 });
    expect(a.frames.slice(from).filter((f) => f.t === 'refused' || f.t === 'resend')).toHaveLength(1);
    await a.close();
  });

  it('refuses a POST for an older stream, and events for a project its stream has not opened', async () => {
    const project = newProject();
    const a = await machine('fenced');
    const stale = a.generation;
    await a.close();
    await a.connect();
    expect((await a.post([{ t: 'hello', project, name: 'demo', have: {} }], stale)).status).toBe(409);
    const from = a.frames.length;
    await a.postOk([{ t: 'events', project, events: [say(a, project, 1)] }]);
    expect(await a.next((f) => f.t === 'refused', 'refused', from)).toMatchObject({ refusal: { reason: 'not-open' } });
    expect((await a.post([{ t: 'hello', project, name: 'demo', have: {} }, 'not json' as never])).status).toBe(400);
    await a.close();
  });

  it('refuses a POST its stream outlived: one in flight when a newer stream opened changes nothing for the newer one', async () => {
    const project = newProject();
    const m = await machine('fenced');
    const text = JSON.stringify({ t: 'hello', project, name: 'demo', have: {} });
    let finish!: () => void;
    const stale = new Promise<{ status: number; body: string }>((resolve, reject) => {
      const headers = { ...credentials(m.creds), 'content-type': 'application/x-ndjson', 'content-length': String(Buffer.byteLength(text)), [GENERATION_HEADER]: String(m.generation) };
      const request = httpRequest(`${hub.url}/machine/frames`, { method: 'POST', headers }, (response) => {
        let body = '';
        response.on('data', (chunk) => (body += chunk));
        response.on('end', () => resolve({ status: response.statusCode ?? 0, body }));
      });
      request.on('error', reject);
      // Half the body now, the rest once the newer stream has opened the project.
      request.write(text.slice(0, 10));
      finish = () => request.end(text.slice(10));
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    await m.connect();
    expect(m.generation).toBe(2);
    await m.sync(project);
    finish();
    const answer = await stale;
    expect(answer.status).toBe(409);
    expect(JSON.parse(answer.body)).toMatchObject({ error: 'stale-generation' });
    const from = m.frames.length;
    await m.postOk([{ t: 'events', project, events: [say(m, project, 1)] }]);
    expect((await hubCounts(project)).counts).toEqual({ [`${m.name}/${SESSION}`]: 1 });
    expect(m.frames.slice(from).filter((f) => f.t === 'refused')).toEqual([]);
    await m.close();
  });

  it("hands a POST's frames for one project to its object in one call, in order", async () => {
    const project = newProject();
    const m = await machine('batched');
    await m.sync(project);
    const before = await hub.projectCalls(project);
    // Forty uploads of one event each in one POST: one call, every event stored in its seq order (a gap would be
    // answered with a resend, and the count would fall short).
    await m.postOk(Array.from({ length: 40 }, (_, i) => ({ t: 'events', project, events: [say(m, project, i + 1)] })));
    const after = await hub.projectCalls(project);
    expect(after.calls - before.calls).toBe(1);
    expect(after.frames - before.frames).toBe(40);
    expect((await hubCounts(project)).counts).toEqual({ [`${m.name}/${SESSION}`]: 40 });
    await m.close();
  });

  it('stops a POST at a frame its project finds a newer stream of the machine has reached, and answers stale-generation', async () => {
    const project = newProject();
    const m = await machine('outlived');
    await hub.holdHellos(project, true);
    // The hello waits on the Registry while the project learns of a newer stream (its close, as a newer stream's would
    // arrive); the events after it in the same POST are not applied.
    const post = m.post([
      { t: 'hello', project, name: 'demo', have: {} },
      { t: 'events', project, events: [say(m, project, 1)] },
    ]);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await hub.lease(project, { op: 'closed', machine: m.name, generation: m.generation + 1 });
    await hub.holdHellos(project, false);
    const answer = await post;
    expect(answer.status).toBe(409);
    expect(await answer.json()).toMatchObject({ error: 'stale-generation', frames: 1 });
    expect((await hubCounts(project)).counts).toEqual({});
    await m.close();
  });

  it("records a daemon's report of an event it refused and shows it to the project's browsers", async () => {
    const project = newProject();
    const a = await machine('rejecter');
    await a.sync(project);
    const browser = await BrowserClient.open(hub, ADMIN, project);
    await a.postOk([{ t: 'rejected', project, event: { writer: `hub/${memberId}`, seq: 4 }, nonce: 'AwMDAwMDAwMDAwMDAwMDAw', reason: 'bad-code' }]);
    expect(await browser.next((f) => f.t === 'rejected', 'rejected')).toMatchObject({
      rejection: { machine: a.name, event: { writer: `hub/${memberId}`, seq: 4 }, reason: 'bad-code', id: expect.any(Number) },
    });
    browser.close();
    await a.close();
  });

  it('records a conflict a daemon reports: an authentic event at a position where it holds another', async () => {
    const project = newProject();
    const a = await machine('conflicted');
    await a.sync(project);
    const browser = await BrowserClient.open(hub, ADMIN, project);
    await a.postOk([{ t: 'rejected', project, event: { writer: `hub/${memberId}`, seq: 2 }, nonce: 'AwMDAwMDAwMDAwMDAwMDAw', reason: 'conflict', message: 're-sequenced' }]);
    expect(await browser.next((f) => f.t === 'rejected', 'rejected')).toMatchObject({
      rejection: { machine: a.name, event: { writer: `hub/${memberId}`, seq: 2 }, reason: 'conflict', message: 're-sequenced' },
    });
    expect(a.frames.filter((f) => f.t === 'refused')).toEqual([]);
    browser.close();
    await a.close();
  });

  it('a repeated hello on an open stream: a fresh have with the current archive flag, the backlog past its vector, one membership', async () => {
    const project = newProject();
    const writer = await machine('rewriter');
    const reader = await machine('rehello');
    await writer.sync(project);
    await reader.sync(project);
    await writer.postOk([{ t: 'events', project, events: [1, 2, 3].map((seq) => say(writer, project, seq)) }]);
    const feed = `${writer.name}/${SESSION}`;
    await reader.reaches(project, { [feed]: 3 });
    expect((await hub.fetchAs(ADMIN, `/api/projects/${project}/archive`, { method: 'PUT', body: { machine: reader.name } })).status).toBe(200);

    const from = reader.frames.length;
    await reader.postOk([{ t: 'hello', project, name: 'demo', have: { [feed]: 1 } }]);
    expect(await reader.next((f) => f.t === 'have', 'the fresh have', from)).toEqual({ t: 'have', project, have: { [feed]: 3 }, archive: true });
    await reader.next((f) => f.t === 'events' && f.events.some((e) => e.seq === 3), 'the backlog', from);
    // A live event after the repeat arrives once: the machine is in the fan-out once.
    await writer.postOk([{ t: 'events', project, events: [say(writer, project, 4)] }]);
    await reader.next((f) => f.t === 'events' && f.events.some((e) => e.seq === 4), 'the live event', from);
    await new Promise((resolve) => setTimeout(resolve, 200));
    const sent = reader.frames.slice(from).flatMap((f) => (f.t === 'events' ? f.events.map((e) => e.seq) : []));
    expect(sent).toEqual([2, 3, 4]);
    await writer.close();
    await reader.close();
  });

  it('never fills a hole: a daemon whose vector moved past a refused seq is not sent that seq again', async () => {
    const project = newProject();
    const writer = await machine('holder');
    await writer.sync(project);
    await writer.postOk([{ t: 'events', project, events: [1, 2, 3].map((seq) => say(writer, project, seq)) }]);
    const reader = await machine('spender');
    // The reader refused seq 2 of the writer's feed and spent the position: its vector says 3 while it holds 1 and 3.
    const feed = `${writer.name}/${SESSION}`;
    const from = reader.frames.length;
    await reader.postOk([{ t: 'hello', project, name: 'demo', have: { [feed]: 3 } }]);
    await reader.next((f) => f.t === 'have' && f.project === project, 'have', from);
    await writer.postOk([{ t: 'events', project, events: [say(writer, project, 4)] }]);
    await reader.next((f) => f.t === 'events' && f.events.some((e) => e.seq === 4), 'the live seq 4', from);
    const sent = reader.frames.slice(from).flatMap((f) => (f.t === 'events' ? f.events.map((e) => e.seq) : []));
    expect(sent).toEqual([4]);
    await writer.close();
    await reader.close();
  });
});

describe('a paged resume (DX3 more)', () => {
  /** A project whose log is `count` events of about 100 KB (several pages), and a browser that drives its pages. */
  async function longLog(count: number) {
    const project = newProject();
    const a = await machine('paged');
    await a.sync(project);
    for (let from = 1; from <= count; from += 8) {
      const events = Array.from({ length: Math.min(8, count - from + 1) }, (_, i) => say(a, project, from + i, 'x'.repeat(100_000)));
      await a.postOk([{ t: 'events', project, events }]);
    }
    const browser = await BrowserClient.open(hub, ADMIN, project);
    browser.followMore = false;
    return { project, a, browser };
  }

  /** The page the browser's last `resume` asked for: its `log` frames' offsets and how it ended. */
  async function page(browser: BrowserClient, after: number) {
    const from = browser.frames.length;
    browser.send({ t: 'resume', after });
    const end = (await browser.next((f) => f.t === 'more' || f.t === 'caught-up', 'the page end', from)) as Extract<ProjectDown, { t: 'more' | 'caught-up' }>;
    const at = browser.frames.indexOf(end);
    const frames = browser.frames.slice(from, at).filter((f): f is Extract<ProjectDown, { t: 'log' }> => f.t === 'log');
    return { end, frames, offsets: frames.flatMap((f) => f.events.map((e) => e.offset)) };
  }

  it('a long suffix arrives in pages of at most four frames, each but the last ending more at its last offset, with no event missing or twice', async () => {
    const { a, browser } = await longLog(30);
    const offsets: number[] = [];
    let after = 0;
    let pages = 0;
    for (;;) {
      const p = await page(browser, after);
      pages++;
      expect(p.frames.length).toBeLessThanOrEqual(4);
      offsets.push(...p.offsets);
      if (p.end.t === 'caught-up') {
        expect(p.end.offset).toBe(30);
        break;
      }
      expect(p.end.offset).toBe(p.offsets.at(-1));
      after = p.end.offset;
    }
    expect(pages).toBeGreaterThan(1);
    expect(offsets).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
    browser.close();
    await a.close();
  });

  it('live frames reach a caught-up socket and not one mid-paging, whose later page carries them exactly once, across a real hibernation', async () => {
    const { project, a, browser } = await longLog(30);
    const follower = await BrowserClient.open(hub, ADMIN, project);
    follower.send({ t: 'resume', after: 0 });
    await follower.next((f) => f.t === 'caught-up', 'caught-up');
    const first = await page(browser, 0);
    expect(first.end.t).toBe('more');

    // Stored while the browser is mid-paging: live to the follower only.
    await a.postOk([{ t: 'events', project, events: [say(a, project, 31)] }]);
    await follower.next((f) => f.t === 'log' && f.events.some((e) => e.offset === 31), 'the live event');
    // The browser's paging survives a real hibernation: still not caught up, it gets nothing live.
    const life = await hub.projectLife(project);
    await hub.evict('Project', ORG + ':' + project, 'hibernate');
    expect(await hub.projectLife(project)).not.toBe(life);
    await a.postOk([{ t: 'events', project, events: [say(a, project, 32)] }]);
    await follower.next((f) => f.t === 'log' && f.events.some((e) => e.offset === 32), 'the live event after the hibernation');
    await new Promise((resolve) => setTimeout(resolve, 300));
    const seen = () => browser.logged.map((e) => e.offset);
    expect(seen().filter((o) => o > 30)).toEqual([]);

    let after = first.end.offset;
    for (;;) {
      const p = await page(browser, after);
      if (p.end.t === 'caught-up') break;
      after = p.end.offset;
    }
    expect(seen()).toEqual(Array.from({ length: 32 }, (_, i) => i + 1));
    // Caught up now: live.
    await a.postOk([{ t: 'events', project, events: [say(a, project, 33)] }]);
    await browser.next((f) => f.t === 'log' && f.events.some((e) => e.offset === 33), 'live once caught up');
    expect(seen().filter((o) => o === 33)).toEqual([33]);
    follower.close();
    browser.close();
    await a.close();
  });
});

describe('browsers', () => {
  it('a browser resuming at offset N receives exactly the events after N, then live', async () => {
    const project = newProject();
    const a = await machine('resume');
    await a.sync(project);
    await a.postOk([{ t: 'events', project, events: Array.from({ length: 12 }, (_, i) => say(a, project, i + 1)) }]);
    const browser = await BrowserClient.open(hub, ADMIN, project);
    expect(browser.frames[0]).toMatchObject({ t: 'welcome', head: 12 });
    browser.send({ t: 'resume', after: 7 });
    const caught = await browser.next((f) => f.t === 'caught-up', 'caught-up');
    expect(caught).toEqual({ t: 'caught-up', offset: 12 });
    expect(browser.logged.map((e) => [e.offset, e.event.seq])).toEqual([8, 9, 10, 11, 12].map((n) => [n, n]));
    await a.postOk([{ t: 'events', project, events: [say(a, project, 13)] }]);
    await browser.next((f) => f.t === 'log' && f.events.some((e) => e.offset === 13), 'the live event');
    expect(browser.logged.map((e) => e.offset)).toEqual([8, 9, 10, 11, 12, 13]);
    browser.close();
    await a.close();
  });

  it("a web human enters hub/<member>, sequenced by the hub with a position DX1's check admits, sent once per nonce", async () => {
    const project = newProject();
    const a = await machine('recipient');
    await a.sync(project);
    const browser = await BrowserClient.open(hub, ADMIN, project);
    const sealed = await human(project, memberId, 'keep user_id');
    browser.send({ t: 'human', event: sealed });
    const ack = await browser.next((f) => f.t === 'human-ack', 'human-ack');
    expect(ack).toEqual({ t: 'human-ack', nonce: sealed.mac.nonce, offset: 1, writer: `hub/${memberId}`, seq: 1 });

    const delivered = (await a.next((f) => f.t === 'events' && f.events.some((e) => e.writer === `hub/${memberId}`), 'the human')) as Extract<DownFrame, { t: 'events' }>;
    const stored = delivered.events[0];
    expect(isHubPosition(stored)).toBe(true);
    // Stored as received plus writer, seq, and ts: its code verifies at the daemon.
    expect(await verify(await KEY, 'log', project, stored)).toBe(true);
    expect(withoutPosition(stored)).toEqual(sealed);

    // The browser lost its ack and sends the same sealed event again: answered from the record, not stored twice.
    const from = browser.frames.length;
    browser.send({ t: 'human', event: sealed });
    expect(await browser.next((f) => f.t === 'human-ack', 'the repeated ack', from)).toEqual(ack);
    expect((await hubCounts(project)).counts).toEqual({ [`hub/${memberId}`]: 1 });
    browser.close();
    await a.close();
  });

  it("refuses a human whose member is not the signed-in member's, and one that names its own position", async () => {
    const project = newProject();
    const a = await machine('guard');
    await a.sync(project);
    const browser = await BrowserClient.open(hub, ADMIN, project);
    const impostor = await human(project, '0123456789abcdef0123456789abcdef', 'not mine');
    browser.send({ t: 'human', event: impostor });
    const refused = (await browser.next((f) => f.t === 'refused', 'refused')) as Extract<ProjectDown, { t: 'refused' }>;
    expect(refused.refusal).toMatchObject({ reason: 'writer-not-yours', member: memberId, nonce: impostor.mac.nonce });
    const positioned = { ...(await human(project, memberId, 'placed')), writer: `hub/${memberId}`, seq: 9 };
    const from = browser.frames.length;
    browser.send({ t: 'human', event: positioned as never });
    expect(await browser.next((f) => f.t === 'refused', 'refused', from)).toMatchObject({ refusal: { reason: 'bad-shape' } });
    expect((await hubCounts(project)).counts).toEqual({});
    browser.close();
    await a.close();
  });
  it('a human re-sent on a new socket after the log moved on gets its original ack; its nonce with another payload is a conflict', async () => {
    const project = newProject();
    const a = await machine('resent');
    await a.sync(project);
    const first = await BrowserClient.open(hub, ADMIN, project);
    const sealed = await human(project, memberId, 'keep user_id');
    first.send({ t: 'human', event: sealed });
    const ack = await first.next((f) => f.t === 'human-ack', 'human-ack');
    expect(ack).toEqual({ t: 'human-ack', nonce: sealed.mac.nonce, offset: 1, writer: `hub/${memberId}`, seq: 1 });
    await a.postOk([{ t: 'events', project, events: [say(a, project, 1)] }]);
    first.send({ t: 'human', event: await human(project, memberId, 'a later one') });
    expect(await first.next((f) => f.t === 'human-ack' && f.seq === 2, 'the second ack')).toMatchObject({ offset: 3 });
    first.close();

    const second = await BrowserClient.open(hub, ADMIN, project);
    second.send({ t: 'human', event: sealed });
    expect(await second.next((f) => f.t === 'human-ack', 'the original ack')).toEqual(ack);

    const { mac, ...draft } = sealed;
    const other = await seal(await KEY, 'log', project, { ...draft, text: 'drop user_id' }, mac.nonce);
    const from = second.frames.length;
    second.send({ t: 'human', event: other });
    const refused = (await second.next((f) => f.t === 'refused', 'refused', from)) as Extract<ProjectDown, { t: 'refused' }>;
    expect(refused.refusal).toMatchObject({ reason: 'conflict', writer: `hub/${memberId}`, seq: 1, nonce: mac.nonce });
    expect((await hubCounts(project)).counts).toEqual(sorted({ [`hub/${memberId}`]: 2, [`${a.name}/${SESSION}`]: 1 }));
    second.close();
    await a.close();
  });
  it('refuses a socket frame over 1 MiB on the wire before reading it, and joins a larger frame sent as parts', async () => {
    const project = newProject();
    const a = await machine('bounded');
    await a.sync(project);
    const browser = await BrowserClient.open(hub, ADMIN, project);
    const large = { t: 'resume', after: 0, padding: 'x'.repeat(FRAME_LIMIT) };
    browser.send(large as never);
    expect(await browser.next((f) => f.t === 'refused', 'refused')).toMatchObject({ refusal: { reason: 'too-large', member: memberId } });
    expect(browser.frames.some((f) => f.t === 'caught-up')).toBe(false);
    for (const line of toWire(large)) browser.send(JSON.parse(line));
    await browser.next((f) => f.t === 'caught-up', 'caught-up');
    browser.close();
    await a.close();
  });
  it("refuses a browser's part set of too many parts, or joining past its bound, as too-large and unread; one of the bound is read", async () => {
    const project = newProject();
    const a = await machine('bounded-set');
    await a.sync(project);
    const browser = await BrowserClient.open(hub, ADMIN, project);
    browser.send({ t: 'part', id: 'many', index: 0, count: BROWSER_SET_PARTS + 1, data: '' });
    expect(await browser.next((f) => f.t === 'refused', 'refused')).toMatchObject({ refusal: { reason: 'too-large', member: memberId } });
    // A resume padded one byte past the bound, and then to it: only the second is read.
    const shell = JSON.stringify({ t: 'resume', after: 0, padding: '' }).length;
    const over = { t: 'resume', after: 0, padding: 'x'.repeat(BROWSER_SET_LIMIT - shell + 1) };
    const from = browser.frames.length;
    for (const line of toWire(over)) browser.send(JSON.parse(line));
    expect(await browser.next((f) => f.t === 'refused', 'refused', from)).toMatchObject({ refusal: { reason: 'too-large' } });
    expect(browser.frames.some((f) => f.t === 'caught-up')).toBe(false);
    for (const line of toWire({ ...over, padding: over.padding.slice(1) })) browser.send(JSON.parse(line));
    await browser.next((f) => f.t === 'caught-up', 'caught-up');
    browser.close();
    await a.close();
  });
});

describe('delivery failures', () => {
  async function until(check: () => boolean, ms = 8000) {
    const deadline = Date.now() + ms;
    while (!check()) {
      if (Date.now() > deadline) throw new Error('timed out');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  it("answers 503 to a POST whose first reply failed though a later one went out; the stream ends, and a reconnect's hello heals it", async () => {
    const project = newProject();
    const source = await machine('source');
    await source.sync(project);
    const event = say(source, project, 1);
    await source.postOk([{ t: 'events', project, events: [event] }]);
    const target = await machine('target');
    // The hello owes two replies: `have`, then the backlog's `events`. The first fails.
    await hub.failNextSend(target.name, 'have');
    const response = await target.post([{ t: 'hello', project, name: 'demo', have: {} }]);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: 'delivery-failed', frames: 0 });
    await until(() => target.isEnded);
    await target.connect();
    await target.sync(project);
    expect(countsOf(target, project)).toEqual({ [event.writer]: 1 });
    await source.close();
    await target.close();
  });

  it("answers 503 counting the frames applied before the one whose reply failed, though they reached the project in one call", async () => {
    const project = newProject();
    const m = await machine('progress');
    await m.sync(project);
    // One call to the project: an upload that owes no reply and is stored, then one with a gap, which owes `resend`.
    await hub.failNextSend(m.name, 'resend');
    const response = await m.post([
      { t: 'events', project, events: [say(m, project, 1)] },
      { t: 'events', project, events: [say(m, project, 3)] },
    ]);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: 'delivery-failed', frames: 1 });
    expect((await hubCounts(project)).counts).toEqual({ [`${m.name}/${SESSION}`]: 1 });
    await until(() => m.isEnded);
    await m.close();
  });

  it('ends a stream a live event could not be sent to; the machine reconnects, and its hello heals what it missed', async () => {
    const project = newProject();
    const source = await machine('live-source');
    const target = await machine('live-target');
    await source.sync(project);
    await target.sync(project);
    await hub.failNextSend(target.name, 'events');
    const event = say(source, project, 1);
    await source.postOk([{ t: 'events', project, events: [event] }]);
    await until(() => target.isEnded);
    expect(countsOf(target, project)).toEqual({});
    await target.connect();
    await target.sync(project);
    expect(countsOf(target, project)).toEqual({ [event.writer]: 1 });
    await source.close();
    await target.close();
  });
});

describe('session presence', () => {
  const OTHER = '9b2e4c6d-1a3f-4e5b-8c7d-0f1e2d3c4b5a';
  const presence = (m: MachineClient, project: string, session: string, status: string | null): Extract<SessionMessage, { kind: 'presence' }> => ({
    project,
    machine: m.name,
    session,
    kind: 'presence',
    sub: null,
    n: null,
    body: { record: status === null ? null : { status }, bridge: status !== null },
  });
  const presences = (b: BrowserClient) =>
    b.frames.flatMap((f) => (f.t === 'session' && f.message.kind === 'presence' ? [f.message] : []));

  it("a browser is sent each session's latest presence on connect, then each change", async () => {
    const project = newProject();
    const a = await machine('present');
    await a.sync(project);
    await a.postOk([
      { t: 'session', message: presence(a, project, SESSION, 'busy') },
      { t: 'session', message: presence(a, project, OTHER, null) },
      { t: 'session', message: presence(a, project, SESSION, 'waiting') },
    ]);
    const browser = await BrowserClient.open(hub, ADMIN, project);
    browser.send({ t: 'resume', after: 0 });
    await browser.next((f) => f.t === 'caught-up', 'caught-up');
    expect(Object.fromEntries(presences(browser).map((m) => [m.session, m]))).toEqual({
      [SESSION]: presence(a, project, SESSION, 'waiting'),
      [OTHER]: presence(a, project, OTHER, null),
    });
    expect(presences(browser)).toHaveLength(2);

    await a.postOk([{ t: 'session', message: presence(a, project, OTHER, 'idle') }]);
    await browser.next((f) => f.t === 'session' && f.message.session === OTHER && presences(browser).length === 3, 'the change');
    expect(presences(browser)[2]).toEqual(presence(a, project, OTHER, 'idle'));
    browser.close();
    await a.close();
  });

  it("refuses presence for a project the stream has not opened, and presence naming another machine", async () => {
    const project = newProject();
    const a = await machine('presence-guard');
    let from = a.frames.length;
    await a.postOk([{ t: 'session', message: presence(a, project, SESSION, 'busy') }]);
    expect(await a.next((f) => f.t === 'refused', 'refused', from)).toMatchObject({ refusal: { reason: 'not-open' } });
    await a.sync(project);
    from = a.frames.length;
    await a.postOk([{ t: 'session', message: { ...presence(a, project, SESSION, 'busy'), machine: 'someone-else' } }]);
    expect(await a.next((f) => f.t === 'refused', 'refused', from)).toMatchObject({ refusal: { reason: 'bad-shape' } });
    const browser = await BrowserClient.open(hub, ADMIN, project);
    browser.send({ t: 'resume', after: 0 });
    await browser.next((f) => f.t === 'caught-up', 'caught-up');
    expect(presences(browser)).toEqual([]);
    browser.close();
    await a.close();
  });
});

/** A WebSocket upgrade the hub answers without upgrading: its status and JSON body (fetch cannot send an Upgrade). */
function upgrade(path: string, who: string): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const request = httpGet(`${hub.url}${path}`, {
      headers: { ...credentials(who), Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==', 'Sec-WebSocket-Version': '13' },
    });
    request.on('upgrade', () => reject(new Error('upgraded')));
    request.on('response', (response) => {
      let text = '';
      response.on('data', (chunk) => (text += chunk));
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body: JSON.parse(text) }));
    });
    request.on('error', reject);
  });
}

async function waitFrames(m: MachineClient, count: number, predicate: (f: DownFrame) => boolean, from: number): Promise<DownFrame[]> {
  const deadline = Date.now() + 5000;
  for (;;) {
    const found = m.frames.slice(from).filter(predicate);
    if (found.length >= count) return found;
    if (Date.now() > deadline) throw new Error(`only ${found.length} of ${count}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
