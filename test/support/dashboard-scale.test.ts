// P3-E2 M6's measurement correction (parent Decision Log 42; the execution document's M6 "Acceptance seam and measurement
// definitions" and Decision Log 36): the scale gate's judging, free of Playwright. A timing row needs three admitted
// trials (started at a 1-minute load below 10) and every one within its bound, a trial at 10 or more never counting
// as met; the scroll row is the p95 of every admitted event pooled across trials, per-trial p95s information only, a
// long task over 50 ms failing it on its own; the renderer's memory is the first of two consecutive 10 s samples of
// its private footprint within 5 % of each other, within 60 s, never a forced collection's figure.
import { describe, expect, it } from 'vitest';
import { footprintMB, LOAD_BELOW, percentile, replacementInterval, scrollVerdict, settledMemory, timingVerdict } from '../../e2e/support/dashboard-scale';

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

describe('the renderer’s memory', () => {
  it('is the later of the first two consecutive samples within 5 %, within the samples a minute holds', () => {
    expect(settledMemory([600, 560, 530, 520])).toEqual({ settled: true, value: 520, index: 3 });
    expect(settledMemory([300, 300])).toEqual({ settled: true, value: 300, index: 1 });
    expect(settledMemory([600, 500, 400, 300, 200, 100, 50])).toEqual({ settled: false, value: null, index: -1 });
  });

  it('reads the private footprint footprint(1) reports, in MB', () => {
    expect(footprintMB('=====\nElectron Helper (Renderer) [80172]: 64-bit    Footprint: 412 MB (16384 bytes per page)\n=====')).toBe(412);
    expect(footprintMB('zsh [39185]: 64-bit    Footprint: 2096 KB (16384 bytes per page)')).toBeCloseTo(2.05, 2);
    expect(footprintMB('x [1]: 64-bit    Footprint: 1.25 GB (16384 bytes per page)')).toBe(1280);
    expect(() => footprintMB('no footprint here')).toThrow(/footprint/);
  });

  it('takes percentiles by rank', () => {
    expect(percentile([5, 1, 3, 2, 4], 0.95)).toBe(5);
    expect(percentile([5, 1, 3, 2, 4], 0.5)).toBe(3);
    expect(Number.isNaN(percentile([], 0.95))).toBe(true);
  });
});
