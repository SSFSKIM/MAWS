// A remote page's connector leases and a Send to's runs, per channel (P5 O7 M5c, docs/doperpowers/plans/2026-10-28-p5-o7-
// remote-lane-b.md, M5 "O4's surfaces: the grade" and "leases, the window, delivery on the machine"; §L's M5c rows).
//
// A lease names its artifact once, at `connectors.open {artifactId}`; every later command of it names the lease alone,
// and so does the machine's `connectors.watchUpdate`. A lease's owner on the machine is the channel's `ClientRef`, so the
// lease ids the device holds are this channel's: the endpoint keeps, per channel, each lease the device opened with the
// artifact it was opened on (`opened`, from the open's input and its answer), which the `artifact` rule reads for the
// lease's commands (targets.ts' `HeldNames`) and the `artifacts` feed for its updates (artifacts-feed.ts). A run names its
// artifact at `delivery.send {runId, artifactId}`, which `delivery.cancel {runId}` is placed by.
//
// A lease outlives the decision that admitted it: the broker's refresh loop runs and publishes on its own, ended only by
// the owner's close or the ref's end. So a lease is authorized again as a stream is, by the one predicate the call rows
// read: the `artifact` rule, run through authorization's steps for its `connectors.open` (`view` on the artifact). It
// is decided again whenever the artifact cache drops the placement it was last decided on (`ArtifactRanks.onDropped`:
// a `caps` refresh, a new head, a certificate change, a record change naming one of the artifact's sessions, its relink,
// a linked session's new placement), and once at its opening, in case a change landed while the open was out. A lease
// whose member no longer holds `view` is closed by the endpoint (`connectors.close` under the channel's ref), its mapping
// dropped in the same step, so its next update reaches no one and its next command is refused `grade`, as a lease the
// channel never held. An answer that can't be had now (`unavailable`) is asked again after each retry delay, and the
// lease is closed after the last: no lease runs on a decision nobody could take.
//
// Bounded: at most LEASES_KEPT leases a channel (an open past it is refused `busy` before it reaches the machine), and
// RUNS_KEPT runs, the oldest forgotten first (its cancel is then `no-target`; the run is the machine's either way). A
// channel's leases and runs go with its end, when the machine closes every lease of its ref.
import type { ClientRef } from '@shared/ipc/client';
import type { ArtifactRanks } from './artifacts';
import type { AuthorizeRequest, Decision, Who } from './authorize';
import type { RemoteChannel } from './channels';
import { dispatchAs, type EndpointServices } from './services';
import { RECHECK_RETRY_MS } from './subscriptions';

/** How many leases one channel may hold open (one per page that shows connector data). */
export const LEASES_KEPT = 64;
/** How many runs' artifacts one channel keeps for their cancel. */
export const RUNS_KEPT = 256;

export type LeasesContext = {
  authorize(request: AuthorizeRequest, who: Who, now: number): Promise<Decision>;
  dispatch: EndpointServices['dispatch'];
  /** The `artifact` rule's placements, whose drops say a lease's decision may have moved. */
  artifacts: ArtifactRanks;
  now(): number;
  log(line: string): void;
  recheckRetryMs?: readonly number[];
};

type Lease = {
  leaseId: string;
  artifactId: string;
  channel: RemoteChannel;
  /** Whether the placement its last decision rests on still stands; null while a decision is out. */
  current: (() => boolean) | null;
  /** Decisions begun: only the latest one's answer is taken. */
  checks: number;
};

type Held = { leases: Map<string, Lease>; opening: number; runs: Map<string, string> };

export class Leases {
  readonly #ctx: LeasesContext;
  readonly #channels = new Map<ClientRef, Held>();
  readonly #timers = new Set<ReturnType<typeof setTimeout>>();
  readonly #offDropped: () => void;
  #stopped = false;

  constructor(ctx: LeasesContext) {
    this.#ctx = ctx;
    this.#offDropped = ctx.artifacts.onDropped(() => this.#moved());
  }

  /** The artifact of a lease the channel holds; null for one it doesn't. */
  lease(client: ClientRef, leaseId: string): string | null {
    return this.#channels.get(client)?.leases.get(leaseId)?.artifactId ?? null;
  }

  /** The artifact of a run the channel sent; null for one it didn't (or forgot). */
  run(client: ClientRef, runId: string): string | null {
    return this.#channels.get(client)?.runs.get(runId) ?? null;
  }

  /**
   * An open about to go to the machine: false when the channel holds LEASES_KEPT already (opens in flight counted). A
   * true answer is a reservation, given back by `opened` or `unopened`.
   */
  reserve(channel: RemoteChannel): boolean {
    const held = this.#held(channel);
    if (held === null || held.leases.size + held.opening >= LEASES_KEPT) return false;
    held.opening++;
    return true;
  }

  /** The reserved open answered no lease. */
  unopened(channel: RemoteChannel): void {
    const held = this.#channels.get(channel.client);
    if (held !== undefined && held.opening > 0) held.opening--;
  }

  /** The machine opened `leaseId` on `artifactId` for the channel: kept, and decided again at once. */
  opened(channel: RemoteChannel, artifactId: string, leaseId: string): void {
    this.unopened(channel);
    const held = this.#held(channel);
    if (held === null) return; // the channel ended: the machine closed the lease with its ref
    const lease: Lease = { leaseId, artifactId, channel, current: null, checks: 0 };
    held.leases.set(leaseId, lease);
    this.#check(lease);
  }

  /** The device closed the lease (the machine answered its close). */
  closed(client: ClientRef, leaseId: string): void {
    this.#channels.get(client)?.leases.delete(leaseId);
  }

  /** The device's send of `runId` on `artifactId` was handed to the machine: kept for its cancel. */
  sent(channel: RemoteChannel, runId: string, artifactId: string): void {
    const held = this.#held(channel);
    if (held === null) return;
    held.runs.delete(runId);
    if (held.runs.size >= RUNS_KEPT) held.runs.delete(held.runs.keys().next().value!);
    held.runs.set(runId, artifactId);
  }

  stop(): void {
    this.#stopped = true;
    this.#offDropped();
    for (const timer of this.#timers) clearTimeout(timer);
    this.#timers.clear();
    this.#channels.clear();
  }

  /** The channel's table, made at its first lease or run and dropped at its end; null for a channel that ended. */
  #held(channel: RemoteChannel): Held | null {
    if (channel.closed || this.#stopped) return null;
    let held = this.#channels.get(channel.client);
    if (held === undefined) {
      held = { leases: new Map(), opening: 0, runs: new Map() };
      this.#channels.set(channel.client, held);
      const client = channel.client;
      client.onGone(() => this.#channels.delete(client));
    }
    return held;
  }

  /** Placements were dropped: every lease whose last decision rests on one no longer standing is decided again. */
  #moved(): void {
    for (const held of this.#channels.values()) for (const lease of held.leases.values()) if (lease.current !== null && !lease.current()) this.#check(lease);
  }

  #stands(lease: Lease): boolean {
    return !this.#stopped && !lease.channel.closed && this.#channels.get(lease.channel.client)?.leases.get(lease.leaseId) === lease;
  }

  /**
   * The lease decided again, as its open would be now: kept, resting on the placement the decision read (read first,
   * so a drop while the decision is out is seen), or closed. `unavailable` is asked again after each retry delay.
   */
  #check(lease: Lease, attempt = 0): void {
    const n = attempt === 0 ? ++lease.checks : lease.checks;
    lease.current = null;
    const { channel } = lease;
    const who: Who = { member: channel.member, device: channel.device, clientClass: channel.clientClass, client: channel.client };
    const placing = { dispatch: dispatchAs(this.#ctx.dispatch, channel.client), log: (line: string) => this.#ctx.log(line) };
    void (async () => {
      const placed = await this.#ctx.artifacts.of(channel.client, lease.artifactId, placing);
      const decision = await this.#ctx.authorize({ kind: 'call', name: 'connectors.open', input: { artifactId: lease.artifactId } }, who, this.#ctx.now());
      if (n !== lease.checks || !this.#stands(lease)) return;
      if (decision.ok) {
        // A placement dropped while the decision was out may be one it read: decided again on what stands now.
        const current = placed.resolved.kind === 'refused' ? () => false : placed.current;
        if (!current()) return this.#check(lease);
        lease.current = current;
        return;
      }
      if (decision.reason !== 'unavailable') return this.#close(lease, decision.reason);
      const retries = this.#ctx.recheckRetryMs ?? RECHECK_RETRY_MS;
      if (attempt >= retries.length) return this.#close(lease, 'unavailable');
      const timer = setTimeout(() => {
        this.#timers.delete(timer);
        if (n === lease.checks && this.#stands(lease)) this.#check(lease, attempt + 1);
      }, retries[attempt]);
      timer.unref?.();
      this.#timers.add(timer);
    })().catch((error: unknown) => {
      if (n !== lease.checks || !this.#stands(lease)) return;
      this.#ctx.log(`endpoint: lease ${lease.leaseId}'s access could not be checked again: ${(error as Error).message}`);
      this.#close(lease, 'unavailable');
    });
  }

  /** The lease's mapping dropped, and the lease closed on the machine under its channel's ref, in this step. */
  #close(lease: Lease, reason: string): void {
    this.#channels.get(lease.channel.client)?.leases.delete(lease.leaseId);
    this.#ctx.log(`endpoint: lease ${lease.leaseId} on artifact ${lease.artifactId} closed by the endpoint: ${reason}`);
    void this.#ctx
      .dispatch('machine', 'connectors.close', { leaseId: lease.leaseId }, lease.channel.client)
      .then((answer) => {
        if (!answer.ok) this.#ctx.log(`endpoint: the machine did not close lease ${lease.leaseId}: ${answer.error.code}`);
      })
      .catch((error: unknown) => this.#ctx.log(`endpoint: the machine did not close lease ${lease.leaseId}: ${(error as Error).message}`));
  }
}
