// The remote bench's numbers (test/support/remote-latency.ts; P5 O7 M7, acceptance 3): each carrier's bounds from the
// same run's local numbers and its own round trip, the misses named, and the run's validity (the local bench's per case,
// the pings, Rule B on the load).
import { describe, expect, it } from 'vitest';
import { markerOf } from './latency-engine';
import { boundsOf, budgetMisses, clockEstimate, delaysOf, engineStartOf, clockVoid, deltaVerdict, EXPECTED_MARKERS, invalidReasons, liveClock, liveJudgement, loadVerdict, measureResume, remoteLine, rttStats, signedStats, type CaseRun, type Measures, type RemoteMeasures, type ResumeSteps } from './remote-latency';

const stats = (p50: number, p95 = p50, n = 600) => ({ p50, p95, n });
const LOCAL: Measures = { deltaToFrame: stats(24.5, 37.5), roundTrip: stats(0.9, 1.3, 200), openToFirstRowMs: 180, resumeMs: null, engineStartMs: 420 };
const clock = { ok: true, widthMs: 0.4, offsetMs: 0.1, offsetRangeMs: [-0.1, 0.3] as [number, number] };
const valid = (): CaseRun => ({ samples: Array.from({ length: EXPECTED_MARKERS }, () => 25), expected: EXPECTED_MARKERS, missing: [], clock });

describe('the remote bench (P5 O7 M7)', () => {
  it('reads the link’s round trip as each pong’s arrival less its ping’s send', () => {
    const exchanges = [3, 1, 2, 2].map((d, i) => ({ at: 1000 * i, received: null, sent: null, arrived: 1000 * i + d }));
    expect(rttStats(exchanges)).toEqual({ p50: 2, p95: 3, n: 4 });
  });

  it('reads the local engine start less the observation’s hops, never more than observed, so the resume allowance only narrows', () => {
    expect(engineStartOf(420, 3)).toBe(417);
    expect(engineStartOf(2, 3)).toBe(0);
    expect(engineStartOf(420, -1)).toBe(420);
    for (const hop of [0, 0.5, 7]) expect(boundsOf({ ...LOCAL, engineStartMs: engineStartOf(420, hop) }, stats(1)).resumeMs).toBeLessThanOrEqual(boundsOf({ ...LOCAL, engineStartMs: 420 }, stats(1)).resumeMs);
  });

  it('bounds a carrier by the same run’s local numbers and its own round trip (acceptance 3)', () => {
    expect(boundsOf(LOCAL, stats(4))).toEqual({ deltaToFrameP50Ms: 24.5 + 4 + 10, roundTripP50Ms: 2 * 4 + 20, openToFirstRowMs: 1500, resumeMs: 420 + 4 });
  });

  it('names each bound a carrier misses, and none when it holds them all, a value at its bound holding', () => {
    const bounds = boundsOf(LOCAL, stats(1));
    const at: RemoteMeasures = { deltaToFrame: stats(35.5), roundTrip: stats(22), openToFirstRowMs: 1500, resumeMs: 421, engineStartMs: 400, rtt: stats(1) };
    expect(budgetMisses('direct', at, bounds)).toEqual([]);
    const over: RemoteMeasures = { ...at, deltaToFrame: stats(35.6), roundTrip: stats(22.5), openToFirstRowMs: 1501, resumeMs: 900 };
    expect(budgetMisses('relay', over, bounds)).toEqual([
      'relay: delta-to-frame p50 35.6 ms over its bound 35.5 ms',
      'relay: round trip p50 22.5 ms over its bound 22 ms',
      'relay: open to first row 1501 ms over its bound 1500 ms',
      'relay: resume 900 ms over its bound 421 ms',
    ]);
  });

  it('holds each case to the local bench’s validity, naming the case, and every carrier to its hundred pings', () => {
    const cases = { local: valid(), direct: valid(), relay: valid() };
    expect(invalidReasons({ cases, pings: { direct: 100, relay: 100 }, loads: [1, 1, 1] })).toEqual([]);
    const short = { ...valid(), samples: valid().samples.slice(0, 500) };
    expect(invalidReasons({ cases: { ...cases, relay: short, direct: null }, pings: { direct: 100, relay: 97 }, loads: [1] })).toEqual([
      'direct: not measured',
      'relay: 500 samples of 600, under the floor of 570 (95%)',
      'relay: 97 of 100 pings answered',
    ]);
  });

  it('voids the run on load by Rule B: a peak of 5 with a 30 s pair of 4.7, never a burst under it', () => {
    expect(loadVerdict([2, 2.2, 2.4])).toMatchObject({ peak: 2.4, void: false });
    const burst = [1, 5.2, 3.2, 2]; // one interval's spike: the pair stays low
    expect(loadVerdict(burst).void).toBe(false);
    const sustained = [5, 6, 6.5, 6.8];
    expect(loadVerdict(sustained)).toMatchObject({ void: true });
    expect(invalidReasons({ cases: { local: valid(), direct: valid(), relay: valid() }, pings: { direct: 100, relay: 100 }, loads: sustained })).toEqual([expect.stringMatching(/^the machine's load: peak 6\.8 at or over 5, 30 s pair \d+\.\d at or over 4\.7 \(Rule B\)$/)]);
  });

  it('keeps the terminal reading out of the 30 s pair, which assumes the spacing, and in the peak', () => {
    const regular = [1, 1.2, 1.1, 1.3];
    // the run ended 4 s after the last sample: read as a 30 s interval, its rise would rebuild a sustained load
    const verdict = loadVerdict(regular, 6.5);
    expect(verdict.pair).toBe(loadVerdict(regular).pair);
    expect(verdict.pair!).toBeLessThan(4.7);
    expect(verdict).toMatchObject({ peak: 6.5, void: false });
    expect(loadVerdict([...regular, 6.5]).pair!).toBeGreaterThan(loadVerdict(regular).pair!); // what folding it in would read
  });

  it('skips the resume bound of a carrier whose recovery came back over another, and carries the note as a reason', () => {
    const bounds = boundsOf(LOCAL, stats(1));
    const voided: RemoteMeasures = { deltaToFrame: stats(30), roundTrip: stats(5), openToFirstRowMs: 200, resumeMs: null, engineStartMs: 400, rtt: stats(1) };
    expect(budgetMisses('direct', voided, bounds)).toEqual([]);
    const cases = { local: valid(), direct: valid(), relay: valid() };
    expect(invalidReasons({ cases, pings: { direct: 100, relay: 100 }, loads: [1, 1, 1], notes: ['direct: the first event after the gap came with the link up/relay, so its resume is not direct’s'] })).toEqual(['direct: the first event after the gap came with the link up/relay, so its resume is not direct’s']);
  });

  it('prints one line per case, the carrier’s round trip and resume beside its numbers', () => {
    expect(remoteLine('local', LOCAL)).toBe('[remote-latency] local: delta-to-frame p50 24.5 ms p95 37.5 ms (n=600) · round trip p50 0.9 ms p95 1.3 ms · open to first row 180.0 ms · engine start 420.0 ms');
    expect(remoteLine('direct', { ...LOCAL, resumeMs: 61, rtt: stats(1, 2, 100) })).toContain('· resume 61.0 ms · engine start 420.0 ms · rtt p50 1.0 ms (n=100)');
  });
});

describe('the live bench’s clock (P5 O7 M7)', () => {
  // the machine's clock 1000 ms ahead of this Mac's; each exchange's way out `up` and back `down` milliseconds
  const exchange = (at: number, up: number, down: number, offset = 1000) => ({ at, received: at + up + offset, sent: at + up + offset, arrived: at + up + down });

  it('places the offset in [sent − arrived, received − at], widened by the stamps’ millisecond, and keeps the narrowest', () => {
    const estimate = clockEstimate([exchange(0, 10, 10), exchange(100, 2, 4), exchange(200, 30, 1)])!;
    expect(estimate).toMatchObject({ offsetMs: 999, intervalMs: [995, 1003], samples: 3 }); // the 2 + 4 exchange: [1000 − 4 − 1, 1000 + 2 + 1]
    expect(estimate.estimates).toEqual([1000, 999, 1014.5]); // each exchange's own ((received − at) + (sent − arrived)) / 2
    expect(estimate.spreadMs).toBe(15.5);
    expect(estimate.intervalMs[0]).toBeLessThanOrEqual(1000);
    expect(estimate.intervalMs[1]).toBeGreaterThanOrEqual(1000);
    expect(clockEstimate([{ at: 0, received: null, sent: null, arrived: 3 }])).toBeNull();
  });

  it('holds the true offset inside every exchange’s interval, whatever the route’s asymmetry', () => {
    for (const [up, down] of [[1, 40], [40, 1], [0, 0], [7, 7]]) {
      const { intervalMs } = clockEstimate([exchange(50, up!, down!, -321)])!;
      expect(intervalMs[0]).toBeLessThanOrEqual(-321);
      expect(intervalMs[1]).toBeGreaterThanOrEqual(-321);
    }
  });

  it('takes the union of the start’s and the end’s intervals, their estimates’ distance as the spread, and voids past 5 ms or under 50 exchanges', () => {
    const fifty = (offset: number) => Array.from({ length: 50 }, (_, i) => exchange(i * 10, 1, 1, offset));
    const clock = liveClock(fifty(1000), fifty(1004))!;
    expect(clock).toMatchObject({ offsetMs: 1002, intervalMs: [998, 1006], spreadMs: 4, samples: { start: 50, end: 50 } });
    expect(clockVoid(clock)).toBeNull();
    expect(clockVoid(liveClock(fifty(1000), fifty(1006)))).toBe('the clock’s spread 6 ms is over 5 ms');
    expect(clockVoid(liveClock(fifty(1000).slice(0, 49), fifty(1000)))).toBe('49 clock exchanges at the run’s start, under 50');
    expect(clockVoid(liveClock([], fifty(1000)))).toMatch(/no exchange carried the machine’s clock/);
  });

  it('judges a cross-clock delta at its interval’s worst edge: pass, miss beyond its best edge, else inconclusive, and inconclusive when wider than the allowance', () => {
    const clock = liveClock([exchange(0, 1, 1)], [exchange(10, 1, 1)])!; // [998, 1002]: θ = remote − here
    // raw = this Mac's frame − the machine's write = true − θ: a true 30 ms reads −970; the two stamps' millisecond widens it
    expect(deltaVerdict(-970, clock, 33, 12)).toEqual({ verdict: 'pass', p50IntervalMs: [27, 33], wide: false });
    expect(deltaVerdict(-970, clock, 32, 12).verdict).toBe('inconclusive');
    expect(deltaVerdict(-970, clock, 27, 12).verdict).toBe('inconclusive');
    expect(deltaVerdict(-970, clock, 26, 12).verdict).toBe('miss');
    expect(deltaVerdict(-970, clock, 33, 3)).toMatchObject({ verdict: 'inconclusive', wide: true });
  });

  it('judges a live carrier: its delta across the clocks by the interval, its round trip and open on this Mac’s clock alone, and the clock’s void first', () => {
    const fifty = (offset: number, up = 1, down = 1) => Array.from({ length: 50 }, (_, i) => exchange(i * 10, up, down, offset));
    const rtt = stats(2);
    const clock = liveClock(fifty(1000), fifty(1000))!; // [998, 1002]
    const base = { roundTrip: stats(20), openToFirstRowMs: 400, rtt, clock, rawSamples: [-970, -969, -971], resumeMs: null };
    // the bound: local 24.5 + rtt 2 + 10 = 36.5 ms; a true 30 ms reads −970, its p50 in [27, 33]
    expect(liveJudgement('direct', LOCAL, { ...base, rawDelta: stats(-970) })).toMatchObject({ void: null, delta: { verdict: 'pass', p50IntervalMs: [27, 33], wide: false }, misses: [], inconclusive: [], bounds: { deltaToFrameP50Ms: 36.5, roundTripP50Ms: 24 }, verdicts: { deltaToFrame: 'pass', roundTrip: 'pass', openToFirstRow: 'pass', resume: 'not measured' } });
    expect(liveJudgement('direct', LOCAL, { ...base, rawDelta: stats(-966) }).inconclusive).toEqual(['direct: delta-to-frame p50 in [31, 37] ms across the clocks, which straddles its bound 36.5 ms']);
    expect(liveJudgement('direct', LOCAL, { ...base, rawDelta: stats(-960), roundTrip: stats(25), openToFirstRowMs: 1600 }).misses).toEqual([
      'direct: delta-to-frame p50 in [37, 43] ms across the clocks, over its bound 36.5 ms',
      'direct: round trip p50 25 ms over its bound 24 ms',
      'direct: open to first row 1600 ms over its bound 1500 ms',
    ]);
    // a clock interval wider than the allowance (10 ms and the round trip) is never decided, even where it would pass
    const slow = liveClock(fifty(1000, 30, 30), fifty(1000, 30, 30))!; // [969, 1031]
    expect(liveJudgement('relay', LOCAL, { ...base, rtt: stats(20), clock: slow, rawDelta: stats(-970) })).toMatchObject({ delta: { verdict: 'inconclusive', wide: true }, misses: [], inconclusive: ['relay: delta-to-frame p50 in [-2, 62] ms across the clocks, its clock’s interval 62 ms wider than its allowance 30 ms (10 ms and the round trip)'] });
    const spread = liveJudgement('direct', LOCAL, { ...base, clock: liveClock(fifty(1000), fifty(1007)), rawDelta: stats(-970) });
    expect(spread).toMatchObject({ void: 'direct: the clock’s spread 7 ms is over 5 ms', delta: null, inconclusive: [], verdicts: { deltaToFrame: 'void' } });
    // a resume measured live is held to the local engine start plus the rtt
    expect(liveJudgement('direct', LOCAL, { ...base, rawDelta: stats(-970), resumeMs: 430 })).toMatchObject({ verdicts: { resume: 'miss' }, misses: ['direct: resume 430 ms over its bound 422 ms'] });
    expect(liveJudgement('direct', LOCAL, { ...base, rawDelta: stats(-970), resumeMs: 300 }).verdicts.resume).toBe('pass');
  });

  it('voids the run on one exchange whose estimate lies more than 5 ms from the rest, though the narrowest agree', () => {
    const steady = Array.from({ length: 50 }, (_, i) => exchange(i * 10, 1, 1));
    const outlier = exchange(600, 1, 17); // a pong held 16 ms on its way back: its estimate reads 8 ms low
    const clock = liveClock([...steady, outlier], steady)!;
    expect(clock.intervalMs).toEqual([998, 1002]); // the offset and its uncertainty are still the narrowest exchanges'
    expect(clock.spreadMs).toBe(8);
    expect(clockVoid(clock)).toBe('the clock’s spread 8 ms is over 5 ms');
    expect(clockVoid(liveClock(steady, steady))).toBeNull();
  });

  it('carries a live case’s signed delays through stats, validity and judgement: negative before the clock is applied, valid after', () => {
    // the machine’s clock 1 s ahead: a true 25 ms delay reads −975 across the clocks
    const delays = Array.from({ length: EXPECTED_MARKERS }, (_, i) => -975 + (i % 7));
    const run: CaseRun = { samples: delays, expected: EXPECTED_MARKERS, missing: [], clock };
    const fifty = Array.from({ length: 50 }, (_, i) => exchange(i * 10, 1, 1));
    const clockOf = liveClock(fifty, fifty)!;
    const raw = signedStats(delays)!;
    expect(raw).toMatchObject({ p50: -972, n: EXPECTED_MARKERS });
    expect(signedStats([])).toBeNull();
    expect(invalidReasons({ cases: { local: valid(), direct: run, relay: run }, pings: { direct: 100, relay: 100 }, loads: [1, 1, 1], signed: ['direct', 'relay'] })).toEqual([]);
    expect(invalidReasons({ cases: { local: valid(), direct: run, relay: run }, pings: { direct: 100, relay: 100 }, loads: [1, 1, 1] })).toEqual([`direct: ${EXPECTED_MARKERS} negative samples`, `relay: ${EXPECTED_MARKERS} negative samples`]);
    const judged = liveJudgement('direct', LOCAL, { rawDelta: raw, rawSamples: delays, roundTrip: stats(20), openToFirstRowMs: 400, rtt: stats(2), clock: clockOf, resumeMs: null });
    expect(judged).toMatchObject({ void: null, verdicts: { deltaToFrame: 'pass' } });
    // one delay under zero even at the interval’s high edge (θ ≤ 1002 + 1): the clocks disagree
    const early = liveJudgement('direct', LOCAL, { rawDelta: raw, rawSamples: [...delays, -1010], roundTrip: stats(20), openToFirstRowMs: 400, rtt: stats(2), clock: clockOf, resumeMs: null });
    expect(early).toMatchObject({ void: 'direct: 1 delay under zero across the whole clock interval: the clocks disagree', delta: null });
  });

  it('collects a live case’s delays as the page does, signed: a frame on this Mac’s wall clock before the machine’s write stamp is kept negative, then judged after the clock', () => {
    const kept = [{ turn: 2, k: 1, writtenAt: 50, wallAt: 1_000 }, { turn: 2, k: 2, writtenAt: 60, wallAt: 1_010 }, { turn: 2, k: 3, writtenAt: 70, wallAt: 1_020 }, { turn: 2, k: 4, writtenAt: 80 }];
    const seen = new Map([
      [markerOf(2, 1).trim(), { at: 995, present: true }], // the machine's clock 8 ms ahead: shown "before" it was written
      [markerOf(2, 2).trim(), { at: 1_012, present: true }],
      [markerOf(2, 3).trim(), { at: 1_030, present: false }], // gone again: not a frame
      [markerOf(2, 4).trim(), { at: 1_040, present: true }], // no wall stamp: not a wall sample
    ]);
    const delays = delaysOf(kept, seen, 'wall', markerOf);
    expect(delays).toEqual([-5, 2]);
    expect(delaysOf(kept, seen, 'performance', markerOf)).toEqual([945, 952, 960]);
    expect(signedStats(delays)).toEqual({ p50: -5, p95: 2, n: 2 });
  });

  describe('the live resume', () => {
    function steps(over: Partial<ResumeSteps> = {}) {
      const did: string[] = [];
      const step = <T>(name: string, value: T) => async () => (did.push(name), value);
      const all: ResumeSteps = {
        drop: step('drop', true),
        unhold: step('unhold', undefined),
        down: step('down', undefined),
        writeTurn: step('writeTurn', undefined),
        reachedWhileHeld: step('reachedWhileHeld', false),
        release: step('release', { upAt: 1_000, carrier: 'direct' as const }),
        firstArrival: step('firstArrival', 1_180),
        shown: step('shown', undefined),
        ...over,
      };
      return { all, did };
    }

    it('takes resume from the link’s up again to the turn’s first event in A, and lifts the hold at the end', async () => {
      const { all, did } = steps();
      expect(await measureResume('direct', all)).toEqual({ resumeMs: 180, reason: null });
      expect(did).toEqual(['drop', 'down', 'writeTurn', 'reachedWhileHeld', 'release', 'firstArrival', 'shown', 'unhold']);
    });

    it('lifts the hold on every early return and every failure', async () => {
      const cases: [Partial<ResumeSteps>, string][] = [
        [{ drop: async () => false }, 'direct: resume: the link had no channel to drop'],
        [{ reachedWhileHeld: async () => true }, 'direct: resume: the turn reached A while its link was held down'],
        [{ release: async () => null }, 'direct: resume: the link did not come up after its release'],
        [{ release: async () => ({ upAt: 1_000, carrier: 'relay' }) }, "direct: resume: the link came back over relay, so its resume is not direct's"],
      ];
      for (const [over, reason] of cases) {
        const { all, did } = steps(over);
        expect(await measureResume('direct', all)).toEqual({ resumeMs: null, reason });
        expect(did.at(-1)).toBe('unhold');
      }
      for (const failing of ['down', 'writeTurn', 'firstArrival', 'shown'] as const) {
        const over: Partial<ResumeSteps> = {};
        over[failing] = async () => Promise.reject(new Error(`${failing} timed out`));
        const { all, did } = steps(over);
        await expect(measureResume('direct', all)).rejects.toThrow(`${failing} timed out`);
        expect(did.at(-1)).toBe('unhold');
      }
    });
  });
});
