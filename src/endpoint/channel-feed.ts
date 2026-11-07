// The machine's `channel` feed (P5 O8 M7b, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M7b, Interfaces §O,
// Decision Log "M7b's channel feed"): one org project's to-human entries on this machine, live, for a device's Channel tab.
// The sub names the project (`{t: 'sub', feed: 'channel', project, cursor, credit}`, behind `rl2.channel`); it is admitted
// at `list` for a member while the project is one of the org's (authorize.ts), and what it carries is cut entry by entry
// to the sessions the member views, ranked lane by lane as `channel.history` cuts them (channel-view.ts).
//
// Every opening is `subbed {mode: 'snapshot', epoch: 'channel:<this endpoint's boot>', seq: 0}` with its `snap`, the
// project's newest page the member views (`{entries, more}`, `channel.history {project}`'s first page as the member would be
// answered it); then each new entry of the project the member views goes as `ev {body: {entry}}` at the next `seq`, in the
// order the journal recorded them (`channel.changed`), `seq` without gaps. Another project's entries never go on this
// feed. An entry the snapshot holds is not sent again. Every entry goes under its cursor (channel-cursors.ts), as
// history's do. Older entries are the device's to page with `channel.history`.
//
// Output crosses no change of rights, as the `attention` feed's doesn't: one output is queued at a time (the snapshot, or
// one entry) and the next is worked out only once it was taken; at every change of rights (a record change, a new head:
// `accessChanged`; a lane B session's record heard, or its removal) the queued output is checked again before anything more
// of it can leave. An entry that no longer stands is taken back and dropped (the member no longer views its session), its
// `seq` given to the next; a snapshot is read again (never cut again: its `more` is exact only for the read it came of),
// or, once a page of it left, the feed ends `behind` and the device opens it again. The member's ranks are read again once
// they are no longer current, and a snapshot read out under ranks since replaced is read again under the new ones; one
// read is published only while nothing it kept is hidden now and nothing it passed by is viewable now (channel-view.ts'
// `publish`), and a queued snapshot is held to both until it is taken. After SNAPSHOT_READS reads in a row that moved so,
// it waits for the next change of rights and reads once more, or ends `unavailable` past SNAPSHOT_SETTLE_MS or a read that
// moved again: no page whose `more` it can't vouch for goes.
//
// A lane B entry is ranked by its session's record as read after the entry came, and every record of it heard since
// (channel-view.ts' `PlacementBook`); one that waited behind another output is read again when its turn comes, so what
// goes is ranked by the record as it stood then, not a placement read before the record moved. An entry the member
// doesn't view is dropped once ranked, before it counts toward what the feed holds; past CHANGES_HELD waiting to be ranked
// (their placements slow to come), they are let go of, their ids kept, and read again from the journal once nothing is
// queued: what the member views of them goes as `ev`s in the journal's order (nothing, when they view none of them), or,
// when that is more than a page, the project's page again as a `snap` at the stream's place. No entry the member can't be
// shown to view ends the feed or sends a frame. What the feed holds is what it still has to send: the snapshot's read until
// it is taken, the entries waiting, the let-go ids, the reads ranking them, the ids of the snapshot's page (an entry it
// holds that `channel.changed` brings again goes once).
//
// It ends with its channel, `removed` once the project is no longer the org's (the reader's reach is per project), `behind`
// past plane B's backlog or past CHANGES_HELD entries the member views waiting, and `unavailable` when the spine can't
// answer the snapshot's read (or the journal runs past the scan's bound), a session's placement or the member's ranks, or
// the snapshot could not be vouched for (above): the device opens it again on its backoff.
import { randomBytes } from 'node:crypto';
import type { HostEntry } from '@shared/ipc/schema/channel';
import { HISTORY_LIMIT_MAX } from '@shared/ipc/schema/channel';
import { BACKLOG_BYTES } from '@shared/host/stream-catchup';
import type { SessionRanks } from './authorize';
import type { ChannelCursors } from './channel-cursors';
import { PlacementBook, publish, readViewable, viewable, type EntrySession, type ViewableRead } from './channel-view';
import { dispatchAs, type EndpointServices } from './services';
import type { Subscription } from './subscriptions';
import { recordedPlacement, type Placement } from './targets';

export type ChannelFeedsContext = {
  dispatch: EndpointServices['dispatch'];
  /** The member's ranks on the machine's sessions as the head now gives them (`Authorizer.ranks`). */
  ranks(member: string): Promise<SessionRanks>;
  /** Whether `project` is one of the org's projects in the head now (channel-view.ts' `orgProject`). */
  reaches(project: string): boolean;
  /** The cursor each entry goes under (channel-cursors.ts). */
  cursors: Pick<ChannelCursors, 'seal'>;
  log(line: string): void;
  /** The most a feed's queued stream may hold before it ends `behind`. */
  backlogBytes?: number;
  /** How long a snapshot past its reads waits for a change of rights before the feed ends `unavailable` (SNAPSHOT_SETTLE_MS). */
  settleMs?: number;
};

/** How many of the project's new entries the member views a feed holds unsent before it ends `behind`; as many unranked before it reads the project again. */
export const CHANGES_HELD = 1_000;
/** How many reads in a row a snapshot may take, what each read moving under it, before it waits on a change of rights. */
export const SNAPSHOT_READS = 3;
/**
 * How long a snapshot past SNAPSHOT_READS waits for the next change of rights (one more read then) before the feed ends
 * `unavailable`. Rights that moved under three reads in a row are mid-churn (a head and its records arriving); a change
 * usually lands within a second or two. Past that, the device's own reopen (its backoff from about a second) does as well.
 */
export const SNAPSHOT_SETTLE_MS = 2_000;
/** How many let-go entries' ids a feed keeps to read again: the journal keeps no more of a project (CHANNEL_BOUNDS.perProject). */
export const DEFERRED_MAX = 2_000;

/**
 * A new entry: its mark (`after`), what ranks it once its session's record read after it landed; whether the member viewed
 * it then (`ranked`); and the mark it goes by (`deliverAfter`): the same, when it came with nothing ahead of it, else one
 * taken when its turn came.
 */
type Change = { entry: HostEntry; after: number; ranked: boolean; deliverAfter: number | null };
type Pending = { kind: 'snapshot'; kept: readonly HostEntry[]; skipped: readonly EntrySession[]; after: number } | { kind: 'change'; change: Change; after: number };

type Feed = {
  sub: Subscription;
  project: string;
  seq: number;
  subbed: boolean;
  book: PlacementBook;
  /** The snapshot's read, under the ranks it began with: out (`read` null) or landed and not yet queued; null once queued, or before it is begun. */
  snapshot: { after: number; ranks: SessionRanks; read: ViewableRead | null } | null;
  /** The snapshot was queued: what the project records goes as `ev`s after it. */
  snapshotted: boolean;
  /**
   * The journal ids of new entries let go of unranked (more than CHANGES_HELD waiting to be ranked), in order: read again
   * from the journal once nothing is queued (`catchUp`), and what the member views of them goes as `ev`s.
   */
  deferred: number[];
  /** The read of the let-go entries: out (`read` null) or landed; null before it is begun. */
  catchUp: { after: number; read: ViewableRead | null } | null;
  /** Reads of the snapshot since one was last queued. */
  reads: number;
  /** A snapshot past SNAPSHOT_READS waiting on a change of rights (`waited`: it did, once, since one was last queued). */
  stall: ReturnType<typeof setTimeout> | null;
  waited: boolean;
  /** The journal ids of the snapshot's page as queued: an entry it holds goes once. */
  known: Set<string>;
  /** The project's new entries, in order, not yet sent. */
  changes: Change[];
  pending: Pending | null;
  /** The reads a ranking waits on, each settling the feed once when it lands. */
  waiting: Set<Promise<void>>;
  ranks: SessionRanks | null;
  rankReads: number;
};

const SNAPSHOT = 'channel';
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isId = (value: unknown): value is string => typeof value === 'string' && value !== '' && value.length <= 512;
const laneBOf = (entry: EntrySession): string | null => (entry.lane === 'B' && isId(entry.appSessionId) ? entry.appSessionId : null);

export class ChannelFeeds {
  readonly #ctx: ChannelFeedsContext;
  readonly #epoch = `channel:${randomBytes(9).toString('base64url')}`;
  readonly #feeds = new Map<Subscription, Feed>();

  constructor(ctx: ChannelFeedsContext) {
    this.#ctx = ctx;
  }

  open(sub: Subscription): void {
    const project = sub.message.feed === 'channel' && 'project' in sub.message ? sub.message.project : undefined;
    if (!isId(project)) return void sub.end('no-target');
    const feed: Feed = { sub, project, seq: 0, subbed: false, book: new PlacementBook(), snapshot: null, snapshotted: false, deferred: [], catchUp: null, reads: 0, stall: null, waited: false, known: new Set(), changes: [], pending: null, waiting: new Set(), ranks: null, rankReads: 0 };
    this.#feeds.set(sub, feed);
    sub.onRoom = () => this.#settle(feed);
    void this.#readRanks(feed);
  }

  close(sub: Subscription): void {
    const feed = this.#feeds.get(sub);
    if (feed?.stall != null) clearTimeout(feed.stall);
    this.#feeds.delete(sub);
  }

  stop(): void {
    for (const feed of this.#feeds.values()) if (feed.stall !== null) clearTimeout(feed.stall);
    this.#feeds.clear();
  }

  /**
   * A record changed, or a new head came: every feed's queued output is checked again, its ranks read again where they
   * moved; a snapshot waiting on a change of rights takes its one more read.
   */
  accessChanged(): void {
    for (const feed of this.#feeds.values()) {
      if (feed.stall !== null) {
        clearTimeout(feed.stall);
        feed.stall = null;
        feed.reads = SNAPSHOT_READS - 1;
      }
      this.#settle(feed);
    }
  }

  /** What a feed holds (the suites' measure of its bounds): entries for its snapshot, entries waiting, sessions placed, ids known. */
  held(sub: Subscription): { snapshot: number; changes: number; placements: number; known: number } | null {
    const feed = this.#feeds.get(sub);
    if (feed === undefined) return null;
    const snapshot = (feed.snapshot?.read?.kept.length ?? 0) + (feed.pending?.kind === 'snapshot' ? feed.pending.kept.length : 0);
    return { snapshot, changes: feed.changes.length + (feed.pending?.kind === 'change' ? 1 : 0), placements: feed.book.size, known: feed.known.size };
  }

  /** A machine event: a project's new entry (`channel.changed`), or a lane B session's record (`session.changed`, `.removed`). */
  event(owner: string, message: { name: string; payload: unknown }): void {
    if (owner !== 'machine' || this.#feeds.size === 0) return;
    const { name, payload } = message;
    if (!isObject(payload)) return;
    if (name === 'channel.changed' && isId(payload.project) && isObject(payload.entry) && isId(payload.entry.id)) {
      const entry = payload.entry as HostEntry;
      for (const feed of this.#feeds.values()) if (feed.project === payload.project) this.#arrive(feed, entry);
    } else if (name === 'session.changed' && isObject(payload.record) && isId(payload.record.appId)) {
      this.#heard(payload.record.appId, recordedPlacement(payload.record.appId, payload.record));
    } else if (name === 'session.removed' && isId(payload.appSessionId)) {
      this.#heard(payload.appSessionId, null); // a removed record places the session nowhere: nobody views it
    }
  }

  /**
   * A lane B session's record heard: one more placement every reader of it since their mark is held to, for each feed
   * that reads it or whose snapshot's read is out (it may come to read it); a feed reading it is settled.
   */
  #heard(appSessionId: string, placement: Placement): void {
    for (const feed of this.#feeds.values()) {
      const reads = feed.book.has(appSessionId);
      if (!reads && !this.#readOut(feed)) continue;
      feed.book.heard(appSessionId, placement);
      if (reads) this.#settle(feed);
    }
  }

  #arrive(feed: Feed, entry: HostEntry): void {
    if (feed.known.has(entry.id)) return;
    const idle = feed.snapshotted && feed.pending === null && feed.changes.length === 0 && feed.deferred.length === 0;
    const after = feed.book.mark();
    feed.changes.push({ entry, after, ranked: false, deliverAfter: idle ? after : null });
    this.#settle(feed);
  }

  #live(feed: Feed): boolean {
    return !feed.sub.ended && this.#feeds.get(feed.sub) === feed;
  }

  /** Whether a read of the journal is out for the feed (its snapshot's, or its let-go entries'), whose sessions aren't known yet. */
  #readOut(feed: Feed): boolean {
    return (feed.snapshot !== null && feed.snapshot.read === null) || (feed.catchUp !== null && feed.catchUp.read === null);
  }

  async #readRanks(feed: Feed): Promise<void> {
    const n = ++feed.rankReads;
    feed.ranks = null;
    let ranks: SessionRanks;
    try {
      ranks = await this.#ctx.ranks(feed.sub.who.member);
    } catch (error) {
      if (n !== feed.rankReads || !this.#live(feed)) return;
      this.#ctx.log(`endpoint: a channel feed's ranks could not be read: ${(error as Error).message}`);
      return void feed.sub.end('unavailable');
    }
    if (n !== feed.rankReads || !this.#live(feed)) return;
    feed.ranks = ranks;
    // A snapshot read out under other ranks is read again under these, a few times at most (SNAPSHOT_READS): one landed
    // is checked against them as it goes (`publish`).
    if (feed.snapshot !== null && feed.snapshot.read === null && feed.snapshot.ranks !== ranks && feed.reads < SNAPSHOT_READS) feed.snapshot = null;
    this.#settle(feed);
  }

  /** The project's newest page the member views, read from the journal (channel-view.ts' `readViewable`), then the feed settled. */
  #readSnapshot(feed: Feed, ranks: SessionRanks): void {
    const snapshot: NonNullable<Feed['snapshot']> = { after: feed.book.mark(), ranks, read: null };
    feed.snapshot = snapshot;
    feed.reads++;
    const dispatch = dispatchAs(this.#ctx.dispatch, feed.sub.channel.client);
    const place = (ids: string[]) => Promise.all(ids.map((id) => feed.book.ensure(id, snapshot.after, dispatch))).then(() => {});
    // Each page ranked by the member's ranks as they stand then (those it began with while they are re-read).
    const views = (entry: HostEntry) => viewable(entry, feed.ranks ?? ranks, feed.book, snapshot.after);
    readViewable(dispatch, { project: feed.project, limit: HISTORY_LIMIT_MAX }, views, place).then(
      (read) => {
        if (!this.#live(feed) || feed.snapshot !== snapshot) return;
        snapshot.read = read;
        this.#settle(feed);
      },
      (error: unknown) => {
        if (!this.#live(feed) || feed.snapshot !== snapshot) return;
        this.#ctx.log(`endpoint: a channel feed's snapshot could not be read: ${(error as Error).message}`);
        feed.sub.end('unavailable');
      },
    );
  }

  /**
   * The let-go entries read again from the journal: what the member views of them (newest first, at most CHANGES_HELD and a
   * page's bytes; `full` past either), each ranked as a snapshot's page is; then the feed settled.
   */
  #readCatchUp(feed: Feed, ranks: SessionRanks): void {
    const catchUp: NonNullable<Feed['catchUp']> = { after: feed.book.mark(), read: null };
    feed.catchUp = catchUp;
    const deferred = new Set(feed.deferred);
    const dispatch = dispatchAs(this.#ctx.dispatch, feed.sub.channel.client);
    const place = (ids: string[]) => Promise.all(ids.map((id) => feed.book.ensure(id, catchUp.after, dispatch))).then(() => {});
    const views = (entry: HostEntry) => deferred.has(Number(entry.id)) && viewable(entry, feed.ranks ?? ranks, feed.book, catchUp.after);
    readViewable(dispatch, { project: feed.project, limit: CHANGES_HELD }, views, place).then(
      (read) => {
        if (!this.#live(feed) || feed.catchUp !== catchUp) return;
        catchUp.read = read;
        this.#settle(feed);
      },
      (error: unknown) => {
        if (!this.#live(feed) || feed.catchUp !== catchUp) return;
        this.#ctx.log(`endpoint: a channel feed's let-go entries could not be read again: ${(error as Error).message}`);
        feed.sub.end('unavailable');
      },
    );
  }

  /** A lane B session's record, read after `after` for the feed; settled again once it lands. */
  #place(feed: Feed, appSessionId: string, after: number): void {
    const read = feed.book.ensure(appSessionId, after, dispatchAs(this.#ctx.dispatch, feed.sub.channel.client));
    if (feed.waiting.has(read)) return;
    feed.waiting.add(read);
    read.then(
      () => {
        feed.waiting.delete(read);
        if (this.#live(feed)) this.#settle(feed);
      },
      (error: unknown) => {
        feed.waiting.delete(read);
        if (!this.#live(feed)) return;
        this.#ctx.log(`endpoint: a channel feed could not place a session: ${(error as Error).message}`);
        feed.sub.end('unavailable');
      },
    );
  }

  /** Whether the member views `entry` by what was seen since `after`; null while that can't be said (no ranks, its read out). */
  #views(feed: Feed, entry: EntrySession, after: number): boolean | null {
    if (feed.ranks === null) return null;
    const app = laneBOf(entry);
    if (app !== null && feed.book.seen(app, after) === undefined) return null;
    return viewable(entry, feed.ranks, feed.book, after);
  }

  /**
   * The feed against the rights now, in one synchronous step: the entries waiting ranked (the hidden dropped), the queued
   * output checked again (held while it can't be, taken back once it no longer stands), and once nothing waits, the next
   * output queued.
   */
  #settle(feed: Feed): void {
    const { sub } = feed;
    for (;;) {
      if (!this.#live(feed)) return;
      if (!this.#ctx.reaches(feed.project)) return void sub.end('removed');
      if (feed.pending !== null && sub.backlog === 0) feed.pending = null; // taken: the device holds it
      if (feed.ranks !== null && !feed.ranks.current()) void this.#readRanks(feed);
      if (!this.#rank(feed)) return;
      if (feed.pending !== null) {
        const pending = feed.pending;
        const stands = pending.kind === 'snapshot' ? this.#snapshotStands(feed, pending) : this.#views(feed, pending.change.entry, pending.after);
        if (stands === null) return void sub.hold();
        if (stands) {
          sub.unhold();
          return void this.#prune(feed);
        }
        if (!this.#takeBack(feed)) return;
        continue;
      }
      if (feed.ranks === null) return;
      sub.unhold();
      let queued: boolean;
      try {
        queued = this.#queueNext(feed, feed.ranks);
      } catch (error) {
        this.#ctx.log(`endpoint: a channel feed could not seal its entries' cursors: ${(error as Error).message}`);
        return void sub.end('unavailable');
      }
      if (!queued) return void this.#prune(feed);
      if (sub.backlog > (this.#ctx.backlogBytes ?? BACKLOG_BYTES)) return void sub.end('behind');
      if (sub.backlog > 0) return void this.#prune(feed); // taken later: `onRoom` settles again
    }
  }

  /**
   * Whether a queued snapshot still stands: the member views every entry it holds (the one past it too) and none of the
   * sessions its read passed by, whose entries would belong on it (null: one can't be said yet).
   */
  #snapshotStands(feed: Feed, pending: Extract<Pending, { kind: 'snapshot' }>): boolean | null {
    let stands: boolean | null = true;
    for (const entry of pending.kept) {
      const views = this.#views(feed, entry, pending.after);
      if (views === false) return false;
      if (views === null) stands = null;
    }
    for (const session of pending.skipped) {
      const views = this.#views(feed, session, pending.after);
      if (views === true) return false;
      if (views === null) stands = null;
    }
    return stands;
  }

  /** Each new entry not yet ranked, ranked: dropped when the member doesn't view it. False when the feed ended `behind`. */
  #rank(feed: Feed): boolean {
    if (feed.ranks !== null) {
      feed.changes = feed.changes.filter((change) => {
        if (change.ranked) return true;
        const views = this.#views(feed, change.entry, change.after);
        if (views === false) return false;
        if (views === null) this.#place(feed, laneBOf(change.entry)!, change.after);
        else change.ranked = true;
        return true;
      });
    }
    const ranked = feed.changes.filter((change) => change.ranked).length;
    if (ranked > CHANGES_HELD) {
      feed.sub.end('behind');
      return false;
    }
    if (feed.changes.length - ranked > CHANGES_HELD) {
      // Past CHANGES_HELD waiting to be ranked, whether the member views any of them is unknown: none ends the feed. They
      // are let go of, their ids kept, and read again from the journal once nothing is queued: what goes of them is only
      // what the member views (a snapshot not yet queued is read again instead; a read out now may not hold them).
      this.#ctx.log(`endpoint: a channel feed let go of ${feed.changes.length} entries waiting to be ranked; it reads them again from the journal`);
      if (feed.snapshotted) {
        feed.deferred.push(...feed.changes.map((change) => Number(change.entry.id)));
        if (feed.deferred.length > DEFERRED_MAX) feed.deferred.splice(0, feed.deferred.length - DEFERRED_MAX);
        feed.catchUp = null;
      } else {
        feed.snapshot = null;
        feed.reads = 0;
      }
      feed.changes = [];
    }
    return true;
  }

  /** The queued output no longer stands: taken back. False when it can't be (a part-sent snapshot): the feed ended. */
  #takeBack(feed: Feed): boolean {
    const { sub } = feed;
    const pending = feed.pending!;
    if (pending.kind === 'snapshot') {
      if (sub.midSnapshot) {
        sub.end('behind');
        return false;
      }
      sub.dropSnapshot(SNAPSHOT); // its `subbed`, already queued, stands: the snapshot read next replaces it
      feed.known.clear();
      feed.snapshotted = false;
    } else {
      sub.clear(); // the entry is dropped: the member no longer views its session
      feed.seq--; // and its `seq` is the next entry's
    }
    feed.pending = null;
    return true;
  }

  /** The next output, queued: the snapshot, then the first new entry the member views. False: none (or one waits on a read). */
  #queueNext(feed: Feed, ranks: SessionRanks): boolean {
    const { sub } = feed;
    while (!feed.snapshotted) {
      if (feed.stall !== null) return false; // waiting on a change of rights
      const snapshot = feed.snapshot;
      if (snapshot === null) {
        this.#readSnapshot(feed, ranks);
        return false;
      }
      if (snapshot.read === null) return false;
      const read = snapshot.read;
      const views = (entry: EntrySession) => this.#views(feed, entry, snapshot.after) === true;
      const seal = (entry: HostEntry) => this.#sealed(entry);
      feed.snapshot = null;
      const page = publish(read, HISTORY_LIMIT_MAX, views, seal);
      const kept = read.kept;
      if (page === null && feed.reads < SNAPSHOT_READS) continue; // what it read moved since: read again
      if (page === null && !feed.waited) {
        // Rights mid-churn: one more read once they change again, or none past a short wait.
        feed.waited = true;
        feed.stall = setTimeout(() => {
          feed.stall = null;
          if (!this.#live(feed)) return;
          this.#ctx.log(`endpoint: a channel feed's snapshot of ${feed.project.slice(0, 64)} moved under each of its reads and no change of rights came`);
          sub.end('unavailable');
        }, this.#ctx.settleMs ?? SNAPSHOT_SETTLE_MS);
        feed.stall.unref?.();
        return false;
      }
      if (page === null) {
        // No page it can vouch for (its `more` exact): the device opens the feed again on its backoff, as history answers.
        this.#ctx.log(`endpoint: a channel feed's snapshot of ${feed.project.slice(0, 64)} moved under each of its reads, and again after a change of rights`);
        sub.end('unavailable');
        return false;
      }
      // A snapshot again (taken back, or the let-go entries too many) is at the stream's place: what follows goes on from its `seq`.
      const at = { epoch: this.#epoch, seq: feed.seq };
      if (!feed.subbed) sub.subbed('snapshot', at);
      feed.subbed = true;
      feed.snapshotted = true;
      feed.reads = 0;
      feed.waited = false;
      feed.known = new Set(kept.slice(0, page.entries.length).map((entry) => entry.id));
      feed.changes = feed.changes.filter((change) => !feed.known.has(change.entry.id));
      feed.pending = { kind: 'snapshot', kept, skipped: read.skipped, after: snapshot.after };
      sub.snap(at, page, SNAPSHOT);
      return true;
    }
    if (feed.deferred.length > 0) {
      const catchUp = feed.catchUp;
      if (catchUp === null) {
        this.#readCatchUp(feed, ranks);
        return false;
      }
      if (catchUp.read === null) return false;
      feed.catchUp = null;
      feed.deferred = [];
      if (catchUp.read.full) {
        // More of them the member views than a page holds: the project is read again whole, a snapshot that differs from
        // what the device holds by them.
        feed.snapshotted = false;
        feed.known.clear();
        return this.#queueNext(feed, ranks);
      }
      // What the member views of them, in the journal's order, ahead of what came since; nothing, when they view none.
      const found = [...catchUp.read.kept].sort((a, b) => Number(a.id) - Number(b.id));
      const ids = new Set(found.map((entry) => entry.id));
      feed.changes = [...found.map((entry): Change => ({ entry, after: catchUp.after, ranked: true, deliverAfter: null })), ...feed.changes.filter((change) => !ids.has(change.entry.id))];
    }
    while (feed.changes.length > 0) {
      const change = feed.changes[0];
      if (!change.ranked) return false; // its read is out (`#rank` began it)
      change.deliverAfter ??= feed.book.mark();
      const views = this.#views(feed, change.entry, change.deliverAfter);
      if (views === null) {
        this.#place(feed, laneBOf(change.entry)!, change.deliverAfter);
        return false;
      }
      feed.changes.shift();
      if (!views) continue;
      feed.pending = { kind: 'change', change, after: change.deliverAfter };
      sub.ev({ epoch: this.#epoch, seq: ++feed.seq }, { entry: this.#sealed(change.entry) });
      return true;
    }
    return false;
  }

  #sealed(entry: HostEntry): HostEntry {
    return { ...entry, id: this.#ctx.cursors.seal(entry) };
  }

  /** Lets go of the placements nothing the feed holds is ranked by; none while the snapshot's read is out. */
  #prune(feed: Feed): void {
    if (this.#readOut(feed)) return;
    const needs: Array<readonly [string, number]> = [];
    const need = (entries: readonly EntrySession[], after: number) => {
      for (const entry of entries) {
        const app = laneBOf(entry);
        if (app !== null) needs.push([app, after]);
      }
    };
    if (feed.snapshot?.read != null) need([...feed.snapshot.read.kept, ...feed.snapshot.read.skipped], feed.snapshot.after);
    if (feed.pending?.kind === 'snapshot') need([...feed.pending.kept, ...feed.pending.skipped], feed.pending.after);
    if (feed.pending?.kind === 'change') need([feed.pending.change.entry], feed.pending.after);
    for (const change of feed.changes) need([change.entry], change.after);
    feed.book.prune(needs);
  }
}
