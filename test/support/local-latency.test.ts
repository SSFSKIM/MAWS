import { describe, expect, it } from 'vitest';
import { baselineProblems, BENCH, budgetMisses, clockCheck, invalidReasons, LOCAL_LATENCY_BASELINE, latencyLine, nearestRank, OX7_BUDGET_MS, summarize } from './local-latency';

describe('the bench statistics (P5 O1, M1)', () => {
  it('reads p50 and p95 by nearest rank: the smallest sample at or above that share of the samples', () => {
    const hundred = Array.from({ length: 100 }, (_, k) => 100 - k); // 100 … 1, unsorted on purpose
    expect(summarize(hundred, 0)).toEqual({ p50: 50, p95: 95, n: 100 });
    expect(nearestRank([1, 2, 3], 50)).toBe(2); // ceil(1.5) = 2nd
    expect(nearestRank([1, 2, 3], 95)).toBe(3);
    expect(nearestRank([7], 50)).toBe(7);
    expect(summarize([4.25, 1.5], 0)).toEqual({ p50: 1.5, p95: 4.25, n: 2 });
  });

  it('discards the warm-up samples from the front before ranking', () => {
    const samples = [90, 80, 70, ...Array.from({ length: 20 }, (_, k) => k + 1)];
    expect(summarize(samples, 3)).toEqual({ p50: 10, p95: 19, n: 20 });
    expect(() => summarize([1, 2], 2)).toThrow(/no samples/);
  });

  it('refuses a negative sample after the warm-up, naming how many', () => {
    expect(() => summarize([1, -0.2, 3, -4], 0)).toThrow(/2 negative samples/);
    expect(summarize([-1, 2, 3], 1)).toEqual({ p50: 2, p95: 3, n: 2 }); // a warm-up sample is never a sample
  });

  it('calls a run invalid below 95% of its markers, for a turn missing a marker, a failed clock check or a negative sample, saying which', () => {
    const clock = { ok: true, widthMs: 0.4, offsetMs: 0.1, offsetRangeMs: [-0.1, 0.3] as [number, number] };
    const expected = BENCH.markersPerTurn * (BENCH.turns - BENCH.warmupTurns);
    expect(expected).toBe(600);
    const samples = (n: number) => Array.from({ length: n }, () => 5);
    expect(invalidReasons({ samples: samples(570), expected, missing: [], clock })).toEqual([]);
    expect(invalidReasons({ samples: samples(569), expected, missing: [], clock })).toEqual(['569 samples of 600, under the floor of 570 (95%)']);
    expect(invalidReasons({ samples: samples(600), expected, missing: [{ turn: 3, markers: ['⟦t3:12⟧', '⟦t3:300⟧'] }], clock })).toEqual(['turn 3 lacks 2 of its markers after it completed (⟦t3:12⟧, ⟦t3:300⟧)']);
    expect(invalidReasons({ samples: samples(600), expected, missing: [], clock: { ok: false, widthMs: 0.5, offsetMs: 1.75, offsetRangeMs: [1.5, 2] } })).toEqual([
      "the renderer's clock is not shown within ±1 ms of the runner's: its offset lies in [1.5, 2] ms (tightest bracket 0.5 ms)",
    ]);
    expect(invalidReasons({ samples: [...samples(599), -0.3], expected, missing: [], clock })).toEqual(['1 negative sample']);
  });
});

describe('the clock check', () => {
  it('reads the tightest bracket, and passes when every offset it allows is within ±1 ms', () => {
    const brackets = [
      { before: 1_000, renderer: 1_003.5, after: 1_004 }, // width 4
      { before: 2_000, renderer: 2_000.5, after: 2_000.75 }, // width 0.75, the tightest: offsets [-0.25, 0.5]
      { before: 3_000, renderer: 3_001, after: 3_002 },
    ];
    expect(clockCheck(brackets)).toEqual({ ok: true, widthMs: 0.75, offsetMs: 0.125, offsetRangeMs: [-0.25, 0.5] });
    expect(clockCheck([{ before: 10, renderer: 9.25, after: 10.25 }])).toMatchObject({ ok: true, offsetRangeMs: [-1, -0.75] }); // read before the bracket, within the tolerance
  });

  it('fails a bracket whose possible offsets leave ±1 ms, so a wide bracket is inconclusive whatever the renderer read', () => {
    // inside the bracket, yet the true offset could be anywhere from -2 to +8 ms
    expect(clockCheck([{ before: 100, renderer: 108, after: 110 }])).toMatchObject({ ok: false, offsetRangeMs: [-2, 8] });
    // a 2.5 ms bracket read at its midpoint still allows ±1.25 ms
    expect(clockCheck([{ before: 0, renderer: 1.25, after: 2.5 }])).toMatchObject({ ok: false, offsetRangeMs: [-1.25, 1.25] });
    // read 1.5 ms after the runner's later read
    expect(clockCheck([{ before: 10, renderer: 12.5, after: 11 }])).toMatchObject({ ok: false, offsetRangeMs: [1.5, 2.5] });
  });

  it('holds its boundaries: an offset range ending at exactly ±1 ms passes, one a little past it fails', () => {
    expect(clockCheck([{ before: 0, renderer: 1, after: 2 }])).toMatchObject({ ok: true, offsetRangeMs: [-1, 1] }); // a 2 ms bracket, read at its midpoint
    expect(clockCheck([{ before: 0, renderer: 1.0625, after: 2 }])).toMatchObject({ ok: false, offsetRangeMs: [-0.9375, 1.0625] });
    expect(clockCheck([{ before: 5, renderer: 6, after: 5 }])).toMatchObject({ ok: true, offsetRangeMs: [1, 1] }); // a zero-width bracket
    expect(clockCheck([{ before: 5, renderer: 3.9375, after: 5 }])).toMatchObject({ ok: false, offsetRangeMs: [-1.0625, -1.0625] });
  });
});

describe('the budget (OX7)', () => {
  const baseline = {
    commit: 'ecd9b047f', appTree: 'c3507722d' as const, runs: ['1', '2', '3'],
    deltaToFrame: { p50: 6, p95: 10, n: 600, spreadP50: 0.4, spreadP95: 1.1 },
    roundTrip: { p50: 2, p95: 3, n: 200, spreadP50: 0.1, spreadP95: 0.3 },
  };

  it('is 2 ms at p50 and 5 ms at p95 over the baseline', () => {
    expect(OX7_BUDGET_MS).toEqual({ p50: 2, p95: 5 });
  });

  it('a baseline is three distinct runs of the whole bench at the app of c3507722d, each metric ranked and its spread non-negative', () => {
    expect(baselineProblems(null)).toEqual([]); // not yet recorded: nothing to hold
    expect(baselineProblems(baseline)).toEqual([]);
    expect(baselineProblems({
      ...baseline, commit: 'HEAD', runs: ['1', '1'],
      deltaToFrame: { ...baseline.deltaToFrame, n: 569, p95: 5 },
      roundTrip: { ...baseline.roundTrip, n: 220, spreadP95: -0.1 },
    })).toEqual([
      'commit HEAD is not a sha',
      'runs [1, 1] are not three distinct run ids',
      'delta-to-frame n 569 is under the floor of 570',
      'delta-to-frame p95 5 is under its p50 6',
      'round trip n 220 is not 200',
      'round trip spreadP95 -0.1 is negative',
    ]);
  });

  // The recorded baseline itself, once the commit that records it (touching only local-latency.ts) lands; until then the
  // case is reported as skipped, not passed.
  it.skipIf(LOCAL_LATENCY_BASELINE === null)('the recorded baseline is well formed', () => {
    expect(baselineProblems(LOCAL_LATENCY_BASELINE)).toEqual([]);
  });

  it('names each metric over its budget and passes one exactly at it', () => {
    expect(budgetMisses({ deltaToFrame: { p50: 8, p95: 15, n: 600 }, roundTrip: { p50: 4, p95: 8, n: 200 } }, baseline)).toEqual([]);
    expect(budgetMisses({ deltaToFrame: { p50: 8.1, p95: 15, n: 600 }, roundTrip: { p50: 2, p95: 8.4, n: 200 } }, baseline)).toEqual([
      'delta-to-frame p50 8.1 ms over the baseline 6 ms + 2 ms',
      'round trip p95 8.4 ms over the baseline 3 ms + 5 ms',
    ]);
    expect(budgetMisses({ deltaToFrame: { p50: 99, p95: 99, n: 600 }, roundTrip: { p50: 99, p95: 99, n: 200 } }, null)).toEqual([]);
  });
});

describe('the printed line', () => {
  it('reads as acceptance 1 quotes it', () => {
    expect(latencyLine({ deltaToFrame: { p50: 6.84, p95: 11.2, n: 598 }, expected: 600, roundTrip: { p50: 1.9, p95: 3.41, n: 200 }, load: 2.06 })).toBe(
      '[local-latency] delta-to-frame p50 6.8 ms p95 11.2 ms (n=598 of 600) · round trip p50 1.9 ms p95 3.4 ms (n=200) · load 2.1',
    );
  });
});
