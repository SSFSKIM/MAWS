// The machine's `artifacts` feed (P5 O7 M5a, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, §R and M5 "Events
// that cross"): a device's artifact and library stores follow the machine's as a local app's follow its own, with one
// subscription for the whole machine (a subscription per artifact would meet the channel's 64 against a library of
// hundreds). Admitted at `list` for any member but a web-cards device (authorize.ts), it names no session; behind
// `rl2.artifacts`.
//
// Every opening is `subbed {mode: 'snapshot', epoch: 'artifacts:<this endpoint's boot>', seq: 0}` with nothing to snap
// (the device reads its lists afresh on a new epoch); then each event goes as `ev {body: {name, payload}}` at the next
// `seq`: every `library.changed` (`{revision}`, the index's revision, naming nothing), and each `artifacts.changed`
// (`{artifactId, kind, revision, change}`) whose artifact the member holds `view` on by the `artifact` rule, decided by its
// one predicate (artifacts.ts' `holdsArtifact`) over the artifact's placement (the channel's `ArtifactRanks` entry) and the
// member's ranks (`Authorizer.ranks`, each linked session's record read when asked). A `created` change for an artifact
// nobody but the machine's owners can view yet (no link) is decided once, as it stands then; its `linked` change, which
// drops the placement, is decided afresh.
//
// Output crosses no change of rights (M6's rule, attention-feed.ts'): one event at a time is queued on the subscription,
// decided in the same synchronous step as it is queued, and the next is decided only once the device took it. At every
// change of access (`accessChanged`: a record change, a new head) and every dropped placement, a queued event not yet
// taken is checked again against the rights now: held while the ranks or its placement are read, taken back once it no
// longer stands. What waits behind it waits undecided. A placement the machine can't read (the store or the spine away)
// ends the feed `unavailable`, and more than the backlog bound waiting ends it `behind`: the device opens it again, as
// after a reconnect, and reads its lists afresh (`Subscription.ev`'s `{omitted: 'too-large'}` is a lost feed to it too).
import { randomBytes } from 'node:crypto';
import { BACKLOG_BYTES } from '@shared/host/stream-catchup';
import { holdsArtifact, type ArtifactRanks, type CachedPlacement } from './artifacts';
import type { SessionRanks } from './authorize';
import { dispatchAs, type EndpointServices } from './services';
import type { Subscription } from './subscriptions';

export type ArtifactsFeedsContext = {
  dispatch: EndpointServices['dispatch'];
  /** The member's ranks on the machine's sessions as the head now gives them (`Authorizer.ranks`). */
  ranks(member: string): Promise<SessionRanks>;
  /** The `artifact` rule's placements, per channel. */
  artifacts: ArtifactRanks;
  log(line: string): void;
  /** The most a feed's waiting events may hold before it ends `behind`. */
  backlogBytes?: number;
};

/** An event waiting to go: its artifact (null: `library.changed`, which names none and always goes). */
type Item = { name: string; payload: unknown; artifactId: string | null; bytes: number };

type Feed = {
  sub: Subscription;
  seq: number;
  /** What waits, undecided, in order. */
  waiting: Item[];
  waitingBytes: number;
  /** The one event queued on the subscription and not yet taken. */
  pending: Item | null;
  /** The member's ranks; null while read. */
  ranks: SessionRanks | null;
  rankReads: number;
  /** The placements of the artifacts waiting or pending: one being read is `reading`. */
  placed: Map<string, CachedPlacement | 'reading'>;
};

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isId = (value: unknown): value is string => typeof value === 'string' && value !== '' && value.length <= 512;

export class ArtifactsFeeds {
  readonly #ctx: ArtifactsFeedsContext;
  readonly #epoch = `artifacts:${randomBytes(9).toString('base64url')}`;
  readonly #feeds = new Map<Subscription, Feed>();

  constructor(ctx: ArtifactsFeedsContext) {
    this.#ctx = ctx;
  }

  open(sub: Subscription): void {
    const feed: Feed = { sub, seq: 0, waiting: [], waitingBytes: 0, pending: null, ranks: null, rankReads: 0, placed: new Map() };
    this.#feeds.set(sub, feed);
    sub.subbed('snapshot', { epoch: this.#epoch, seq: 0 });
    // The device took the queued event, or credit came: the next may be decided.
    sub.onRoom = () => this.#settle(feed);
    void this.#readRanks(feed);
  }

  close(sub: Subscription): void {
    this.#feeds.delete(sub);
  }

  stop(): void {
    this.#feeds.clear();
  }

  /** A record changed, or a new head came: what is queued is checked again (the ranks read again where they moved). */
  accessChanged(): void {
    for (const feed of this.#feeds.values()) this.#settle(feed);
  }

  /** The machine's events: an artifact's change (the engine host's), the library's (the spine's). */
  event(owner: string, message: { name: string; payload: unknown }): void {
    if (this.#feeds.size === 0) return;
    const { name, payload } = message;
    let artifactId: string | null;
    if (owner === 'engine-host' && name === 'artifacts.changed' && isObject(payload) && isId(payload.artifactId)) artifactId = payload.artifactId;
    else if (owner === 'machine' && name === 'library.changed') artifactId = null;
    else {
      // A relink (dropped from the cache before this) or a moved record: what is queued is checked again.
      if (owner === 'machine' && name === 'session.changed') this.accessChanged();
      return;
    }
    const bytes = Buffer.byteLength(JSON.stringify(payload ?? null));
    for (const feed of this.#feeds.values()) {
      feed.waiting.push({ name, payload, artifactId, bytes });
      feed.waitingBytes += bytes;
      if (feed.waitingBytes + feed.sub.backlog > (this.#ctx.backlogBytes ?? BACKLOG_BYTES)) {
        feed.sub.end('behind');
        continue;
      }
      this.#settle(feed);
    }
  }

  async #readRanks(feed: Feed): Promise<void> {
    const n = ++feed.rankReads;
    feed.ranks = null;
    let ranks: SessionRanks;
    try {
      ranks = await this.#ctx.ranks(feed.sub.who.member);
    } catch (error) {
      if (n !== feed.rankReads || this.#feeds.get(feed.sub) !== feed) return;
      this.#ctx.log(`endpoint: an artifacts feed's ranks could not be read: ${(error as Error).message}`);
      return void feed.sub.end('unavailable');
    }
    if (n !== feed.rankReads || this.#feeds.get(feed.sub) !== feed) return;
    feed.ranks = ranks;
    this.#settle(feed);
  }

  /** The artifact's placement through the channel's cache; settled again when it lands. */
  async #place(feed: Feed, artifactId: string): Promise<void> {
    feed.placed.set(artifactId, 'reading');
    const client = feed.sub.channel.client;
    const placed = await this.#ctx.artifacts.of(client, artifactId, { dispatch: dispatchAs(this.#ctx.dispatch, client), log: (line) => this.#ctx.log(line) });
    if (this.#feeds.get(feed.sub) !== feed || feed.placed.get(artifactId) !== 'reading') return;
    if (placed.resolved.kind === 'refused') {
      this.#ctx.log(`endpoint: an artifacts feed could not place artifact ${artifactId}`);
      return void feed.sub.end('unavailable');
    }
    feed.placed.set(artifactId, placed);
    this.#settle(feed);
  }

  /**
   * The feed against the rights now, in one synchronous step: the queued event is checked again (held while it can't
   * be, taken back once it no longer stands), and once it was taken, the next waiting one is decided and queued.
   */
  #settle(feed: Feed): void {
    const { sub } = feed;
    for (;;) {
      if (sub.ended || this.#feeds.get(sub) !== feed) return;
      if (feed.pending !== null && sub.backlog === 0) feed.pending = null; // taken
      if (feed.ranks !== null && !feed.ranks.current()) void this.#readRanks(feed);
      if (feed.pending !== null) {
        const verdict = this.#stands(feed, feed.pending);
        if (verdict === 'unknown') return void sub.hold();
        if (verdict === 'stands') return void sub.unhold();
        sub.clear(); // taken back
        feed.pending = null;
      }
      sub.unhold();
      const next = feed.waiting[0];
      if (next === undefined) return this.#prune(feed);
      const verdict = this.#stands(feed, next);
      if (verdict === 'unknown') return;
      feed.waiting.shift();
      feed.waitingBytes -= next.bytes;
      if (verdict === 'withdrawn') continue;
      feed.pending = next;
      sub.ev({ epoch: this.#epoch, seq: ++feed.seq }, { name: next.name, payload: next.payload });
      if (sub.backlog > 0) return; // taken later: `onRoom` settles again
    }
  }

  /**
   * Whether the member may hear of `item` now: `unknown` while the ranks or its artifact's placement are read (a read
   * begun for a placement dropped since). A machine owner hears of every artifact, its placement unread.
   */
  #stands(feed: Feed, item: Item): 'stands' | 'withdrawn' | 'unknown' {
    if (item.artifactId === null) return 'stands';
    const ranks = feed.ranks;
    if (ranks === null) return 'unknown';
    if (ranks.ownsMachine()) return 'stands';
    const placed = feed.placed.get(item.artifactId);
    if (placed === 'reading') return 'unknown';
    if (placed === undefined || !placed.current()) {
      void this.#place(feed, item.artifactId);
      return 'unknown';
    }
    const resolved = placed.resolved;
    if (resolved.kind !== 'artifact') return 'withdrawn'; // unknown to the store: nobody's but its owners'
    return holdsArtifact(resolved, false, (session) => ranks.holds(session, 'view')) ? 'stands' : 'withdrawn';
  }

  /** Placements no waiting or queued event names are let go. */
  #prune(feed: Feed): void {
    const named = new Set([...feed.waiting, ...(feed.pending === null ? [] : [feed.pending])].map((item) => item.artifactId));
    for (const id of feed.placed.keys()) if (!named.has(id) && feed.placed.get(id) !== 'reading') feed.placed.delete(id);
  }
}
