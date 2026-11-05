// The wall clock for ages and waits ("8m", "waiting 4m"), shared by every row and card: one timer, ticking every 30 s
// while anything reads it.
import { useSyncExternalStore } from 'react';

const TICK_MS = 30_000;
const listeners = new Set<() => void>();
let now = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (timer === null) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      listeners.forEach((l) => l());
    }, TICK_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

export const useNow = (): number => useSyncExternalStore(subscribe, () => now);

/**
 * The same clock rounded down to a multiple of `ms` (a multiple of the 30 s tick): a reader renders again only when the
 * rounded time changes, so an order that depends on the time (the sidebar's fresh-unread window, P5 O7 M10's follow-up)
 * is recomputed at most once per `ms`, not on every tick, and never by a timer of its own.
 */
export const useNowEvery = (ms: number): number => useSyncExternalStore(subscribe, () => Math.floor(now / ms) * ms);
