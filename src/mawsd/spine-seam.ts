// The spine seam (P5 O3-D M2; docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md, Interfaces §A; D5, D6, D8, D9, D26,
// D27): how `mawsd` composes the spine from the services chunk, loaded on demand and never at start, and lets it go.
//
// States: `cold` → `loading` at a trigger (a spine command from a client, an endpoint's, or a `session.eventBatch` from
// the engine host); `loading` → `loaded` once the lock is held (taken the first time, the one the seam holds
// afterwards), the load's data opened under it and its root started and past its barrier (spine-hosts.ts), or →
// `refused` while a live process holds `spine.lock` (a trigger tries again once a minute has passed); `loaded` →
// `releasing` once the daemon's quiet and no working session have held for the quiet period: no new work is admitted
// (a request waits for `cold` and loads again), the engine host's events keep folding, and the parts stop only once the
// root settled, with no deadline that hands anything over (a release never closes the index under a writer); → `cold`.
// A unit daemon re-executes after a release: the link's terminal draining close first, its last batches folded into
// the still-loaded spine, then the parts stop and the daemon exits 75 (its unit restarts it cold). Any state →
// `yielded` while an older app's pid lives (§L): a loaded spine settles, stops and gives the lock up, or, when its
// writers have not settled within a minute, the process ends instead, which ends every writer and frees the lock by the
// exit path (D27); → `cold` once the pid is gone.
import type { SpineData, SpineDeps, SpineRoot } from '../services/spine-root';
import type { SpineLock } from '../services/settings/spine-lock';
import type { EngineSessionStatus } from '@shared/engine/status';
import { isAlive, procStartOf } from '../engine-host/supervisor-files';
import { SpineEvents, SpineHostsAdapter, type EngineIntercept, type EngineLink } from './spine-hosts';

export type SpineState = 'cold' | 'loading' | 'loaded' | 'refused' | 'releasing' | 'yielded';
export type SpineTrigger = 'command' | 'event' | 'endpoint';

// What the seam takes of the services chunk (../services/entry; a test brings a stand-in).
export interface SpineEntry {
  takeSpineLock(profile: string, options: { build: string; waitMs?: number; log?: (line: string) => void }): Promise<SpineLock>;
  openSpineData(profile: string, options: { build: string; lock?: SpineLock }): Promise<SpineData>;
  startSpine(deps: SpineDeps): SpineRoot;
}

// The deferred load of the services chunk (`out/main/services.js`'s code, emitted beside mawsd.js): nothing of the
// library is on mawsd's run path until the first trigger (the bundle guard's case).
export const loadServicesEntry = (): Promise<SpineEntry> => import('../services/entry');

export interface SpineTiming {
  refusalRetryMs: number; // a refused load is tried again at the first trigger after this
  yieldCheckMs: number; // the yielded-to pid's liveness, by pid and start time
  yieldSettleMs: number; // a yield whose writers have not settled by then ends the process
  settleLogMs: number; // a release still waiting for the root's work logs again after this
  stopSettleMs: number; // the daemon's exit waits this long in all for a load, a release or the root's work, then leaves them to the exit
}
export const SPINE_TIMING: SpineTiming = { refusalRetryMs: 60_000, yieldCheckMs: 5_000, yieldSettleMs: 60_000, settleLogMs: 30_000, stopSettleMs: 5_000 };

export interface LazySpineOptions {
  profileDir: string;
  build: string; // `${version}+${commit}`, the lock's buildId
  hosts: EngineLink; // the daemon's supervisor, for the engine host's link
  intercept: EngineIntercept; // the daemon's engine-host intercepts (daemon.ts's interceptEngine)
  load(): Promise<SpineEntry>; // the deferred chunk
  deps(): Omit<SpineDeps, 'data' | 'hosts'>; // mawsd's bindings, built at each load (one login-shell capture per load)
  quietMs(): number; // the daemon's idle time, or MAWS_SPINE_QUIET_MS under a measured scene (D6)
  reexecute: boolean; // exit 75 after a release: a unit daemon with the switch on (D38, daemon.ts); otherwise the link stays open and the hold starts
  wakeOnEvents: boolean; // a session.eventBatch while cold loads the spine (M2: off in the product until main stops composing its own; daemon.ts)
  endLink(): Promise<void>; // re-execution's first step: the engine host's link ended by its terminal draining close
  restart(reason: string): void; // re-execution's last: the daemon's exit order with EXIT_RESTART
  exitForYield(): void; // a yield whose writers did not settle: the daemon's exit order (75 for a unit, 0 for a private one)
  collected(): void; // a release dropped the root: the idle collector's dropped()
  onState(state: SpineState, detail: string | null): void;
  log(line: string): void;
  // test seams
  lockWaitMs?: number;
  timing?: Partial<SpineTiming>;
  now?(): number;
  processes?: { isAlive(pid: number): boolean; procStartOf(pid: number): string | null };
}

export interface SpineStatus {
  state: SpineState;
  refused: string | null;
  loadedAt: string | null;
  heldDropped: number;
}

export interface LazySpine {
  state(): SpineState;
  status(): SpineStatus; // daemon.status.spine
  // Loads if cold (or refused, once the minute passed), then answers the root; rejects with the refusal while a live
  // process holds the lock, or while yielded. A request while releasing waits for the release and loads again.
  ensure(reason: SpineTrigger): Promise<SpineRoot>;
  root(): SpineRoot | null; // loaded only
  quiet(quiet: boolean): void; // told at each evaluation of the daemon's facts (clocks.ts)
  yield(pid: number | null): void; // an older app's pid (§L): release and give the lock up while it lives; null lifts it
  stop(): Promise<void>; // the daemon's exit order: release without re-execution, bounded
}

// Not loadable now: the refusal (the lock's holder named) or the yield.
export class SpineUnavailable extends Error {}

const WORKING_REASONS = new Set(['turn', 'busy', 'background_tasks']);

// A session the spine must stay loaded for (Interfaces §A): launching, or live with an open turn, host work or background
// tasks, or an engine-started turn (which runs with a null `turn` and an empty `keepAlive`). A kept session that is
// `ready`, `idle` and holds none of those is not working: it permits the release and is not ended by it.
export function workingSession(status: EngineSessionStatus): boolean {
  if (status.process === 'starting' || status.process === 'initializing') return true;
  if (status.process !== 'ready') return false;
  return status.keepAlive.some((reason) => WORKING_REASONS.has(reason)) || status.engineState === 'running' || status.engineState === 'requires_action';
}

interface Loaded {
  root: SpineRoot;
  adapter: SpineHostsAdapter;
  offs: (() => void)[];
}

export function createLazySpine(options: LazySpineOptions): LazySpine {
  const timing = { ...SPINE_TIMING, ...options.timing };
  const now = options.now ?? (() => Date.now());
  const processes = options.processes ?? { isAlive, procStartOf };
  const { log } = options;

  let state: SpineState = 'cold';
  let refusal: { reason: string; at: number } | null = null;
  let loadedAt: string | null = null;
  let entry: SpineEntry | null = null;
  let lock: SpineLock | null = null;
  let releaseAtExit: (() => void) | null = null;
  let loaded: Loaded | null = null;
  let loading: Promise<SpineRoot> | null = null;
  let releasing: Promise<void> | null = null;
  let yieldTo: { pid: number; procStart: string | null; check: ReturnType<typeof setInterval> } | null = null;
  let quietFact = false;
  let quietTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const events = new SpineEvents(options.hosts, {
    log,
    wake: () => {
      if (!options.wakeOnEvents || stopped || !loadable()) return false;
      void ensure('event').catch(() => {}); // a refusal is logged and kept by the load
      return true;
    },
  });

  function set(next: SpineState, detail: string | null = null): void {
    state = next;
    options.onState(next, detail);
  }

  function loadable(): boolean {
    if (yieldTo) return false;
    if (state === 'cold') return true;
    return state === 'refused' && refusal !== null && now() - refusal.at >= timing.refusalRetryMs;
  }

  async function ensure(reason: SpineTrigger): Promise<SpineRoot> {
    for (;;) {
      if (stopped) throw new SpineUnavailable('the daemon is exiting');
      if (yieldTo) throw new SpineUnavailable(`the spine yielded to pid ${yieldTo.pid}, an app that runs its own`);
      if (loaded && state === 'loaded') return loaded.root;
      if (loading) return loading;
      if (releasing) {
        await releasing;
        continue;
      }
      if (state === 'refused' && !loadable()) throw new SpineUnavailable(refusal!.reason);
      loading = load(reason).finally(() => {
        loading = null;
      });
      return loading;
    }
  }

  async function load(reason: SpineTrigger): Promise<SpineRoot> {
    const started = now();
    events.beginHold();
    set('loading', reason);
    log(`spine: loading (${reason})`);
    let adapter: SpineHostsAdapter | null = null;
    let root: SpineRoot | null = null;
    try {
      entry ??= await options.load();
      throwIfExiting();
      if (!lock) {
        const taken = await entry.takeSpineLock(options.profileDir, { build: options.build, log, ...(options.lockWaitMs !== undefined && { waitMs: options.lockWaitMs }) });
        if (taken.refused !== null) return refuse(taken.refused);
        lock = taken;
        const held = taken;
        releaseAtExit = () => held.release();
        process.once('exit', releaseAtExit); // a yield's or a fault's exit with a writer alive: the lock goes by the exit path
      }
      throwIfYielded();
      throwIfExiting();
      const data = await entry.openSpineData(options.profileDir, { build: options.build, lock });
      throwIfExiting(); // no composition once the exit began
      adapter = new SpineHostsAdapter({ link: options.hosts, events, intercept: options.intercept, log });
      root = entry.startSpine({ ...options.deps(), data, hosts: adapter });
      await adapter.load();
      throwIfYielded();
    } catch (error) {
      if (root) {
        if (yieldTo) await settle(root, null); // the yield's deadline ends the process if it never does
        await stopRoot(root, adapter!);
      } else adapter?.close();
      if (yieldTo) {
        events.discard('the spine yielded while it loaded', 'off');
        giveLockUp();
        set('yielded', `pid ${yieldTo.pid}`);
      } else if (state === 'loading') {
        events.discard('the load failed', 'cold');
        set('cold', `the load failed: ${messageOf(error)}`);
        log(`spine: the load failed: ${messageOf(error)}`);
      }
      throw error;
    }
    refusal = null;
    loaded = { root, adapter, offs: [root.view.on('engine', () => evaluate())] };
    loadedAt = new Date().toISOString();
    const ms = now() - started;
    set('loaded', `in ${ms} ms`);
    log(`spine: loaded in ${ms} ms`);
    evaluate();
    return root;
  }

  // read through a call: the exit begins while the load awaits
  function throwIfExiting(): void {
    if (stopped) throw new SpineUnavailable('the daemon is exiting');
  }

  // read through a call: a yield arrives while the load awaits
  function throwIfYielded(): void {
    if (yieldTo) throw new SpineUnavailable(`the spine yielded to pid ${yieldTo.pid} while it loaded`);
  }

  function refuse(reason: string): never {
    refusal = { reason, at: now() };
    events.discard('the spine is refused', 'cold');
    set('refused', reason);
    log(`spine: refused: ${reason}`);
    throw new SpineUnavailable(reason);
  }

  // --- the release ------------------------------------------------------------------------------------------------------
  function working(): boolean {
    return loaded !== null && loaded.root.view.engineStatuses().some(workingSession);
  }

  // At each evaluation (the daemon's quiet, an engine status): the quiet period runs while the daemon is quiet, no
  // session works and the root has nothing in flight as it begins; work that starts once it runs is waited for at the
  // release itself.
  function evaluate(): void {
    const permits = state === 'loaded' && quietFact && !working();
    if (!permits) {
      if (quietTimer) clearTimeout(quietTimer);
      quietTimer = null;
      return;
    }
    if (quietTimer) return;
    const root = loaded!.root;
    if (root.busy()) return void root.settled().then(() => evaluate());
    quietTimer = setTimeout(() => {
      quietTimer = null;
      if (state === 'loaded' && quietFact && !working()) void release('quiet');
    }, options.quietMs());
  }

  // `exitBy` (a stop's): when the exit's deadline passes, after which nothing is stopped under the root's work
  function release(why: 'quiet' | 'stop' | 'yield', exitBy: Promise<unknown> | null = null): Promise<void> {
    releasing ??= (async () => {
      const current = loaded!;
      set('releasing');
      log(`spine: releasing (${why})`);
      const reexecute = why === 'quiet' && options.reexecute;
      await settle(current.root, exitBy);
      if (why === 'stop' && current.root.busy()) {
        log('spine: the exit leaves the spine’s work in flight to the exit; nothing stopped under it');
        return;
      }
      if (reexecute) {
        log('spine: ending the engine host’s link before the re-execution');
        await options.endLink(); // the drain's batches fold into the loaded spine
        await settle(current.root, null);
      }
      await stopRoot(current.root, current.adapter, current.offs);
      loaded = null;
      loadedAt = null;
      if (why === 'yield') {
        events.off();
        giveLockUp();
      } else {
        events.cold();
      }
      set(why === 'yield' ? 'yielded' : 'cold', why === 'yield' ? `pid ${yieldTo?.pid ?? 'gone'}` : 'released');
      log('spine: released');
      if (why !== 'stop') options.collected();
      if (reexecute) options.restart('spine released');
      else if (why === 'yield' && !yieldTo) {
        events.cold(); // lifted while it released
        set('cold', 'the yield lifted');
      }
    })().finally(() => {
      releasing = null;
    });
    return releasing;
  }

  // root.settled(), logging the wait; `until` null waits as long as it takes.
  async function settle(root: SpineRoot, until: Promise<unknown> | null): Promise<void> {
    if (!root.busy()) return root.settled();
    log('spine: the release waits for the spine’s work in flight');
    const started = now();
    const every = setInterval(() => log(`spine: the release still waits for the spine’s work in flight (${Math.round((now() - started) / 1000)} s)`), timing.settleLogMs);
    try {
      await (until === null ? root.settled() : Promise.race([root.settled(), until]));
    } finally {
      clearInterval(every);
    }
  }

  async function stopRoot(root: SpineRoot, adapter: SpineHostsAdapter, offs: (() => void)[] = []): Promise<void> {
    for (const off of offs.splice(0)) off();
    try {
      root.stop();
    } catch (error) {
      log(`spine: a part's stop failed: ${messageOf(error)}`);
    }
    adapter.close();
  }

  function giveLockUp(): void {
    if (!lock) return;
    lock.release();
    if (releaseAtExit) process.removeListener('exit', releaseAtExit);
    lock = null;
    releaseAtExit = null;
  }

  // --- the yield --------------------------------------------------------------------------------------------------------
  function lift(): void {
    if (!yieldTo) return;
    clearInterval(yieldTo.check);
    log(`spine: the yield to pid ${yieldTo.pid} lifted`);
    yieldTo = null;
    if (state === 'loading') events.beginHold(true); // the load goes on: its barrier drains what arrives from here
    if (state === 'yielded') {
      events.cold();
      set('cold', 'the yield lifted');
    }
  }

  function yieldSpine(pid: number | null): void {
    if (pid === null) return lift();
    if (yieldTo?.pid === pid || stopped) return;
    if (yieldTo) clearInterval(yieldTo.check);
    const procStart = processes.procStartOf(pid);
    const check = setInterval(() => {
      if (!processes.isAlive(pid) || processes.procStartOf(pid) !== procStart) lift();
    }, timing.yieldCheckMs);
    yieldTo = { pid, procStart, check };
    log(`spine: yielding to pid ${pid}, an app that runs its own spine`);
    if (quietTimer) clearTimeout(quietTimer);
    quietTimer = null;
    const deadline = () => {
      const timer = setTimeout(() => {
        log(`spine: the spine’s writers did not settle within ${timing.yieldSettleMs / 1000} s of the yield; ending the process`);
        options.exitForYield();
      }, timing.yieldSettleMs);
      return () => clearTimeout(timer);
    };
    if (state === 'loading') {
      events.discard('the spine yielded while it loaded', 'off');
      void loading!.catch(() => {}).finally(deadline()); // the load ends yielded at its next step
      return;
    }
    if (state === 'loaded' || state === 'releasing') {
      const yielding = state === 'releasing' ? releasing!.then(() => (loaded ? release('yield') : afterRelease())) : release('yield');
      void yielding.finally(deadline());
      return;
    }
    afterRelease();
  }

  // cold or refused, or a release that ended cold: nothing loaded; the lock goes, and every load is refused
  function afterRelease(): void {
    if (!yieldTo || loaded) return;
    events.off();
    giveLockUp();
    set('yielded', `pid ${yieldTo.pid}`);
  }

  return {
    state: () => state,
    status: () => ({ state, refused: state === 'refused' ? (refusal?.reason ?? null) : null, loadedAt, heldDropped: events.dropped }),
    ensure,
    root: () => (state === 'loaded' ? (loaded?.root ?? null) : null),
    quiet(quiet) {
      quietFact = quiet;
      evaluate();
    },
    yield: yieldSpine,
    async stop() {
      if (stopped) return;
      stopped = true;
      if (quietTimer) clearTimeout(quietTimer);
      if (yieldTo) clearInterval(yieldTo.check);
      // one deadline for the whole exit (D34): a load, a release or the root's work still running when it passes is
      // left to the process's exit, which ends every writer and frees spine.lock; nothing is closed or handed over
      let expire!: () => void;
      const exitBy = new Promise<'expired'>((resolve) => (expire = () => resolve('expired')));
      const timer = setTimeout(expire, timing.stopSettleMs);
      try {
        const finished = (work: Promise<unknown>) => Promise.race([work.then(() => 'done', () => 'done'), exitBy]);
        if (loading && (await finished(loading)) === 'expired') return log('spine: the exit leaves the load in flight to the exit; nothing closed or handed over under it');
        if (releasing && (await finished(releasing)) === 'expired') return log('spine: the exit leaves the release in flight to the exit');
        if (loaded && !releasing) await release('stop', exitBy);
        if (!loaded && !releasing) giveLockUp(); // nothing writes: the exit follows
      } finally {
        clearTimeout(timer);
        events.close();
      }
    },
  };
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
