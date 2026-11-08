// The channel feed's queue against changes of rights (P5 O8 M7b fix wave), on a subscription stood in for that sends
// nothing until the device takes it, so what is queued and what is taken back can be seen: a lane B entry ranked on a
// placement read begun after it came and narrowed by every record heard since (a removed one placing nobody), placements
// that only narrow across a snapshot's reads, a snapshot read again rather than cut again, `more` exact, hidden entries
// never counted against the feed's bound, `seq` without gaps, and what a feed holds bounded.
import { describe, expect, it } from 'vitest';
import { HISTORY_LIMIT_MAX, type HostEntry } from '@shared/ipc/schema/channel';
import type { SessionRanks } from '../../src/endpoint/authorize';
import { ChannelFeeds, CHANGES_HELD, SNAPSHOT_READS } from '../../src/endpoint/channel-feed';
import type { EndpointServices } from '../../src/endpoint/services';
import type { Subscription } from '../../src/endpoint/subscriptions';

const PROJECT = 'proj-1';
const JOURNAL_HOLDS = 2_000; // CHANNEL_BOUNDS.perProject
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
/** An entry's id is the journal's arrival order; its `at`, when it was said, is the id's second unless given (`atSeconds`). */
const laneB = (app: string, text: string, atSeconds?: number): HostEntry => {
  const id = ++ids;
  return { id: String(id), project: PROJECT, appSessionId: app as never, engineSessionId: null, lane: 'B', kind: 'message', text, at: new Date(Date.UTC(2026, 10, 6) + (atSeconds ?? id) * 1000).toISOString(), src: `${PROJECT}/lane-b/${app}/${id}` };
};
const laneA = (session: string, text: string, atSeconds?: number): HostEntry => ({ ...laneB('x', text, atSeconds), appSessionId: null, engineSessionId: session as never, lane: 'A' });

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
    // newest first by `at`, then by id, as the journal orders them
    const newest = [...journal].sort((a, b) => b.at.localeCompare(a.at) || Number(b.id) - Number(a.id));
    const from = before === undefined ? 0 : newest.findIndex((e) => e.id === before) + 1;
    const entries = newest.slice(from, from + limit);
    return { ok: true, value: { entries, more: from + entries.length < newest.length } } as never;
  };
  return {
    dispatch,
    records,
    journal,
    /** What the journal does at each record: it keeps a project's newest JOURNAL_HOLDS by `(at, id)`, and lets go of the rest. */
    prune: () => {
      const newest = [...journal].sort((a, b) => b.at.localeCompare(a.at) || Number(b.id) - Number(a.id));
      const gone = new Set(newest.slice(JOURNAL_HOLDS).map((e) => e.id));
      for (let i = journal.length - 1; i >= 0; i--) if (gone.has(journal[i].id)) journal.splice(i, 1);
    },
    reads: (name: string) => calls.filter((c) => c === name).length,
    /** Reads of `name` past the first `after` wait until `release`. */
    hold: (name: string, after = 0) => void holding.set(name, after),
    release: () => {
      holding.clear();
      for (const go of held.splice(0)) go();
    },
  };
}

/**
 * A member who views the engine sessions and lane A sessions in `views`. Each read of their ranks is its own, current
 * until `stale` (a new head): stale ranks rank nothing, as ranks read under a head no longer held.
 */
function member(views: Set<string>) {
  const issued: Array<{ current: boolean }> = [];
  const ranks = (): SessionRanks => {
    const own = { current: true };
    issued.push(own);
    return {
      holds: (placement) => own.current && placement !== null && views.has(placement.target.session),
      ownsMachine: () => false,
      holdsRight: () => false,
      current: () => own.current,
    };
  };
  return { views, ranks, stale: () => issued.forEach((own) => void (own.current = false)) };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

function start(m: ReturnType<typeof machine>, who: Pick<ReturnType<typeof member>, 'ranks'>, settleMs?: number) {
  const feeds = new ChannelFeeds({
    dispatch: m.dispatch,
    ranks: async () => who.ranks(),
    cursors: { seal: (entry) => `c${entry.id}` },
    log: () => {},
    ...(settleMs === undefined ? {} : { settleMs }),
  });
  const sub = new Sub();
  feeds.open(sub as unknown as Subscription);
  const record = (entry: HostEntry) => {
    m.journal.push(entry);
    m.prune();
    feeds.event('machine', { name: 'channel.changed', payload: { project: PROJECT, entry } });
  };
  const event = (name: string, payload: unknown) => feeds.event('machine', { name, payload });
  return { feeds, sub, record, event };
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

  it('is read again under the member’s new ranks once they change while it is read: a new head never empties it', async () => {
    const m = machine({ 'app-1': 'eng-1' });
    m.journal.push(laneB('app-1', 'shared'));
    const who = member(new Set(['eng-1']));
    m.hold('channel.history'); // the snapshot's read waits
    const { feeds, sub } = start(m, who);
    await settle();
    who.stale(); // a new head, access unchanged: the ranks the read began under are no longer current
    feeds.accessChanged();
    await settle();
    m.release();
    await settle();
    expect(sub.snaps().map((snap) => [snap.entries.map((e) => e.text), snap.more])).toEqual([[['shared'], false]]);
  });

  it('is read again when a session it passed by is viewable by the time it would go', async () => {
    const m = machine({ 'app-1': 'eng-1', 'app-2': 'eng-2' });
    for (let i = 0; i < 250; i++) m.journal.push(laneB('app-2', `other ${i}`));
    m.journal.push(laneB('app-1', 'mine'));
    const who = member(new Set(['eng-2']));
    m.hold('channel.history', 1); // the snapshot's second page waits
    const { feeds, sub } = start(m, who);
    await settle();
    who.views.add('eng-1'); // app-1 shared, passed by on the first page
    feeds.accessChanged();
    m.release();
    await settle();
    const [snap] = sub.snaps();
    expect(snap.entries[0].text).toBe('mine');
    expect(snap.entries).toHaveLength(200);
    expect(snap.more).toBe(true);
  });

  /** A member for whom la-x is hidden while each read passes it by, and viewable by the time that read would go (while `flipping`). */
  const flipping = () => {
    const state = { flipping: true, asked: 0 };
    const ranks = (): SessionRanks => ({
      holds: (placement) => placement !== null && (placement.target.session === 'la-v' || (placement.target.session === 'la-x' && (!state.flipping || ++state.asked % 2 === 0))),
      ownsMachine: () => false,
      holdsRight: () => false,
      current: () => true,
    });
    return { state, ranks };
  };
  const olderThanAPage = () => {
    const m = machine();
    m.journal.push(laneA('la-x', 'older'));
    for (let i = 0; i < 200; i++) m.journal.push(laneA('la-v', `shown ${i}`));
    return m;
  };

  it('past SNAPSHOT_READS reads that each moved, waits for a change of rights, and ends `unavailable` when none comes: never a page whose `more` it can’t vouch for', async () => {
    const m = olderThanAPage();
    const who = flipping();
    const { sub } = start(m, who, 60);
    await settle();
    expect(m.reads('channel.history')).toBe(2 * SNAPSHOT_READS);
    expect(sub.endedWith).toBeNull(); // waiting on a change of rights
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(sub.snaps()).toEqual([]);
    expect(sub.endedWith).toBe('unavailable');
  });

  it('past SNAPSHOT_READS, reads once more at the next change of rights: a page that holds what the member views, `more` exact', async () => {
    const m = olderThanAPage();
    const who = flipping();
    const { feeds, sub } = start(m, who, 60_000);
    await settle();
    who.state.flipping = false; // the rights settle: la-x viewable
    feeds.accessChanged();
    await settle();
    expect(sub.endedWith).toBeNull();
    const [snap] = sub.snaps();
    expect(snap.entries).toHaveLength(200);
    expect(snap.more).toBe(true); // la-x's entry, past the page
    feeds.stop();
  });

  it('ends `unavailable` when the one more read moved too', async () => {
    const m = olderThanAPage();
    const { feeds, sub } = start(m, flipping(), 60_000);
    await settle();
    feeds.accessChanged(); // a change of rights, still moving
    await settle();
    expect(sub.snaps()).toEqual([]);
    expect(sub.endedWith).toBe('unavailable');
  });

  it('is taken back, queued, once a session its read passed by is viewable: an empty snapshot doesn’t stay empty', async () => {
    const m = machine({ 'app-x': 'eng-x' });
    m.journal.push(laneB('app-x', 'x'));
    const who = member(new Set());
    const { feeds, sub } = start(m, who);
    await settle();
    expect(sub.queue.filter((out) => out.t === 'snap')).toHaveLength(1); // queued, empty, not taken
    who.views.add('eng-x');
    feeds.accessChanged();
    await settle();
    sub.take();
    expect(sub.snaps().map((snap) => [snap.entries.map((e) => e.text), snap.more])).toEqual([[['x'], false]]);
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
    expect(feeds.held(sub as unknown as Subscription)).toEqual({ snapshot: 0, changes: 0, placements: 0, known: expect.any(Number), letGo: 0 });
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

  it('never ends, nor sends a thing, for hidden entries waiting to be ranked past CHANGES_HELD: it reads them again and none is viewable', async () => {
    const m = machine({ 'app-h': 'eng-h' });
    const who = member(new Set(['la-2']));
    const { sub, record } = start(m, who);
    await settle();
    sub.take();
    await settle();
    m.hold('session.get'); // their placement is slow to come
    for (let i = 0; i <= CHANGES_HELD; i++) record(laneB('app-h', `hidden ${i}`));
    expect(sub.endedWith).toBeNull();
    m.release();
    await settle();
    expect(sub.queue).toEqual([]); // nothing the member views came: nothing goes
    record(laneA('la-2', 'shown'));
    await settle();
    sub.take();
    await settle();
    expect(sub.endedWith).toBeNull();
    expect(sub.snaps()).toEqual([{ entries: [], more: false }]);
    expect(sub.evs()).toEqual([{ seq: 1, text: 'shown' }]);
  });

  it('sends what the member views of entries it let go of unranked, in the journal’s order, ahead of what came after', async () => {
    const m = machine({ 'app-h': 'eng-h', 'app-v': 'eng-v' });
    const who = member(new Set(['eng-v', 'la-2']));
    const { sub, record } = start(m, who);
    await settle();
    sub.take();
    await settle();
    m.hold('session.get');
    for (let i = 0; i <= CHANGES_HELD; i++) record(laneB(i % 250 === 0 ? 'app-v' : 'app-h', i % 250 === 0 ? `viewed ${i}` : `hidden ${i}`));
    record(laneA('la-2', 'after'));
    m.release();
    for (let i = 0; i < 6; i++) {
      await settle();
      sub.take();
    }
    expect(sub.endedWith).toBeNull();
    expect(sub.snaps()).toHaveLength(1);
    expect(sub.evs()).toEqual([
      { seq: 1, text: 'viewed 0' },
      { seq: 2, text: 'viewed 250' },
      { seq: 3, text: 'viewed 500' },
      { seq: 4, text: 'viewed 750' },
      { seq: 5, text: 'viewed 1000' },
      { seq: 6, text: 'after' },
    ]);
  });

  it('recovers a let-go entry the member views that was said earlier than the rest, and sends the recovered in the journal’s arrival order', async () => {
    const m = machine({ 'app-h': 'eng-h', 'app-v': 'eng-v' });
    const who = member(new Set(['eng-v']));
    const { sub, record } = start(m, who);
    await settle();
    sub.take();
    await settle();
    const base = ids + 100_000;
    m.hold('session.get');
    record(laneB('app-v', 'early, said long ago', 1)); // arrives first, its `at` older than any
    for (let i = 0; i <= CHANGES_HELD; i++) record(laneB('app-h', `hidden ${i}`, base + i));
    record(laneB('app-v', 'late, said last', base + 5_000));
    m.release();
    for (let i = 0; i < 4; i++) {
      await settle();
      sub.take();
    }
    expect(sub.endedWith).toBeNull();
    expect(sub.snaps()).toHaveLength(1);
    expect(sub.evs()).toEqual([
      { seq: 1, text: 'early, said long ago' },
      { seq: 2, text: 'late, said last' },
    ]);
    const delivered = sub.sent.filter((out) => out.t === 'ev').map((out) => Number((out.body as { entry: HostEntry }).entry.id.slice(1)));
    expect(delivered).toEqual([...delivered].sort((a, b) => a - b));
  });

  it('recovers a viewable entry however many came after it, as long as the journal holds it', async () => {
    const m = machine({ 'app-h': 'eng-h', 'app-v': 'eng-v' });
    const who = member(new Set(['eng-v']));
    const { feeds, sub, record } = start(m, who);
    await settle();
    sub.take();
    await settle();
    const base = ids + 100_000;
    m.hold('session.get');
    record(laneB('app-v', 'viewed', base + 10_000)); // first to arrive, said last: the journal keeps it
    for (let i = 0; i < 2 * CHANGES_HELD + 100; i++) record(laneB('app-h', `hidden ${i}`, base + 2_200 - i));
    await settle();
    // Past what the journal holds, the ids it let go of are those of entries the journal still holds: no more than it does.
    expect(feeds.held(sub as unknown as Subscription)!.letGo).toBeLessThanOrEqual(JOURNAL_HOLDS);
    m.release();
    for (let i = 0; i < 4; i++) {
      await settle();
      sub.take();
    }
    expect(sub.endedWith).toBeNull();
    expect(sub.evs()).toEqual([{ seq: 1, text: 'viewed' }]);
  });

  it('recovers a let-go entry whose id is below a snapshot read again since: an id the snapshot never reached is still recovered', async () => {
    const m = machine({ 'app-v': 'eng-v', 'app-h': 'eng-h' });
    m.journal.push(laneA('la-h', 'h')); // the snapshot passes it by, and is taken back once it is shared
    const who = member(new Set(['eng-v', 'la-q']));
    const { feeds, sub, record } = start(m, who);
    await settle(); // the first snapshot queued, not taken
    m.hold('session.get');
    record(laneB('app-v', 'p, said long ago', 1)); // waits on its placement; its `at` older than any
    for (let i = 0; i < 2 * HISTORY_LIMIT_MAX; i++) record(laneA('la-q', `q ${i}`)); // the snapshot read again stops among them
    who.views.add('la-h');
    feeds.accessChanged(); // the queued snapshot no longer stands: read again, a page of q's ids, all above p's
    await settle();
    sub.take();
    await settle();
    for (let i = 0; i <= CHANGES_HELD; i++) record(laneB('app-h', `hidden ${i}`)); // p let go of, unranked
    m.release();
    for (let i = 0; i < HISTORY_LIMIT_MAX + 10; i++) {
      await settle();
      sub.take();
    }
    expect(sub.endedWith).toBeNull();
    expect(sub.snaps()).toHaveLength(1); // the first, taken back before the device took it, never went
    expect(sub.snaps()[0].more).toBe(true);
    const evs = sub.evs();
    expect(evs.filter((ev) => ev.text === 'p, said long ago')).toHaveLength(1);
    expect(evs.filter((ev) => ev.text.startsWith('q '))).toHaveLength(HISTORY_LIMIT_MAX); // the q's past the page, none lost
    expect(evs.map((ev) => ev.seq)).toEqual(evs.map((_, i) => i + 1));
  });

  it('replays no history from before it opened for a wholly hidden burst: the snapshot of older ids said later leaves newer ids behind it', async () => {
    const m = machine({ 'app-h': 'eng-h' });
    const base = ids + 100_000;
    for (let i = 0; i <= HISTORY_LIMIT_MAX; i++) m.journal.push(laneA('la-v', `said late ${i}`, base + 5_000 + i)); // the snapshot's page
    for (let i = 0; i <= CHANGES_HELD; i++) m.journal.push(laneA('la-v', `said early ${i}`, base + i)); // newer ids, older `at`s
    const who = member(new Set(['la-v']));
    const { sub, record } = start(m, who);
    await settle();
    sub.take();
    await settle();
    m.hold('session.get');
    for (let i = 0; i <= CHANGES_HELD; i++) record(laneB('app-h', `hidden ${i}`, base + 10_000 + i));
    m.release();
    for (let i = 0; i < 4; i++) {
      await settle();
      sub.take();
    }
    expect(sub.endedWith).toBeNull();
    expect(sub.snaps()).toHaveLength(1);
    expect(sub.evs()).toEqual([]);
  });

  it('replays no entry it dropped as hidden once its session is shared later, when an unrelated burst is let go of', async () => {
    const m = machine({ 'app-h': 'eng-h' });
    const who = member(new Set(['la-v']));
    const { feeds, sub, record } = start(m, who);
    await settle();
    sub.take();
    await settle();
    record(laneA('la-d', 'dropped as hidden')); // ranked when it came: the member didn't view it
    who.views.add('la-d');
    feeds.accessChanged();
    await settle();
    m.hold('session.get');
    for (let i = 0; i <= CHANGES_HELD; i++) record(laneB('app-h', `hidden ${i}`));
    m.release();
    for (let i = 0; i < 4; i++) {
      await settle();
      sub.take();
    }
    expect(sub.endedWith).toBeNull();
    expect(sub.evs()).toEqual([]);
  });

  it('recovers by the rights as they stand: a session revoked mid-read sends what stays viewable as an ev, never a snapshot', async () => {
    const m = machine({ 'app-p': 'eng-p' });
    const who = member(new Set(['eng-p', 'la-q']));
    const { feeds, sub, record } = start(m, who);
    await settle();
    sub.take();
    await settle();
    const base = ids + 100_000;
    m.hold('session.get');
    record(laneB('app-p', 'p first', base + 6_000)); // unranked: what comes after it waits
    record(laneA('la-q', 'q stays', base)); // said before every P entry
    for (let i = 0; i < CHANGES_HELD + 100; i++) record(laneB('app-p', `p ${i}`, base + 5_000 - i));
    m.hold('channel.history', 1 + 5); // the snapshot's read and five pages of the recovery's go; the sixth waits
    m.release();
    m.hold('channel.history', 1 + 5);
    await settle();
    who.views.delete('eng-p'); // P revoked mid-read
    feeds.accessChanged();
    m.release();
    for (let i = 0; i < 6; i++) {
      await settle();
      sub.take();
    }
    expect(sub.endedWith).toBeNull();
    expect(sub.snaps()).toHaveLength(1);
    expect(sub.evs()).toEqual([{ seq: 1, text: 'q stays' }]);
  });

  it('ends `behind` past CHANGES_HELD entries the member views waiting', async () => {
    const m = machine();
    const { sub, record } = start(m, member(new Set(['la-2'])));
    await settle();
    for (let i = 0; i <= CHANGES_HELD; i++) record(laneA('la-2', `shown ${i}`));
    expect(sub.endedWith).toBe('behind');
  });
});
