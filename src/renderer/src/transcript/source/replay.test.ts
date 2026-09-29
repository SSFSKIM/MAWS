import type { SessionEvent } from '@shared/graph/events';
import type { EventId, SessionId } from '@shared/graph/ids';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { replaySource } from './replay';

const T0 = Date.parse('2026-09-28T10:00:00.000Z');

// Notices at the given millisecond offsets from T0; seq is the position.
const events = (...offsets: number[]): SessionEvent[] =>
  offsets.map((offset, seq) => ({
    id: `e${seq}` as EventId, sessionId: 's' as SessionId, at: new Date(T0 + offset).toISOString(), seq, agentId: null, parentToolUseId: null,
    kind: 'notice.posted', level: 'info', text: `n${seq}`, key: null,
  }));

function collect(source: ReturnType<typeof replaySource>) {
  const batches: string[][] = [];
  source.subscribe((batch) => batches.push(batch.map((event) => event.id)));
  return batches;
}

beforeEach(() => vi.useFakeTimers({ now: 0 }));
afterEach(() => vi.useRealTimers());

describe('replay source', () => {
  it('snapshots nothing: the player releases every event through subscribe', async () => {
    await expect(replaySource(events(0)).snapshot()).resolves.toEqual([]);
  });

  it('releases events at wall-clock speed from their timestamps, one batch per 16 ms tick', () => {
    const source = replaySource(events(0, 10, 40, 1000), { speed: 1 });
    const batches = collect(source);
    source.play();
    vi.advanceTimersByTime(16);
    expect(batches).toEqual([['e0', 'e1']]);
    vi.advanceTimersByTime(32);
    expect(batches).toEqual([['e0', 'e1'], ['e2']]);
    expect(source.done).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(batches.flat()).toEqual(['e0', 'e1', 'e2', 'e3']);
    expect(source.done).toBe(true);
  });

  it('scales time by speed, and releases everything at once at speed 0', () => {
    const fast = replaySource(events(0, 1600), { speed: 16 });
    const fastBatches = collect(fast);
    fast.play();
    vi.advanceTimersByTime(96);
    expect(fastBatches.flat()).toEqual(['e0']);
    vi.advanceTimersByTime(16);
    expect(fastBatches.flat()).toEqual(['e0', 'e1']);

    const instant = replaySource(events(0, 60_000, 3_600_000), { speed: 0 });
    const instantBatches = collect(instant);
    instant.play();
    vi.advanceTimersByTime(16);
    expect(instantBatches).toEqual([['e0', 'e1', 'e2']]);
    expect(instant.done).toBe(true);
  });

  it('starts from the next pending event, so a gap before play or after a pause costs no waiting', () => {
    const source = replaySource(events(0, 5_000, 5_010), { speed: 1 });
    const batches = collect(source);
    source.step();
    expect(batches).toEqual([['e0']]);
    source.play();
    vi.advanceTimersByTime(16);
    expect(batches).toEqual([['e0'], ['e1', 'e2']]);
  });

  it('pauses, steps one event at a time and seeks forward by seq', () => {
    const source = replaySource(events(0, 100, 200, 300, 400), { speed: 1 });
    const batches = collect(source);
    source.seek(3);
    expect(batches).toEqual([['e0', 'e1', 'e2']]);
    source.step();
    expect(batches.at(-1)).toEqual(['e3']);
    source.play();
    source.pause();
    vi.advanceTimersByTime(1000);
    expect(batches.flat()).toHaveLength(4);
    source.step();
    expect(source.done).toBe(true);
  });

  it('changes speed while playing without skipping or repeating events', () => {
    const source = replaySource(events(0, 1000, 2000), { speed: 1 });
    const batches = collect(source);
    source.play();
    vi.advanceTimersByTime(16);
    source.speed = 0;
    vi.advanceTimersByTime(16);
    expect(batches.flat()).toEqual(['e0', 'e1', 'e2']);
  });

  it('stops delivering to a listener that unsubscribed', () => {
    const source = replaySource(events(0, 1), { speed: 0 });
    const seen: number[] = [];
    const unsubscribe = source.subscribe((batch) => seen.push(batch.length));
    unsubscribe();
    source.play();
    vi.advanceTimersByTime(16);
    expect(seen).toEqual([]);
  });
});
