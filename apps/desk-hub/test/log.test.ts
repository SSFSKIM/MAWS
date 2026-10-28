// The log plane (DC3.G2) on the local runtime: machines on RL1, which carries the log plane since O14 M5b took DX2's
// stream out of the hub, and browsers speaking DX3 through the stand-in. The hub holds no org key, so machines' events
// here carry codes it never checks; a browser's `human` is sealed for real, since its position must pass DX1's check once
// the hub assigns it. The hub does check that every code is spelled canonically (DX1), so the machines' codes here are
// random 32 bytes in canonical base64url. A machine's frames reach a project in order, so a `hello` after an upload is
// answered once the upload is applied: the suites wait on that (`settled`) where DX2's POST answered.
import { get as httpGet } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BROWSER_SET_LIMIT, BROWSER_SET_PARTS, type ProjectDown } from '../src/protocol/browser';
import { base64urlEncode } from '../src/protocol/base64url';
import { importOrgKey, newNonce, seal, verify } from '../src/protocol/codes';
import { isHubPosition, withoutPosition, type HumanDraft, type LogEvent } from '../src/protocol/log';
import type { DownFrame } from '../src/protocol/machine';
import { FRAME_LIMIT, toWire } from '../src/protocol/parts';
import { BrowserClient, sorted } from './support/clients';
import { ADMIN, credentials, ORG, startLocalHub, type LocalHub } from './support/local';
import { TestOrg, type Rl1Machine } from './support/rl1';

let hub: LocalHub;
let org: TestOrg;
let memberId: string;
beforeAll(async () => {
  hub = await startLocalHub();
  org = await TestOrg.root(hub);
  memberId = org.admin;
});
afterAll(() => hub?.close());

let projects = 0;
/** A fresh project id per test, so the suites share one runtime without sharing a log. */
const newProject = () => `6f1c0a8e-3b2d-4c5e-9f70-${(++projects).toString(16).padStart(12, '0')}`;
const SESSION = 'e0ad139c-18bc-45bd-9489-be8653145f80';

let machines = 0;
const machine = (prefix: string): Promise<Rl1Machine> => org.machine(`${prefix}-${++machines}`);

/** A `say` written on `machine`, with a code the hub carries and never checks. */
function say(machine: Rl1Machine, project: string, seq: number, text = `say ${seq}`, session = SESSION): LogEvent {
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

async function until(check: () => boolean, ms = 8000) {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
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

const countsOf = (m: Rl1Machine, project: string) =>
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
    mini.close();
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
    other.send([{ t: 'events', project, events: [legacy(1)] }]);
    expect(await other.next((f) => f.t === 'refused', 'refused', from)).toMatchObject({ refusal: { reason: 'writer-not-yours', writer: 'legacy/seat-7' } });
    archive.send([{ t: 'events', project, events: [legacy(1), legacy(2)] }]);
    await archive.settled(project);
    expect((await hubCounts(project)).counts).toEqual({ 'legacy/seat-7': 2 });
    expect((await hub.fetchAs(ADMIN, `/api/projects/${project}/archive`, { method: 'PUT', body: { machine: 'no-such-machine' } })).status).toBe(409);
    archive.close();
    other.close();
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
      a.send([{ t: 'events', project, events: [say(a, project, 2 * round - 1), say(a, project, 2 * round)] }]);
      browser.send({ t: 'human', event: await human(project, memberId, `round ${round}`) });
      b.send([{ t: 'events', project, events: [say(b, project, round)] }]);
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
    a.close();
    b.close();
  });

  it('a gap asks for a resend from it; the writer is stored to the gap and nothing after it', async () => {
    const project = newProject();
    const a = await machine('gap');
    await a.sync(project);
    const events = [1, 2, 3, 4, 5, 6].map((seq) => say(a, project, seq));
    const from = a.frames.length;
    a.send([{ t: 'events', project, events: [events[0], events[1], events[4], events[5]] }]);
    expect(await a.next((f) => f.t === 'resend', 'resend', from)).toEqual({ t: 'resend', project, writer: `${a.name}/${SESSION}`, from: 3 });
    expect((await hubCounts(project)).last).toEqual({ [`${a.name}/${SESSION}`]: 2 });
    a.send([{ t: 'events', project, events: events.slice(2) }]);
    await a.settled(project);
    expect((await hubCounts(project)).counts).toEqual({ [`${a.name}/${SESSION}`]: 6 });
    a.close();
  });

  it('a connection dropped mid-suffix resumes with nothing lost and nothing duplicated', async () => {
    const project = newProject();
    const a = await machine('writer');
    await a.sync(project);
    const events = Array.from({ length: 400 }, (_, i) => say(a, project, i + 1, `${'x'.repeat(8000)} ${i + 1}`));
    for (let i = 0; i < events.length; i += 100) a.send([{ t: 'events', project, events: events.slice(i, i + 100) }]);
    expect(await a.settled(project)).toEqual({ [`${a.name}/${SESSION}`]: 400 });

    // A second machine bootstraps the project (3.2 MB of backlog) and its connection is cut while the backlog arrives.
    const b = await machine('reader');
    await b.endpoint.project(project, 'demo', () => b.vector(project));
    await b.next((f) => f.t === 'events', 'the first backlog frame');
    b.drop();
    await until(() => !b.endpoint.isOpen);
    const partial = b.vector(project)[`${a.name}/${SESSION}`] ?? 0;
    expect(partial).toBeGreaterThan(0);
    const reconnected = b.frames.length;
    // Connecting again opens the project again, with the mirror's vector.
    await b.connect();
    expect(b.generation).toBe(2);
    await b.reaches(project, { [`${a.name}/${SESSION}`]: 400 });
    expect(countsOf(b, project)).toEqual({ [`${a.name}/${SESSION}`]: 400 });
    // The resumed backlog started where the mirror stood (the hub sends only what the hello's vector lacks).
    const resumed = b.frames.slice(reconnected + b.frames.slice(reconnected).findIndex((f) => f.t === 'have'));
    const firstSeq = (resumed.find((f) => f.t === 'events') as Extract<DownFrame, { t: 'events' }> | undefined)?.events[0]?.seq;
    expect(firstSeq).toBe(partial < 400 ? partial + 1 : undefined);

    // And an uploader that sends again what the hub holds (its connection lost before it learned so): one copy kept.
    a.send([{ t: 'events', project, events: events.slice(390) }]);
    await a.settled(project);
    expect((await hubCounts(project)).counts).toEqual({ [`${a.name}/${SESSION}`]: 400 });
    a.close();
    b.close();
  });

  it('an object restart between two uploads loses and duplicates nothing', async () => {
    const project = newProject();
    const a = await machine('restart');
    await a.sync(project);
    a.send([{ t: 'events', project, events: [1, 2, 3].map((seq) => say(a, project, seq)) }]);
    await a.settled(project);
    await hub.restart();
    await until(() => !a.endpoint.isOpen);
    await a.connect();
    for (const seq of [4, 5, 6]) say(a, project, seq);
    const have = await a.sync(project);
    expect(have.have).toEqual({ [`${a.name}/${SESSION}`]: 3 });
    await a.settled(project);
    const seen = await hubCounts(project);
    expect(seen.counts).toEqual({ [`${a.name}/${SESSION}`]: 6 });
    expect(seen.offsets).toEqual([1, 2, 3, 4, 5, 6]);
    a.close();
  });
});

describe('a long backlog', () => {
  it("a hello's backlog is read a page at a time, the next once the page before it is written (scalpel-5#3)", async () => {
    const project = newProject();
    const a = await machine('pages-a');
    await a.sync(project);
    const events = Array.from({ length: 8 }, (_, i) => say(a, project, i + 1, 'x'.repeat(100_000)));
    a.send([{ t: 'events', project, events }]);
    await a.settled(project);
    const b = await machine('pages-b');
    const before = await hub.backlogPages(project);
    await hub.holdSend(b.name, 'events');
    await b.endpoint.project(project, 'demo');
    // The first page waits at the machine's object; nothing past it has been read.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect((await hub.backlogPages(project)) - before).toBe(1);
    await hub.releaseSend(b.name);
    await b.reaches(project, a.vector(project));
    expect((await hub.backlogPages(project)) - before).toBeGreaterThan(1);
    a.close();
    b.close();
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
    a.send([{ t: 'events', project, events: [forged, asHub] }]);
    const refusals = await waitFrames(a, 2, (f) => f.t === 'refused', from);
    expect(refusals.map((f) => (f as Extract<DownFrame, { t: 'refused' }>).refusal)).toEqual([
      expect.objectContaining({ reason: 'writer-not-yours', writer: `someone-else/${SESSION}`, seq: 1 }),
      expect.objectContaining({ reason: 'writer-not-yours', writer: `hub/${memberId}`, seq: 1 }),
    ]);
    const audited = await browser.next((f) => f.t === 'refused', 'the audit record');
    expect(audited).toMatchObject({ refusal: { reason: 'writer-not-yours', machine: a.name, id: expect.any(Number), at: expect.any(String) } });
    expect((await hubCounts(project)).counts).toEqual({});
    browser.close();
    a.close();
  });

  it('refuses and reports a different payload at an existing (writer, seq), and keeps the first', async () => {
    const project = newProject();
    const a = await machine('conflict');
    await a.sync(project);
    const first = say(a, project, 1, 'the original');
    a.send([{ t: 'events', project, events: [first] }]);
    // The same event again, its keys in another order, is the same canonical form: stored once, refused never.
    const reordered = Object.fromEntries(Object.entries(first).reverse()) as LogEvent;
    const from = a.frames.length;
    a.send([{ t: 'events', project, events: [reordered, { ...first, text: 'a rewrite' }] }]);
    expect(await a.next((f) => f.t === 'refused', 'refused', from)).toMatchObject({ refusal: { reason: 'conflict', writer: first.writer, seq: 1 } });
    await a.settled(project);
    expect(a.frames.slice(from).filter((f) => f.t === 'refused')).toHaveLength(1);

    // A browser that connects later sees the refusal in the audit record after catching up.
    const browser = await BrowserClient.open(hub, ADMIN, project);
    browser.send({ t: 'resume', after: 0 });
    await browser.next((f) => f.t === 'caught-up', 'caught-up');
    const audit = await browser.next((f) => f.t === 'refused', 'the replayed audit record');
    expect(audit).toMatchObject({ refusal: { reason: 'conflict', machine: a.name } });
    expect(browser.logged.map((e) => e.event.text)).toEqual(['the original']);
    browser.close();
    a.close();
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
    a.send([{ t: 'events', project, events: [{ ...event, mac: { ...event.mac, value: respelled } }] }]);
    expect(await a.next((f) => f.t === 'refused', 'refused', from)).toMatchObject({ refusal: { reason: 'bad-shape', writer: event.writer, seq: 1 } });
    a.send([{ t: 'events', project, events: [event] }]);
    await a.settled(project);
    expect((await hubCounts(project)).counts).toEqual({ [event.writer]: 1 });
    a.close();
  });

  it('stops a writer at a malformed event that names it: the rest of its batch is neither stored nor asked for again', async () => {
    const project = newProject();
    const a = await machine('stopped');
    await a.sync(project);
    const [first, second, third] = [say(a, project, 1), say(a, project, 2), say(a, project, 3)];
    const from = a.frames.length;
    a.send([{ t: 'events', project, events: [first, { ...second, mac: undefined } as never, third] }]);
    expect(await a.next((f) => f.t === 'refused', 'refused', from)).toMatchObject({ refusal: { reason: 'bad-shape', writer: first.writer, seq: 2 } });
    await a.settled(project);
    expect((await hubCounts(project)).counts).toEqual({ [first.writer]: 1 });
    expect(a.frames.slice(from).filter((f) => f.t === 'refused' || f.t === 'resend')).toHaveLength(1);
    a.close();
  });

  it('refuses events for a project its connection has not opened', async () => {
    const project = newProject();
    const a = await machine('fenced');
    const from = a.frames.length;
    a.send([{ t: 'events', project, events: [say(a, project, 1)] }]);
    expect(await a.next((f) => f.t === 'refused', 'refused', from)).toMatchObject({ refusal: { reason: 'not-open' } });
    a.close();
  });

  it("records a daemon's report of an event it refused and shows it to the project's browsers", async () => {
    const project = newProject();
    const a = await machine('rejecter');
    await a.sync(project);
    const browser = await BrowserClient.open(hub, ADMIN, project);
    a.send([{ t: 'rejected', project, event: { writer: `hub/${memberId}`, seq: 4 }, nonce: 'AwMDAwMDAwMDAwMDAwMDAw', reason: 'bad-code' }]);
    expect(await browser.next((f) => f.t === 'rejected', 'rejected')).toMatchObject({
      rejection: { machine: a.name, event: { writer: `hub/${memberId}`, seq: 4 }, reason: 'bad-code', id: expect.any(Number) },
    });
    browser.close();
    a.close();
  });

  it('records a conflict a daemon reports: an authentic event at a position where it holds another', async () => {
    const project = newProject();
    const a = await machine('conflicted');
    await a.sync(project);
    const browser = await BrowserClient.open(hub, ADMIN, project);
    a.send([{ t: 'rejected', project, event: { writer: `hub/${memberId}`, seq: 2 }, nonce: 'AwMDAwMDAwMDAwMDAwMDAw', reason: 'conflict', message: 're-sequenced' }]);
    expect(await browser.next((f) => f.t === 'rejected', 'rejected')).toMatchObject({
      rejection: { machine: a.name, event: { writer: `hub/${memberId}`, seq: 2 }, reason: 'conflict', message: 're-sequenced' },
    });
    expect(a.frames.filter((f) => f.t === 'refused')).toEqual([]);
    browser.close();
    a.close();
  });

  it('a repeated hello on an open connection: a fresh have with the current archive flag, the backlog past its vector, one membership', async () => {
    const project = newProject();
    const writer = await machine('rewriter');
    const reader = await machine('rehello');
    await writer.sync(project);
    await reader.sync(project);
    writer.send([{ t: 'events', project, events: [1, 2, 3].map((seq) => say(writer, project, seq)) }]);
    const feed = `${writer.name}/${SESSION}`;
    await reader.reaches(project, { [feed]: 3 });
    expect((await hub.fetchAs(ADMIN, `/api/projects/${project}/archive`, { method: 'PUT', body: { machine: reader.name } })).status).toBe(200);

    const from = reader.frames.length;
    reader.send([{ t: 'hello', project, name: 'demo', have: { [feed]: 1 } }]);
    expect(await reader.next((f) => f.t === 'have', 'the fresh have', from)).toEqual({ t: 'have', project, have: { [feed]: 3 }, archive: true });
    await reader.next((f) => f.t === 'events' && f.events.some((e) => e.seq === 3), 'the backlog', from);
    // A live event after the repeat arrives once: the machine is in the fan-out once.
    writer.send([{ t: 'events', project, events: [say(writer, project, 4)] }]);
    await reader.next((f) => f.t === 'events' && f.events.some((e) => e.seq === 4), 'the live event', from);
    await new Promise((resolve) => setTimeout(resolve, 200));
    const sent = reader.frames.slice(from).flatMap((f) => (f.t === 'events' ? f.events.map((e) => e.seq) : []));
    expect(sent).toEqual([2, 3, 4]);
    writer.close();
    reader.close();
  });

  it('never fills a hole: a daemon whose vector moved past a refused seq is not sent that seq again', async () => {
    const project = newProject();
    const writer = await machine('holder');
    await writer.sync(project);
    writer.send([{ t: 'events', project, events: [1, 2, 3].map((seq) => say(writer, project, seq)) }]);
    await writer.settled(project);
    const reader = await machine('spender');
    // The reader refused seq 2 of the writer's feed and spent the position: its vector says 3 while it holds 1 and 3.
    const feed = `${writer.name}/${SESSION}`;
    const from = reader.frames.length;
    reader.send([{ t: 'hello', project, name: 'demo', have: { [feed]: 3 } }]);
    await reader.next((f) => f.t === 'have' && f.project === project, 'have', from);
    writer.send([{ t: 'events', project, events: [say(writer, project, 4)] }]);
    await reader.next((f) => f.t === 'events' && f.events.some((e) => e.seq === 4), 'the live seq 4', from);
    const sent = reader.frames.slice(from).flatMap((f) => (f.t === 'events' ? f.events.map((e) => e.seq) : []));
    expect(sent).toEqual([4]);
    writer.close();
    reader.close();
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
      a.send([{ t: 'events', project, events }]);
    }
    await a.settled(project);
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
    a.close();
  });

  it('live frames reach a caught-up socket and not one mid-paging, whose later page carries them exactly once, across a real hibernation', async () => {
    const { project, a, browser } = await longLog(30);
    const follower = await BrowserClient.open(hub, ADMIN, project);
    follower.send({ t: 'resume', after: 0 });
    await follower.next((f) => f.t === 'caught-up', 'caught-up');
    const first = await page(browser, 0);
    expect(first.end.t).toBe('more');

    // Stored while the browser is mid-paging: live to the follower only.
    a.send([{ t: 'events', project, events: [say(a, project, 31)] }]);
    await follower.next((f) => f.t === 'log' && f.events.some((e) => e.offset === 31), 'the live event');
    // The browser's paging survives a real hibernation: still not caught up, it gets nothing live.
    const life = await hub.projectLife(project);
    await hub.evict('Project', ORG + ':' + project, 'hibernate');
    expect(await hub.projectLife(project)).not.toBe(life);
    a.send([{ t: 'events', project, events: [say(a, project, 32)] }]);
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
    a.send([{ t: 'events', project, events: [say(a, project, 33)] }]);
    await browser.next((f) => f.t === 'log' && f.events.some((e) => e.offset === 33), 'live once caught up');
    expect(seen().filter((o) => o === 33)).toEqual([33]);
    follower.close();
    browser.close();
    a.close();
  });
});

describe('browsers', () => {
  it('a browser resuming at offset N receives exactly the events after N, then live', async () => {
    const project = newProject();
    const a = await machine('resume');
    await a.sync(project);
    a.send([{ t: 'events', project, events: Array.from({ length: 12 }, (_, i) => say(a, project, i + 1)) }]);
    await a.settled(project);
    const browser = await BrowserClient.open(hub, ADMIN, project);
    expect(browser.frames[0]).toMatchObject({ t: 'welcome', head: 12 });
    browser.send({ t: 'resume', after: 7 });
    const caught = await browser.next((f) => f.t === 'caught-up', 'caught-up');
    expect(caught).toEqual({ t: 'caught-up', offset: 12 });
    expect(browser.logged.map((e) => [e.offset, e.event.seq])).toEqual([8, 9, 10, 11, 12].map((n) => [n, n]));
    a.send([{ t: 'events', project, events: [say(a, project, 13)] }]);
    await browser.next((f) => f.t === 'log' && f.events.some((e) => e.offset === 13), 'the live event');
    expect(browser.logged.map((e) => e.offset)).toEqual([8, 9, 10, 11, 12, 13]);
    browser.close();
    a.close();
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
    a.close();
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
    a.close();
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
    a.send([{ t: 'events', project, events: [say(a, project, 1)] }]);
    await a.settled(project);
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
    a.close();
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
    a.close();
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
    a.close();
  });
});

describe('delivery failures', () => {
  it('ends a connection a live event could not be sent to; the machine reconnects, and its hello heals what it missed', async () => {
    const project = newProject();
    const source = await machine('live-source');
    const target = await machine('live-target');
    await source.sync(project);
    await target.sync(project);
    await hub.failNextSend(target.name, 'events');
    const event = say(source, project, 1);
    source.send([{ t: 'events', project, events: [event] }]);
    await until(() => !target.endpoint.isOpen);
    expect(countsOf(target, project)).toEqual({});
    await target.connect();
    await target.sync(project);
    // The backlog past its vector follows the `have`.
    await target.reaches(project, { [event.writer]: 1 });
    expect(countsOf(target, project)).toEqual({ [event.writer]: 1 });
    source.close();
    target.close();
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

async function waitFrames(m: Rl1Machine, count: number, predicate: (f: DownFrame) => boolean, from: number): Promise<DownFrame[]> {
  const deadline = Date.now() + 5000;
  for (;;) {
    const found = m.frames.slice(from).filter(predicate);
    if (found.length >= count) return found;
    if (Date.now() > deadline) throw new Error(`only ${found.length} of ${count}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
