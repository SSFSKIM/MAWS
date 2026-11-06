// Feeds (P5 O7 M4, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, §R): a device's subscription to a machine's
// events that carry no session cursor. `git.changed`, `files.changed` and `scm.remote.output` are the spine's events
// (owner `machine`), which lane B's plane drops, so a remote pane's diff, file tree and push output follow the machine
// through a session's `checkout` feed.
//
// Every opening is `subbed {mode: 'snapshot', epoch: 'checkout:<this endpoint's boot>', seq: 0}` with nothing to snap,
// whatever cursor the device sent: the feed keeps nothing to replay, and the device, which dedups by `(epoch, seq)`,
// reads a reconnect as a fresh start (its watches replayed or invalidated, src/main/sessions/watch-replay.ts's rules).
// Each later event is `ev {body: {name, payload}}` at the next `seq`: every `files.changed` and `scm.remote.output` naming
// the session, and every `git.changed` whose `repoRoot` lies in the session's checkout bounds, as the `checkout` target
// rule reads them (targets.ts), so the device hears every repository it may watch and no other. Each `session.changed`
// of the session is carried too (O5's landing audit): the record says when the session runs again (its holder `self`, a
// new engine session), which is how a device holding no live stream of it learns so without placing it on the engine
// host or reporting interest, either of which keeps a parked host from parking. The bounds are read at the opening and
// again at each `session.changed` of the session (its roots may move). While a read is out the bounds
// are unknown: a `git.changed` waits for the latest read's answer, the latest per repository, and is sent only if the
// new bounds take it, so a root's change neither leaks the old repository's changes nor drops the new one's (fix wave 1).
// 2026-11-06 (the home-root rule, targets.ts' CheckoutBounds): a `files.changed` under a root the rule dropped (a home of
// the machine, or above it) and within none of the session's roots is not carried, as the files service refuses its path
// to a remote reader, nor an `scm.remote.output` of a session whose checkout is a home's; both are held while the bounds
// are read, as a `git.changed` is, and delivered only against bounds that were read (`reached`).
//
// A feed lives with its channel and its access (the table re-checks it as any subscription), and ends `behind` when the
// device leaves more than its backlog unread: the device opens it again, as after a reconnect.
//
// P5 O7 M6: the machine's `attention` feed is this plane's too, run by attention-feed.ts: it names no session, and cuts
// what it carries to the member's sessions at every change of access the table tells this plane of.
//
// P5 O7 M5a: so is the machine's `artifacts` feed, run by artifacts-feed.ts (artifact and library changes, cut by the
// `artifact` rule), and a session's `checkout` feed carries its `session.capabilitiesChanged` (O5's tools on it), as it
// carries `session.changed`. P5 O7 M5c: the `artifacts` feed carries O4's surfaces' events (artifacts-feed.ts).
//
// P5 O17 M9a: so is a session's `browser.inventory` feed, run by inventory-feed.ts (the agent's tabs on the session).
import { randomBytes } from 'node:crypto';
import { BACKLOG_BYTES } from '@shared/host/stream-catchup';
import type { ArtifactRanks } from './artifacts';
import { ArtifactsFeeds, type ArtifactsFeedsContext } from './artifacts-feed';
import { AttentionFeeds, type AttentionFeedsContext } from './attention-feed';
import { InventoryFeeds, type InventoryFeedsContext } from './inventory-feed';
import { dispatchAs, type EndpointServices } from './services';
import { namesSession, type Plane, type SessionSubscription, type Subscription } from './subscriptions';
import { inNfc, withinBounds, type Bounds, type CheckoutBounds } from './targets';

export type PlaneFeedsContext = {
  dispatch: EndpointServices['dispatch'];
  bounds: CheckoutBounds;
  /** The member's ranks on the machine's sessions, for the `attention` and `artifacts` feeds' cuts (P5 O7 M6, M5a). */
  ranks: AttentionFeedsContext['ranks'];
  /** The `artifact` rule's placements, per channel (P5 O7 M5a). */
  artifacts: ArtifactRanks;
  /** P5 O7 M5c: the leases each channel holds (the `artifacts` feed's watch updates). */
  leases: ArtifactsFeedsContext['leases'];
  /** P5 O17 M9a: the machine's agent browser (the `browser.inventory` feed's inventories), null before the endpoint starts. */
  browser: InventoryFeedsContext['browser'];
  log(line: string): void;
  /** The most a feed's unread stream may hold before it ends `behind`. */
  backlogBytes?: number;
};

/** How many repositories' latest `git.changed` a feed holds while its bounds are read. */
export const HELD_REPOSITORIES = 64;
/** How many `files.changed` a feed holds until its first bounds are read (the latest ones). */
export const HELD_FILE_CHANGES = 256;

type Open = {
  sub: SessionSubscription;
  seq: number;
  /** The session's checkout bounds; null while a read of them is out. */
  bounds: readonly string[] | null;
  /** Each repository's latest `git.changed`, held while the bounds are read. */
  held: Map<string, unknown>;
  /**
   * 2026-11-06: the bounds a file's change and an scm run's output are read against; null while a read of them is out,
   * or the last one couldn't read them (until the next read answers: never delivered against none).
   */
  files: Bounds | null;
  /** The `files.changed` and `scm.remote.output` held while `files` is null, in order (the latest HELD_FILE_CHANGES). */
  heldFiles: { name: string; payload: Record<string, unknown> }[];
  /** Reads of the bounds begun: only the latest one's answer is taken. */
  reads: number;
};

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
/**
 * 2026-11-06 (the home-root rule): whether a file's change, or an scm run's output, reaches a remote reader. A file's
 * path within the session's roots does; one under a root the rule dropped (a home, or above it) and in no root doesn't,
 * as the files service refuses it to them; any other is as before (a delivered file's, a watch's elsewhere). The path is
 * compared as named, which is canonical up to its last name: the machine's watches name a change under the watched
 * directory's confirmed realpath (src/services/files/watch.ts, `join(entry.real, name)`), the only `files.changed` its
 * services emit. An scm run's output reaches them unless the session's checkout is a home's (scm.ts' rule, the same).
 */
const reached = (bounds: Bounds, name: string, payload: Record<string, unknown>): boolean =>
  name === 'scm.remote.output' ? !bounds.checkoutCovers : typeof payload.path === 'string' && (withinBounds(bounds.roots, inNfc(payload.path)) || !withinBounds(bounds.dropped, inNfc(payload.path)));

export class PlaneFeeds implements Plane {
  readonly #ctx: PlaneFeedsContext;
  /** The epoch of every `checkout` feed this endpoint opens: a restarted endpoint's feeds begin again. */
  readonly #epoch = `checkout:${randomBytes(9).toString('base64url')}`;
  readonly #open = new Map<Subscription, Open>();
  readonly #attention: AttentionFeeds;
  readonly #artifacts: ArtifactsFeeds;
  readonly #inventory: InventoryFeeds;

  constructor(ctx: PlaneFeedsContext) {
    this.#ctx = ctx;
    this.#attention = new AttentionFeeds({ dispatch: ctx.dispatch, ranks: ctx.ranks, log: ctx.log, backlogBytes: ctx.backlogBytes });
    this.#artifacts = new ArtifactsFeeds({ dispatch: ctx.dispatch, ranks: ctx.ranks, artifacts: ctx.artifacts, leases: ctx.leases, log: ctx.log, backlogBytes: ctx.backlogBytes });
    this.#inventory = new InventoryFeeds({ browser: ctx.browser, backlogBytes: ctx.backlogBytes });
  }

  open(sub: Subscription): void {
    if (sub.message.feed === 'artifacts') return this.#artifacts.open(sub);
    if (sub.message.feed === 'browser.inventory' && namesSession(sub)) return this.#inventory.open(sub);
    if (sub.message.feed === 'attention' || !namesSession(sub)) return this.#attention.open(sub);
    const open: Open = { sub, seq: 0, bounds: null, held: new Map(), files: null, heldFiles: [], reads: 0 };
    this.#open.set(sub, open);
    sub.subbed('snapshot', { epoch: this.#epoch, seq: 0 });
    void this.#readBounds(open, null);
  }

  close(sub: Subscription): void {
    this.#open.delete(sub);
    this.#attention.close(sub);
    this.#artifacts.close(sub);
    this.#inventory.close(sub);
  }

  stop(): void {
    this.#open.clear();
    this.#attention.stop();
    this.#artifacts.stop();
    this.#inventory.stop();
  }

  /** P5 O7 M5c: the members' rights were read again (a `caps` refresh): the `artifacts` feeds' ranks read again. */
  rightsMoved(): void {
    this.#artifacts.rightsMoved();
  }

  /** A record changed or a new head came (P5 O7 M6): the machine feeds' cuts, worked out again. */
  accessChanged(): void {
    this.#attention.accessChanged();
    this.#artifacts.accessChanged();
  }

  /** A machine event (`onEvent`; the engine host's `artifacts.changed` too, P5 O7 M5a): to every feed it concerns. */
  event(owner: string, message: { name: string; payload: unknown }): void {
    this.#attention.event(owner, message);
    this.#artifacts.event(owner, message);
    if (owner !== 'machine' || this.#open.size === 0) return;
    const { name, payload } = message;
    if (!isObject(payload)) return;
    if (name === 'files.changed' || name === 'scm.remote.output') {
      for (const open of this.#open.values()) {
        if (open.sub.session.id !== payload.appSessionId) continue;
        if (open.files !== null) {
          if (reached(open.files, name, payload)) this.#send(open, name, payload);
        } else {
          if (open.heldFiles.length >= HELD_FILE_CHANGES) open.heldFiles.shift();
          open.heldFiles.push({ name, payload });
        }
      }
    } else if (name === 'session.capabilitiesChanged') {
      for (const open of this.#open.values()) if (open.sub.session.id === payload.appSessionId) this.#send(open, name, payload);
    } else if (name === 'git.changed' && typeof payload.repoRoot === 'string') {
      const repoRoot = payload.repoRoot;
      for (const open of this.#open.values()) {
        if (open.bounds !== null) {
          if (withinBounds(open.bounds, inNfc(repoRoot))) this.#send(open, name, payload);
        } else {
          open.held.delete(repoRoot);
          if (open.held.size >= HELD_REPOSITORIES) open.held.delete(open.held.keys().next().value!);
          open.held.set(repoRoot, payload);
        }
      }
    } else if (name === 'session.changed' && isObject(payload.record)) {
      const record = payload.record;
      for (const open of this.#open.values()) {
        if (open.sub.session.id !== record.appId) continue;
        this.#send(open, name, payload);
        void this.#readBounds(open, record);
      }
    }
  }

  /**
   * The session's checkout bounds, from `record` (a `session.changed`'s) or the spine's `session.get`; then what was held.
   * The bounds are unknown from the call on (synchronously, before anything else is delivered), and only the latest
   * read's answer is taken. One that couldn't be read (no record, the spine or git away) takes git's changes nowhere, as
   * before, and keeps the files' and scm's held (2026-11-06: never delivered against bounds it doesn't have), until the
   * session's next change reads them again.
   */
  async #readBounds(open: Open, record: Record<string, unknown> | null): Promise<void> {
    const n = ++open.reads;
    open.bounds = null;
    open.files = null;
    const dispatch = dispatchAs(this.#ctx.dispatch, open.sub.channel.client);
    let bounds: Bounds | null = null;
    try {
      const read = record ?? (await this.#record(open, dispatch));
      bounds = read === null ? null : await this.#ctx.bounds.of(read, dispatch);
    } catch (error) {
      this.#ctx.log(`endpoint: a checkout feed's bounds could not be read: ${(error as Error).message}`);
    }
    if (n !== open.reads || this.#open.get(open.sub) !== open) return;
    open.bounds = bounds?.within ?? [];
    open.files = bounds;
    const held = [...open.held.entries()];
    open.held.clear();
    for (const [repoRoot, payload] of held) if (withinBounds(open.bounds, inNfc(repoRoot))) this.#send(open, 'git.changed', payload);
    if (bounds === null) return;
    const heldFiles = open.heldFiles.splice(0);
    for (const { name, payload } of heldFiles) if (reached(bounds, name, payload)) this.#send(open, name, payload);
  }

  async #record(open: Open, dispatch: EndpointServices['dispatch']): Promise<Record<string, unknown> | null> {
    const answer = await dispatch('machine', 'session.get', { appSessionId: open.sub.session.id });
    return answer.ok && isObject(answer.value) ? answer.value : null;
  }

  #send(open: Open, name: string, payload: unknown): void {
    const { sub } = open;
    if (sub.ended) return;
    if (sub.backlog > (this.#ctx.backlogBytes ?? BACKLOG_BYTES)) return void sub.end('behind');
    sub.ev({ epoch: this.#epoch, seq: ++open.seq }, { name, payload });
  }
}
