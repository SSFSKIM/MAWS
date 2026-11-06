// The channel feed's queue against changes of rights (P5 O8 M7b fix wave), on a subscription stood in for that sends
// nothing until the device takes it, so what is queued and what is taken back can be seen: a lane B entry ranked on a
// placement read begun after it came and narrowed by every record heard since (a removed one placing nobody), placements
// that only narrow across a snapshot's reads, a snapshot read again rather than cut again, `more` exact, hidden entries
// never counted against the feed's bound, `seq` without gaps, and what a feed holds bounded.
import { describe, expect, it } from 'vitest';
import type { HostEntry } from '@shared/ipc/schema/channel';
import type { SessionRanks } from '../../src/endpoint/authorize';
import { ChannelFeeds, CHANGES_HELD } from '../../src/endpoint/channel-feed';
import type { EndpointServices } from '../../src/endpoint/services';
import type { Subscription } from '../../src/endpoint/subscriptions';

const PROJECT = 'proj-1';
type Out = { t: string; seq?: number; body?: unknown; key?: string };

/** A subscription that sends only what the device takes (`take`), as one without credit holds its stream. */
class Sub {
  readonly message = { t: 'sub', sub: 'ch', feed: 'channel', project: PROJECT, cursor: null, credit: 1 };
  readonly who = { member: 'B', device: 'd', clientClass: 'full' };
  readonly channel = { client: undefined, closed: false };
  onRoom: (() => void) | null = null;
  queue: Out[] = [];
  sent: Out[] = [];
  held = false;
  endedWith: string | null = null;
  midSnapshot = false;
  get ended(): boolean {
    return this.endedWith !== null;
  }
  get backlog(): number {
    return this.queue.filter((out) => out.t !== 'subbed').length;
  }
  hold(): void {
    this.held = true;
  }
  unhold(): void {
    this.held = false;
  }
  subbed(_mode: string, at: { seq: number }): void {
    this.queue.push({ t: 'subbed', seq: at.seq });
  }
  snap(at: { seq: number }, body: unknown, key: string): void {
    this.dropSnapshot(key);
    this.queue.push({ t: 'snap', seq: at.seq, body, key });
  }
  ev(at: { seq: number }, body: unknown): void {
    this.queue.push({ t: 'ev', seq: at.seq, body });
  }
  dropSnapshot(key: string): void {
    this.queue = this.queue.filter((out) => out.key !== key);
  }
  clear(): void {
    this.queue = [];
  }
  end(reason: string): void {
    this.endedWith ??= reason;
    this.queue = [];
  }
  /** The device takes what is queued, unless it is held. */
  take(): void {
    if (this.held) return;
    this.sent.push(...this.queue.splice(0));
    queueMicrotask(() => this.onRoom?.());
  }
  evs(): Array<{ seq: number; text: string }> {
    return this.sent.filter((out) => out.t === 'ev').map((out) => ({ seq: out.seq!, text: (out.body as { entry: HostEntry }).entry.text }));
  }
  snaps(): Array<{ entries: HostEntry[]; more: boolean }> {
    return [...this.sent, ...this.queue].filter((out) => out.t === 'snap').map((out) => out.body as { entries: HostEntry[]; more: boolean });
  }
}

let ids = 0;
const laneB = (app: string, text: string): HostEntry => {
  const id = ++ids;
  return { id: String(id), project: PROJECT, appSessionId: app as never, engineSessionId: null, lane: 'B', kind: 'message', text, at: new Date(Date.UTC(2026, 10, 6) + id * 1000).toISOString(), src: `${PROJECT}/lane-b/${app}/${id}` };
};
const laneA = (session: string, text: string): HostEntry => ({ ...laneB('x', text), appSessionId: null, engineSessionId: session as never, lane: 'A' });

/** The spine stood in for: the project's journal, the records (app → engine), each read countable and holdable. */
function machine(records: Record<string, string | null> = {}) {
  const journal: HostEntry[] = [];
  const calls: string[] = [];
  const holding = new Map<string, number>(); // a name's reads past this many wait for `release`
  const held: Array<() => void> = [];
  const dispatch: EndpointServices['dispatch'] = async (_owner, name, input) => {
    calls.push(name);
    const after = holding.get(name);
    if (after !== undefined && calls.filter((c) => c === name).length > after) await new Promise<void>((go) => held.push(go));
    if (name === 'session.get') {
      const app = (input as { appSessionId: string }).appSessionId;
      const engine = records[app];
      return { ok: true, value: engine == null ? null : { appSessionId: app, engineSessionId: engine } } as never;
    }
    if (name !== 'channel.history') return { ok: false, error: { code: 'unknown_command', message: name } } as never;
    const { before, limit } = input as { before?: string; limit: number };
    const newest = [...journal].reverse();
    const from = before === undefined ? 0 : newest.findIndex((e) => e.id === before) + 1;
    const entries = newest.slice(from, from + limit);
    return { ok: true, value: { entries, more: from + entries.length < newest.length } } as never;
  };
  return {
    dispatch,
    records,
    journal,
    reads: (name: string) => calls.filter((c) => c === name).length,
    /** Reads of `name` past the first `after` wait until `release`. */
    hold: (name: string, after = 0) => void holding.set(name, after),
    release: () => {
      holding.clear();
      for (const go of held.splice(0)) go();
    },
  };
}

/** A member who views the engine sessions and lane A sessions in `views`, their ranks current while `current`. */
function member(views: Set<string>) {
  const state = { current: true };
  const ranks: SessionRanks = {
    holds: (placement) => placement !== null && views.has(placement.target.session),
    ownsMachine: () => false,
    holdsRight: () => false,
    current: () => state.current,
  };
  return { views, state, ranks };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

function start(m: ReturnType<typeof machine>, who: ReturnType<typeof member>, reach = { reaches: true }) {
  const feeds = new ChannelFeeds({
    dispatch: m.dispatch,
    ranks: async () => who.ranks,
    reaches: () => reach.reaches,
    cursors: { seal: (entry) => `c${entry.id}` },
    log: () => {},
  });
  const sub = new Sub();
  feeds.open(sub as unknown as Subscription);
  const record = (entry: HostEntry) => {
    m.journal.push(entry);
    feeds.event('machine', { name: 'channel.changed', payload: { project: PROJECT, entry } });
  };
  const event = (name: string, payload: unknown) => feeds.event('machine', { name, payload });
  return { feeds, sub, record, event, reach };
}

describe('a lane B entry on the feed', () => {
  it('is taken back, queued, once its session’s record is removed, and the next entry takes its seq', async () => {
    const m = machine({ 'app-1': 'eng-1' });
    const who = member(new Set(['eng-1', 'la-2']));
    const { sub, record, event } = start(m, who);
    await settle();
    sub.take(); // the snapshot
    record(laneB('app-1', 'queued B'));
    await settle();
    expect(sub.queue.map((out) => out.t)).toEqual(['ev']);
    delete m.records['app-1'];
    event('session.removed', { appSessionId: 'app-1', revision: 2 });
    expect(sub.queue).toEqual([]);
    record(laneA('la-2', 'next A'));
    await settle();
    sub.take();
    await settle();
    expect(sub.evs()).toEqual([{ seq: 1, text: 'next A' }]);
  });

  it('goes by its session’s record as read after it came, not a placement read before', async () => {
    const m = machine({ 'app-1': 'eng-1' });
    const who = member(new Set(['eng-1', 'la-2']));
    const { sub, record } = start(m, who);
    await settle();
    sub.take();
    record(laneB('app-1', 'first B'));
    await settle();
    sub.take();
    await settle();
    m.records['app-1'] = 'eng-private'; // the record moved; its `session.changed` is on the index's next tick
    record(laneB('app-1', 'after the move'));
    record(laneA('la-2', 'next A'));
    await settle();
    sub.take();
    await settle();
    expect(sub.evs()).toEqual([
      { seq: 1, text: 'first B' },
      { seq: 2, text: 'next A' },
    ]);
  });

  it('waiting behind another, is read again before it goes', async () => {
    const m = machine({ 'app-1': 'eng-1' });
    const who = member(new Set(['eng-1', 'la-2']));
    const { sub, record } = start(m, who);
    await settle();
    sub.take();
    record(laneB('app-1', 'first B'));
    await settle();
    sub.take();
    await settle();
    record(laneA('la-2', 'next A'));
    record(laneB('app-1', 'waiting B'));
    await settle();
    m.records['app-1'] = 'eng-private'; // while it waits behind the queued entry
    sub.take();
    await settle();
    sub.take();
    await settle();
    expect(sub.evs()).toEqual([
      { seq: 1, text: 'first B' },
      { seq: 2, text: 'next A' },
    ]);
  });
});

describe('the feed’s snapshot', () => {
  it('is read again, not cut again, once a share goes while it is queued: `more` only for a viewable older entry', async () => {
    const m = machine({ 'app-1': 'eng-1' });
    for (let i = 0; i < 401; i++) m.journal.push(laneB('app-1', `b${i}`));
    const who = member(new Set(['eng-1']));
    const { feeds, sub } = start(m, who);
    await settle();
    expect(sub.snaps()).toHaveLength(1);
    expect(sub.snaps()[0].more).toBe(true);
    who.views.delete('eng-1');
    feeds.accessChanged();
    await settle();
    sub.take();
    expect(sub.snaps()).toEqual([{ entries: [], more: false }]);
  });

  it('holds a session to every placement seen of it across its reads: one heard between two pages widens nothing', async () => {
    const m = machine({ 'app-1': 'eng-hidden' });
    for (let i = 0; i < 300; i++) m.journal.push(laneB('app-1', `b${i}`));
    const who = member(new Set(['eng-1']));
    m.hold('channel.history', 1); // the snapshot's second page waits
    const { sub, event } = start(m, who);
    await settle();
    event('session.changed', { record: { appId: 'app-1', engineSessionId: 'eng-1' }, revision: 3 });
    m.release();
    await settle();
    sub.take();
    expect(sub.snaps()).toEqual([{ entries: [], more: false }]);
  });

  it('is never queued once the project left the org meanwhile: the feed ends `removed`', async () => {
    const m = machine({ 'app-1': 'eng-1' });
    m.journal.push(laneB('app-1', 'b'));
    m.hold('session.get');
    const { sub, reach } = start(m, member(new Set(['eng-1'])));
    await settle();
    reach.reaches = false;
    m.release();
    await settle();
    expect(sub.endedWith).toBe('removed');
    expect(sub.snaps()).toEqual([]);
  });

  it('is let go of once taken, and what the feed holds stays bounded by what it still has to send', async () => {
    const m = machine(Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`app-${i}`, `eng-${i}`])));
    for (let i = 0; i < 300; i++) m.journal.push(laneB(`app-${i}`, `old ${i}`));
    const who = member(new Set(Array.from({ length: 300 }, (_, i) => `eng-${i}`)));
    const { feeds, sub, record } = start(m, who);
    await settle();
    sub.take();
    await settle();
    for (let i = 0; i < 300; i++) {
      record(laneB(`app-${i}`, `new ${i}`));
      await settle();
      sub.take();
    }
    await settle();
    expect(sub.evs()).toHaveLength(300);
    expect(feeds.held(sub as unknown as Subscription)).toEqual({ snapshot: 0, changes: 0, placements: 0, known: expect.any(Number) });
    expect(feeds.held(sub as unknown as Subscription)!.known).toBeLessThanOrEqual(201);
  });
});

describe('the feed’s bound on what waits', () => {
  it('counts only what the member views: hidden entries waiting never end it `behind`', async () => {
    const m = machine();
    const who = member(new Set(['la-2']));
    const { sub, record } = start(m, who);
    await settle(); // the snapshot queued, not taken: what comes waits
    for (let i = 0; i <= CHANGES_HELD; i++) record(laneA('la-1', `hidden ${i}`));
    record(laneA('la-2', 'shown'));
    await settle();
    expect(sub.endedWith).toBeNull();
    sub.take();
    await settle();
    sub.take();
    expect(sub.evs()).toEqual([{ seq: 1, text: 'shown' }]);
  });

  it('ends `behind` past CHANGES_HELD entries the member views waiting', async () => {
    const m = machine();
    const { sub, record } = start(m, member(new Set(['la-2'])));
    await settle();
    for (let i = 0; i <= CHANGES_HELD; i++) record(laneA('la-2', `shown ${i}`));
    expect(sub.endedWith).toBe('behind');
  });
});
