import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReplayClock } from './clock';

// Every row is scheduled up front; `fired` records the real (fake) time each one fired, relative to the start.
function run(clock: ReplayClock, rows: number[]) {
  const start = Date.now();
  const fired: number[] = [];
  for (const at of rows) clock.schedule(at, () => fired.push(Date.now() - start));
  return fired;
}

const near = (actual: number | undefined, expected: number) => {
  expect(actual).toBeDefined();
  expect(Math.abs(actual! - expected), `${actual} vs ${expected}`).toBeLessThanOrEqual(50);
};

describe('replay clock paces recorded rows in real time', () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());

  it('at speed 2 fires rows recorded at 0, 1000 and 3000 ms at about 0, 500 and 1500 ms', () => {
    const fired = run(new ReplayClock({ speed: 2, maxGapMs: 2000 }), [0, 1000, 3000]);
    vi.advanceTimersByTime(0);
    near(fired[0], 0);
    vi.advanceTimersByTime(499);
    expect(fired).toHaveLength(1);
    vi.advanceTimersByTime(1);
    near(fired[1], 500);
    vi.advanceTimersByTime(1000);
    near(fired[2], 1500);
    expect(fired).toHaveLength(3);
  });

  it('a speed change re-bases at the current row: setSpeed(4) after the second row fires the third about 500 ms later', () => {
    const clock = new ReplayClock({ speed: 2, maxGapMs: 2000 });
    const start = Date.now();
    const fired: number[] = [];
    clock.schedule(0, () => fired.push(Date.now() - start));
    clock.schedule(1000, () => {
      fired.push(Date.now() - start);
      clock.setSpeed(4);
    });
    clock.schedule(3000, () => fired.push(Date.now() - start));
    vi.advanceTimersByTime(2000);
    expect(fired).toHaveLength(3);
    near(fired[1], 500);
    near(fired[2] - fired[1], 500);
  });

  it('a speed change part-way through a gap keeps the part already played', () => {
    const clock = new ReplayClock({ speed: 1, maxGapMs: 10_000 });
    const fired = run(clock, [0, 4000]);
    vi.advanceTimersByTime(1000); // a quarter of the gap played at speed 1
    clock.setSpeed(3); // the remaining 3000 recorded ms take 1000 ms
    vi.advanceTimersByTime(999);
    expect(fired).toHaveLength(1);
    vi.advanceTimersByTime(1);
    near(fired[1], 2000);
  });

  it('shortens a 60 s recorded gap to 2 s at speed 1', () => {
    const fired = run(new ReplayClock({ speed: 1, maxGapMs: 2000 }), [0, 60_000, 60_500]);
    vi.advanceTimersByTime(1999);
    expect(fired).toHaveLength(1);
    vi.advanceTimersByTime(1);
    near(fired[1], 2000);
    vi.advanceTimersByTime(500);
    near(fired[2], 2500);
  });

  it('pause then resume after 300 ms shifts every remaining deadline by 300 ms', () => {
    const clock = new ReplayClock({ speed: 1, maxGapMs: 2000 });
    const fired = run(clock, [0, 1000, 2000]);
    vi.advanceTimersByTime(400);
    clock.pause();
    expect(clock.state).toBe('paused');
    vi.advanceTimersByTime(300);
    expect(fired).toHaveLength(1);
    clock.resume();
    expect(clock.state).toBe('running');
    vi.advanceTimersByTime(2000);
    near(fired[1], 1300);
    near(fired[2], 2300);
  });

  it("'instant' bypasses the timers: rows fire one per turn of the event loop, whatever the recorded gaps", async () => {
    vi.useRealTimers();
    const clock = new ReplayClock({ speed: 'instant', maxGapMs: 2000 });
    const started = performance.now();
    const fired: number[] = [];
    await new Promise<void>((resolve) => {
      for (const at of [0, 60_000, 120_000]) clock.schedule(at, () => fired.push(at));
      clock.schedule(180_000, () => resolve());
    });
    expect(fired).toEqual([0, 60_000, 120_000]);
    expect(performance.now() - started).toBeLessThan(100);
  });

  it('switching to instant mid-gap fires the waiting row at once; switching back paces from there', () => {
    const clock = new ReplayClock({ speed: 1, maxGapMs: 10_000 });
    const start = Date.now();
    const fired: number[] = [];
    clock.schedule(0, () => fired.push(Date.now() - start));
    clock.schedule(5000, () => {
      fired.push(Date.now() - start);
      clock.setSpeed(1);
    });
    clock.schedule(6000, () => fired.push(Date.now() - start));
    vi.advanceTimersByTime(100);
    clock.setSpeed('instant');
    vi.advanceTimersByTime(0);
    expect(fired).toEqual([0, 100]);
    vi.advanceTimersByTime(999);
    expect(fired).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(fired).toEqual([0, 100, 1100]);
  });

  it('switching from instant back to a speed while a row waits paces that row from the switch', () => {
    const clock = new ReplayClock({ speed: 'instant', maxGapMs: 2000 });
    const fired = run(clock, [0, 1000]);
    clock.setSpeed(1); // before the event loop turned: nothing has fired yet
    vi.advanceTimersByTime(0);
    expect(fired).toEqual([0]);
    vi.advanceTimersByTime(1000);
    expect(fired).toEqual([0, 1000]);
  });

  it('stop drops every waiting row and ignores later schedules', () => {
    const clock = new ReplayClock({ speed: 1, maxGapMs: 2000 });
    const fired = run(clock, [0, 1000]);
    vi.advanceTimersByTime(0);
    clock.stop();
    clock.schedule(1500, () => fired.push(-1));
    vi.advanceTimersByTime(5000);
    expect(fired).toHaveLength(1);
    expect(clock.state).toBe('stopped');
  });
});
