// The measured specs' quiet admission (e2e/support/quiet.ts; P4 tracker row 2026-10-18, the measured-run quiet admission
// protocol), on a fake clock and load: a spec's first trial is admitted once two consecutive reads of the 1-minute load,
// 30 s apart, each read under 5 (gate-offload Decision Log 75, the rule ci-kit's measured-job guard applies before the
// checkout); the wait is bounded, and on its expiry the trials still run, the record saying so.
import { describe, expect, it } from 'vitest';
import { QUIET_BUDGET_MS, QUIET_LOAD_BELOW, QUIET_READ_EVERY_MS, quietWait, type QuietClock } from '../../e2e/support/quiet';

/** A clock whose loads are read in order (the last repeated), and whose sleeps advance time by what was asked plus `overshoot(k)`. */
function fake(loads: number[], overshoot: (k: number) => number = () => 0): QuietClock & { slept: number[] } {
  let t = 1_000_000;
  let read = 0;
  const slept: number[] = [];
  return {
    slept,
    now: () => t,
    sleep: async (ms) => {
      slept.push(ms);
      t += ms + overshoot(slept.length - 1);
    },
    load: () => loads[Math.min(read++, loads.length - 1)]!,
  };
}

describe('the quiet admission', () => {
  it('reads the gate lane’s rule: under 5, two reads 30 s apart, within three minutes by default', () => {
    expect([QUIET_LOAD_BELOW, QUIET_READ_EVERY_MS, QUIET_BUDGET_MS]).toEqual([5, 30_000, 180_000]);
  });

  it('admits on the second of two consecutive reads under 5, 30 s after the first', async () => {
    const admission = await quietWait({ clock: fake([3.2, 4.1]) });
    expect(admission).toMatchObject({ quiet: true, waitedMs: 30_000, startLoad: 3.2, endLoad: 4.1, reads: [{ atMs: 0, load: 3.2 }, { atMs: 30_000, load: 4.1 }] });
    expect(admission.summary).toMatch(/quiet after 30 s/);
  });

  it('starts the pair again after a read at or over 5, which is not under it', async () => {
    expect(await quietWait({ clock: fake([4, 5, 4.99, 2]) })).toMatchObject({ quiet: true, waitedMs: 90_000, startLoad: 4, endLoad: 2 });
    expect(await quietWait({ clock: fake([6, 4, 7, 4, 4]) })).toMatchObject({ quiet: true, waitedMs: 120_000 });
  });

  it('keeps every two reads at least 30 s apart, however late a sleep wakes', async () => {
    const clock = fake([4, 9, 4, 4], (k) => (k === 0 ? 10_000 : 0));
    const admission = await quietWait({ clock });
    expect(admission.reads.map((r) => r.atMs)).toEqual([0, 40_000, 70_000, 100_000]);
    expect(clock.slept).toEqual([30_000, 30_000, 30_000]);
  });

  it('on the budget’s expiry admits the trials anyway, not quiet, with no read after the budget and every read kept', async () => {
    const admission = await quietWait({ budgetMs: 75_000, clock: fake([9, 8, 7, 1, 1]) });
    expect(admission).toMatchObject({ quiet: false, waitedMs: 60_000, budgetMs: 75_000, startLoad: 9, endLoad: 7, reads: [{ atMs: 0, load: 9 }, { atMs: 30_000, load: 8 }, { atMs: 60_000, load: 7 }] });
    expect(admission.summary).toMatch(/not quiet within 75 s.*the trials run/);
    // a read under 5 on the budget's last read is not a pair on its own
    expect(await quietWait({ budgetMs: 60_000, clock: fake([6, 6, 4, 4]) })).toMatchObject({ quiet: false, waitedMs: 60_000, endLoad: 4 });
    // the default budget: a machine that never quiets is read seven times, over three minutes
    const loud = await quietWait({ clock: fake([12]) });
    expect(loud).toMatchObject({ quiet: false, waitedMs: 180_000 });
    expect(loud.reads).toHaveLength(7);
    // a sleep that wakes past the budget reads nothing more: the pair it would have completed is not admitted
    const lateWake = await quietWait({ clock: fake([9, 9, 9, 9, 9, 4, 4], (k) => (k === 5 ? 1_000 : 0)) });
    expect(lateWake).toMatchObject({ quiet: false, waitedMs: 181_000, endLoad: 4 });
    expect(lateWake.reads.map((r) => r.atMs)).toEqual([0, 30_000, 60_000, 90_000, 120_000, 150_000]);
  });

  it('records the rule it applied and when it started', async () => {
    const admission = await quietWait({ clock: fake([1, 1]) });
    expect(admission.rule).toMatch(/under 5 .*30 s apart.*180 s.*Decision Log 75/);
    expect(admission.startedAt).toBe(new Date(1_000_000).toISOString());
  });
});
