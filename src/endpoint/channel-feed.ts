// The machine's `channel` feed (P5 O8 M7b, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M7b, Interfaces §O,
// Decision Log "M7b's channel feed"): one org project's to-human entries on this machine, live, for a device's Channel tab.
// The sub names the project (`{t: 'sub', feed: 'channel', project, cursor, credit}`, behind `rl2.channel`); it is admitted
// at `list` for a member while the project is one of the org's (authorize.ts), and what it carries is cut entry by entry
// to the sessions the member views, ranked lane by lane as `channel.history` cuts them (channel-view.ts).
//
// Every opening is `subbed {mode: 'snapshot', epoch: 'channel:<this endpoint's boot>', seq: 0}` with its `snap`, the
// project's newest page the member views (`{entries, more}`, `channel.history {project}`'s first page as the member would be
// answered it); then each new entry of the project the member views goes as `ev {body: {entry}}` at the next `seq`, in the
// order the journal recorded them (`channel.changed`). Another project's entries never go on this feed. An entry the
// snapshot holds is not sent again. Older entries are the device's to page with `channel.history`.
//
// Output crosses no change of rights, as the `attention` feed's doesn't: one output is queued at a time (the snapshot, or
// one entry) and the next is worked out only once it was taken; at every change of rights (a record change, a new head:
// `accessChanged`) the queued output is checked again before anything more of it can leave. An entry that no longer
// stands is taken back and dropped (the member no longer views its session); a snapshot is cut again, or, once a page of it
// left, the feed ends `behind` and the device opens it again. A lane B entry waits while its session is placed. The member's
// ranks are read again once they are no longer current.
//
// It ends with its channel, `removed` once the project is no longer the org's (the reader's reach is per project), `behind`
// past plane B's backlog or past CHANGES_HELD entries waiting, and `unavailable` when the spine can't answer the snapshot's
// read, a session's placement or the member's ranks: the device opens it again on its backoff.
import { randomBytes } from 'node:crypto';
import type { HostEntry } from '@shared/ipc/schema/channel';
import { HISTORY_LIMIT_MAX } from '@shared/ipc/schema/channel';
import { BACKLOG_BYTES } from '@shared/host/stream-catchup';
import type { SessionRanks } from './authorize';
import { cutPage, laneBSessions, readHistory, viewable, type ChannelPage } from './channel-view';
import { dispatchAs, type EndpointServices } from './services';
import type { Subscription } from './subscriptions';
import { placeRecorded, recordedPlacement, type Placement } from './targets';

export type ChannelFeedsContext = {
  dispatch: EndpointServices['dispatch'];
  /** The member's ranks on the machine's sessions as the head now gives them (`Authorizer.ranks`). */
  ranks(member: string): Promise<SessionRanks>;
  /** Whether `project` is one of the org's projects in the head now (channel-view.ts' `orgProject`). */
  reaches(project: string): boolean;
  log(line: string): void;
  /** The most a feed's queued stream may hold before it ends `behind`. */
  backlogBytes?: number;
};

/** How many of the project's new entries a feed holds unsent before it ends `behind` (the device reads its snapshot again). */
export const CHANGES_HELD = 1_000;

type Pending = { kind: 'snapshot'; entries: readonly HostEntry[] } | { kind: 'change'; entry: HostEntry };

type Feed = {
  sub: Subscription;
  project: string;
  seq: number;
  subbed: boolean;
  /** The snapshot's read: the journal's entries it read and whether older ones remain; null while it is out. */
  read: { entries: HostEntry[]; more: boolean } | null;
  /** The snapshot was queued: what the project records goes as `ev`s after it. */
  snapshotted: boolean;
  /** The ids the device was given or is queued, so an entry the snapshot holds goes once. */
  known: Set<string>;
  /** The project's new entries, in order, not yet worked out. */
  queue: HostEntry[];
  /** Each lane B session's placements, every one of which the member must view: the latest heard, or a read's and those heard meanwhile. */
  placed: Map<string, readonly Placement[]>;
  /** The placement read out per session, with the placements heard meanwhile. */
  placing: Map<string, { heard: Placement[] }>;
  pending: Pending | null;
  ranks: SessionRanks | null;
  rankReads: number;
};

const SNAPSHOT = 'channel';
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isId = (value: unknown): value is string => typeof value === 'string' && value !== '' && value.length <= 512;

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
    const feed: Feed = { sub, project, seq: 0, subbed: false, read: null, snapshotted: false, known: new Set(), queue: [], placed: new Map(), placing: new Map(), pending: null, ranks: null, rankReads: 0 };
    this.#feeds.set(sub, feed);
    sub.onRoom = () => this.#settle(feed);
    void this.#readRanks(feed).then(() => this.#readSnapshot(feed));
  }

  close(sub: Subscription): void {
    this.#feeds.delete(sub);
  }

  stop(): void {
    this.#feeds.clear();
  }

  /** A record changed, or a new head came: every feed's queued output is checked again, its ranks read again where they moved. */
  accessChanged(): void {
    for (const feed of this.#feeds.values()) this.#settle(feed);
  }

  /** A machine event: a project's new entry (`channel.changed`), or a lane B session's record (its placement). */
  event(owner: string, message: { name: string; payload: unknown }): void {
    if (owner !== 'machine' || this.#feeds.size === 0) return;
    const { name, payload } = message;
    if (!isObject(payload)) return;
    if (name === 'channel.changed' && isId(payload.project) && isObject(payload.entry) && isId(payload.entry.id)) {
      const entry = payload.entry as HostEntry;
      for (const feed of this.#feeds.values()) {
        if (feed.project !== payload.project || feed.known.has(entry.id)) continue;
        if (feed.queue.length >= CHANGES_HELD) {
          feed.sub.end('behind');
          continue;
        }
        feed.queue.push(entry);
        this.#settle(feed);
      }
    } else if (name === 'session.changed' && isObject(payload.record) && isId(payload.record.appId)) {
      const id = payload.record.appId;
      const placement = recordedPlacement(id, payload.record);
      for (const feed of this.#feeds.values()) {
        const reading = feed.placing.get(id);
        if (reading !== undefined) reading.heard.push(placement);
        else if (feed.placed.has(id)) {
          feed.placed.set(id, [placement]);
          this.#settle(feed);
        }
      }
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
      this.#ctx.log(`endpoint: a channel feed's ranks could not be read: ${(error as Error).message}`);
      return void feed.sub.end('unavailable');
    }
    if (n !== feed.rankReads || this.#feeds.get(feed.sub) !== feed) return;
    feed.ranks = ranks;
    this.#settle(feed);
  }

  /** The project's newest page as the journal holds it, read until it holds a page of what the member views (channel-view.ts). */
  async #readSnapshot(feed: Feed): Promise<void> {
    if (this.#feeds.get(feed.sub) !== feed || feed.sub.ended) return;
    const dispatch = dispatchAs(this.#ctx.dispatch, feed.sub.channel.client);
    try {
      const read = await readHistory(
        dispatch,
        { project: feed.project, limit: HISTORY_LIMIT_MAX },
        (ids) => Promise.all(ids.filter((id) => !feed.placed.has(id)).map((id) => this.#place(feed, id, dispatch))).then(() => {}),
        (entry) => this.#views(feed, entry),
      );
      if (this.#feeds.get(feed.sub) !== feed) return;
      feed.read = read;
    } catch (error) {
      if (this.#feeds.get(feed.sub) !== feed) return;
      this.#ctx.log(`endpoint: a channel feed's snapshot could not be read: ${(error as Error).message}`);
      return void feed.sub.end('unavailable');
    }
    this.#settle(feed);
  }

  /** A lane B session's placement by its record, with what was heard of it meanwhile; throws when the spine can't answer. */
  async #place(feed: Feed, id: string, dispatch: EndpointServices['dispatch']): Promise<void> {
    const reading = { heard: [] as Placement[] };
    feed.placing.set(id, reading);
    try {
      const placement = await placeRecorded(id, dispatch);
      if (feed.placing.get(id) === reading) feed.placed.set(id, [...reading.heard, placement]);
    } finally {
      if (feed.placing.get(id) === reading) feed.placing.delete(id);
    }
  }

  /** A queued change's lane B session, placed for the feed; settled again when it lands. */
  #placeChange(feed: Feed, id: string): void {
    if (feed.placing.has(id)) return;
    void this.#place(feed, id, dispatchAs(this.#ctx.dispatch, feed.sub.channel.client)).then(
      () => this.#feeds.get(feed.sub) === feed && this.#settle(feed),
      (error: unknown) => {
        if (this.#feeds.get(feed.sub) !== feed) return;
        this.#ctx.log(`endpoint: a channel feed could not place a session: ${(error as Error).message}`);
        feed.sub.end('unavailable');
      },
    );
  }

  #views(feed: Feed, entry: HostEntry): boolean {
    return feed.ranks !== null && viewable(entry, feed.ranks, (id) => feed.placed.get(id));
  }

  /** Whether `entries` can be ranked now: the ranks held, and each lane B session placed. */
  #rankable(feed: Feed, entries: readonly HostEntry[]): boolean {
    return feed.ranks !== null && laneBSessions(entries).every((id) => feed.placed.has(id));
  }

  /**
   * The feed against the rights now, in one synchronous step: the queued output checked again (held while it can't be,
   * taken back once it no longer stands), and once nothing waits, the next output queued.
   */
  #settle(feed: Feed): void {
    const { sub } = feed;
    for (;;) {
      if (sub.ended || this.#feeds.get(sub) !== feed) return;
      if (!this.#ctx.reaches(feed.project)) return void sub.end('removed');
      if (feed.pending !== null && sub.backlog === 0) feed.pending = null; // taken: the device holds it
      if (feed.ranks !== null && !feed.ranks.current()) void this.#readRanks(feed);
      if (feed.pending !== null) {
        const entries = feed.pending.kind === 'snapshot' ? feed.pending.entries : [feed.pending.entry];
        if (!this.#rankable(feed, entries)) return void sub.hold();
        if (entries.every((entry) => this.#views(feed, entry))) return void sub.unhold();
        if (!this.#takeBack(feed)) return;
      }
      if (feed.ranks === null || feed.read === null) return;
      sub.unhold();
      if (!this.#queueNext(feed)) return;
      if (sub.backlog > (this.#ctx.backlogBytes ?? BACKLOG_BYTES)) return void sub.end('behind');
      if (sub.backlog > 0) return; // taken later: `onRoom` settles again
    }
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
      sub.dropSnapshot(SNAPSHOT); // its `subbed`, already queued, stands: the snapshot queued next replaces it
      for (const entry of pending.entries) feed.known.delete(entry.id);
      feed.snapshotted = false;
    } else {
      sub.clear(); // the entry is dropped: the member no longer views its session
    }
    feed.pending = null;
    return true;
  }

  /** The next output, queued: the snapshot, then the first new entry the member views. False: none (or one waits on a placement). */
  #queueNext(feed: Feed): boolean {
    const { sub } = feed;
    if (!feed.snapshotted) {
      const missing = laneBSessions(feed.read!.entries).filter((id) => !feed.placed.has(id));
      if (missing.length > 0) {
        for (const id of missing) this.#placeChange(feed, id);
        return false;
      }
      const page: ChannelPage = cutPage(feed.read!, HISTORY_LIMIT_MAX, (entry) => this.#views(feed, entry));
      const at = { epoch: this.#epoch, seq: 0 };
      if (!feed.subbed) sub.subbed('snapshot', at);
      feed.subbed = true;
      feed.snapshotted = true;
      for (const entry of page.entries) feed.known.add(entry.id);
      feed.queue = feed.queue.filter((entry) => !feed.known.has(entry.id));
      feed.pending = { kind: 'snapshot', entries: page.entries };
      sub.snap(at, page, SNAPSHOT);
      return true;
    }
    while (feed.queue.length > 0) {
      const entry = feed.queue[0];
      if (!this.#rankable(feed, [entry])) {
        for (const id of laneBSessions([entry])) if (!feed.placed.has(id)) this.#placeChange(feed, id);
        return false;
      }
      feed.queue.shift();
      if (feed.known.has(entry.id) || !this.#views(feed, entry)) continue;
      feed.known.add(entry.id);
      feed.pending = { kind: 'change', entry };
      sub.ev({ epoch: this.#epoch, seq: ++feed.seq }, { entry });
      return true;
    }
    return false;
  }
}
