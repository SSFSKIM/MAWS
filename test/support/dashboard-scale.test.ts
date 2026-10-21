// P3-E2 M6's measurement correction (parent Decision Log 42; the execution document's M6 "Acceptance seam and measurement
// definitions" and Decision Log 36): the scale gate's judging, free of Playwright. A timing row needs three admitted
// trials (started at a 1-minute load below 10) and every one within its bound, a trial at 10 or more never counting
// as met; the scroll row is the p95 of every admitted event pooled across trials, per-trial p95s information only, a
// long task over 50 ms failing it on its own; the renderer's memory is its documented private memory, the later of the
// first two 10 s-spaced samples within 5 % completed within 60 s of the first one's start, every sample admitted below
// load 10, never a forced collection's figure.
import { describe, expect, it } from 'vitest';
import { LOAD_BELOW, MEMORY_FLOOR_MS, MEMORY_LAST_MARK_MS, MEMORY_LATE_MS, MEMORY_SPACING_MS, memoryVerdict, percentile, privateMB, replacementInterval, scrollVerdict, timingVerdict } from '../../e2e/support/dashboard-scale';

const at = (load: number) => (value: number) => ({ value, load });

describe('a timing row', () => {
  it('is met only when three admitted trials are each within the bound', () => {
    expect(timingVerdict([10, 20, 30].map(at(3)), 30)).toMatchObject({ verdict: 'met', admitted: 3 });
    // one admitted trial over the bound fails the row, whatever the median or the best
    expect(timingVerdict([10, 20, 31].map(at(3)), 30)).toMatchObject({ verdict: 'failed', reason: expect.stringMatching(/31 .* over 30/) });
  });

  it('never counts a trial started at load 10 or more: fewer than three admitted is hardware-blocked, not met', () => {
    expect(LOAD_BELOW).toBe(10);
    const trials = [at(3)(10), at(12)(10), at(4)(10)];
    expect(timingVerdict(trials, 30)).toMatchObject({ verdict: 'hardware-blocked', admitted: 2 });
    // an excluded trial over the bound is not a product failure either
    expect(timingVerdict([at(3)(10), at(3)(11), at(15)(999), at(3)(12)], 30)).toMatchObject({ verdict: 'met', admitted: 3 });
    // a failed admitted trial still fails the row, however many trials were excluded
    expect(timingVerdict([at(3)(31), at(11)(1), at(11)(1)], 30)).toMatchObject({ verdict: 'failed' });
  });

  it('records a row with no bound', () => {
    expect(timingVerdict([at(3)(5)], null)).toMatchObject({ verdict: 'recorded' });
  });
});

describe('the replacement interval', () => {
  it('runs from the first observed post-write revision announcement to the last view painted; missing or negative fails by name', () => {
    expect(replacementInterval(1_000, 1_250)).toEqual({ ok: true, value: 250 });
    expect(replacementInterval(undefined, 1_250)).toEqual({ ok: false, reason: expect.stringMatching(/no post-write revision announcement/) });
    expect(replacementInterval(1_300, 1_250)).toEqual({ ok: false, reason: expect.stringMatching(/painted 50 ms before/) });
  });
});

describe('the scroll row', () => {
  const trial = (work: number[], load = 3, longTasks: number[] = []) => ({ work, load, longTasks });

  it('gates the p95 of every admitted event pooled across trials, a trial’s own p95 only information', () => {
    // two quiet trials and one whose p95 alone would miss: pooled, 95 % of the 300 events are within 16 ms
    const quiet = Array.from({ length: 100 }, () => 2);
    const loud = [...Array.from({ length: 85 }, () => 2), ...Array.from({ length: 15 }, () => 30)];
    const judged = scrollVerdict([trial(quiet), trial(quiet), trial(loud)], 16);
    expect(judged.perTrialP95).toEqual([2, 2, 30]);
    expect(judged.pooledP95).toBe(2);
    expect(judged.verdict).toBe('met');
    // pooled over the bound fails, though two trials alone are within it
    const worse = [...Array.from({ length: 40 }, () => 2), ...Array.from({ length: 60 }, () => 30)];
    expect(scrollVerdict([trial(quiet), trial(quiet), trial(worse)], 16)).toMatchObject({ verdict: 'failed', pooledP95: 30 });
  });

  it('fails on any long task over 50 ms by itself, and is hardware-blocked with fewer than three admitted trials', () => {
    const quiet = Array.from({ length: 100 }, () => 2);
    expect(scrollVerdict([trial(quiet), trial(quiet, 3, [12, 51]), trial(quiet)], 16)).toMatchObject({ verdict: 'failed', reason: expect.stringMatching(/long task .*51/) });
    expect(scrollVerdict([trial(quiet), trial(quiet, 11), trial(quiet)], 16)).toMatchObject({ verdict: 'hardware-blocked' });
    // a long task during an excluded trial still fails: a long task is the product's whatever the load
    expect(scrollVerdict([trial(quiet), trial(quiet, 11, [80]), trial(quiet), trial(quiet)], 16)).toMatchObject({ verdict: 'failed' });
    expect(scrollVerdict([trial([]), trial([]), trial([])], 16)).toMatchObject({ verdict: 'failed', reason: expect.stringMatching(/no scroll event/) });
  });
});

describe('the renderer’s memory (parent Decision Log 42(5), amended)', () => {
  // a sample: when it started and completed (ms from the first sample's start), the 1-minute load as it started, the
  // renderer's private memory in MB
  const sample = (startedAt: number, completedAt: number, mb: number, load = 3) => ({ startedAt, completedAt, load, mb });
  // the seven samples on the 10 s marks 0 through 60, each completing `overhead` ms after its start
  const marks = (mbs: readonly number[], overhead = 40, loads: readonly number[] = []) => mbs.map((mb, k) => sample(k * MEMORY_SPACING_MS, k * MEMORY_SPACING_MS + overhead, mb, loads[k] ?? 3));

  it('schedules seven samples, on the 10 s marks 0 through 60 inclusive, deciding from 30 s', () => {
    expect([MEMORY_SPACING_MS, MEMORY_FLOOR_MS, MEMORY_LAST_MARK_MS]).toEqual([10_000, 30_000, 60_000]);
  });

  it('never admits a pair with a sample started before 30 s: the old 0/10 s pair is not the figure', () => {
    // run 39003524044's early pair, 503.6 and 505.7 MB at 0 and 10 s, settled and failed under the then-current policy;
    // under the amendment the first pair both started at or after 30 s decides (20/30 s is within 5 % too, but early)
    expect(memoryVerdict(marks([503.6, 505.7, 470, 450, 452, 460, 455]), 500)).toMatchObject({ verdict: 'met', value: 452 });
    // nor does a low early pair pass a row that grows afterwards
    expect(memoryVerdict(marks([300, 301, 302, 560, 600, 700, 800]), 500)).toMatchObject({ verdict: 'failed', value: 800 });
  });

  it('is decided by the later sample of the first consecutive pair from 30 s within 5 %, met or failed at the bound', () => {
    expect(memoryVerdict(marks([600, 560, 520, 480, 470, 300, 200]), 500)).toMatchObject({ verdict: 'met', value: 470 });
    expect(memoryVerdict(marks([600, 560, 520, 515, 512, 300, 200]), 500)).toMatchObject({ verdict: 'failed', value: 512, reason: expect.stringMatching(/512\.0 MB over 500 MB/) });
    // a later pair decides when 30/40 s is not within 5 %
    expect(memoryVerdict(marks([600, 560, 520, 400, 470, 471, 200]), 500)).toMatchObject({ verdict: 'met', value: 471 });
  });

  it('takes the sample started at the 60 s mark when no pair from 30 s settles, whatever its completion overhead', () => {
    const drifting = [600, 540, 480, 420, 360, 300];
    expect(memoryVerdict([...marks(drifting), sample(60_000, 61_500, 240)], 500)).toMatchObject({ verdict: 'met', value: 240, reason: expect.stringMatching(/60 s/) });
    expect(memoryVerdict(marks([300, 300, 300, 400, 450, 520, 600]), 500)).toMatchObject({ verdict: 'failed', value: 600 });
    // the 60 s sample started a little after its mark (a sample's overhead delays nothing scheduled) is still the one
    expect(memoryVerdict([...marks(drifting, 900), sample(60_030, 60_950, 499)], 500)).toMatchObject({ verdict: 'met', value: 499 });
  });

  it('is unsettled, never met, when no pair from 30 s settles and no sample started at the 60 s mark', () => {
    expect(memoryVerdict(marks([600, 540, 480, 420, 360, 300]), 500)).toMatchObject({ verdict: 'unsettled', value: null, reason: expect.stringMatching(/60 s/) });
  });

  it('is hardware-blocked by any sample started at load 10 or more, the deciding pair’s, an early one’s or one after it', () => {
    const flat = [300, 300, 300, 300, 300, 300, 300];
    expect(memoryVerdict(marks(flat, 40, [11]), 500)).toMatchObject({ verdict: 'hardware-blocked', value: null });
    expect(memoryVerdict(marks(flat, 40, [3, 3, 3, 10]), 500)).toMatchObject({ verdict: 'hardware-blocked' });
    expect(memoryVerdict(marks(flat, 40, [3, 3, 3, 3, 3, 3, 12]), 500)).toMatchObject({ verdict: 'hardware-blocked', reason: expect.stringMatching(/12/) });
    // an over-limit figure under load is blocked, not a product failure
    expect(memoryVerdict(marks([600, 600, 600, 600, 600, 600, 600], 40, [3, 3, 3, 3, 3, 15]), 500)).toMatchObject({ verdict: 'hardware-blocked' });
  });

  it('keeps a sample started more than 1 s after its mark out of the deciding pair only, every sample kept and the excluded named (P3-F L249)', () => {
    expect(MEMORY_LATE_MS).toBe(1_000);
    // a slow read delays the 40 s sample 1.2 s past its mark: 30/40 s (within 5 %) cannot decide, nor 40/50 s; 50/60 s does
    const late = [...marks([600, 560, 520, 480]), sample(41_200, 41_250, 482), ...[490, 492].map((mb, k) => sample((5 + k) * MEMORY_SPACING_MS, (5 + k) * MEMORY_SPACING_MS + 40, mb))];
    const verdict = memoryVerdict(late, 500);
    expect(verdict).toMatchObject({ verdict: 'met', value: 492, excluded: [{ mark: 40_000, startedAt: 41_200, mb: 482 }] });
    expect(verdict.reason).toMatch(/40 s mark.*41\.2 s.*482\.0 MB/);
    expect(late).toHaveLength(7); // the input is never trimmed
    // exactly 1 s late is not late
    expect(memoryVerdict([...marks([600, 560, 520, 480]), sample(41_000, 41_050, 482), ...[300, 200].map((mb, k) => sample((5 + k) * MEMORY_SPACING_MS, (5 + k) * MEMORY_SPACING_MS + 40, mb))], 500)).toMatchObject({ verdict: 'met', value: 482, excluded: [] });
    // the catch-up burst after a slow read: the 50 s sample starts at 61.5 s, right after the slow 40 s one; neither
    // decides a pair, and the 60 s figure is the sample on the 60 s mark, never the late 50 s one that started after 60 s
    const burst = [...marks([600, 560, 520, 400]), sample(40_000, 61_400, 512), sample(61_500, 61_540, 300), sample(61_600, 61_640, 700)];
    expect(memoryVerdict(burst, 500)).toMatchObject({ verdict: 'failed', value: 700, excluded: [{ mark: 50_000, startedAt: 61_500, mb: 300 }, { mark: 60_000, startedAt: 61_600, mb: 700 }] });
    // an excluded sample vetoes nothing: a later qualifying pair still decides
    expect(memoryVerdict([...marks([600, 560, 520, 470]), sample(42_000, 42_040, 900), sample(50_000, 50_040, 471), sample(60_000, 60_040, 472)], 500)).toMatchObject({ verdict: 'met', value: 472 });
    // load still blocks on every sample, the excluded ones included
    expect(memoryVerdict([...marks([600, 560, 520, 470]), sample(42_000, 42_040, 471, 12), sample(50_000, 50_040, 471), sample(60_000, 60_040, 472)], 500)).toMatchObject({ verdict: 'hardware-blocked' });
  });

  it('compares the raw samples and rounds only the figure it reports, to 0.1 MB', () => {
    // 9.96 and 10.54 MB differ by 0.58 MB, over 5 % of 10.54; as 10.0 and 10.5 they would differ by 0.5, within 5 % of
    // 10.5, and settle the row at 40 s
    const judged = memoryVerdict(marks([14, 13, 12, 9.96, 10.54, 10.56, 10.58]), 500);
    expect(judged).toMatchObject({ verdict: 'met', value: 10.6, reason: expect.stringMatching(/40\.0 s and 50\.0 s/) });
    // the bound too is judged on the raw figure: 500.04 MB is over 500 MB though it reports as 500.0
    expect(memoryVerdict(marks([600, 560, 520, 500.02, 500.04, 300, 200]), 500)).toMatchObject({ verdict: 'failed', value: 500 });
    // an excluded sample is named at the report's precision
    const late = memoryVerdict([...marks([600, 560, 520, 480]), sample(41_200, 41_250, 482.04), ...[490, 492].map((mb, k) => sample((5 + k) * MEMORY_SPACING_MS, (5 + k) * MEMORY_SPACING_MS + 40, mb))], 500);
    expect(late.excluded).toEqual([{ mark: 40_000, startedAt: 41_200, mb: 482 }]);
  });

  it('takes the renderer’s private kilobytes as MB, refusing what is not a finite non-negative number', () => {
    expect(privateMB({ private: 512_000 })).toBe(500);
    for (const bad of [{ private: -1 }, { private: Number.NaN }, { private: Number.POSITIVE_INFINITY }, {}, null, undefined, { private: '512000' }]) expect(() => privateMB(bad), JSON.stringify(bad)).toThrow(/private/);
  });

  it('takes percentiles by rank', () => {
    expect(percentile([5, 1, 3, 2, 4], 0.95)).toBe(5);
    expect(percentile([5, 1, 3, 2, 4], 0.5)).toBe(3);
    expect(Number.isNaN(percentile([], 0.95))).toBe(true);
  });
});
