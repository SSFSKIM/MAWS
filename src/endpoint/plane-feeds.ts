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
//
// A feed lives with its channel and its access (the table re-checks it as any subscription), and ends `behind` when the
// device leaves more than its backlog unread: the device opens it again, as after a reconnect.
//
// P5 O7 M6: the machine's `attention` feed is this plane's too, run by attention-feed.ts: it names no session, and cuts
// what it carries to the member's sessions at every change of access the table tells this plane of.
//
// P5 O7 M5a: so is the machine's `artifacts` feed, run by artifacts-feed.ts (artifact and library changes, cut by the
// `artifact` rule), and a session's `checkout` feed carries its `session.capabilitiesChanged` (O5's tools on it), as it
// carries `session.changed`.
import { randomBytes } from 'node:crypto';
import { BACKLOG_BYTES } from '@shared/host/stream-catchup';
import type { ArtifactRanks } from './artifacts';
import { ArtifactsFeeds } from './artifacts-feed';
import { AttentionFeeds, type AttentionFeedsContext } from './attention-feed';
import { dispatchAs, type EndpointServices } from './services';
import { namesSession, type Plane, type SessionSubscription, type Subscription } from './subscriptions';
import { withinBounds, type CheckoutBounds } from './targets';

export type PlaneFeedsContext = {
  dispatch: EndpointServices['dispatch'];
  bounds: CheckoutBounds;
  /** The member's ranks on the machine's sessions, for the `attention` and `artifacts` feeds' cuts (P5 O7 M6, M5a). */
  ranks: AttentionFeedsContext['ranks'];
  /** The `artifact` rule's placements, per channel (P5 O7 M5a). */
  artifacts: ArtifactRanks;
  log(line: string): void;
  /** The most a feed's unread stream may hold before it ends `behind`. */
  backlogBytes?: number;
};

/** How many repositories' latest `git.changed` a feed holds while its bounds are read. */
export const HELD_REPOSITORIES = 64;

type Open = {
  sub: SessionSubscription;
  seq: number;
  /** The session's checkout bounds; null while a read of them is out. */
  bounds: readonly string[] | null;
  /** Each repository's latest `git.changed`, held while the bounds are read. */
  held: Map<string, unknown>;
  /** Reads of the bounds begun: only the latest one's answer is taken. */
  reads: number;
};

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export class PlaneFeeds implements Plane {
  readonly #ctx: PlaneFeedsContext;
  /** The epoch of every `checkout` feed this endpoint opens: a restarted endpoint's feeds begin again. */
  readonly #epoch = `checkout:${randomBytes(9).toString('base64url')}`;
  readonly #open = new Map<Subscription, Open>();
  readonly #attention: AttentionFeeds;
  readonly #artifacts: ArtifactsFeeds;

  constructor(ctx: PlaneFeedsContext) {
    this.#ctx = ctx;
    this.#attention = new AttentionFeeds({ dispatch: ctx.dispatch, ranks: ctx.ranks, log: ctx.log, backlogBytes: ctx.backlogBytes });
    this.#artifacts = new ArtifactsFeeds({ dispatch: ctx.dispatch, ranks: ctx.ranks, artifacts: ctx.artifacts, log: ctx.log, backlogBytes: ctx.backlogBytes });
  }

  open(sub: Subscription): void {
    if (sub.message.feed === 'artifacts') return this.#artifacts.open(sub);
    if (sub.message.feed === 'attention' || !namesSession(sub)) return this.#attention.open(sub);
    const open: Open = { sub, seq: 0, bounds: null, held: new Map(), reads: 0 };
    this.#open.set(sub, open);
    sub.subbed('snapshot', { epoch: this.#epoch, seq: 0 });
    void this.#readBounds(open, null);
  }

  close(sub: Subscription): void {
    this.#open.delete(sub);
    this.#attention.close(sub);
    this.#artifacts.close(sub);
  }

  stop(): void {
    this.#open.clear();
    this.#attention.stop();
    this.#artifacts.stop();
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
    if (name === 'files.changed' || name === 'scm.remote.output' || name === 'session.capabilitiesChanged') {
      for (const open of this.#open.values()) if (open.sub.session.id === payload.appSessionId) this.#send(open, name, payload);
    } else if (name === 'git.changed' && typeof payload.repoRoot === 'string') {
      const repoRoot = payload.repoRoot;
      for (const open of this.#open.values()) {
        if (open.bounds !== null) {
          if (withinBounds(open.bounds, repoRoot)) this.#send(open, name, payload);
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
   * read's answer is taken.
   */
  async #readBounds(open: Open, record: Record<string, unknown> | null): Promise<void> {
    const n = ++open.reads;
    open.bounds = null;
    const dispatch = dispatchAs(this.#ctx.dispatch, open.sub.channel.client);
    let bounds: readonly string[] = [];
    try {
      const read = record ?? (await this.#record(open, dispatch));
      bounds = read === null ? [] : await this.#ctx.bounds.of(read, dispatch);
    } catch (error) {
      this.#ctx.log(`endpoint: a checkout feed's bounds could not be read: ${(error as Error).message}`);
    }
    if (n !== open.reads || this.#open.get(open.sub) !== open) return;
    open.bounds = bounds;
    const held = [...open.held.entries()];
    open.held.clear();
    for (const [repoRoot, payload] of held) if (withinBounds(bounds, repoRoot)) this.#send(open, 'git.changed', payload);
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
