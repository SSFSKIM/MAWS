// P3-E2 M6's measurement correction (parent Decision Log 42; the execution document's M6 "Acceptance seam and measurement
// definitions" and Decision Log 36): the scale gate's judging, free of Playwright. A timing row needs three admitted
// trials (started at a 1-minute load below 10) and every one within its bound, a trial at 10 or more never counting
// as met; the scroll row is the p95 of every admitted event pooled across trials, per-trial p95s information only, a
// long task over 50 ms failing it on its own; the renderer's memory is its documented private memory, the later of the
// first two 10 s-spaced samples within 5 % completed within 60 s of the first one's start, every sample admitted below
// load 10, never a forced collection's figure.
import { describe, expect, it } from 'vitest';
import { LOAD_BELOW, memoryVerdict, percentile, privateMB, replacementInterval, scrollVerdict, timingVerdict } from '../../e2e/support/dashboard-scale';

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

describe('the renderer’s memory (parent Decision Log 42(5))', () => {
  // a sample: when it started and completed (ms from the first sample's start), the 1-minute load as it started, the
  // renderer's private memory in MB
  const sample = (startedAt: number, completedAt: number, mb: number, load = 3) => ({ startedAt, completedAt, load, mb });

  it('is met by the later of the first two 10 s-spaced samples within 5 %, both completed within 60 s of the first one’s start', () => {
    expect(memoryVerdict([sample(0, 40, 520), sample(10_000, 10_040, 480), sample(20_000, 20_050, 470)], 500)).toMatchObject({ verdict: 'met', value: 470 });
    expect(memoryVerdict([sample(0, 40, 300), sample(10_000, 10_030, 301)], 500)).toMatchObject({ verdict: 'met', value: 301 });
  });

  it('fails a settled value over the bound', () => {
    expect(memoryVerdict([sample(0, 40, 555), sample(10_000, 10_040, 556)], 500)).toMatchObject({ verdict: 'failed', value: 556 });
  });

  it('is hardware-blocked by any sample started at load 10 or more, even a stable low pair: never met afterwards', () => {
    expect(memoryVerdict([sample(0, 40, 300), sample(10_000, 10_040, 300, 11)], 500)).toMatchObject({ verdict: 'hardware-blocked' });
    expect(memoryVerdict([sample(0, 40, 300, 12), sample(10_000, 10_040, 300), sample(20_000, 20_040, 300)], 500)).toMatchObject({ verdict: 'hardware-blocked' });
  });

  it('admits no pair completed after the 60 s deadline: a stable pair whose later sample completes late is unsettled', () => {
    const drifting = [600, 540, 480, 420, 360, 300].map((mb, k) => sample(k * 10_000, k * 10_000 + 50, mb));
    expect(memoryVerdict([...drifting, sample(60_000, 60_001, 299)], 500)).toMatchObject({ verdict: 'unsettled', value: null });
    // the same pair completing on time settles
    expect(memoryVerdict([...drifting, sample(59_900, 59_990, 299)], 500)).toMatchObject({ verdict: 'met', value: 299 });
  });

  it('is unsettled when no two consecutive samples come within 5 % before the deadline', () => {
    expect(memoryVerdict([600, 500, 400, 300, 200, 100, 50].map((mb, k) => sample(k * 10_000, k * 10_000 + 50, mb)), 500)).toMatchObject({ verdict: 'unsettled', value: null, reason: expect.stringMatching(/within 5 %/) });
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
