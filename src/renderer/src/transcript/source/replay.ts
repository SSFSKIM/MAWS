// replaySource: a TranscriptSource that plays a fixed list of X1 events (the harness and tests; C6 execution document,
// Public surface). Nothing is in the snapshot; the player releases events through `subscribe`, one batch per 16 ms
// tick, by their timestamps scaled by `speed` (0 releases everything at the next tick, 1 is wall clock). Time starts
// at the next pending event whenever playback (re)starts, so a gap before play or during a pause costs no waiting.
import type { SessionEvent } from '@shared/graph/events';
import type { Player, TranscriptSource } from './types';

export const TICK_MS = 16;

export interface ReplaySource extends TranscriptSource, Player {
  speed: number;
}

export function replaySource(events: SessionEvent[], options: { speed?: number; key?: string } = {}): ReplaySource {
  const listeners = new Set<(events: SessionEvent[]) => void>();
  const times = events.map((event) => Date.parse(event.at));
  let next = 0; // index of the first unreleased event
  let speed = options.speed ?? 1;
  let timer: ReturnType<typeof setInterval> | null = null;
  let anchor = { wall: 0, virtual: 0 }; // playback clock: virtual event time at a wall-clock instant

  const release = (end: number) => {
    if (end <= next) return;
    const batch = events.slice(next, end);
    next = end;
    for (const listener of listeners) listener(batch);
    if (next >= events.length) stop();
  };
  const virtualNow = () => anchor.virtual + (Date.now() - anchor.wall) * speed;
  const restartClock = () => {
    anchor = { wall: Date.now(), virtual: next < events.length ? times[next] : 0 };
  };
  const stop = () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };
  const tick = () => {
    if (speed === 0) return release(events.length);
    const now = virtualNow();
    let end = next;
    while (end < events.length && times[end] <= now) end += 1;
    release(end);
  };

  return {
    key: options.key,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    snapshot: () => Promise.resolve([]),
    play() {
      if (timer !== null || next >= events.length) return;
      restartClock();
      timer = setInterval(tick, TICK_MS);
    },
    pause: stop,
    step: () => release(next + 1),
    seek(seq) {
      let end = next;
      while (end < events.length && (events[end].seq ?? end) < seq) end += 1;
      release(end);
      if (timer !== null) restartClock();
    },
    get done() {
      return next >= events.length;
    },
    get speed() {
      return speed;
    },
    set speed(value: number) {
      if (timer !== null && next < events.length) anchor = { wall: Date.now(), virtual: virtualNow() };
      speed = value;
    },
  };
}
