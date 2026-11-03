// A remote dashboard's snapshot holds, per channel (P5 O7 M5c round 3, docs/doperpowers/plans/2026-10-28-p5-o7-remote-
// lane-b.md, M5 "O4's surfaces"; E3's R1b, docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md). A dashboard holds a
// snapshot before it reads it, so the machine's retention never prunes bytes a page still pages through; for another
// machine's dashboard, that machine's main asks the hold over RL2 (`artifacts.holdAssets`, then `artifacts.releaseAssets`,
// calls behind `rl2.asset-holds`; offers.ts), and the endpoint takes it on the engine host for the channel.
//
// - A hold is authorized at `view` on its artifact (the `artifact` rule, by the gate), taken on the engine host through
//   `mawsd`'s permanent link (whose connection owns it there), and kept in the asking channel's table with its artifact.
//   A channel releases only a hold of its own table (any other id releases nothing, asking the host nothing). A hold
//   answered once its channel ended is released at once; one answered after the engine host's link went was released by
//   the host with that connection.
// - A channel's end releases every hold it took. The engine host's link going (the host released every hold of that
//   connection) forgets them all. The endpoint's stop releases every hold it keeps.
// - A hold outlives the decision that admitted it, so it is decided again as a lease is (leases.ts): at every change that
//   can move the decision (the artifact cache's drops: a caps refresh, a new head, a certificate change, a record
//   change, a relink, a linked session's new placement), and once when it is kept, in case a change landed while it was
//   being taken. A channel's holds on one artifact stand or fall together (one member, one artifact, one decision), so a
//   change costs one decision per artifact a channel holds, never one per hold. A decision is used only in the step it is
//   still the latest change's; one a change overtook, or one that can't be had now (`unavailable`), is asked again after
//   each retry delay, and after the last the holds go. A member who no longer holds `view` loses the channel's holds on
//   that artifact in the step that is decided: dropped here and released on the host.
// - Bounded: at most ASSET_HOLDS_KEPT holds a channel, those being taken counted; one past it is refused `busy` before
//   the host is asked.
// - A hold is taken within its call's bound (acquire.ts; P5 O7 M5c review 1): the device gives up on the call at its
//   deadline, so one the host answers past the bound is released at once and the call answers `timeout`; one whose bound
//   passed while it was authorized is never asked of the host. Its count is held while the host's answer is out.
import type { ClientRef } from '@shared/ipc/client';
import type { ArtifactRanks } from './artifacts';
import type { AuthorizeRequest, Decision, Who } from './authorize';
import type { RemoteChannel } from './channels';
import { LATE, within } from './acquire';
import type { EndpointServices } from './services';
import { RECHECK_RETRY_MS } from './subscriptions';

/** How many snapshot holds one channel may keep (64 pages a channel, each a few snapshots cached and a sheet's group). */
export const ASSET_HOLDS_KEPT = 256;

export type AssetHoldsContext = {
  authorize(request: AuthorizeRequest, who: Who, now: number): Promise<Decision>;
  dispatch: EndpointServices['dispatch'];
  /** The `artifact` rule's placements, whose drops are the changes that can move a hold's decision. */
  artifacts: Pick<ArtifactRanks, 'onDropped'>;
  now(): number;
  log(line: string): void;
  recheckRetryMs?: readonly number[];
};

type Result = { ok: true; output: unknown } | { ok: false; code: string };

/** A channel's holds on one artifact, decided together: each hold's refs by the host's id. */
type Group = {
  artifactId: string;
  channel: RemoteChannel;
  holds: Map<string, readonly string[]>;
  /** The changes counted so far: a decision is used only while it is still the latest one's. */
  generation: number;
  /** A decision out, or a wait before the next one: the change it will read is already counted. */
  pending: boolean;
};

type Held = { groups: Map<string, Group>; kept: number; taking: number };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const asRefusal = (code: string) => (code === 'host_unavailable' || code === 'timeout' ? 'unavailable' : code);
type Response = Awaited<ReturnType<EndpointServices['dispatch']>>;
/** The hold a host's answer names, or null. */
const holdIdOf = (response: Response): string | null => (response.ok && isObject(response.value) && typeof response.value.assetHoldId === 'string' ? response.value.assetHoldId : null);

export class AssetHolds {
  readonly #ctx: AssetHoldsContext;
  readonly #channels = new Map<ClientRef, Held>();
  readonly #timers = new Set<ReturnType<typeof setTimeout>>();
  readonly #offDropped: () => void;
  /** Advanced each time the engine host's link goes: a hold asked before belongs to a connection that released it. */
  #upstream = 0;
  #stopped = false;

  constructor(ctx: AssetHoldsContext) {
    this.#ctx = ctx;
    this.#offDropped = ctx.artifacts.onDropped(() => this.#moved());
  }

  /**
   * An authorized `artifacts.holdAssets {artifactId, refs}`: taken on the engine host by `by` (its call's bound, acquire.ts)
   * and kept for the channel.
   */
  async hold(channel: RemoteChannel, input: unknown, by: number): Promise<Result> {
    const artifactId = isObject(input) ? input.artifactId : undefined;
    const refs = isObject(input) && Array.isArray(input.refs) ? (input.refs as string[]) : undefined;
    if (typeof artifactId !== 'string' || refs === undefined) return { ok: false, code: 'malformed' };
    const held = this.#held(channel);
    if (held === null) return { ok: false, code: 'unavailable' };
    if (held.kept + held.taking >= ASSET_HOLDS_KEPT) return { ok: false, code: 'busy' };
    const upstream = this.#upstream;
    const ask = () => {
      held.taking++;
      return this.#ctx.dispatch('engine-host', 'artifacts.holdAssets', { artifactId, refs }, channel.client).finally(() => held.taking--);
    };
    // answered past the bound, its device gone: released at once (a host link that went took it with its connection)
    const late = (answer: Response | null) => {
      const id = answer === null ? null : holdIdOf(answer);
      if (id !== null && upstream === this.#upstream) this.#release(id, 'answered past its call’s bound');
    };
    const response = await within(by, () => this.#ctx.now(), ask, late);
    if (response === LATE) return { ok: false, code: 'timeout' };
    if (!response.ok) return { ok: false, code: asRefusal(response.error.code) };
    const assetHoldId = holdIdOf(response);
    if (assetHoldId === null) return { ok: false, code: 'unavailable' };
    // Kept or let go in this one step: a host link that went took it with its connection; a channel that ended meanwhile
    // releases it at once.
    if (upstream !== this.#upstream) return { ok: false, code: 'unavailable' };
    if (!this.#current(channel, held)) {
      this.#release(assetHoldId, 'answered after its channel ended');
      return { ok: false, code: 'unavailable' };
    }
    let group = held.groups.get(artifactId);
    if (group === undefined) {
      group = { artifactId, channel, holds: new Map(), generation: 0, pending: false };
      held.groups.set(artifactId, group);
    }
    group.holds.set(assetHoldId, refs);
    held.kept++;
    if (!group.pending) this.#check(group, 0);
    return { ok: true, output: { assetHoldId } };
  }

  /** `artifacts.releaseAssets {assetHoldId}`: a hold of this channel's own table released; any other id releases nothing. */
  async release(channel: RemoteChannel, input: unknown): Promise<Result> {
    const assetHoldId = isObject(input) && typeof input.assetHoldId === 'string' ? input.assetHoldId : null;
    const held = this.#channels.get(channel.client);
    const group = assetHoldId === null || held === undefined ? undefined : [...held.groups.values()].find((candidate) => candidate.holds.has(assetHoldId));
    if (group === undefined || held === undefined || assetHoldId === null) return { ok: true, output: { released: false } };
    this.#forget(held, group, assetHoldId);
    const response = await this.#ctx.dispatch('engine-host', 'artifacts.releaseAssets', { assetHoldId }, channel.client);
    if (!response.ok) return { ok: false, code: asRefusal(response.error.code) };
    return { ok: true, output: { released: isObject(response.value) && response.value.released === true } };
  }

  /** The engine host's link went: the host released every hold of that connection, so none is kept here. */
  upstreamLost(): void {
    this.#upstream++;
    for (const held of this.#channels.values()) {
      held.groups.clear();
      held.kept = 0;
    }
  }

  /** Every hold kept released on the host, and nothing kept or decided any more. */
  stop(): void {
    this.#stopped = true;
    this.#offDropped();
    for (const timer of this.#timers) clearTimeout(timer);
    this.#timers.clear();
    for (const held of this.#channels.values()) for (const group of held.groups.values()) for (const id of group.holds.keys()) this.#release(id, 'the endpoint stopped');
    this.#channels.clear();
  }

  /** The channel's table, made at its first hold and released whole at its end; null for a channel that ended. */
  #held(channel: RemoteChannel): Held | null {
    if (channel.closed || this.#stopped) return null;
    const { client } = channel;
    let held = this.#channels.get(client);
    if (held === undefined) {
      const made: Held = { groups: new Map(), kept: 0, taking: 0 };
      held = made;
      this.#channels.set(client, made);
      client.onGone(() => {
        if (this.#channels.get(client) !== made) return;
        this.#channels.delete(client);
        for (const group of made.groups.values()) for (const id of group.holds.keys()) this.#release(id, 'its channel ended');
        made.groups.clear();
        made.kept = 0;
      });
    }
    return held;
  }

  #current(channel: RemoteChannel, held: Held): boolean {
    return !this.#stopped && !channel.closed && this.#channels.get(channel.client) === held;
  }

  #forget(held: Held, group: Group, assetHoldId: string): void {
    if (!group.holds.delete(assetHoldId)) return;
    held.kept--;
    if (group.holds.size === 0 && held.groups.get(group.artifactId) === group) held.groups.delete(group.artifactId);
  }

  #release(assetHoldId: string, why: string): void {
    void this.#ctx.dispatch('engine-host', 'artifacts.releaseAssets', { assetHoldId }).then(
      (answer) => {
        if (!answer.ok) this.#ctx.log(`endpoint: a snapshot hold (${why}) was not released on the engine host: ${answer.error.code}`);
      },
      (error: unknown) => this.#ctx.log(`endpoint: a snapshot hold (${why}) was not released on the engine host: ${(error as Error).message}`),
    );
  }

  /** A change that can move a hold's decision: counted on every group, and one with nothing out decided again. */
  #moved(): void {
    for (const held of this.#channels.values()) {
      for (const group of held.groups.values()) {
        group.generation++;
        if (!group.pending) this.#check(group, 0);
      }
    }
  }

  #stands(group: Group): boolean {
    return !this.#stopped && !group.channel.closed && group.holds.size > 0 && this.#channels.get(group.channel.client)?.groups.get(group.artifactId) === group;
  }

  /**
   * The group decided again, as a hold of its artifact would be now, and the decision used in the step it is still the
   * latest change's: kept, or let go. One a change overtook, or `unavailable`, is asked again after the attempt's delay.
   */
  #check(group: Group, attempt: number): void {
    group.pending = true;
    const generation = group.generation;
    const { channel } = group;
    const refs = group.holds.values().next().value!;
    const who: Who = { member: channel.member, device: channel.device, clientClass: channel.clientClass, client: channel.client };
    void (async () => {
      const decision = await this.#ctx.authorize({ kind: 'call', name: 'artifacts.holdAssets', input: { artifactId: group.artifactId, refs } }, who, this.#ctx.now());
      if (!this.#stands(group)) return;
      if (group.generation !== generation) return this.#again(group, attempt, 'unavailable');
      if (decision.ok) {
        group.pending = false;
        return;
      }
      if (decision.reason !== 'unavailable') return this.#drop(group, decision.reason);
      this.#again(group, attempt, 'unavailable');
    })().catch((error: unknown) => {
      if (!this.#stands(group)) return;
      this.#ctx.log(`endpoint: the snapshot holds on artifact ${group.artifactId} could not be checked again: ${(error as Error).message}`);
      this.#drop(group, 'unavailable');
    });
  }

  /** The decision asked again after the attempt's retry delay; past the last, the group's holds go `reason`. */
  #again(group: Group, attempt: number, reason: string): void {
    const retries = this.#ctx.recheckRetryMs ?? RECHECK_RETRY_MS;
    if (attempt >= retries.length) return this.#drop(group, reason);
    const timer = setTimeout(() => {
      this.#timers.delete(timer);
      if (this.#stands(group)) this.#check(group, attempt + 1);
    }, retries[attempt]);
    timer.unref?.();
    this.#timers.add(timer);
  }

  /** The group's holds dropped from the channel's table and released on the host, in this step. */
  #drop(group: Group, reason: string): void {
    const held = this.#channels.get(group.channel.client);
    if (held === undefined || held.groups.get(group.artifactId) !== group) return;
    held.groups.delete(group.artifactId);
    held.kept -= group.holds.size;
    this.#ctx.log(`endpoint: ${group.holds.size} snapshot holds on artifact ${group.artifactId} released by the endpoint: ${reason}`);
    for (const id of group.holds.keys()) this.#release(id, `its member's access moved: ${reason}`);
    group.holds.clear();
  }
}
