// P5 O15 M2b §D (docs/doperpowers/plans/2026-11-10-p5-o15-recomposition.md): a wake, noticed with the sleep's length.
// The one listener in main to powerMonitor's `suspend`, `resume` and `unlock-screen`; the remote source, the org feed and
// the project sockets take its notices. A consumer drops every socket from before the sleep when `sleptMs` is at least
// WAKE_DROP_MS, and makes today's probe when it is less.
//
// A `resume` reports the time since the `suspend`. For a wake that sent no `resume` (Electron says of it only "Emitted
// when system is resuming"), a tick every WAKE_TICK_MS reports one that came WAKE_DROP_MS or more late as a wake of that
// length, at most once in WAKE_CLOCK_GAP_MS, so a main process that keeps stalling does not reconnect in a loop. A
// stall of 10 s is reported too, rightly: the peers saw the same silence. The tick reads the wall clock's lateness and
// no second clock, since whether Node's monotonic clock advances through a macOS sleep is not something this
// repository shows, and a timer due during the sleep fires when the process runs again either way.
//
// §I's seam: under MAWS_E2E=1 in an unpackaged build, `globalThis.__maws_wake.inject(sleptMs)` tells a wake that did
// not happen, for e2e/remote-latency.spec.ts's wake case. A packaged app has no way to be told one.

export const WAKE_TICK_MS = 1_000;
export const WAKE_DROP_MS = 10_000; // twice PING_MS[0] of src/endpoint/channels.ts; a test holds the two (src/main/machines/remote/timing.test.ts)
export const WAKE_CLOCK_GAP_MS = 60_000; // the least time between two notices the timer raises

export interface WakeNotice {
  sleptMs: number;
  source: 'resume' | 'clock';
}

export interface WakeSource {
  onWake(listener: (notice: WakeNotice) => void): () => void;
  onUnlock(listener: () => void): () => void;
  close(): void;
}

type PowerEvent = 'suspend' | 'resume' | 'unlock-screen';

export function createWakeSource(deps: {
  power: { on(event: PowerEvent, listener: () => void): unknown; off(event: PowerEvent, listener: () => void): unknown }; // Electron's powerMonitor
  now?(): number;
  log(line: string): void;
}): WakeSource & { inject(sleptMs: number): void } {
  const now = deps.now ?? Date.now;
  const wakeListeners = new Set<(notice: WakeNotice) => void>();
  const unlockListeners = new Set<() => void>();
  let suspendedAt: number | null = null;
  let lastTick = now();
  let lastClockNotice: number | null = null; // when the timer last raised a notice

  const tell = (notice: WakeNotice) => {
    deps.log(`[wake] slept ${notice.sleptMs} ms (${notice.source})`);
    for (const listener of [...wakeListeners]) listener(notice);
  };

  const onSuspend = () => {
    suspendedAt = now();
  };
  const onResume = () => {
    const at = now();
    const sleptMs = at - (suspendedAt ?? lastTick);
    suspendedAt = null;
    lastTick = at;
    tell({ sleptMs, source: 'resume' });
  };
  const onUnlockScreen = () => {
    for (const listener of [...unlockListeners]) listener();
  };
  const tick = () => {
    const at = now();
    const late = at - lastTick - WAKE_TICK_MS;
    lastTick = at;
    if (late < WAKE_DROP_MS) return;
    if (lastClockNotice !== null && at - lastClockNotice < WAKE_CLOCK_GAP_MS) return;
    lastClockNotice = at;
    suspendedAt = null;
    tell({ sleptMs: late, source: 'clock' });
  };

  deps.power.on('suspend', onSuspend);
  deps.power.on('resume', onResume);
  deps.power.on('unlock-screen', onUnlockScreen);
  const timer = setInterval(tick, WAKE_TICK_MS);
  (timer as { unref?: () => void }).unref?.(); // the tick never holds the process

  return {
    onWake(listener) {
      wakeListeners.add(listener);
      return () => void wakeListeners.delete(listener);
    },
    onUnlock(listener) {
      unlockListeners.add(listener);
      return () => void unlockListeners.delete(listener);
    },
    inject(sleptMs) {
      lastTick = now();
      tell({ sleptMs, source: 'clock' });
    },
    close() {
      deps.power.off('suspend', onSuspend);
      deps.power.off('resume', onResume);
      deps.power.off('unlock-screen', onUnlockScreen);
      clearInterval(timer);
      wakeListeners.clear();
      unlockListeners.clear();
    },
  };
}

/** §I's seam: what e2e/remote-latency.spec.ts reaches through Playwright's `app.evaluate`. */
export interface WakeSeam {
  inject(sleptMs: number): void;
}

declare global {
  var __maws_wake: WakeSeam | undefined;
}

/** Installs the seam under MAWS_E2E=1 in a build that is not packaged, as installRemoteBenchSeam does; returns its removal. */
export function installWakeSeam(env: NodeJS.ProcessEnv, packaged: boolean, wake: WakeSeam): () => void {
  if (env.MAWS_E2E !== '1' || packaged) return () => {};
  const seam: WakeSeam = { inject: (sleptMs) => wake.inject(sleptMs) };
  globalThis.__maws_wake = seam;
  return () => {
    if (globalThis.__maws_wake === seam) delete globalThis.__maws_wake;
  };
}
