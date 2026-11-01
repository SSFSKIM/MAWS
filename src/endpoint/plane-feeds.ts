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
import { randomBytes } from 'node:crypto';
import { BACKLOG_BYTES } from '@shared/host/stream-catchup';
import { dispatchAs, type EndpointServices } from './services';
import type { Plane, Subscription } from './subscriptions';
import { withinBounds, type CheckoutBounds } from './targets';

export type PlaneFeedsContext = {
  dispatch: EndpointServices['dispatch'];
  bounds: CheckoutBounds;
  log(line: string): void;
  /** The most a feed's unread stream may hold before it ends `behind`. */
  backlogBytes?: number;
};

/** How many repositories' latest `git.changed` a feed holds while its bounds are read. */
export const HELD_REPOSITORIES = 64;

type Open = {
  sub: Subscription;
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

  constructor(ctx: PlaneFeedsContext) {
    this.#ctx = ctx;
  }

  open(sub: Subscription): void {
    const open: Open = { sub, seq: 0, bounds: null, held: new Map(), reads: 0 };
    this.#open.set(sub, open);
    sub.subbed('snapshot', { epoch: this.#epoch, seq: 0 });
    void this.#readBounds(open, null);
  }

  close(sub: Subscription): void {
    this.#open.delete(sub);
  }

  stop(): void {
    this.#open.clear();
  }

  /** A machine event (`onEvent`, owner `machine`): to every feed it concerns. */
  event(owner: string, message: { name: string; payload: unknown }): void {
    if (owner !== 'machine' || this.#open.size === 0) return;
    const { name, payload } = message;
    if (!isObject(payload)) return;
    if (name === 'files.changed' || name === 'scm.remote.output') {
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
