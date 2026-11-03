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
// read: the `artifact` rule, run through authorization's steps for its `connectors.open` (`view` on the artifact; a
// machine owner's standing, which rests on no placement). It is decided again at every change that can move that
// decision, each of which drops placements from the artifact cache (`ArtifactRanks.onDropped`: a `caps` refresh, a new
// head, a certificate change, a record change, a relink, a linked session's new placement), and once at its opening, in
// case a change landed while the open was out. Each change counts on the lease (its generation), and a decision is used
// only in the step it is still the latest change's: keep or close alike. One that a change overtook, or one that can't be
// had now (`unavailable`), is asked again after each retry delay (RECHECK_RETRY_MS), never at once, and the lease is
// closed after the last: no lease runs on a decision nobody could take. A lease has at most one decision or one wait out,
// so a burst of changes costs one more decision, not one each. A lease whose member no longer holds `view` is closed by
// the endpoint (`connectors.close` under the channel's ref), its mapping dropped in the same step, so its next update
// reaches no one and its next command is refused `grade`, as a lease the channel never held.
//
// A run's id is the machine's one namespace (a second send of a running id answers `busy`; a cancel ends whichever run
// holds the id), so the endpoint reserves an id endpoint-wide for the one channel and artifact that sent it, in the step
// the send is handed on: a send of an id reserved by any channel is refused `busy` (never moved to another artifact), and
// a cancel is placed only by a run its own channel reserved, on that run's artifact. A reservation ends when the send is
// answered as ended (done, or refused before it ran), or at its channel's end once no send of it is out; one whose
// answer said nothing of the run (the machine unreachable, the run still in progress) is kept until then.
//
// An open the machine answers past its call's bound (acquire.ts; P5 O7 M5c review 1) reaches no device: its reservation is
// given back and its lease closed at once under the channel's ref (`openedLate`).
//
// Bounded: at most LEASES_KEPT leases a channel (an open past it is refused `busy` before it reaches the machine), and
// RUNS_KEPT reserved runs (a send past it `busy`: a reservation is never forgotten while its run may live). A channel's
// leases go with its end, when the machine closes every lease of its ref.
import type { ClientRef } from '@shared/ipc/client';
import type { ArtifactRanks } from './artifacts';
import type { AuthorizeRequest, Decision, Who } from './authorize';
import type { RemoteChannel } from './channels';
import type { EndpointServices } from './services';
import { RECHECK_RETRY_MS } from './subscriptions';

/** How many leases one channel may hold open (one per page that shows connector data). */
export const LEASES_KEPT = 64;
/** How many runs one channel may hold reserved at once. */
export const RUNS_KEPT = 256;

export type LeasesContext = {
  authorize(request: AuthorizeRequest, who: Who, now: number): Promise<Decision>;
  dispatch: EndpointServices['dispatch'];
  /** The `artifact` rule's placements, whose drops are the changes that can move a lease's decision. */
  artifacts: Pick<ArtifactRanks, 'onDropped'>;
  now(): number;
  log(line: string): void;
  recheckRetryMs?: readonly number[];
};

type Lease = {
  leaseId: string;
  artifactId: string;
  channel: RemoteChannel;
  /** The changes counted so far: a decision is used only while it is still the latest one's. */
  generation: number;
  /** A decision out, or a wait before the next one: the change it will read is already counted. */
  pending: boolean;
};

type Held = { leases: Map<string, Lease>; opening: number; runs: Set<string> };
/** A reserved run: its channel, its artifact, and how many of its sends are out. */
type Run = { client: ClientRef; artifactId: string; sending: number };

export class Leases {
  readonly #ctx: LeasesContext;
  readonly #channels = new Map<ClientRef, Held>();
  /** Every channel's reserved runs, by the machine's run id. */
  readonly #runs = new Map<string, Run>();
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

  /** The artifact of a run the channel reserved; null for one it didn't (another channel's, or one that ended). */
  run(client: ClientRef, runId: string): string | null {
    const run = this.#runs.get(runId);
    return run !== undefined && run.client === client ? run.artifactId : null;
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
    const lease: Lease = { leaseId, artifactId, channel, generation: 0, pending: false };
    held.leases.set(leaseId, lease);
    this.#check(lease, 0);
  }

  /**
   * P5 O7 M5c review 1: a reserved open answered past its call's bound (acquire.ts), whose device gave up on it: the
   * reservation given back, and the lease the machine opened (`leaseId`, null for none) closed at once under the ref.
   */
  openedLate(channel: RemoteChannel, leaseId: string | null): void {
    this.unopened(channel);
    if (leaseId === null) return;
    this.#ctx.log(`endpoint: lease ${leaseId} closed by the endpoint: opened past its call’s bound`);
    this.#closeOnMachine(channel.client, leaseId);
  }

  /** The device closed the lease (the machine answered its close). */
  closed(client: ClientRef, leaseId: string): void {
    this.#channels.get(client)?.leases.delete(leaseId);
  }

  /**
   * A send of `runId` on `artifactId` about to be handed to the machine, in the step it is: reserved for the channel, or
   * false when any channel holds the id reserved, or this one holds RUNS_KEPT. A true answer is given back by `sendEnded`.
   */
  reserveRun(channel: RemoteChannel, runId: string, artifactId: string): boolean {
    const held = this.#held(channel);
    if (held === null || this.#runs.has(runId) || held.runs.size >= RUNS_KEPT) return false;
    this.#runs.set(runId, { client: channel.client, artifactId, sending: 1 });
    held.runs.add(runId);
    return true;
  }

  /** The machine answered the send: `ended` (done, or refused before it ran) frees the id; else it is kept for a cancel. */
  sendEnded(channel: RemoteChannel, runId: string, ended: boolean): void {
    const run = this.#runs.get(runId);
    if (run === undefined || run.client !== channel.client) return;
    run.sending--;
    if (ended || this.#channels.get(channel.client) === undefined) this.#release(runId);
  }

  stop(): void {
    this.#stopped = true;
    this.#offDropped();
    for (const timer of this.#timers) clearTimeout(timer);
    this.#timers.clear();
    this.#channels.clear();
    this.#runs.clear();
  }

  /** The channel's table, made at its first lease or run and dropped at its end; null for a channel that ended. */
  #held(channel: RemoteChannel): Held | null {
    if (channel.closed || this.#stopped) return null;
    let held = this.#channels.get(channel.client);
    if (held === undefined) {
      held = { leases: new Map(), opening: 0, runs: new Set() };
      this.#channels.set(channel.client, held);
      const client = channel.client;
      const ended = held;
      client.onGone(() => {
        this.#channels.delete(client);
        // its runs' ids freed, but for one whose send is still out (freed at its answer)
        for (const runId of ended.runs) if (this.#runs.get(runId)?.sending === 0) this.#release(runId);
      });
    }
    return held;
  }

  #release(runId: string): void {
    const run = this.#runs.get(runId);
    if (run === undefined) return;
    this.#runs.delete(runId);
    this.#channels.get(run.client)?.runs.delete(runId);
  }

  /** A change that can move a lease's decision: counted on every lease, and one with nothing out decided again. */
  #moved(): void {
    for (const held of this.#channels.values()) {
      for (const lease of held.leases.values()) {
        lease.generation++;
        if (!lease.pending) this.#check(lease, 0);
      }
    }
  }

  #stands(lease: Lease): boolean {
    return !this.#stopped && !lease.channel.closed && this.#channels.get(lease.channel.client)?.leases.get(lease.leaseId) === lease;
  }

  /**
   * The lease decided again, as its open would be now, and the decision used in the step it is still the latest change's:
   * kept, or closed. One a change overtook, or `unavailable`, is asked again after the attempt's retry delay.
   */
  #check(lease: Lease, attempt: number): void {
    lease.pending = true;
    const generation = lease.generation;
    const { channel } = lease;
    const who: Who = { member: channel.member, device: channel.device, clientClass: channel.clientClass, client: channel.client };
    void (async () => {
      const decision = await this.#ctx.authorize({ kind: 'call', name: 'connectors.open', input: { artifactId: lease.artifactId } }, who, this.#ctx.now());
      if (!this.#stands(lease)) return;
      if (lease.generation !== generation) return this.#again(lease, attempt, 'unavailable');
      if (decision.ok) {
        lease.pending = false;
        return;
      }
      if (decision.reason !== 'unavailable') return this.#close(lease, decision.reason);
      this.#again(lease, attempt, 'unavailable');
    })().catch((error: unknown) => {
      if (!this.#stands(lease)) return;
      this.#ctx.log(`endpoint: lease ${lease.leaseId}'s access could not be checked again: ${(error as Error).message}`);
      this.#close(lease, 'unavailable');
    });
  }

  /** The decision asked again after the attempt's retry delay; past the last, the lease closed `reason`. */
  #again(lease: Lease, attempt: number, reason: string): void {
    const retries = this.#ctx.recheckRetryMs ?? RECHECK_RETRY_MS;
    if (attempt >= retries.length) return this.#close(lease, reason);
    const timer = setTimeout(() => {
      this.#timers.delete(timer);
      if (this.#stands(lease)) this.#check(lease, attempt + 1);
    }, retries[attempt]);
    timer.unref?.();
    this.#timers.add(timer);
  }

  /** The lease's mapping dropped, and the lease closed on the machine under its channel's ref, in this step. */
  #close(lease: Lease, reason: string): void {
    this.#channels.get(lease.channel.client)?.leases.delete(lease.leaseId);
    this.#ctx.log(`endpoint: lease ${lease.leaseId} on artifact ${lease.artifactId} closed by the endpoint: ${reason}`);
    this.#closeOnMachine(lease.channel.client, lease.leaseId);
  }

  /** `connectors.close` on the machine under `client`, its failure logged. */
  #closeOnMachine(client: ClientRef, leaseId: string): void {
    void this.#ctx
      .dispatch('machine', 'connectors.close', { leaseId }, client)
      .then((answer) => {
        if (!answer.ok) this.#ctx.log(`endpoint: the machine did not close lease ${leaseId}: ${answer.error.code}`);
      })
      .catch((error: unknown) => this.#ctx.log(`endpoint: the machine did not close lease ${leaseId}: ${(error as Error).message}`));
  }
}
