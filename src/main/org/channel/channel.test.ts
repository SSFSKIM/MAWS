// A project's channel in main (P5 O8 M7a, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M7a's Touches for
// channel.ts and its *Words*, *The cache* and *Hub access* decisions): one per open project, released 30 s after its
// last tab closes. Its cache drawn at once and judged again, the socket resumed after the cache's offset once the
// attestations are read, `live` after `caught-up`, every event judged again at each adopted head, the owner's words
// addressed and answered, the hub's refusal of the project, signed out drawn "as of", and the cache written through the
// commit queue, last at `close()`. A fake socket and an in-memory store, over real signed states and events.
//
// UX wave U11a M4 (S-09; the execution document's Interfaces §F): the channel's own reach while it is not live and the
// hub's refusal of it while that stands, each sequence held open with a held attestations promise and the fake socket.
//
// `org.channel.changed` is a delta: the harness folds the open answer and each change after it as a renderer does
// (`latest()`), so every case checks what a tab would draw; `told()` is the last change as sent.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NO_CERTIFICATES, type HistoryAttestation, type OrgView, type Signed } from '../../../../apps/org-protocol/src/index.ts';
import { ChannelOrg, NOW, ORG, PROJECT, S1, S2 } from '../../../../test/org/channel-world';
import type { ChannelAnswer, ChannelChanged, ChannelEvent, ChannelHost, ChannelMachine, ChannelSession, ChannelWord } from '@shared/ipc/schema/org';
import type { MachineRef } from '@shared/machine/ref';
import { BUILD_HEADER } from '../hub-client';
import { fakeReach, fakeWake } from '../../../../test/support/wake-reach';
import type { Reach } from '../../net/reach';
import type { WakeSource } from '../../net/wake';
import type { WebSocketLike } from '../registry-feed';
import { heldOrgSession, type SignedIn } from '../session';
import { emptyLog, type ChannelCacheFile, type ChannelStore } from './cache';
import { createChannels, type Channels } from './channel';
import type { ChannelMachines, ProjectHosts } from './machines';

/** A judgment of an event whose text is `held.text` waits for `held.until`: a verification still in flight. */
const held = vi.hoisted(() => ({ text: null as string | null, until: Promise.resolve() }));
vi.mock('./verify', async (importOriginal) => {
  const real = await importOriginal<typeof import('./verify')>();
  return {
    ...real,
    judgeEvent: async (event: unknown, judging: Parameters<typeof real.judgeEvent>[1]) => {
      if (held.text !== null && (event as { text?: unknown }).text === held.text) await held.until;
      return real.judgeEvent(event, judging);
    },
  };
});

type Listener = (...args: never[]) => void;

class FakeSocket implements WebSocketLike {
  readonly #listeners = new Map<string, Listener[]>();
  readonly sent: Array<Record<string, unknown>> = [];
  closed = false;
  constructor(readonly url: string) {}
  on(event: string, listener: Listener): void {
    this.#listeners.set(event, [...(this.#listeners.get(event) ?? []), listener]);
  }
  send(text: string): void {
    this.sent.push(JSON.parse(text) as Record<string, unknown>);
  }
  ping(): void {}
  /** The app's own end of its socket (P5 O15 M2b §G rule 5): `closed` reads it. */
  terminate(): void {
    this.closed = true;
  }
  emit(event: string, ...args: unknown[]): void {
    for (const listener of this.#listeners.get(event) ?? []) (listener as (...a: unknown[]) => void)(...args);
  }
  frame(frame: unknown): void {
    this.emit('message', JSON.stringify(frame));
  }
  welcome(): void {
    this.emit('open');
    this.frame({ t: 'welcome', project: PROJECT });
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until<T>(check: () => T | null | undefined | false, what: string, ms = 5_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = check();
    if (value !== null && value !== undefined && value !== false) return value;
    if (Date.now() > deadline) throw new Error(`no ${what} within ${ms} ms`);
    await sleep(5);
  }
}

/** What a tab draws: the open answer, each change folded onto it by offset, `reset` replacing it. */
type Open = Extract<ChannelAnswer, { ok: true }>;
type Drawn =
  | { project: string; ok: true; events: ChannelEvent[]; sessions: ChannelSession[]; pending: ChannelWord[]; unverified: number; asOf: string | null; live: boolean; reach?: Open['reach']; refused?: Open['refused'] }
  | { project: string; ok: false; reason: string };

function fold(base: Drawn | undefined, change: ChannelChanged): Drawn | undefined {
  if (!change.ok) return change;
  if (change.reset !== true && (base === undefined || !base.ok)) throw new Error(`a delta onto nothing drawn: ${JSON.stringify(change)}`);
  const byOffset = new Map((change.reset === true || base === undefined || !base.ok ? [] : base.events).map((e) => [e.offset, e]));
  for (const offset of change.removed ?? []) byOffset.delete(offset);
  for (const event of change.upserts) byOffset.set(event.offset, event);
  const { project, sessions, pending, unverified, asOf, live, reach, refused } = change;
  const standing = { ...(reach === undefined ? {} : { reach }), ...(refused === undefined ? {} : { refused }) }; // told whole, as the rest
  return { project, ok: true, events: [...byOffset.values()].sort((a, b) => a.offset - b.offset), sessions, pending, unverified, asOf, live, ...standing };
}

const opened = (answer: ChannelAnswer | Drawn | undefined) => {
  if (answer === undefined || !answer.ok) throw new Error(`not open: ${JSON.stringify(answer)}`);
  return answer;
};
const delta = (change: ChannelChanged | undefined) => {
  if (change === undefined || !change.ok) throw new Error(`not a delta: ${JSON.stringify(change)}`);
  return change;
};

let channels: Channels | null = null;
afterEach(async () => {
  await channels?.close();
  channels = null;
});

async function harness(
  options: {
    seed?: (o: ChannelOrg) => Promise<ChannelCacheFile>;
    head?: (o: ChannelOrg) => OrgView['head'];
    records?: Signed<HistoryAttestation>[];
    signedIn?: boolean;
    hub?: boolean;
    events?: number;
    reading?: Promise<void>;
    coalesce?: number;
    machines?: ChannelMachines;
    wake?: WakeSource;
    reach?: Reach;
    /** The project's history attestations, for a case that holds or fails them; `records` at once by default. */
    attestations?: () => Promise<Signed<HistoryAttestation>[] | null>;
    /** The socket's reconnect waits (FEED_BACKOFF_MS); the feed's own by default. */
    backoff?: number[];
  } = {},
) {
  const o = await ChannelOrg.make();
  const cache = options.seed === undefined ? undefined : await options.seed(o);
  const view: OrgView = { head: options.head?.(o) ?? (() => o.head()), certificates: () => NO_CERTIFICATES, since: () => ({ states: [], transitions: [] }), advance: async () => {} };
  const hub = { url: 'https://hub.example.com', headers: async () => ({ 'cf-access-token': 't' }) };
  const signedIn = (withHub = options.hub ?? true): SignedIn => ({
    identity: { org: ORG, member: o.A, device: 'app', clientClass: 'native-mac', channelKey: o.app.channel, build: 'test', capabilities: [] },
    view,
    stepUp: { sign: () => Promise.reject(new Error('no step-up here')), signActions: () => Promise.reject(new Error('no step-up here')) },
    hub: withHub ? hub : null,
  });
  const session = heldOrgSession(options.signedIn === false ? null : signedIn());
  const files = new Map<string, unknown>(cache === undefined ? [] : [[PROJECT, JSON.parse(JSON.stringify(cache))]]);
  const writes: ChannelCacheFile[] = [];
  const store: ChannelStore = {
    read: async (project) => {
      await options.reading;
      return files.get(project) ?? null;
    },
    write: async (project, file) => {
      writes.push(file);
      files.set(project, JSON.parse(JSON.stringify(file)));
    },
  };
  const commits: string[] = [];
  let tail: Promise<unknown> = Promise.resolve();
  const sockets: FakeSocket[] = [];
  const changes: ChannelChanged[] = [];
  let reads = 0;
  const commit = <T,>(body: () => Promise<T>): Promise<T> => {
    commits.push('turn');
    const turn = tail.then(body);
    tail = turn.catch(() => {});
    return turn;
  };
  channels = createChannels({
    session,
    store,
    commit,
    attestations: async () => {
      reads++;
      return options.attestations === undefined ? (options.records ?? []) : options.attestations();
    },
    socket: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    now: () => NOW,
    ...(options.machines === undefined ? {} : { machines: options.machines }),
    ...(options.wake === undefined ? {} : { wake: options.wake }),
    ...(options.reach === undefined ? {} : { reach: options.reach }),
    timing: {
      CHANNEL_RELEASE_MS: 60,
      CHANNEL_WRITE_MS: 5,
      CHANNEL_COALESCE_MS: options.coalesce ?? 5,
      ...(options.events === undefined ? {} : { CHANNEL_CACHE_EVENTS: options.events }),
      ...(options.backoff === undefined ? {} : { FEED_BACKOFF_MS: options.backoff }),
    },
    random: () => 0.5,
    log: () => {},
  });
  // the tab: its open answers and the changes after the first, folded in arrival order
  let drawn: Drawn | undefined;
  channels.onChanged((changed) => {
    changes.push(changed);
    if (changed.project === PROJECT && drawn !== undefined) drawn = fold(drawn, changed);
  });
  const created = channels;
  const tab: Channels = {
    ...created,
    async open(project) {
      const answer = await created.open(project);
      if (project === PROJECT) drawn = { project, ...answer }; // a tab mounting draws the answer whole
      return answer;
    },
  };
  const last = () => sockets[sockets.length - 1];
  const latest = () => drawn;
  const told = () => changes.filter((c) => c.project === PROJECT).at(-1);
  return { o, session, signedIn, files, writes, commit, commits, sockets, changes, last, latest, told, reads: () => reads, channels: tab };
}

describe('a project channel', () => {
  it('draws its cache at once, resumes after its offset once the attestations are read, and reads live after caught-up', async () => {
    const h = await harness({
      seed: async (o) => {
        const cached = emptyLog({ org: ORG, member: o.A }, PROJECT, { events: 5000, bytes: 1 << 23 });
        await cached.add([{ offset: 7, event: await o.say(o.mini, 1, 'from the cache') }], { ctx: { org: ORG, project: PROJECT }, state: o.head().state, certificates: NO_CERTIFICATES, now: new Date(NOW) });
        cached.caughtUp(9, '2026-11-06T11:00:00.000Z');
        return cached.file();
      },
    });
    const answer = opened(await h.channels.open(PROJECT));
    expect(answer).toMatchObject({ live: false, asOf: '2026-11-06T11:00:00.000Z', pending: [], unverified: 0 });
    expect(answer.events.map((e) => [e.offset, e.label, e.event.text])).toEqual([[7, 'verified', 'from the cache']]);
    const socket = await until(() => h.last(), 'a socket');
    expect(h.reads()).toBe(1);
    expect(socket.url).toBe(`wss://hub.example.com/api/projects/${PROJECT}/socket`);
    socket.welcome();
    expect(socket.sent).toEqual([{ t: 'resume', after: 9 }]);
    const say = await h.o.say(h.o.mini, 1, 'hello');
    socket.frame({ t: 'log', events: [{ offset: 10, event: say }] });
    socket.frame({ t: 'caught-up', offset: 10 });
    const live = await until(() => {
      const c = h.latest();
      return c?.ok && c.live ? c : null;
    }, 'a live channel');
    expect(live.events.map((e) => [e.offset, e.label, e.event.text])).toEqual([
      [7, 'verified', 'from the cache'],
      [10, 'verified', 'hello'],
    ]);
    expect(live.asOf).toBe(new Date(NOW).toISOString());
    await until(() => h.writes.at(-1)?.after === 10, 'the cache written');
    expect(h.commits.length).toBeGreaterThan(0);
  });

  it('answers signed-out or no-hub with nothing cached, unknown-project for an id that is no project, and draws a cache offline', async () => {
    const out = await harness({ signedIn: false });
    expect(await out.channels.open(PROJECT)).toEqual({ ok: false, reason: 'signed-out', rev: expect.any(Number) });
    expect(await out.channels.open('../../etc/passwd')).toEqual({ ok: false, reason: 'unknown-project', rev: expect.any(Number) });
    const nohub = await harness({ hub: false });
    expect(await nohub.channels.open(PROJECT)).toEqual({ ok: false, reason: 'no-hub', rev: expect.any(Number) });
    expect(nohub.sockets).toHaveLength(0);

    const h = await harness();
    opened(await h.channels.open(PROJECT));
    const socket = await until(() => h.last(), 'a socket');
    socket.welcome();
    socket.frame({ t: 'log', events: [{ offset: 1, event: await h.o.say(h.o.mini, 1, 'kept') }] });
    socket.frame({ t: 'caught-up', offset: 1 });
    await until(() => h.writes.at(-1)?.after === 1, 'the cache written');
    h.session.set(null);
    const offline = await until(() => {
      const c = h.latest();
      return c?.ok && !c.live ? c : null;
    }, 'the channel offline');
    expect(socket.closed).toBe(true);
    expect(offline.events.map((e) => e.event.text)).toEqual(['kept']);
    expect(offline.asOf).toBe(new Date(NOW).toISOString());
  });

  // P5 O15 M2b §G: the channel's socket hears the wake source it was given: a wake of an hour drops it in the same turn,
  // the tab reads as catching up, and the hub's answer opens one socket, which resumes after the offset the channel held
  it('drops its socket at a wake, reads as catching up, and resumes after its offset at the hub’s answer', async () => {
    const wake = fakeWake();
    const reach = fakeReach();
    const h = await harness({ wake: wake.source, reach: reach.reach });
    opened(await h.channels.open(PROJECT));
    const socket = await until(() => h.last(), 'a socket');
    socket.welcome();
    socket.frame({ t: 'log', events: [{ offset: 3, event: await h.o.say(h.o.mini, 1, 'before the sleep') }] });
    socket.frame({ t: 'caught-up', offset: 3 });
    await until(() => opened(h.latest()).live, 'live');
    wake.wake(3_600_000);
    expect(socket.closed).toBe(true);
    expect(reach.windows).toEqual(['wake']);
    await until(() => !opened(h.latest()).live, 'catching up');
    await until(() => reach.waiting.length === 1, 'the wait on the hub');
    expect(h.sockets).toHaveLength(1);
    reach.answer(true);
    const next = await until(() => (h.sockets.length === 2 ? h.last() : null), 'the socket after the wake');
    next.welcome();
    expect(next.sent).toEqual([{ t: 'resume', after: 3 }]);
    next.frame({ t: 'caught-up', offset: 3 });
    await until(() => opened(h.latest()).live, 'live again');
    expect(opened(h.latest()).events.map((e) => e.event.text)).toEqual(['before the sleep']);
  });

  // Task 2's fix wave: a tab applies only the changes numbered past its open answer
  it('numbers each change past the last, across channels, and each open answer with the count as it stands', async () => {
    const h = await harness();
    const first = await h.channels.open(PROJECT); // the answer itself, as a tab gets it, `rev` and all
    const socket = await until(() => h.last(), 'a socket');
    socket.welcome();
    socket.frame({ t: 'log', events: [{ offset: 1, event: await h.o.say(h.o.mini, 1, 'one') }] });
    const one = delta(await until(() => h.told(), 'a change'));
    expect(one.rev).toBeGreaterThan(first.rev);
    const again = await h.channels.open(PROJECT);
    expect(again.rev).toBe(one.rev);
    socket.frame({ t: 'log', events: [{ offset: 2, event: await h.o.say(h.o.mini, 2, 'two') }] });
    const two = delta(await until(() => (h.told()?.rev ?? 0) > one.rev && h.told(), 'a later change'));
    expect(two.rev).toBe(one.rev + 1);
    const other = await h.channels.open('2f0e2d3c-4b5a-4968-8776-a5b4c3d2e1f0'); // another channel shares the count
    expect(other.rev).toBe(two.rev);
  });

  it("ends unknown-project when the hub doesn't hold the project, kept through a head, and opens again at the tab's next open", async () => {
    const h = await harness();
    opened(await h.channels.open(PROJECT));
    const socket = await until(() => h.last(), 'a socket');
    socket.emit('refused', 404, { [BUILD_HEADER]: 'b' });
    await until(() => h.latest()?.ok === false, 'the refusal');
    expect(h.latest()).toEqual({ project: PROJECT, ok: false, reason: 'unknown-project', rev: expect.any(Number) });
    expect(await h.channels.send(PROJECT, 'hello')).toMatchObject({ ok: false, reason: 'unreadable' });
    h.session.changed(); // a new head keeps the hub: no new socket, the refusal stands
    await sleep(30);
    expect(h.sockets).toHaveLength(1);
    expect(h.latest()).toEqual({ project: PROJECT, ok: false, reason: 'unknown-project', rev: expect.any(Number) });
    expect(await h.channels.open(PROJECT)).toMatchObject({ ok: true, live: false });
    await until(() => h.sockets.length === 2, 'a second socket');
    // a tab that drew the refusal holds nothing: what follows it is told whole
    expect(await until(() => h.told()?.ok && h.told(), 'a change after the refusal')).toMatchObject({ reset: true });
  });

  it('sends words addressed by a leading @alias among the log\'s sessions, sending until the ack, a refusal kept', async () => {
    const h = await harness();
    opened(await h.channels.open(PROJECT));
    const socket = await until(() => h.last(), 'a socket');
    socket.welcome();
    socket.frame({ t: 'log', events: [{ offset: 1, event: await h.o.joined(h.o.mini, 1, 'maws-45') }] });
    socket.frame({ t: 'caught-up', offset: 1 });
    await until(() => h.latest()?.ok && (h.latest() as { live: boolean }).live, 'live');
    expect(await h.channels.send(PROJECT, '@nobody hi')).toEqual({ ok: false, reason: 'no-member', detail: '@nobody' });
    const sent = await h.channels.send(PROJECT, '@maws-45 look');
    if (!sent.ok) throw new Error('unsent');
    const frame = socket.sent.find((f) => f.t === 'human') as { event: Record<string, unknown> };
    expect(frame.event).toMatchObject({ kind: 'human', member: h.o.A, to: [{ session: S1, alias: 'maws-45' }], text: '@maws-45 look', nonce: sent.nonce });
    expect(frame.event).not.toHaveProperty('mac');
    await until(() => opened(h.latest()).pending.length === 1, 'the word pending');
    expect(opened(h.latest()).pending[0]).toMatchObject({ nonce: sent.nonce, state: 'sending' });
    socket.frame({ t: 'human-ack', nonce: sent.nonce, offset: 2, writer: `hub/${h.o.A}`, seq: 1 });
    await until(() => opened(h.latest()).pending[0]?.state === 'sent', 'the word acknowledged');
    const echo = { ts: new Date(NOW).toISOString(), writer: `hub/${h.o.A}`, seq: 1, ...frame.event };
    socket.frame({ t: 'log', events: [{ offset: 2, event: echo }] });
    await until(() => opened(h.latest()).pending.length === 0, 'the word logged');
    const hidden = await h.channels.send(PROJECT, 'to someone hidden');
    if (!hidden.ok) throw new Error('unsent');
    socket.frame({ t: 'refused', refusal: { reason: 'not-reachable', nonce: hidden.nonce } });
    await until(() => opened(h.latest()).pending.some((w) => typeof w.state === 'object'), 'the refusal');
    expect(opened(h.latest()).pending).toEqual([{ nonce: hidden.nonce, text: 'to someone hidden', to: '*', state: { refused: 'not-reachable' } }]);
    expect(await h.channels.send('2f0e2d3c-4b5a-4968-8776-a5b4c3d2e1f0', 'hi')).toMatchObject({ ok: false, reason: 'not-open' });
  });

  // Task 2's fix round 2: main is the one source of a word's state, its words bound to the member who signed them
  it("shows only the signed-in member's words: another's sign-in hides them unsent, and its signer's shows them as they were", async () => {
    const h = await harness();
    opened(await h.channels.open(PROJECT));
    const first = await until(() => h.last(), 'a socket');
    first.welcome();
    const sending = await h.channels.send(PROJECT, 'before the switch');
    const acked = await h.channels.send(PROJECT, 'acked');
    if (!sending.ok || !acked.ok) throw new Error('unsent');
    first.frame({ t: 'human-ack', nonce: acked.nonce, offset: 2, writer: `hub/${h.o.A}`, seq: 1 });
    const mine = [
      { nonce: sending.nonce, text: 'before the switch', to: '*', state: 'sending' },
      { nonce: acked.nonce, text: 'acked', to: '*', state: 'sent' },
    ];
    await until(() => JSON.stringify(opened(h.latest()).pending) === JSON.stringify(mine), 'the ack');
    const ours = h.signedIn();
    h.session.set({ ...ours, identity: { ...ours.identity, member: h.o.B } });
    await until(() => opened(h.latest()).pending.length === 0, 'the words hidden');
    first.emit('close', 1006, '');
    const second = await until(() => (h.sockets.length === 2 ? h.last() : null), 'a reconnect', 5_000);
    second.welcome();
    expect(second.sent.some((f) => f.t === 'human')).toBe(false);
    h.session.set(ours);
    await until(() => opened(h.latest()).pending.length === 2, 'the words back');
    expect(opened(h.latest()).pending).toEqual(mine);
  });

  it('a word acknowledged after its tab closed is not Not sent at the next open; one never acknowledged is, until the next release', async () => {
    const h = await harness();
    opened(await h.channels.open(PROJECT));
    const socket = await until(() => h.last(), 'a socket');
    socket.welcome();
    const acked = await h.channels.send(PROJECT, 'acked in the grace');
    const lost = await h.channels.send(PROJECT, 'never acked');
    if (!acked.ok || !lost.ok) throw new Error('unsent');
    h.channels.release(PROJECT); // the tab is gone; the channel holds on for CHANNEL_RELEASE_MS
    socket.frame({ t: 'human-ack', nonce: acked.nonce, offset: 2, writer: `hub/${h.o.A}`, seq: 1 });
    await until(() => socket.closed, 'released', 2_000); // before the log's copy arrived
    expect(opened(await h.channels.open(PROJECT)).pending).toEqual([{ nonce: lost.nonce, text: 'never acked', to: '*', state: 'not-sent' }]);
    const again = await until(() => (h.sockets.length === 2 ? h.last() : null), 'a socket again');
    again.welcome();
    await sleep(20);
    expect(again.sent.some((f) => f.t === 'human')).toBe(false); // a word not sent is never sent later
    h.channels.release(PROJECT);
    await until(() => again.closed, 'released again', 2_000);
    expect(opened(await h.channels.open(PROJECT)).pending).toEqual([]);
  });

  it("keeps a member's words not sent for that member's next open of the project, never another's", async () => {
    const h = await harness();
    opened(await h.channels.open(PROJECT));
    const first = await until(() => h.last(), 'a socket');
    const lost = await h.channels.send(PROJECT, 'mine');
    if (!lost.ok) throw new Error('unsent');
    h.channels.release(PROJECT);
    await until(() => first.closed, 'released', 2_000);
    const ours = h.signedIn();
    h.session.set({ ...ours, identity: { ...ours.identity, member: h.o.B } });
    expect(opened(await h.channels.open(PROJECT)).pending).toEqual([]);
    const second = await until(() => (h.sockets.length === 2 ? h.last() : null), 'a socket again');
    h.channels.release(PROJECT);
    await until(() => second.closed, 'released again', 2_000);
    h.session.set(ours);
    expect(opened(await h.channels.open(PROJECT)).pending).toEqual([{ nonce: lost.nonce, text: 'mine', to: '*', state: 'not-sent' }]);
  });

  // Task 2's fix round 3 (the reviewer's repro): the log may hold a word main let go unacknowledged, heard while another
  // member held the channel; the word is delivered, never Not sent
  it('never recalls Not sent a word the log came to hold while another member held the channel', async () => {
    const h = await harness();
    opened(await h.channels.open(PROJECT));
    const first = await until(() => h.last(), 'a socket');
    first.welcome();
    const said = await h.channels.send(PROJECT, 'delivered without its ack');
    if (!said.ok) throw new Error('unsent');
    const draft = (first.sent.find((f) => f.t === 'human') as { event: Record<string, unknown> }).event;
    h.channels.release(PROJECT);
    await until(() => first.closed, 'released', 2_000);
    const ours = h.signedIn();
    h.session.set({ ...ours, identity: { ...ours.identity, member: h.o.B, device: 'b-app', channelKey: h.o.bDevice.channel } });
    opened(await h.channels.open(PROJECT));
    const second = await until(() => (h.sockets.length === 2 ? h.last() : null), 'a socket again');
    second.welcome();
    second.frame({ t: 'log', events: [{ offset: 1, event: { ts: new Date(NOW).toISOString(), writer: `hub/${h.o.A}`, seq: 1, ...draft } }] });
    await until(() => opened(h.latest()).events.some((e) => e.event.nonce === said.nonce), 'the log copy');
    h.channels.release(PROJECT);
    await until(() => second.closed, 'released again', 2_000);
    h.session.set(ours);
    const answer = opened(await h.channels.open(PROJECT));
    expect(answer.pending).toEqual([]);
    // B's log is B's: A reads the project afresh, on A's own socket, and draws the word from there
    expect(answer.events).toEqual([]);
    const third = await until(() => (h.sockets.length === 3 ? h.last() : null), "A's socket again");
    third.welcome();
    expect(third.sent).toEqual([{ t: 'resume', after: 0 }]);
    third.frame({ t: 'log', events: [{ offset: 1, event: { ts: new Date(NOW).toISOString(), writer: `hub/${h.o.A}`, seq: 1, ...draft } }] });
    await until(() => opened(h.latest()).events.some((e) => e.event.nonce === said.nonce), "the log copy on A's socket");
    expect(opened(h.latest()).pending).toEqual([]);
  });

  it('addresses a session whose joined the bound let go, from the cache after a reload, and tells the sessions', async () => {
    const h = await harness({
      events: 2,
      seed: async (o) => {
        const cached = emptyLog({ org: ORG, member: o.A }, PROJECT, { events: 2, bytes: 1 << 23 });
        const g = { ctx: { org: ORG, project: PROJECT }, state: o.head().state, certificates: NO_CERTIFICATES, now: new Date(NOW) };
        await cached.add([{ offset: 1, event: await o.joined(o.mini, 1, 'maws-45') }, { offset: 2, event: await o.say(o.mini, 2, 'two') }, { offset: 3, event: await o.say(o.mini, 3, 'three') }], g);
        return cached.file();
      },
    });
    const answer = opened(await h.channels.open(PROJECT));
    expect(answer.events.map((e) => e.offset)).toEqual([2, 3]);
    expect(answer.sessions).toEqual([{ session: S1, alias: 'maws-45', machine: 'mini', title: null, member: true, authenticated: true }]);
    const socket = await until(() => h.last(), 'a socket');
    socket.welcome();
    socket.frame({ t: 'log', events: [{ offset: 4, event: await h.o.lifecycle(h.o.mini, 4, 'renamed', { alias: 'maws-46' }) }] });
    await until(() => opened(h.latest()).sessions[0]?.alias === 'maws-46', 'the rename told');
    const sent = await h.channels.send(PROJECT, '@maws-46 still there?');
    expect(sent).toMatchObject({ ok: true });
    expect(socket.sent.find((f) => f.t === 'human')).toMatchObject({ event: { to: [{ session: S1, alias: 'maws-46' }] } });
  });

  it('resends unanswered words at the next welcome, with the same nonce', async () => {
    const h = await harness();
    opened(await h.channels.open(PROJECT));
    const first = await until(() => h.last(), 'a socket');
    first.welcome();
    const sent = await h.channels.send(PROJECT, 'over a blip');
    if (!sent.ok) throw new Error('unsent');
    first.emit('close', 1006, '');
    const second = await until(() => (h.sockets.length === 2 ? h.last() : null), 'a reconnect', 5_000);
    second.welcome();
    expect(second.sent.find((f) => f.t === 'human')).toMatchObject({ event: { nonce: sent.nonce } });
  });

  it('judges a failed event again at each adopted head', async () => {
    const h = await harness();
    opened(await h.channels.open(PROJECT));
    const socket = await until(() => h.last(), 'a socket');
    socket.welcome();
    const studio = await h.o.machine('studio');
    socket.frame({ t: 'log', events: [{ offset: 1, event: await h.o.say(studio, 1, 'early') }] });
    socket.frame({ t: 'caught-up', offset: 1 });
    await until(() => opened(h.latest()).unverified === 1, 'the failed event counted');
    expect(opened(h.latest()).events).toEqual([]);
    const spare = await h.o.machine('spare');
    await h.o.adopt((s) => {
      s.machines.push({ name: 'spare', ref: spare.ref, pub: spare.key.pub, owners: [h.o.A] });
      s.machineNames.push({ name: 'spare', ref: spare.ref });
    });
    const before = h.changes.length;
    h.session.changed();
    await sleep(30);
    expect(h.changes.slice(before).some((c) => c.ok && c.reset === true)).toBe(false); // no verdict changed
    await h.o.adopt((s) => {
      s.machines.push({ name: 'studio', ref: studio.ref, pub: studio.key.pub, owners: [h.o.A] });
      s.machineNames.push({ name: 'studio', ref: studio.ref });
    });
    h.session.changed();
    await until(() => opened(h.latest()).unverified === 0, 'the event verified');
    expect(opened(h.latest()).events.map((e) => e.event.text)).toEqual(['early']);
    expect(delta(h.told())).toMatchObject({ reset: true, upserts: [{ offset: 1, label: 'verified' }] });
  });

  // the branch review's finding: the load judges the cache under the head it read first, so that head, and no later
  // one, is what it records as judged
  it('judges its cache again when a head adopted during the load ends a signer the load verified it under', async () => {
    const h = await harness({
      seed: async (o) => {
        const studio = await o.machine('studio');
        await o.adopt((s) => {
          s.machines.push({ name: 'studio', ref: studio.ref, pub: studio.key.pub, owners: [o.A] });
          s.machineNames.push({ name: 'studio', ref: studio.ref });
        });
        const cached = emptyLog({ org: ORG, member: o.A }, PROJECT, { events: 5000, bytes: 1 << 23 });
        await cached.add([{ offset: 1, event: await o.say(studio, 1, 'from studio') }], { ctx: { org: ORG, project: PROJECT }, state: o.head().state, certificates: NO_CERTIFICATES, now: new Date(NOW) });
        expect(cached.events().map((e) => e.label)).toEqual(['verified']);
        await o.adopt((s) => {
          s.machines = s.machines.filter((m) => m.ref !== studio.ref); // the head that ends studio, adopted mid-load
        });
        return cached.file();
      },
      // the load reads the head that still lists studio; every read after it gets the one that ended it
      head: (o) => {
        let reads = 0;
        const listing = o.chain[o.chain.length - 2];
        return () => (reads++ === 0 ? listing : o.head());
      },
    });
    opened(await h.channels.open(PROJECT));
    await until(() => opened(h.latest()).unverified === 1, 'the event judged again under the later head', 1_000);
    expect(opened(h.latest()).events).toEqual([]);
  });

  it('tells each change as a delta: a page or a live event sends only its events, and the tab draws what a new open would', async () => {
    const h = await harness();
    opened(await h.channels.open(PROJECT));
    const socket = await until(() => h.last(), 'a socket');
    socket.welcome();
    const says = await Promise.all([1, 2, 3].map((n) => h.o.say(h.o.mini, n, `say ${n}`)));
    socket.frame({ t: 'log', events: [{ offset: 1, event: says[0] }, { offset: 2, event: says[1] }] });
    socket.frame({ t: 'caught-up', offset: 2 });
    await until(() => opened(h.latest()).live, 'live');
    socket.frame({ t: 'log', events: [{ offset: 3, event: says[2] }] });
    await until(() => opened(h.latest()).events.length === 3, 'the live event');
    expect(delta(h.told()).upserts.map((e) => e.offset)).toEqual([3]);
    expect(h.changes.some((c) => c.ok && (c.reset === true || c.upserts.length > 2))).toBe(false);
    const drawn = opened(h.latest());
    const fresh = opened(await h.channels.open(PROJECT));
    expect(drawn.events).toEqual(fresh.events);
    expect(drawn).toMatchObject({ pending: fresh.pending, unverified: fresh.unverified, asOf: fresh.asOf, live: fresh.live });
  });

  it("tells each event main lets go (removed): a tab holds main's bounded set, so a revoked signer's evicted event is held nowhere", async () => {
    const h = await harness({ events: 2 });
    const studio = await h.o.machine('studio');
    await h.o.adopt((s) => {
      s.machines.push({ name: 'studio', ref: studio.ref, pub: studio.key.pub, owners: [h.o.A] });
      s.machineNames.push({ name: 'studio', ref: studio.ref });
    });
    opened(await h.channels.open(PROJECT));
    const socket = await until(() => h.last(), 'a socket');
    socket.welcome();
    socket.frame({ t: 'log', events: [{ offset: 1, event: await h.o.say(studio, 1, 'from studio') }, { offset: 2, event: await h.o.say(h.o.mini, 1, 'one') }] });
    socket.frame({ t: 'caught-up', offset: 2 });
    await until(() => opened(h.latest()).live && opened(h.latest()).events.length === 2, 'live');
    socket.frame({ t: 'log', events: [{ offset: 3, event: await h.o.say(h.o.mini, 2, 'two') }] });
    await until(() => opened(h.latest()).events.some((e) => e.offset === 3), 'the live event');
    expect(delta(h.told())).toMatchObject({ upserts: [{ offset: 3 }], removed: [1] });
    expect(delta(h.told()).reset).toBeUndefined();
    // the head revokes studio: nothing of it is drawn, by main or by the tab
    await h.o.adopt((s) => {
      s.machines = s.machines.filter((m) => m.ref !== studio.ref);
    });
    h.session.changed();
    await sleep(30);
    expect(opened(h.latest()).events.map((e) => e.offset)).toEqual([2, 3]);
    expect(opened(h.latest()).events).toEqual(opened(await h.channels.open(PROJECT)).events);
  });

  it('removes an offset a later open exposed, when the bound lets it go before the next change is told', async () => {
    const h = await harness({ events: 1, coalesce: 200 });
    opened(await h.channels.open(PROJECT));
    const socket = await until(() => h.last(), 'a socket');
    socket.welcome();
    socket.frame({ t: 'log', events: [{ offset: 1, event: await h.o.say(h.o.mini, 1, 'one') }] });
    await until(() => opened(h.latest()).events.length === 1, 'offset 1 told');
    const [two, three] = await Promise.all([h.o.say(h.o.mini, 2, 'two'), h.o.say(h.o.mini, 3, 'three')]);
    socket.frame({ t: 'log', events: [{ offset: 2, event: two }] });
    await sleep(30); // 2 is held (and 1 let go); the change isn't told yet
    // a second tab mounts and draws 2
    expect(opened(await h.channels.open(PROJECT)).events.map((e) => e.offset)).toEqual([2]);
    socket.frame({ t: 'log', events: [{ offset: 3, event: three }] }); // lets 2 go, within the same coalesced change
    await until(() => opened(h.latest()).events.some((e) => e.offset === 3), 'offset 3 told');
    expect(delta(h.told()).removed).toEqual(expect.arrayContaining([2]));
    expect(opened(h.latest()).events.map((e) => e.offset)).toEqual([3]);
  });

  it("drops another org's log at its sign-in, told as a reset, and reads that org's log afresh", async () => {
    const h = await harness();
    opened(await h.channels.open(PROJECT));
    const socket = await until(() => h.last(), 'a socket');
    socket.welcome();
    socket.frame({ t: 'log', events: [{ offset: 1, event: await h.o.say(h.o.mini, 1, 'ours') }] });
    socket.frame({ t: 'caught-up', offset: 1 });
    await until(() => opened(h.latest()).live, 'live');
    const ours = h.signedIn();
    h.session.set({ ...ours, identity: { ...ours.identity, org: 'another-org' } });
    await until(() => opened(h.latest()).events.length === 0, 'the log dropped');
    expect(h.changes.some((c) => c.ok && c.reset === true && c.upserts.length === 0)).toBe(true);
    const next = await until(() => (h.sockets.length === 2 ? h.last() : null), "the other org's socket");
    expect(socket.closed).toBe(true);
    next.welcome();
    expect(next.sent).toEqual([{ t: 'resume', after: 0 }]);
  });

  // the branch review's finding: what the hub served one member (an audience stream only its members read, P5 O18) and
  // the offset that member's socket reached are never another member's
  it("scopes the held log, its file and its cursor to the member: another member of the org draws none of it and resumes from its own", async () => {
    const h = await harness();
    opened(await h.channels.open(PROJECT));
    const socket = await until(() => h.last(), 'a socket');
    socket.welcome();
    const scoped = await h.o.say(h.o.mini, 1, 'for A alone', [h.o.A], `${S2}~0123456789abcdef`);
    socket.frame({ t: 'log', events: [{ offset: 5, event: scoped }, { offset: 6, event: await h.o.joined(h.o.mini, 2, 'a-only', S2, '~0123456789abcdef') }] });
    socket.frame({ t: 'caught-up', offset: 6 });
    await until(() => opened(h.latest()).live, 'live');
    expect(opened(h.latest()).events.map((e) => e.offset)).toEqual([5, 6]);
    await until(() => h.writes.at(-1)?.after === 6, "A's cache written");
    const ours = h.signedIn();
    h.session.set({ ...ours, identity: { ...ours.identity, member: h.o.B, device: 'b-app', channelKey: h.o.bDevice.channel } });
    // a tab B opens at once draws nothing of A's, nor addresses A's sessions
    const b = opened(await h.channels.open(PROJECT));
    expect(b.events).toEqual([]);
    expect(b.sessions).toEqual([]);
    expect(b.asOf).toBeNull();
    await until(() => opened(h.latest()).events.length === 0, "A's log dropped");
    expect(opened(h.latest()).sessions).toEqual([]);
    const next = await until(() => (h.sockets.length === 2 ? h.last() : null), "B's socket");
    expect(socket.closed).toBe(true);
    next.welcome();
    expect(next.sent).toEqual([{ t: 'resume', after: 0 }]); // B's own cursor: B has read nothing yet
    next.frame({ t: 'log', events: [{ offset: 2, event: await h.o.say(h.o.mini, 3, 'for everyone') }] });
    next.frame({ t: 'caught-up', offset: 6 });
    await until(() => h.writes.at(-1)?.member === h.o.B && h.writes.at(-1)?.events.length === 1, "B's cache written");
    expect(h.writes.at(-1)?.events.map((e) => e.event.text)).toEqual(['for everyone']);
  });

  it('reads the attestations again when a DX1 writer passes every one it holds', async () => {
    const h = await harness();
    opened(await h.channels.open(PROJECT));
    const socket = await until(() => h.last(), 'a socket');
    expect(h.reads()).toBe(1);
    socket.welcome();
    socket.frame({ t: 'log', events: [{ offset: 1, event: h.o.dx1('oldmini', 1) }] });
    await until(() => h.reads() === 2, 'the attestations read again');
    socket.frame({ t: 'log', events: [{ offset: 2, event: await h.o.say(h.o.mini, 1, 'v2') }] });
    await sleep(30);
    expect(h.reads()).toBe(2);
  });

  it('is released after its last tab closes; one reopened before keeps its socket', async () => {
    const h = await harness();
    opened(await h.channels.open(PROJECT));
    opened(await h.channels.open(PROJECT));
    const socket = await until(() => h.last(), 'a socket');
    h.channels.release(PROJECT);
    h.channels.release(PROJECT);
    await sleep(20);
    opened(await h.channels.open(PROJECT));
    await sleep(80);
    expect(socket.closed).toBe(false);
    h.channels.release(PROJECT);
    await until(() => socket.closed, 'the socket closed at release', 2_000);
    expect(await h.channels.send(PROJECT, 'hi')).toMatchObject({ ok: false, reason: 'not-open' });
  });

  it('enters its cache write in the commit queue only once its own work is done: the queue never waits on a channel', async () => {
    let read!: () => void;
    const h = await harness({ reading: new Promise<void>((resolve) => (read = resolve)) });
    const opening = h.channels.open(PROJECT); // its cache read holds the channel's own queue
    await sleep(5);
    const closing = h.channels.close();
    let ran = false;
    void h.commit(async () => {
      ran = true;
    });
    await sleep(20);
    expect(ran).toBe(true);
    read();
    await Promise.all([opening, closing]);
  });

  // the branch re-review's finding: a channel released while a judgment is in flight writes last, after the project's
  // next channel, so only the project's current channel may write its file
  it("never lets a released channel's last snapshot replace the file of the project's channel after it", async () => {
    const h = await harness();
    opened(await h.channels.open(PROJECT)); // A
    const first = await until(() => h.last(), "A's socket");
    first.welcome();
    first.frame({ t: 'log', events: [{ offset: 1, event: await h.o.say(h.o.mini, 1, 'first') }] });
    first.frame({ t: 'caught-up', offset: 1 });
    await until(() => h.writes.at(-1)?.after === 1, "A's cache written");
    let judged!: () => void;
    held.text = 'judged slowly';
    held.until = new Promise<void>((resolve) => (judged = resolve));
    first.frame({ t: 'log', events: [{ offset: 10, event: await h.o.say(h.o.mini, 2, 'judged slowly') }] }); // in flight
    h.channels.release(PROJECT);
    await until(() => first.closed, 'A released', 2_000);
    opened(await h.channels.open(PROJECT)); // B, from the file A wrote at 1
    const second = await until(() => (h.sockets.length === 2 ? h.last() : null), "B's socket");
    second.welcome();
    expect(second.sent).toEqual([{ t: 'resume', after: 1 }]);
    const said = await h.channels.send(PROJECT, "B's word");
    if (!said.ok) throw new Error('unsent');
    const draft = (second.sent.find((f) => f.t === 'human') as { event: Record<string, unknown> }).event;
    second.frame({ t: 'log', events: [{ offset: 20, event: { ts: new Date(NOW).toISOString(), writer: `hub/${h.o.A}`, seq: 1, ...draft } }] });
    second.frame({ t: 'caught-up', offset: 20 });
    await until(() => h.writes.at(-1)?.after === 20, "B's cache written", 1_000).finally(() => judged());
    // A's judgment lands, and A's last snapshot after it
    held.text = null;
    await sleep(50);
    await h.commit(async () => {});
    expect(h.files.get(PROJECT)).toMatchObject({ after: 20 });
    h.channels.release(PROJECT);
    await until(() => second.closed, 'B released', 2_000);
    h.session.set(h.signedIn(false)); // the hub away
    const reopened = opened(await h.channels.open(PROJECT));
    expect(reopened.events.map((e) => e.event.nonce)).toContain(said.nonce);
  });

  it('writes its cache through the commit queue at close, and nothing after', async () => {
    const h = await harness({ records: [] });
    opened(await h.channels.open(PROJECT));
    const socket = await until(() => h.last(), 'a socket');
    socket.welcome();
    socket.frame({ t: 'log', events: [{ offset: 3, event: await h.o.say(h.o.mini, 1, 'last words') }] });
    await sleep(0);
    await h.channels.close();
    await h.commit(async () => {}); // the queue's tail: the last write was entered before close resolved
    expect(h.writes.at(-1)?.events.map((e) => e.offset)).toEqual([3]);
    expect(socket.closed).toBe(true);
    const written = h.writes.length;
    socket.frame({ t: 'log', events: [{ offset: 4, event: await h.o.say(h.o.mini, 2, 'too late') }] });
    await sleep(30);
    expect(h.writes.length).toBe(written);
  });
});

// M7b: every machine's to-human entries (machines.ts, stood in for here) in the answer and told by key in each change.
describe('the machines’ to-human entries', () => {
  const MINI = 'mini-machine-000000001' as MachineRef;
  const host = (id: string, minute: number): ChannelHost => ({
    key: `${MINI} ${id}`,
    machine: MINI,
    id,
    lane: 'A',
    session: 'la-1',
    kind: 'message',
    text: id,
    at: new Date(NOW + minute * 60_000).toISOString(),
    src: `p/w/${id}`,
    order: minute,
  });
  function stand() {
    let entries: ChannelHost[] = [];
    let machines: ChannelMachine[] = [{ machine: MINI, name: 'mini', state: 'live', asOf: null }];
    const listeners = new Set<(reset: boolean) => void>();
    let closed = 0;
    const hosts: ProjectHosts = {
      loaded: Promise.resolve(),
      entries: () => entries,
      machines: () => machines,
      onChanged(listener) {
        listeners.add(listener);
        return () => void listeners.delete(listener);
      },
      close: async () => void (closed += 1),
    };
    return {
      machines: { open: () => hosts, close: async () => {} } satisfies ChannelMachines,
      set(next: ChannelHost[], options: { reset?: boolean; machines?: ChannelMachine[] } = {}) {
        entries = next;
        machines = options.machines ?? machines;
        for (const listener of [...listeners]) listener(options.reset ?? false);
      },
      closed: () => closed,
    };
  }
  const hostsOf = (change: ChannelChanged | undefined) => {
    const told = delta(change);
    return { ...told.hosts, machines: told.machines };
  };

  it('answers them beside the events, and tells each change by key: new ones, gone ones, and the machines whole', async () => {
    const m = stand();
    m.set([host('a', 1)]);
    const h = await harness({ machines: m.machines });
    const answer = await h.channels.open(PROJECT);
    if (!answer.ok) throw new Error(`not open: ${answer.reason}`);
    expect(answer.hosts).toEqual([host('a', 1)]);
    expect(answer.machines).toEqual([{ machine: MINI, name: 'mini', state: 'live', asOf: null }]);
    m.set([host('a', 1), host('b', 2)]);
    await until(() => h.told()?.ok && delta(h.told()).hosts?.upserts.length === 1, 'b told');
    expect(hostsOf(h.told())).toEqual({ upserts: [host('b', 2)], removed: [], machines: [{ machine: MINI, name: 'mini', state: 'live', asOf: null }] });
    const offline: ChannelMachine[] = [{ machine: MINI, name: 'mini', state: 'offline', asOf: '2026-11-06T12:30:00.000Z' }];
    m.set([host('b', 2)], { machines: offline });
    await until(() => delta(h.told()).hosts?.removed.length === 1, 'a removed');
    expect(hostsOf(h.told())).toEqual({ upserts: [], removed: [`${MINI} a`], machines: offline });
    m.set([host('c', 3)], { reset: true });
    await until(() => delta(h.told()).hosts?.reset === true, 'a reset');
    expect(hostsOf(h.told())).toEqual({ reset: true, upserts: [host('c', 3)], removed: [], machines: offline });
  });

  it('answers open with to-human entries and nothing of the log’s, and closes the machines with the channel', async () => {
    const m = stand();
    m.set([host('a', 1)]);
    const h = await harness({ hub: false, machines: m.machines });
    expect(opened(await h.channels.open(PROJECT))).toMatchObject({ live: false, events: [], hosts: [host('a', 1)] });
    h.channels.release(PROJECT);
    await until(() => m.closed() === 1, 'the machines closed');
  });
});

// UX wave U11a M4 (S-09; Interfaces §F's table of transitions): the channel tells its own reach while it is not live, and
// the hub's refusal of it while that stands, with every open answer and as a change whenever either moves.
describe('the channel’s reach and refusal', () => {
  /** A cache of one event, caught up an hour before: what a Mac that read the channel once holds. */
  const cached = async (o: ChannelOrg) => {
    const log = emptyLog({ org: ORG, member: o.A }, PROJECT, { events: 5000, bytes: 1 << 23 });
    await log.add([{ offset: 1, event: await o.say(o.mini, 1, 'from the cache') }], { ctx: { org: ORG, project: PROJECT }, state: o.head().state, certificates: NO_CERTIFICATES, now: new Date(NOW) });
    log.caughtUp(1, '2026-11-06T11:00:00.000Z');
    return log.file();
  };
  /** An attestations read the case answers, or fails (null), when it chooses. */
  const heldRead = () => {
    let answer!: (records: Signed<HistoryAttestation>[] | null) => void;
    const read = new Promise<Signed<HistoryAttestation>[] | null>((resolve) => (answer = resolve));
    return { read: () => read, answer };
  };
  type Harness = Awaited<ReturnType<typeof harness>>;
  const standing = (h: Harness) => {
    const c = opened(h.latest());
    return { live: c.live, reach: c.reach, refused: c.refused };
  };
  /** Each reach the changes told for the project, in order, a live one as `live`. */
  const reachesTold = (h: Harness) => h.changes.filter((c) => c.project === PROJECT && c.ok).map((c) => (c.ok && c.live ? 'live' : c.ok ? c.reach : null));
  const live = async (h: Harness, socket = h.last(), offset = 1) => {
    socket.welcome();
    socket.frame({ t: 'caught-up', offset });
    await until(() => opened(h.latest()).live, 'live');
  };

  it('(a) answers at once from the cache while the attestations hang, reading connecting', async () => {
    const attest = heldRead();
    const h = await harness({ seed: cached, attestations: attest.read });
    const answer = await Promise.race([h.channels.open(PROJECT), sleep(1_000).then(() => 'late' as const)]);
    expect(answer).not.toBe('late');
    expect(opened(answer as ChannelAnswer)).toMatchObject({ live: false, reach: 'connecting', asOf: '2026-11-06T11:00:00.000Z' });
    expect(opened(answer as ChannelAnswer)).not.toHaveProperty('refused');
    expect(opened(answer as ChannelAnswer).events.map((e) => e.event.text)).toEqual(['from the cache']);
    expect(h.sockets).toHaveLength(0); // the socket waits on the attestations
    attest.answer([]);
    await until(() => h.last(), 'a socket');
  });

  it('(b) turns unreachable when the attestations fail, stays so through a socket error before the welcome, and is live with no reach after caught-up', async () => {
    const attest = heldRead();
    const h = await harness({ seed: cached, attestations: attest.read, backoff: [20] });
    expect(opened(await h.channels.open(PROJECT)).reach).toBe('connecting');
    attest.answer(null);
    await until(() => standing(h).reach === 'unreachable', 'unreachable');
    const first = await until(() => h.last(), 'a socket');
    first.emit('error', new Error('getaddrinfo ENOTFOUND'));
    const second = await until(() => (h.sockets.length === 2 ? h.last() : null), 'the retry');
    expect(standing(h)).toEqual({ live: false, reach: 'unreachable', refused: undefined });
    second.welcome(); // welcomed, not caught up: unchanged
    await sleep(20);
    expect(standing(h).reach).toBe('unreachable');
    second.frame({ t: 'caught-up', offset: 1 });
    await until(() => opened(h.latest()).live, 'live');
    expect(opened(h.latest())).not.toHaveProperty('reach');
    expect(reachesTold(h)).toEqual(['unreachable', 'live']); // no flicker to connecting at the retry
  });

  it('(c) reads connecting when a live channel loses its socket, and unreachable when the next fails before its welcome', async () => {
    const h = await harness({ seed: cached, backoff: [20] });
    opened(await h.channels.open(PROJECT));
    const first = await until(() => h.last(), 'a socket');
    await live(h, first);
    first.emit('close', 1006, '');
    await until(() => !opened(h.latest()).live, 'not live');
    expect(standing(h)).toEqual({ live: false, reach: 'connecting', refused: undefined });
    const second = await until(() => (h.sockets.length === 2 ? h.last() : null), 'the retry');
    second.emit('close', 1006, '');
    await until(() => standing(h).reach === 'unreachable', 'unreachable');
  });

  it('(d) answers a second open during an outage unreachable, and opens no second socket', async () => {
    const h = await harness({ seed: cached, attestations: async () => null, backoff: [5_000] });
    opened(await h.channels.open(PROJECT));
    await until(() => standing(h).reach === 'unreachable', 'unreachable');
    const socket = await until(() => h.last(), 'a socket');
    socket.emit('error', new Error('offline'));
    const again = opened(await h.channels.open(PROJECT));
    expect(again).toMatchObject({ live: false, reach: 'unreachable' });
    await sleep(30);
    expect(h.sockets).toHaveLength(1);
  });

  it('(e) starts again at connecting when the member signs out, and again when they sign back in', async () => {
    const h = await harness({ seed: cached, attestations: async () => null, backoff: [5_000] });
    opened(await h.channels.open(PROJECT));
    await until(() => standing(h).reach === 'unreachable', 'unreachable');
    const ours = h.signedIn();
    h.session.set(null);
    await until(() => standing(h).reach === 'connecting', 'connecting, signed out');
    expect(h.last().closed).toBe(true);
    h.session.set(ours);
    const next = await until(() => (h.sockets.length === 2 ? h.last() : null), 'a socket at the sign-in');
    expect(standing(h)).toEqual({ live: false, reach: 'connecting', refused: undefined });
    next.emit('error', new Error('offline'));
    await until(() => standing(h).reach === 'unreachable', 'unreachable again');
    expect(reachesTold(h)).toEqual(['unreachable', 'connecting', 'unreachable']);
  });

  it('(f) opens no socket once released during the backoff', async () => {
    const h = await harness({ seed: cached, backoff: [200] });
    opened(await h.channels.open(PROJECT));
    const socket = await until(() => h.last(), 'a socket');
    socket.emit('error', new Error('offline'));
    await until(() => standing(h).reach === 'unreachable', 'unreachable');
    h.channels.release(PROJECT); // CHANNEL_RELEASE_MS (60) before the retry's 200
    await sleep(400);
    expect(h.sockets).toHaveLength(1);
  });

  it('(g) from connecting, a close with the sign-in’s code reads refused credentials and opens no socket afterwards', async () => {
    const h = await harness({ seed: cached, backoff: [20] });
    opened(await h.channels.open(PROJECT));
    const socket = await until(() => h.last(), 'a socket');
    socket.emit('refused', 302, {}); // Access answered the upgrade, not the Worker
    await until(() => standing(h).refused === 'credentials', 'the refusal');
    expect(standing(h)).toEqual({ live: false, reach: 'connecting', refused: 'credentials' });
    await sleep(100);
    expect(h.sockets).toHaveLength(1);
    expect(await h.channels.send(PROJECT, 'hello')).toMatchObject({ ok: false, reason: 'unreadable' });
  });

  it('(h) reads connecting when a wake drops a live socket', async () => {
    const wake = fakeWake();
    const reach = fakeReach();
    const h = await harness({ seed: cached, wake: wake.source, reach: reach.reach });
    opened(await h.channels.open(PROJECT));
    await live(h, await until(() => h.last(), 'a socket'));
    wake.wake(3_600_000);
    await until(() => !opened(h.latest()).live, 'not live');
    expect(standing(h)).toEqual({ live: false, reach: 'connecting', refused: undefined });
  });

  it('(i) after unreachable, a close with the sign-in’s code is told as refused beside the unchanged reach; nothing is retried until the session changes, which reads connecting and opens one', async () => {
    const h = await harness({ seed: cached, attestations: async () => null, backoff: [20] });
    opened(await h.channels.open(PROJECT));
    await until(() => standing(h).reach === 'unreachable', 'unreachable');
    const socket = await until(() => h.last(), 'a socket');
    socket.emit('refused', 401, {}); // the hub sign-in has ended; the org's hub status is another component's and may read connected
    await until(() => standing(h).refused === 'credentials', 'the refusal');
    expect(standing(h)).toEqual({ live: false, reach: 'unreachable', refused: 'credentials' });
    expect(delta(h.told())).toMatchObject({ reach: 'unreachable', refused: 'credentials' });
    await sleep(100);
    expect(h.sockets).toHaveLength(1);
    h.session.changed(); // the session's next change (here a head adopted)
    await until(() => standing(h).refused === undefined, 'the refusal cleared');
    expect(standing(h).reach).toBe('connecting');
    await until(() => (h.sockets.length === 2 ? h.last() : null), 'a socket again');
  });

  // M4's review: a refusal stands until the session changes; another tab's open of the channel while it is held keeps it,
  // and only a released channel opened again starts it over
  const refusals = [
    ['credentials', (socket: FakeSocket) => socket.emit('refused', 401, {})],
    ['removed', (socket: FakeSocket) => socket.emit('close', 4403, '')],
  ] as const;
  const refusedHarness = async (refuse: (socket: FakeSocket) => void, refused: 'credentials' | 'removed') => {
    const h = await harness({ seed: cached, attestations: async () => null, backoff: [20] });
    opened(await h.channels.open(PROJECT));
    await until(() => standing(h).reach === 'unreachable', 'unreachable');
    refuse(await until(() => h.last(), 'a socket'));
    await until(() => standing(h).refused === refused, 'the refusal');
    return h;
  };

  it.each(refusals)('keeps a %s refusal and its reach through another open while the channel is held, opening no socket', async (refused, refuse) => {
    const h = await refusedHarness(refuse, refused);
    const before = h.changes.length;
    expect(opened(await h.channels.open(PROJECT))).toMatchObject({ live: false, reach: 'unreachable', refused });
    await sleep(100);
    expect(h.sockets).toHaveLength(1);
    expect(standing(h)).toEqual({ live: false, reach: 'unreachable', refused });
    expect(h.changes.length).toBe(before); // the tabs already open are told nothing: the refusal stands for them
    expect(await h.channels.send(PROJECT, 'hello')).toMatchObject({ ok: false, reason: 'unreadable' });
  });

  it.each(refusals)('clears a %s refusal at the session’s next change, reading connecting and opening a socket', async (refused, refuse) => {
    const h = await refusedHarness(refuse, refused);
    h.session.changed();
    await until(() => standing(h).refused === undefined, 'the refusal cleared');
    expect(standing(h).reach).toBe('connecting');
    await until(() => (h.sockets.length === 2 ? h.last() : null), 'a socket again');
  });

  it.each(refusals)('clears a %s refusal when the channel, released, is opened again', async (refused, refuse) => {
    const h = await refusedHarness(refuse, refused);
    h.channels.release(PROJECT); // inside CHANNEL_RELEASE_MS: the channel is kept, with no tab
    const again = opened(await h.channels.open(PROJECT));
    expect(again).toMatchObject({ live: false, reach: 'connecting' });
    expect(again).not.toHaveProperty('refused');
    await until(() => (h.sockets.length === 2 ? h.last() : null), 'a socket again');
  });

  it('(j) the same with the code of a member the hub no longer admits: refused removed', async () => {
    const h = await harness({ seed: cached, attestations: async () => null, backoff: [20] });
    opened(await h.channels.open(PROJECT));
    await until(() => standing(h).reach === 'unreachable', 'unreachable');
    const socket = await until(() => h.last(), 'a socket');
    socket.emit('close', 4403, '');
    await until(() => standing(h).refused === 'removed', 'the refusal');
    expect(standing(h)).toEqual({ live: false, reach: 'unreachable', refused: 'removed' });
    await sleep(100);
    expect(h.sockets).toHaveLength(1);
    h.session.changed();
    await until(() => standing(h).refused === undefined && standing(h).reach === 'connecting', 'started again');
    await until(() => (h.sockets.length === 2 ? h.last() : null), 'a socket again');
  });
});
