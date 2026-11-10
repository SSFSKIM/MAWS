// P5 O15 M2b §G (docs/doperpowers/plans/2026-11-10-p5-o15-recomposition.md): a wake source and a reach the org suites
// drive by hand. The wake source tells what a test says; the reach's window opens when someone opens it and every
// `reachable` waits until the test answers it, as the hub's prober would at its first connect.
import type { Reach } from '../../src/main/net/reach';
import type { WakeNotice, WakeSource } from '../../src/main/net/wake';

export function fakeWake() {
  const wakes = new Set<(notice: WakeNotice) => void>();
  const unlocks = new Set<() => void>();
  const source: WakeSource = {
    onWake(listener) {
      wakes.add(listener);
      return () => void wakes.delete(listener);
    },
    onUnlock(listener) {
      unlocks.add(listener);
      return () => void unlocks.delete(listener);
    },
    close() {},
  };
  return {
    source,
    wake(sleptMs: number): void {
      for (const listener of [...wakes]) listener({ sleptMs, source: 'resume' });
    },
    unlock(): void {
      for (const listener of [...unlocks]) listener();
    },
    /** The listeners still subscribed, wakes and unlocks together. */
    listeners: () => wakes.size + unlocks.size,
  };
}

export function fakeReach(options: { open?: boolean } = {}) {
  let open = options.open ?? false;
  const waiting: Array<{ target: string; answer(reachable: boolean): void }> = [];
  const windows: string[] = [];
  const answer = (reachable = true): void => {
    for (const waiter of [...waiting]) waiter.answer(reachable);
  };
  const reach: Reach = {
    openWindow(reason) {
      open = true;
      windows.push(reason);
    },
    windowOpen: () => open,
    reachable(target, signal) {
      if (!open || signal?.aborted === true) return Promise.resolve(false);
      return new Promise<boolean>((resolve) => {
        const waiter = {
          target,
          answer(reachable: boolean) {
            const at = waiting.indexOf(waiter);
            if (at < 0) return;
            waiting.splice(at, 1);
            resolve(reachable);
          },
        };
        waiting.push(waiter);
        signal?.addEventListener('abort', () => waiter.answer(false), { once: true });
      });
    },
    close() {},
  };
  return {
    reach,
    /** The waits not yet answered, each with its target. */
    waiting,
    /** The reasons the window was opened with, in order. */
    windows,
    /** Answers every wait: `true`, the path answered a probe. */
    answer,
    /** The window closes: every wait is answered `false`. */
    closeWindow(): void {
      open = false;
      answer(false);
    },
  };
}
