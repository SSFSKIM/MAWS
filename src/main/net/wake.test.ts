// P5 O15 M2b §D and §I's seam (docs/doperpowers/plans/2026-11-10-p5-o15-recomposition.md): the wake source, on a fake
// power source and vitest's fake clock (the source reads Date.now, which the fake timers move).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWakeSource, installWakeSeam, WAKE_CLOCK_GAP_MS, WAKE_DROP_MS, WAKE_TICK_MS, type WakeNotice } from './wake';

type PowerEvent = 'suspend' | 'resume' | 'unlock-screen';

function fakePower() {
  const listeners = new Map<PowerEvent, Set<() => void>>();
  return {
    on(event: PowerEvent, listener: () => void) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(listener);
    },
    off(event: PowerEvent, listener: () => void) {
      listeners.get(event)?.delete(listener);
    },
    emit(event: PowerEvent) {
      for (const listener of [...(listeners.get(event) ?? [])]) listener();
    },
    count: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
  };
}

function source() {
  const power = fakePower();
  const lines: string[] = [];
  const notices: WakeNotice[] = [];
  const wake = createWakeSource({ power, log: (line) => void lines.push(line) });
  wake.onWake((notice) => void notices.push(notice));
  return { power, lines, notices, wake };
}

/** The process does not run for `ms`: the wall clock jumps and no timer fires until the next one is due. */
const asleep = (ms: number) => vi.setSystemTime(Date.now() + ms);

beforeEach(() => void vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  delete globalThis.__maws_wake;
});

describe('the wake source (§D)', () => {
  it('tells a resume after a suspend the time between them, and writes its line', () => {
    const { power, lines, notices, wake } = source();
    power.emit('suspend');
    asleep(3_600_000);
    power.emit('resume');
    expect(notices).toEqual([{ sleptMs: 3_600_000, source: 'resume' }]);
    expect(lines).toEqual(['[wake] slept 3600000 ms (resume)']);
    wake.close();
  });

  it('tells a resume with no suspend the time since the last tick', () => {
    const { power, notices, wake } = source();
    vi.advanceTimersByTime(WAKE_TICK_MS); // a tick at 1 s
    vi.advanceTimersByTime(400);
    power.emit('resume');
    expect(notices).toEqual([{ sleptMs: 400, source: 'resume' }]);
    wake.close();
  });

  it('forgets the suspend at a resume, so a second resume counts from the first', () => {
    const { power, notices, wake } = source();
    power.emit('suspend');
    asleep(20_000);
    power.emit('resume');
    vi.advanceTimersByTime(300);
    power.emit('resume');
    expect(notices).toEqual([
      { sleptMs: 20_000, source: 'resume' },
      { sleptMs: 300, source: 'resume' },
    ]);
    wake.close();
  });

  it('tells a tick 10 s late as one clock notice, and a resume within the second after it as a short sleep', () => {
    const { power, lines, notices, wake } = source();
    vi.advanceTimersByTime(WAKE_TICK_MS);
    power.emit('suspend');
    asleep(WAKE_DROP_MS);
    vi.advanceTimersByTime(WAKE_TICK_MS); // the tick that was due during the sleep, 10 s late
    expect(notices).toEqual([{ sleptMs: WAKE_DROP_MS, source: 'clock' }]);
    vi.advanceTimersByTime(200);
    power.emit('resume');
    expect(notices).toEqual([
      { sleptMs: WAKE_DROP_MS, source: 'clock' },
      { sleptMs: 200, source: 'resume' },
    ]);
    expect(lines).toEqual([`[wake] slept ${WAKE_DROP_MS} ms (clock)`, '[wake] slept 200 ms (resume)']);
    wake.close();
  });

  it('tells nothing for a tick late by less than 10 s', () => {
    const { notices, wake } = source();
    vi.advanceTimersByTime(WAKE_TICK_MS);
    asleep(WAKE_DROP_MS - 1);
    vi.advanceTimersByTime(WAKE_TICK_MS);
    vi.advanceTimersByTime(30 * WAKE_TICK_MS);
    expect(notices).toEqual([]);
    wake.close();
  });

  it('tells two late ticks within a minute as one notice, and a late tick a minute after the first as another', () => {
    const { notices, wake } = source();
    vi.advanceTimersByTime(WAKE_TICK_MS);
    asleep(15_000);
    vi.advanceTimersByTime(WAKE_TICK_MS); // the first notice
    vi.advanceTimersByTime(20 * WAKE_TICK_MS);
    asleep(15_000);
    vi.advanceTimersByTime(WAKE_TICK_MS); // late again, 36 s after the first notice: told nothing
    expect(notices).toEqual([{ sleptMs: 15_000, source: 'clock' }]);
    vi.advanceTimersByTime(WAKE_CLOCK_GAP_MS - 36_000 - WAKE_TICK_MS);
    asleep(12_000);
    vi.advanceTimersByTime(WAKE_TICK_MS); // past the gap: told
    expect(notices).toEqual([
      { sleptMs: 15_000, source: 'clock' },
      { sleptMs: 12_000, source: 'clock' },
    ]);
    wake.close();
  });

  it('passes unlock-screen on to the unlock listeners, and tells the wake listeners nothing', () => {
    const { power, notices, wake } = source();
    let unlocks = 0;
    const stop = wake.onUnlock(() => void unlocks++);
    power.emit('unlock-screen');
    stop();
    power.emit('unlock-screen');
    expect(unlocks).toBe(1);
    expect(notices).toEqual([]);
    wake.close();
  });

  it('stops telling a listener once its removal is called', () => {
    const { power, wake } = source();
    const heard: WakeNotice[] = [];
    const stop = wake.onWake((notice) => void heard.push(notice));
    power.emit('resume');
    stop();
    power.emit('resume');
    expect(heard).toHaveLength(1);
    wake.close();
  });

  it('injects a wake of the given length as a clock notice, taking now as the last tick', () => {
    const { power, lines, notices, wake } = source();
    vi.advanceTimersByTime(500);
    wake.inject(3_600_000);
    vi.advanceTimersByTime(300);
    power.emit('resume');
    expect(notices).toEqual([
      { sleptMs: 3_600_000, source: 'clock' },
      { sleptMs: 300, source: 'resume' },
    ]);
    expect(lines[0]).toBe('[wake] slept 3600000 ms (clock)');
    wake.close();
  });

  it('removes its three listeners and its timer at close()', () => {
    const { power, notices, wake } = source();
    expect(power.count()).toBe(3);
    expect(vi.getTimerCount()).toBe(1);
    wake.close();
    expect(power.count()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    asleep(WAKE_DROP_MS * 2);
    vi.advanceTimersByTime(WAKE_TICK_MS);
    expect(notices).toEqual([]);
  });
});

describe('the wake seam (§I)', () => {
  const wake = () => {
    const injected: number[] = [];
    return { injected, inject: (sleptMs: number) => void injected.push(sleptMs) };
  };

  it('is installed only under MAWS_E2E=1 in an unpackaged build, and removed again', () => {
    const outsideE2e = installWakeSeam({}, false, wake());
    expect(globalThis.__maws_wake).toBeUndefined();
    outsideE2e();
    const packaged = installWakeSeam({ MAWS_E2E: '1' }, true, wake());
    expect(globalThis.__maws_wake).toBeUndefined();
    packaged();
    const source = wake();
    const remove = installWakeSeam({ MAWS_E2E: '1' }, false, source);
    globalThis.__maws_wake!.inject(3_600_000);
    expect(source.injected).toEqual([3_600_000]);
    remove();
    expect(globalThis.__maws_wake).toBeUndefined();
  });
});
