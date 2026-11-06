// A project's channel in main (P5 O8 M7a, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M7a's Touches for
// channel.ts and its *Words*, *The cache* and *Hub access* decisions): one per open project, released 30 s after its
// last tab closes. Its cache drawn at once and judged again, the socket resumed after the cache's offset once the
// attestations are read, `live` after `caught-up`, every event judged again at each adopted head, the owner's words
// addressed and answered, the hub's refusal of the project, signed out drawn "as of", and the cache written through the
// commit queue, last at `close()`. A fake socket and an in-memory store, over real signed states and events.
//
// `org.channel.changed` is a delta: the harness folds the open answer and each change after it as a renderer does
// (`latest()`), so every case checks what a tab would draw; `told()` is the last change as sent.
import { afterEach, describe, expect, it } from 'vitest';
import { NO_CERTIFICATES, type HistoryAttestation, type OrgView, type Signed } from '../../../../apps/org-protocol/src/index.ts';
import { ChannelOrg, NOW, ORG, PROJECT, S1 } from '../../../../test/org/channel-world';
import type { ChannelAnswer, ChannelChanged, ChannelEvent, ChannelSession, ChannelWord } from '@shared/ipc/schema/org';
import { BUILD_HEADER } from '../hub-client';
import type { WebSocketLike } from '../registry-feed';
import { heldOrgSession, type SignedIn } from '../session';
import { emptyLog, type ChannelCacheFile, type ChannelStore } from './cache';
import { createChannels, type Channels } from './channel';

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
  close(): void {
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
type Drawn = { project: string; ok: true; events: ChannelEvent[]; sessions: ChannelSession[]; pending: ChannelWord[]; unverified: number; asOf: string | null; live: boolean } | { project: string; ok: false; reason: string };

function fold(base: Drawn | undefined, change: ChannelChanged): Drawn | undefined {
  if (!change.ok) return change;
  if (change.reset !== true && (base === undefined || !base.ok)) throw new Error(`a delta onto nothing drawn: ${JSON.stringify(change)}`);
  const byOffset = new Map((change.reset === true || base === undefined || !base.ok ? [] : base.events).map((e) => [e.offset, e]));
  for (const offset of change.removed ?? []) byOffset.delete(offset);
  for (const event of change.upserts) byOffset.set(event.offset, event);
  const { project, sessions, pending, unverified, asOf, live } = change;
  return { project, ok: true, events: [...byOffset.values()].sort((a, b) => a.offset - b.offset), sessions, pending, unverified, asOf, live };
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

async function harness(options: { seed?: (o: ChannelOrg) => Promise<ChannelCacheFile>; records?: Signed<HistoryAttestation>[]; signedIn?: boolean; hub?: boolean; events?: number; reading?: Promise<void>; coalesce?: number } = {}) {
  const o = await ChannelOrg.make();
  const cache = options.seed === undefined ? undefined : await options.seed(o);
  const view: OrgView = { head: () => o.head(), certificates: () => NO_CERTIFICATES, since: () => ({ states: [], transitions: [] }), advance: async () => {} };
  const hub = { url: 'https://hub.example.com', headers: async () => ({ 'cf-access-token': 't' }) };
  const signedIn = (withHub = options.hub ?? true): SignedIn => ({
    identity: { org: ORG, member: o.A, device: 'app', clientClass: 'native-mac', channelKey: o.app.channel, build: 'test', capabilities: [] },
    view,
    stepUp: { sign: () => Promise.reject(new Error('no step-up here')) },
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
      return options.records ?? [];
    },
    socket: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    now: () => NOW,
    timing: { CHANNEL_RELEASE_MS: 60, CHANNEL_WRITE_MS: 5, CHANNEL_COALESCE_MS: options.coalesce ?? 5, ...(options.events === undefined ? {} : { CHANNEL_CACHE_EVENTS: options.events }) },
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
        const cached = emptyLog(ORG, PROJECT, { events: 5000, bytes: 1 << 23 });
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

  // Task 2's fix wave: a tab applies only the changes numbered past its open answer
  it('numbers each change past the last, across channels, and each open answer with the count as it stands', async () => {
    const h = await harness();
    const first = opened(await h.channels.open(PROJECT));
    const socket = await until(() => h.last(), 'a socket');
    socket.welcome();
    socket.frame({ t: 'log', events: [{ offset: 1, event: await h.o.say(h.o.mini, 1, 'one') }] });
    const one = delta(await until(() => h.told(), 'a change'));
    expect(one.rev).toBeGreaterThan(first.rev);
    const again = opened(await h.channels.open(PROJECT));
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

  it('refuses its unanswered words context-changed when another member signs in, and sends them no more', async () => {
    const h = await harness();
    opened(await h.channels.open(PROJECT));
    const first = await until(() => h.last(), 'a socket');
    first.welcome();
    const sent = await h.channels.send(PROJECT, 'before the switch');
    if (!sent.ok) throw new Error('unsent');
    const ours = h.signedIn();
    h.session.set({ ...ours, identity: { ...ours.identity, member: h.o.B } });
    await until(() => opened(h.latest()).pending.some((w) => typeof w.state === 'object'), 'the refusal');
    expect(opened(h.latest()).pending).toEqual([{ nonce: sent.nonce, text: 'before the switch', to: '*', state: { refused: 'context-changed' } }]);
    first.emit('close', 1006, '');
    const second = await until(() => (h.sockets.length === 2 ? h.last() : null), 'a reconnect', 5_000);
    second.welcome();
    expect(second.sent.some((f) => f.t === 'human')).toBe(false);
  });

  it('addresses a session whose joined the bound let go, from the cache after a reload, and tells the sessions', async () => {
    const h = await harness({
      events: 2,
      seed: async (o) => {
        const cached = emptyLog(ORG, PROJECT, { events: 2, bytes: 1 << 23 });
        const g = { ctx: { org: ORG, project: PROJECT }, state: o.head().state, certificates: NO_CERTIFICATES, now: new Date(NOW) };
        await cached.add([{ offset: 1, event: await o.joined(o.mini, 1, 'maws-45') }, { offset: 2, event: await o.say(o.mini, 2, 'two') }, { offset: 3, event: await o.say(o.mini, 3, 'three') }], g);
        return cached.file();
      },
    });
    const answer = opened(await h.channels.open(PROJECT));
    expect(answer.events.map((e) => e.offset)).toEqual([2, 3]);
    expect(answer.sessions).toEqual([{ session: S1, alias: 'maws-45', machine: 'mini', title: null, member: true }]);
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
