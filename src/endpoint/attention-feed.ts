// The machine's `attention` feed (P5 O7 M6, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, §R, M6's "The
// feed"): a device's Needs-you rows, badge and notifications for every session on this machine the member views, with
// no tab open and no subscription per session. Admitted at `list` for any member (authorize.ts), it names no session;
// what it carries is cut per session to the ones the member holds `view` on, as their rights stand when it goes.
//
// Every opening is `subbed {mode: 'snapshot', epoch: 'attention:<this endpoint's boot>', seq: 0}` with its `snap`, the
// machine's `attention.list` cut so; then each `attention.changed` (owner `machine`) of a session the member views goes
// as `ev {body: {appSessionId, items}}` at the next `seq`, the session's whole list (replace). The cut follows the
// member's rights: at every record change and every new head (`accessChanged`) the feed works out again which sessions
// the member views, and a session that left the set goes as `{appSessionId, items: []}`, one that joined as its items
// now, so a permission already waiting on a session shared a moment ago shows at once. A member who views nothing holds
// an open, empty feed, which fills at the first share: it lives with its channel, never ending for being empty.
//
// How. The feed keeps the machine's items as `attention.list` answered them and each `attention.changed` replaced them
// since (the changes heard while that read is out are laid over its answer), each session's placement by its record
// (`session.get`, then each `session.changed`; targets.ts' `recordedPlacement`, never the engine host, which a read would
// wake), and what the device holds of each session. Whatever moves, `#settle` compares what the device should hold with
// what it holds and sends the difference, deciding and sending in one synchronous step (M3's lesson: the defects lived
// where two transitions met): the records are read as it decides, so no change of rights can fall between the decision
// and the message, and a change of items heard while a session's placement or the member's ranks are read is sent, cut,
// once they land. Before the snapshot goes nothing else does: it waits for the list, every listed session's placement
// and the ranks, and is cut as things stand when it goes.
//
// It ends with its channel, `removed` with the device (the channel's), `behind` once the device leaves more than its
// backlog unread (as the `checkout` feed), and `unavailable` when the machine can't answer `attention.list`.
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
  /** The most a feed's unread stream may hold before it ends `behind`. */
  backlogBytes?: number;
};

type Items = readonly unknown[];

type Feed = {
  sub: Subscription;
  seq: number;
  /** The snapshot went: what changes goes as `ev`s from here on. */
  opened: boolean;
  /** The machine's items by session (a session with none is absent); null until `attention.list` answers. */
  items: Map<string, Items> | null;
  /** The changes heard while `attention.list` is out, the latest per session, laid over its answer. */
  early: Map<string, Items>;
  /** Each session's placement once read or heard (null: nobody's to rank). */
  placed: Map<string, Placement>;
  /** The placement reads out, by session, numbered: a `session.changed` heard meanwhile supersedes the read. */
  placing: Map<string, number>;
  /** What the device holds of each session: the items last sent (a session it holds none of is absent). */
  sent: Map<string, Items>;
  /** The member's ranks; null while they are read. */
  ranks: SessionRanks | null;
  /** Reads of the ranks begun: only the latest one's answer is taken. */
  rankReads: number;
};

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isId = (value: unknown): value is string => typeof value === 'string' && value !== '' && value.length <= 512;

export class AttentionFeeds {
  readonly #ctx: AttentionFeedsContext;
  readonly #epoch = `attention:${randomBytes(9).toString('base64url')}`;
  readonly #feeds = new Map<Subscription, Feed>();
  #placeReads = 0;

  constructor(ctx: AttentionFeedsContext) {
    this.#ctx = ctx;
  }

  open(sub: Subscription): void {
    const feed: Feed = { sub, seq: 0, opened: false, items: null, early: new Map(), placed: new Map(), placing: new Map(), sent: new Map(), ranks: null, rankReads: 0 };
    this.#feeds.set(sub, feed);
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
        if (feed.placed.get(id) === null) feed.placed.delete(id);
        this.#settle(feed);
      }
    } else if (name === 'session.changed' && isObject(payload.record) && isId(payload.record.appId)) {
      const id = payload.record.appId;
      const placement = recordedPlacement(id, payload.record);
      for (const feed of this.#feeds.values()) {
        if (!feed.placed.has(id) && !feed.placing.has(id)) continue;
        feed.placing.delete(id);
        feed.placed.set(id, placement);
        this.#settle(feed);
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
    const items = new Map<string, unknown[]>();
    for (const item of answer.value as unknown[]) {
      const id = isObject(item) ? item.appSessionId : undefined;
      if (!isId(id)) continue;
      const list = items.get(id);
      if (list === undefined) items.set(id, [item]);
      else list.push(item);
    }
    const machine = new Map<string, Items>(items);
    for (const [id, list] of feed.early) {
      if (list.length === 0) machine.delete(id);
      else machine.set(id, list);
    }
    feed.early.clear();
    feed.items = machine;
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

  /** The session's placement by its record, read for this feed's channel; settled again when it lands. */
  async #place(feed: Feed, id: string): Promise<void> {
    const n = ++this.#placeReads;
    feed.placing.set(id, n);
    let placement: Placement = null;
    try {
      placement = await placeRecorded(id, dispatchAs(this.#ctx.dispatch, feed.sub.channel.client));
    } catch (error) {
      this.#ctx.log(`endpoint: an attention feed could not place a session: ${(error as Error).message}`);
    }
    if (feed.placing.get(id) !== n || this.#feeds.get(feed.sub) !== feed) return;
    feed.placing.delete(id);
    feed.placed.set(id, placement);
    this.#settle(feed);
  }

  /**
   * What the device should hold against what it holds, the difference sent: the decision and the messages in one
   * synchronous step, against the records as they stand. Anything it can't decide yet (a placement or the ranks being
   * read) is decided when that lands.
   */
  #settle(feed: Feed): void {
    const { sub, items } = feed;
    if (sub.ended || items === null) return;
    const sessions = new Set([...items.keys(), ...feed.sent.keys()]);
    let unplaced = false;
    for (const id of sessions) {
      if (feed.placed.has(id)) continue;
      unplaced = true;
      if (!feed.placing.has(id)) void this.#place(feed, id);
    }
    if (feed.ranks === null) return;
    if (!feed.ranks.current()) return void this.#readRanks(feed);
    const ranks = feed.ranks;
    const views = (id: string) => feed.placed.has(id) && ranks.holds(feed.placed.get(id)!, 'view');
    if (!feed.opened) {
      if (unplaced) return;
      feed.opened = true;
      const snap: unknown[] = [];
      for (const [id, list] of items) {
        if (!views(id)) continue;
        feed.sent.set(id, list);
        snap.push(...list);
      }
      const at = { epoch: this.#epoch, seq: 0 };
      sub.subbed('snapshot', at);
      sub.snap(at, snap);
      return;
    }
    for (const id of sessions) {
      if (!feed.placed.has(id)) continue;
      const now = views(id) ? (items.get(id) ?? null) : null;
      const was = feed.sent.get(id) ?? null;
      if (now === was) continue;
      if (now === null) feed.sent.delete(id);
      else feed.sent.set(id, now);
      if (!this.#send(feed, { appSessionId: id, items: now ?? [] })) return;
    }
    // A session the device holds nothing of and the machine lists nothing for needs no placement kept.
    for (const id of feed.placed.keys()) if (!items.has(id) && !feed.sent.has(id)) feed.placed.delete(id);
  }

  /** One change at the next `seq`; false once the feed ended (`behind`). */
  #send(feed: Feed, body: { appSessionId: string; items: Items }): boolean {
    const { sub } = feed;
    if (sub.ended) return false;
    if (sub.backlog > (this.#ctx.backlogBytes ?? BACKLOG_BYTES)) {
      sub.end('behind');
      return false;
    }
    sub.ev({ epoch: this.#epoch, seq: ++feed.seq }, body);
    return true;
  }
}
