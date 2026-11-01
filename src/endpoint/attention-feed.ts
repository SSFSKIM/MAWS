// The machine's `attention` feed (P5 O7 M6, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, §R, M6's "The
// feed"): a device's Needs-you rows, badge and notifications for every session on this machine the member views, with
// no tab open and no subscription per session. Admitted at `list` for any member (authorize.ts), it names no session;
// what it carries is cut per session to the ones the member holds `view` on, as their rights stand when it goes.
//
// Every opening is `subbed {mode: 'snapshot', epoch: 'attention:<this endpoint's boot>', seq: 0}` with its `snap`, the
// machine's `attention.list` cut so; then each change of what the member should hold of a session goes as `ev {body:
// {appSessionId, items}}` at the next `seq`, the session's whole list (replace). The cut follows the member's rights: at
// every record change and every new head (`accessChanged`) the feed works out again which sessions the member views, and
// a session that left the set goes as `{appSessionId, items: []}`, one that joined as its items now, so a permission
// already waiting on a session shared a moment ago shows at once. A member who views nothing holds an open, empty feed,
// which fills at the first share: it lives with its channel, never ending for being empty.
//
// How. The feed keeps the machine's items as `attention.list` answered them and each `attention.changed` replaced them
// since (the changes heard while that read is out are laid over its answer), each session's placement by its record
// (`session.get`, then each `session.changed`; targets.ts' `recordedPlacement`, never the engine host, which a read would
// wake; a read during which records were heard keeps all of them, each of which must allow the member: fix wave 2), what the device was given of each session, and the one output queued and not yet taken (`pending`).
//
// Output crosses no change of rights (fix wave 1). The device's credit can hold what is queued for as long as it likes, so
// a decision made when a message was queued is not one about when it leaves. The feed queues one output at a time (the
// snapshot, or one session's change) and works out the next only once that one was taken; and at every change of
// rights it checks the queued output again against the rights now, before anything more of it can leave: while it can't
// (the member's ranks or a session's placement being read) the subscription is held; one that no longer stands is taken
// back (an `ev` unqueued, a snapshot replaced whole) and what the device should hold is worked out afresh. A snapshot of
// which some pages already left can't be taken back: the feed ends `behind`, and the device opens it again. Since only
// one output waits, a device that reads slowly gets each session's latest state, not every change on the way.
//
// It ends with its channel, `removed` with the device (the channel's), `behind` once what it queued passes plane B's
// backlog bound (as the `checkout` feed) or a part-sent snapshot no longer stands, and `unavailable` when the machine
// can't answer `attention.list` or a session's placement (`session.get`): the device opens it again on its backoff.
import { randomBytes } from 'node:crypto';
import { BACKLOG_BYTES } from '@shared/host/stream-catchup';
import type { SessionRanks } from './authorize';
import { dispatchAs, type EndpointServices } from './services';
import type { Subscription } from './subscriptions';
import { placeRecorded, recordedPlacement, type Placement } from './targets';

export type AttentionFeedsContext = {
  dispatch: EndpointServices['dispatch'];
  /** The member's ranks on the machine's sessions as the head now gives them (`Authorizer.ranks`). */
  ranks(member: string): Promise<SessionRanks>;
  log(line: string): void;
  /** The most a feed's queued stream may hold before it ends `behind`. */
  backlogBytes?: number;
};

type Items = readonly unknown[];

/** What is queued on the subscription and not yet taken: the snapshot (each session's items in it), or one session's change. */
type Pending = { kind: 'snapshot'; sessions: ReadonlyMap<string, Items> } | { kind: 'change'; appSessionId: string; items: Items | null };

type Feed = {
  sub: Subscription;
  seq: number;
  /** Its `subbed` was queued (once: a snapshot taken back is replaced under it). */
  subbed: boolean;
  /** The snapshot was queued (it is `pending`, or was taken): what changes goes as `ev`s after it. */
  snapshotted: boolean;
  /** The machine's items by session (a session with none is absent); null until `attention.list` answers. */
  items: Map<string, Items> | null;
  /** The changes heard while `attention.list` is out, the latest per session, laid over its answer. */
  early: Map<string, Items>;
  /**
   * Each session's placements once read or heard, every one of which the member must view (a null one: nobody's to
   * rank): the latest record heard, or, for a read during which records were heard, the read's and theirs, since neither
   * is known to be the newer (fix wave 2: the index's live read can be ahead of its coalesced notifications).
   */
  placed: Map<string, readonly Placement[]>;
  /** The placement read out per session (only the latest one's answer is taken), with the placements heard meanwhile. */
  placing: Map<string, { heard: Placement[] }>;
  /** What the device was given of each session, as taken (a session it holds none of is absent). */
  given: Map<string, Items>;
  pending: Pending | null;
  /** The member's ranks; null while they are read. */
  ranks: SessionRanks | null;
  /** Reads of the ranks begun: only the latest one's answer is taken. */
  rankReads: number;
};

const SNAPSHOT = 'attention';
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isId = (value: unknown): value is string => typeof value === 'string' && value !== '' && value.length <= 512;

export class AttentionFeeds {
  readonly #ctx: AttentionFeedsContext;
  readonly #epoch = `attention:${randomBytes(9).toString('base64url')}`;
  readonly #feeds = new Map<Subscription, Feed>();

  constructor(ctx: AttentionFeedsContext) {
    this.#ctx = ctx;
  }

  open(sub: Subscription): void {
    const feed: Feed = { sub, seq: 0, subbed: false, snapshotted: false, items: null, early: new Map(), placed: new Map(), placing: new Map(), given: new Map(), pending: null, ranks: null, rankReads: 0 };
    this.#feeds.set(sub, feed);
    // The device took some of the stream, or credit came: the queued output may be taken, and the next one due.
    sub.onRoom = () => this.#settle(feed);
    void this.#readRanks(feed);
    void this.#readItems(feed);
  }

  close(sub: Subscription): void {
    this.#feeds.delete(sub);
  }

  stop(): void {
    this.#feeds.clear();
  }

  /** A record changed, or a new head came: every feed's cut is worked out again (its ranks read again where they moved). */
  accessChanged(): void {
    for (const feed of this.#feeds.values()) this.#settle(feed);
  }

  /** A machine event (`onEvent`, owner `machine`): a session's items, or its record (its placement). */
  event(owner: string, message: { name: string; payload: unknown }): void {
    if (owner !== 'machine' || this.#feeds.size === 0) return;
    const { name, payload } = message;
    if (!isObject(payload)) return;
    if (name === 'attention.changed' && isId(payload.appSessionId) && Array.isArray(payload.items)) {
      const id = payload.appSessionId;
      const items: Items = payload.items;
      for (const feed of this.#feeds.values()) {
        if (feed.items === null) feed.early.set(id, items);
        else if (items.length === 0) feed.items.delete(id);
        else feed.items.set(id, items);
        // A session nobody could rank is placed again at its next change (its record may name its engine session now).
        if (feed.placed.get(id)?.includes(null) === true) feed.placed.delete(id);
        this.#settle(feed);
      }
    } else if (name === 'session.changed' && isObject(payload.record) && isId(payload.record.appId)) {
      const id = payload.record.appId;
      const placement = recordedPlacement(id, payload.record);
      for (const feed of this.#feeds.values()) {
        const reading = feed.placing.get(id);
        if (reading !== undefined) reading.heard.push(placement); // weighed with the read's answer when it lands
        else if (feed.placed.has(id)) {
          feed.placed.set(id, [placement]);
          this.#settle(feed);
        }
      }
    }
  }

  async #readItems(feed: Feed): Promise<void> {
    const answer = await dispatchAs(this.#ctx.dispatch, feed.sub.channel.client)('machine', 'attention.list', undefined).catch((error: unknown) => ({ ok: false as const, error: { code: 'internal', message: (error as Error).message } }));
    if (this.#feeds.get(feed.sub) !== feed) return;
    if (!answer.ok || !Array.isArray(answer.value)) {
      this.#ctx.log(`endpoint: an attention feed's snapshot could not be read: ${answer.ok ? 'not a list' : `${answer.error.code} (${answer.error.message})`}`);
      return void feed.sub.end('unavailable');
    }
    const items = new Map<string, Items>();
    const grouped = new Map<string, unknown[]>();
    for (const item of answer.value as unknown[]) {
      const id = isObject(item) ? item.appSessionId : undefined;
      if (!isId(id)) continue;
      const list = grouped.get(id);
      if (list === undefined) grouped.set(id, [item]);
      else list.push(item);
    }
    for (const [id, list] of grouped) items.set(id, list);
    for (const [id, list] of feed.early) {
      if (list.length === 0) items.delete(id);
      else items.set(id, list);
    }
    feed.early.clear();
    feed.items = items;
    this.#settle(feed);
  }

  async #readRanks(feed: Feed): Promise<void> {
    const n = ++feed.rankReads;
    feed.ranks = null;
    let ranks: SessionRanks;
    try {
      ranks = await this.#ctx.ranks(feed.sub.who.member);
    } catch (error) {
      if (n !== feed.rankReads || this.#feeds.get(feed.sub) !== feed) return;
      this.#ctx.log(`endpoint: an attention feed's ranks could not be read: ${(error as Error).message}`);
      return void feed.sub.end('unavailable');
    }
    if (n !== feed.rankReads || this.#feeds.get(feed.sub) !== feed) return;
    feed.ranks = ranks;
    this.#settle(feed);
  }

  /**
   * The session's placement by its record, read for this feed's channel; settled again when it lands. A spine that
   * can't answer ends the feed `unavailable` (fix wave 1): a session it can't place is not one nobody may rank, and the
   * device's reopening reads it again.
   */
  async #place(feed: Feed, id: string): Promise<void> {
    const reading = { heard: [] as Placement[] };
    feed.placing.set(id, reading);
    let placement: Placement;
    try {
      placement = await placeRecorded(id, dispatchAs(this.#ctx.dispatch, feed.sub.channel.client));
    } catch (error) {
      if (feed.placing.get(id) !== reading || this.#feeds.get(feed.sub) !== feed) return;
      this.#ctx.log(`endpoint: an attention feed could not place a session: ${(error as Error).message}`);
      return void feed.sub.end('unavailable');
    }
    if (feed.placing.get(id) !== reading || this.#feeds.get(feed.sub) !== feed) return;
    feed.placing.delete(id);
    feed.placed.set(id, [...reading.heard, placement]);
    this.#settle(feed);
  }

  /**
   * The feed against the rights now, in one synchronous step: the queued output is checked again (held while it can't
   * be, taken back once it no longer stands), and once nothing waits, the next output is queued, so what leaves was
   * allowed under the rights that stand when it is taken.
   */
  #settle(feed: Feed): void {
    const { sub } = feed;
    for (;;) {
      if (sub.ended || feed.items === null) return;
      if (feed.pending !== null && sub.backlog === 0) this.#taken(feed);
      this.#placeMissing(feed);
      if (feed.ranks !== null && !feed.ranks.current()) void this.#readRanks(feed);
      if (feed.pending !== null) {
        const verdict = this.#stands(feed, feed.pending);
        if (verdict === 'unknown') return void sub.hold();
        if (verdict === 'stands') return void sub.unhold();
        if (!this.#takeBack(feed)) return;
      }
      if (feed.ranks === null) return;
      sub.unhold();
      const queued = this.#queueNext(feed);
      if (!queued) return this.#prune(feed);
      if (sub.backlog > (this.#ctx.backlogBytes ?? BACKLOG_BYTES)) return void sub.end('behind');
      if (sub.backlog > 0) return; // taken later: `onRoom` settles again
    }
  }

  /** The queued output left: the device holds it. */
  #taken(feed: Feed): void {
    const pending = feed.pending!;
    feed.pending = null;
    if (pending.kind === 'snapshot') for (const [id, items] of pending.sessions) feed.given.set(id, items);
    else if (pending.items === null) feed.given.delete(pending.appSessionId);
    else feed.given.set(pending.appSessionId, pending.items);
  }

  /** Whether the member views the session now (false while its placement is unknown). */
  #views(feed: Feed, id: string): boolean {
    const ranks = feed.ranks;
    return ranks !== null && feed.placed.has(id) && feed.placed.get(id)!.every((placement) => ranks.holds(placement, 'view'));
  }

  /** Whether the queued output still stands under the rights now: `unknown` while the ranks or a placement are read. */
  #stands(feed: Feed, pending: Pending): 'stands' | 'withdrawn' | 'unknown' {
    if (pending.kind === 'change' && pending.items === null) return 'stands'; // emptying a session tells nothing
    if (feed.ranks === null) return 'unknown';
    const sessions = pending.kind === 'snapshot' ? [...pending.sessions.keys()] : [pending.appSessionId];
    if (sessions.some((id) => !feed.placed.has(id))) return 'unknown';
    return sessions.every((id) => this.#views(feed, id)) ? 'stands' : 'withdrawn';
  }

  /** The queued output no longer stands: taken back. False when it can't be (a part-sent snapshot): the feed ended. */
  #takeBack(feed: Feed): boolean {
    const { sub } = feed;
    if (feed.pending!.kind === 'snapshot') {
      if (sub.midSnapshot) {
        sub.end('behind');
        return false;
      }
      sub.dropSnapshot(SNAPSHOT); // its `subbed`, already queued, stands: the snapshot queued next replaces it
      feed.snapshotted = false;
    } else {
      sub.clear();
    }
    feed.pending = null;
    return true;
  }

  /** The next output, queued: the snapshot, then the first session whose due items differ from the device's. False: none. */
  #queueNext(feed: Feed): boolean {
    const { sub } = feed;
    const items = feed.items!;
    if (!feed.snapshotted) {
      if ([...items.keys()].some((id) => !feed.placed.has(id))) return false;
      const sessions = new Map([...items].filter(([id]) => this.#views(feed, id)));
      const at = { epoch: this.#epoch, seq: 0 };
      if (!feed.subbed) sub.subbed('snapshot', at);
      feed.subbed = true;
      feed.snapshotted = true;
      feed.pending = { kind: 'snapshot', sessions };
      sub.snap(at, [...sessions.values()].flat(), SNAPSHOT);
      return true;
    }
    for (const id of new Set([...items.keys(), ...feed.given.keys()])) {
      if (!feed.placed.has(id)) continue; // its placement is read: settled again when it lands
      const due = this.#views(feed, id) ? (items.get(id) ?? null) : null;
      if (due === (feed.given.get(id) ?? null)) continue;
      feed.pending = { kind: 'change', appSessionId: id, items: due };
      sub.ev({ epoch: this.#epoch, seq: ++feed.seq }, { appSessionId: id, items: due ?? [] });
      return true;
    }
    return false;
  }

  /** Starts a placement read for every session the feed needs and hasn't placed. */
  #placeMissing(feed: Feed): void {
    const pending = feed.pending === null ? [] : feed.pending.kind === 'snapshot' ? [...feed.pending.sessions.keys()] : [feed.pending.appSessionId];
    for (const id of new Set([...feed.items!.keys(), ...feed.given.keys(), ...pending])) if (!feed.placed.has(id) && !feed.placing.has(id)) void this.#place(feed, id);
  }

  /** A session the device holds nothing of, the machine lists nothing for and nothing queued names needs no placement kept. */
  #prune(feed: Feed): void {
    for (const id of feed.placed.keys()) if (!feed.items!.has(id) && !feed.given.has(id)) feed.placed.delete(id);
  }
}
