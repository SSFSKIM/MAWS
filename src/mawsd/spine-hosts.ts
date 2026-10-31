// What the spine hears of the engine host inside `mawsd` (P5 O3-D M2; docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md,
// Interfaces §A "The hold" and `SpineDeps`' `hosts`; D8, D9, D31). Two parts:
//
// - `SpineEvents`, the daemon's one subscriber to the engine host's validated events, for the seam's whole life. While
//   the spine is cold it keeps the coalesced parts (the latest per session and name, `engine.budget` once), so a
//   periodic status wakes nothing, and offers a `session.eventBatch` to the seam as a trigger; from a trigger until a
//   load's barrier has passed it holds every event in arrival order; once a load's barrier passed it delivers each event
//   to the loaded spine's listeners. A provisional yield (spine-seam.ts) holds as a load does. Once the seam is off (a
//   confirmed yield) it drops every other event and keeps the coalesced parts as cold does, since a yield lifts (the
//   app it yielded to departs) and the next load's barrier replays them: a permission raised while no app ran reaches
//   attention only as the coalesced `session.brokerItems` of a connect burst. The parts are one link's state: a link that
//   leaves `ready` voids them, kept or held, and what it delivers until the next link is ready is not kept; a load the
//   lift resumes past its replay holds them first.
// - `SpineHostsAdapter`, one per load: the `SpineHosts` the spine's root is given. Its `onEvent` listens on the core, its
//   `dispatch` reaches the engine host through the daemon's intercepts first (so `host.configure`, `host.stopAll` and
//   `host.exitWhenIdle` from the spine reach the clocks as the app's do), its `setResync` is run by the adapter itself at
//   each barrier (the supervisor never runs one for an `external` host), and `close` drops everything the root held on
//   the link. Its `replay` tells the session source where a barrier stands (src/services/sessions/index.ts).
//
// A barrier (a load's, and each later connection's once the link streams): the coalesced parts replay; the resync runs
// under E10's contract (RESYNC_BOUND_MS, aborted when the link leaves `ready`, its dispatch refused once aborted); the
// hold drains in order; live delivery begins after `onDrained`'s listeners ran; then the root's streaming listeners.
import type { HostDispatch, HostOwner, HostResync, HostSupervisor } from '@shared/host/host-supervisor';
import { RESYNC_BOUND_MS } from '@shared/host/host-supervisor';
import { ipcError } from '@shared/ipc/errors';
import type { HostResponse } from '@shared/ipc/host-protocol';
import { HOST_EVENTS, type CommandName, type CommandResult, type EventName, type EventPayload, type HostState } from '@shared/ipc/schema';
import type { SpineHosts } from '../services/spine-root';
import type { RelayRequest } from './relay';

// What the seam reads of the daemon's supervisor: the engine host's link.
export type EngineLink = Pick<HostSupervisor, 'onEvent' | 'onState' | 'onStreaming' | 'streaming' | 'snapshot' | 'dispatch'>;
export type EngineIntercept = (request: RelayRequest) => Promise<HostResponse> | null;

export const COALESCED_EVENTS: ReadonlySet<string> = new Set(['session.status', 'session.queue', 'session.brokerItems', 'session.catalogChanged', 'engine.budget']);
export const HOLD_LIMIT_BYTES = 256 * 1024 * 1024; // a last resort no load reaches: a fault to report, not a design loss

type Mode = 'cold' | 'holding' | 'live' | 'off';
type Listener = (payload: unknown) => void;
interface Held {
  name: string;
  payload: unknown;
}

export interface SpineEventsOptions {
  wake(): boolean; // a batch while cold: true when the seam starts a load for it (the batch is then the hold's first)
  log(line: string): void;
  holdLimitBytes?: number;
}

export class SpineEvents {
  private mode: Mode = 'cold';
  private readonly coalesced = new Map<string, Held>();
  private held: Held[] = [];
  private heldBytes = 0;
  private delivering = -1; // the drain's index into `held`
  private replayOwed = false; // a load began and its barrier has not replayed the coalesced parts yet
  private linkReady: boolean; // the link is `ready`: its whole-state parts are the current link's
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly offs: (() => void)[];
  dropped = 0; // held events discarded since the seam started (daemon.status.spine.heldDropped)

  constructor(
    link: Pick<EngineLink, 'onEvent' | 'onState' | 'snapshot'>,
    private readonly options: SpineEventsOptions,
  ) {
    this.offs = HOST_EVENTS.map((name) => link.onEvent(name, (payload: unknown) => this.receive(name, payload)));
    // The coalesced parts are one link's whole state: a link that leaves `ready` voids them, kept or held, and what it
    // still delivers (a recycled connection drains after its `restarting`) is none of the next link's (its successor's
    // connect burst republishes every row it holds, and a row it lacks must not come back from the old host's parts)
    this.linkReady = link.snapshot('engine-host').state === 'ready';
    this.offs.push(link.onState('engine-host', (state) => this.linkState(state.state === 'ready')));
  }

  private linkState(ready: boolean): void {
    this.linkReady = ready;
    if (ready) return;
    this.coalesced.clear();
    if (this.delivering >= 0 || !this.held.some((h) => COALESCED_EVENTS.has(h.name))) return; // a drain's own order stays
    this.held = this.held.filter((h) => !COALESCED_EVENTS.has(h.name));
    this.heldBytes = this.held.reduce((bytes, h) => bytes + sizeOf(h.payload), 0);
  }

  private receive(name: string, payload: unknown): void {
    if (!this.linkReady && COALESCED_EVENTS.has(name)) return; // a voided link's whole state
    switch (this.mode) {
      case 'live':
        return this.deliver(name, payload);
      case 'holding':
        return this.hold(name, payload);
      case 'off':
      case 'cold':
        if (COALESCED_EVENTS.has(name)) return void this.coalesced.set(coalescedKey(name, payload), { name, payload });
        if (this.mode === 'off') return;
        if (name === 'session.eventBatch' && this.options.wake()) this.hold(name, payload); // the wake moved the mode to holding
    }
  }

  private hold(name: string, payload: unknown): void {
    this.held.push({ name, payload });
    this.heldBytes += sizeOf(payload);
    if (this.heldBytes > (this.options.holdLimitBytes ?? HOLD_LIMIT_BYTES)) this.discard(`the hold passed ${Math.round((this.options.holdLimitBytes ?? HOLD_LIMIT_BYTES) / 1024 / 1024)} MiB (a fault)`, 'holding');
  }

  private deliver(name: string, payload: unknown): void {
    for (const listener of [...(this.listeners.get(name) ?? [])]) {
      try {
        listener(payload);
      } catch (error) {
        this.options.log(`[spine] a listener of ${name} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  // While draining: what was held after the event being delivered (HeldReplay.later)
  later(): readonly Held[] {
    return this.delivering < 0 ? [] : this.held.slice(this.delivering + 1);
  }

  listen(name: string, listener: Listener): () => void {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name)!.add(listener);
    return () => void this.listeners.get(name)?.delete(listener);
  }

  // From a trigger or a later connection's streaming: what arrives is held. Off stays off (a yield) unless `resume`
  // says the yield lifted while the load went on.
  beginHold(resume = false): void {
    if (this.mode === 'cold') this.replayOwed = true; // a load begins: its barrier replays the coalesced parts
    // a load resumed past its barrier's replay: what the yield coalesced meanwhile goes first in the hold, in its order
    if (this.mode === 'off' && resume && !this.replayOwed) for (const { name, payload } of this.takeCoalesced()) this.hold(name, payload);
    if (this.mode !== 'off' || resume) this.mode = 'holding';
  }
  holding(): boolean {
    return this.mode === 'holding';
  }

  // The barrier's step 2: the coalesced parts, in the order they were first kept, through the root's listeners.
  replayCoalesced(): void {
    this.replayOwed = false;
    for (const { name, payload } of this.takeCoalesced()) this.deliver(name, payload);
  }
  private takeCoalesced(): Held[] {
    const parts = [...this.coalesced.values()];
    this.coalesced.clear();
    return parts;
  }

  // The barrier's step 4: the hold in order (events a listener's work brings meanwhile are appended and drained too),
  // then live delivery. Answers what it drained.
  drain(): { events: number; bytes: number } {
    const drained = { events: 0, bytes: this.heldBytes };
    try {
      for (this.delivering = 0; this.delivering < this.held.length; this.delivering += 1) {
        drained.events += 1;
        this.deliver(this.held[this.delivering].name, this.held[this.delivering].payload);
      }
    } finally {
      this.delivering = -1;
    }
    this.held = [];
    this.heldBytes = 0;
    if (this.mode === 'holding') this.mode = 'live';
    return drained;
  }
  live(): void {
    this.mode = 'live';
  }

  // A load that ends refused or yielded: no spine of this daemon's will fold the hold. Counted and logged; then `next`.
  discard(why: string, next: Mode): void {
    // Whole-state parts that reached only the hold stay the latest kept for the next load, as cold or off keeps them (a
    // confirmed provisional yield, a refused or failed load); the last resort mid-load keeps none, its barrier going on
    if (next !== 'holding') for (const { name, payload } of this.held) if (COALESCED_EVENTS.has(name)) this.coalesced.set(coalescedKey(name, payload), { name, payload });
    if (this.held.length > 0) {
      this.dropped += this.held.length;
      this.options.log(`[spine] the hold's ${this.held.length} events (${this.heldBytes} bytes) discarded: ${why}`);
    }
    this.held = [];
    this.heldBytes = 0;
    this.mode = next;
  }

  // The parts stopped (an adapter's close removes the root's listeners): cold, where the next batch is a trigger and
  // starts the next hold, or off (a yield), where only the coalesced parts are kept, for the load after the yield lifts.
  cold(): void {
    this.mode = 'cold';
  }
  off(): void {
    this.discard('the spine yielded', 'off');
  }

  listenerCount(): number {
    let count = 0;
    for (const set of this.listeners.values()) count += set.size;
    return count;
  }

  close(): void {
    for (const off of this.offs.splice(0)) off();
    this.listeners.clear();
  }
}

function coalescedKey(name: string, payload: unknown): string {
  const record = (payload ?? {}) as { appSessionId?: unknown; status?: { appSessionId?: unknown } };
  const session = record.appSessionId ?? record.status?.appSessionId ?? '';
  return `${name}\n${String(session)}`;
}

function sizeOf(payload: unknown): number {
  try {
    return JSON.stringify(payload)?.length ?? 0;
  } catch {
    return 0;
  }
}

export interface SpineHostsAdapterOptions {
  link: EngineLink;
  events: SpineEvents;
  intercept: EngineIntercept;
  log(line: string): void;
  resyncBoundMs?: number;
}

// One load's view of the engine host (SpineDeps.hosts).
export class SpineHostsAdapter implements SpineHosts {
  private readonly offs: (() => void)[] = [];
  private readonly streamingListeners = new Set<() => void>();
  private readonly drainedListeners = new Set<() => void>();
  private resync: HostResync | null = null;
  private resyncing: AbortController | null = null;
  private atBarrier = false;
  private replayingHold = false;
  private streamed = false; // the root has been told this connection streams (its barrier passed)
  private again = false; // the link streamed while a barrier ran: another follows it
  private running: Promise<void> | null = null;
  private loadPassed = false; // the load's barrier began: a later streaming runs its own
  private closed = false;

  readonly replay = {
    barrier: () => this.atBarrier,
    replaying: () => this.replayingHold,
    later: () => this.options.events.later(),
    onDrained: (listener: () => void) => (this.drainedListeners.add(listener), () => void this.drainedListeners.delete(listener)),
  };

  constructor(private readonly options: SpineHostsAdapterOptions) {
    const { link } = options;
    this.offs.push(
      link.onState('engine-host', (state) => {
        if (state.state !== 'ready') {
          this.streamed = false;
          this.cancel('transition');
        }
      }),
      link.onStreaming('engine-host', () => {
        if (this.closed) return;
        if (this.running) this.again = true;
        else if (!this.atBarrier && this.loadPassed) void this.barrier();
      }),
    );
  }

  dispatch: HostDispatch = async (owner, name, input, client) => {
    if (owner === 'engine-host') {
      const intercepted = this.options.intercept({ id: 'spine', name, input, ...(client && { client: client.id }) });
      if (intercepted) return resultOf(await intercepted);
    }
    return this.options.link.dispatch(owner, name, input, client);
  };

  onEvent<N extends EventName>(name: N, listener: (payload: EventPayload<N>) => void): () => void {
    const off = this.options.events.listen(name, listener as Listener);
    this.offs.push(off);
    return off;
  }
  onState(owner: HostOwner, listener: (state: HostState) => void): () => void {
    const off = this.options.link.onState(owner, listener);
    this.offs.push(off);
    return off;
  }
  onStreaming(owner: HostOwner, listener: () => void): () => void {
    if (owner !== 'engine-host') {
      const off = this.options.link.onStreaming(owner, listener);
      this.offs.push(off);
      return off;
    }
    this.streamingListeners.add(listener);
    return () => void this.streamingListeners.delete(listener);
  }
  streaming(owner: HostOwner): boolean {
    return owner === 'engine-host' ? this.streamed && this.options.link.streaming(owner) : this.options.link.streaming(owner);
  }
  snapshot(owner: HostOwner): HostState {
    return this.options.link.snapshot(owner);
  }
  setResync(owner: HostOwner, resync: HostResync | null): void {
    if (owner === 'engine-host') this.resync = resync;
  }

  // The load's barrier (Interfaces §A steps 2 to 5), after `startSpine` subscribed its listeners. Later barriers run
  // at each streaming of the link (without the coalesced parts, which only a cold spine keeps).
  load(): Promise<void> {
    this.loadPassed = true;
    return this.barrier(true);
  }

  private barrier(first = false): Promise<void> {
    const run = (async () => {
      do {
        this.again = false;
        const { events } = this.options;
        events.beginHold();
        this.atBarrier = true;
        if (first) events.replayCoalesced();
        first = false;
        const streams = this.options.link.streaming('engine-host');
        if (streams && this.resync) await this.runResync(this.resync);
        if (this.closed) return;
        this.replayingHold = true;
        let drained: { events: number; bytes: number };
        try {
          drained = events.drain();
        } finally {
          this.replayingHold = false;
          this.atBarrier = false;
        }
        if (drained.events > 0) this.options.log(`[spine] the hold drained: ${drained.events} events (${drained.bytes} bytes)`);
        for (const listener of [...this.drainedListeners]) listener();
        if (streams && this.options.link.streaming('engine-host')) {
          this.streamed = true;
          for (const listener of [...this.streamingListeners]) listener();
        }
      } while (this.again && !this.closed);
    })().finally(() => {
      this.running = null;
    });
    this.running = run;
    return run;
  }

  // E10's contract, carried in from host-supervisor.ts's sayReady: bounded, aborted at a transition, its dispatch
  // refused once aborted, and the race of the pull against the abort.
  private async runResync(resync: HostResync): Promise<void> {
    const controller = new AbortController();
    this.resyncing = controller;
    const guarded: HostDispatch = (owner, name, input) =>
      controller.signal.aborted
        ? Promise.resolve({ ok: false, error: ipcError('host_unavailable', `${owner}'s resync was cancelled (${String(controller.signal.reason)}); ${name} not sent`) })
        : this.dispatch(owner, name, input);
    const boundMs = this.options.resyncBoundMs ?? RESYNC_BOUND_MS;
    const bound = setTimeout(() => {
      this.options.log(`[spine] the engine host's resync took longer than ${boundMs / 1000} s; draining the hold without it`);
      controller.abort('bound');
    }, boundMs);
    const ended = new Promise<void>((resolve) => controller.signal.addEventListener('abort', () => resolve(), { once: true }));
    const pulled = Promise.resolve()
      .then(() => resync(guarded, controller.signal))
      .catch((error: unknown) => this.options.log(`[spine] the engine host's resync failed: ${error instanceof Error ? error.message : String(error)}`));
    await Promise.race([pulled, ended]);
    clearTimeout(bound);
    if (this.resyncing === controller) this.resyncing = null;
  }

  cancel(reason: 'transition' | 'yield' | 'closed'): void {
    this.resyncing?.abort(reason);
  }

  // The parts stopped: nothing the root subscribed stays on the link or the core.
  close(): void {
    this.closed = true;
    this.cancel('closed');
    for (const off of this.offs.splice(0)) off();
    this.streamingListeners.clear();
    this.drainedListeners.clear();
  }
}

function resultOf(response: HostResponse): CommandResult<CommandName> {
  return (response.ok ? { ok: true, value: response.value } : { ok: false, error: response.error }) as CommandResult<CommandName>;
}
