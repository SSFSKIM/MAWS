// The remote bench's numbers (test/support/remote-latency.ts; P5 O7 M7, acceptance 3): each carrier's bounds from the
// same run's local numbers and its own round trip, the misses named, and the run's validity (the local bench's per case,
// the pings, Rule B on the load).
import { describe, expect, it } from 'vitest';
import { boundsOf, budgetMisses, EXPECTED_MARKERS, invalidReasons, loadVerdict, remoteLine, rttStats, type CaseRun, type Measures, type RemoteMeasures } from './remote-latency';

const stats = (p50: number, p95 = p50, n = 600) => ({ p50, p95, n });
const LOCAL: Measures = { deltaToFrame: stats(24.5, 37.5), roundTrip: stats(0.9, 1.3, 200), openToFirstRowMs: 180, resumeMs: null, engineStartMs: 420 };
const clock = { ok: true, widthMs: 0.4, offsetMs: 0.1, offsetRangeMs: [-0.1, 0.3] as [number, number] };
const valid = (): CaseRun => ({ samples: Array.from({ length: EXPECTED_MARKERS }, () => 25), expected: EXPECTED_MARKERS, missing: [], clock });

describe('the remote bench (P5 O7 M7)', () => {
  it('reads the link’s round trip as each pong’s arrival less its ping’s send', () => {
    const exchanges = [3, 1, 2, 2].map((d, i) => ({ at: 1000 * i, received: null, sent: null, arrived: 1000 * i + d }));
    expect(rttStats(exchanges)).toEqual({ p50: 2, p95: 3, n: 4 });
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

  it('prints one line per case, the carrier’s round trip and resume beside its numbers', () => {
    expect(remoteLine('local', LOCAL)).toBe('[remote-latency] local: delta-to-frame p50 24.5 ms p95 37.5 ms (n=600) · round trip p50 0.9 ms p95 1.3 ms · open to first row 180.0 ms · engine start 420.0 ms');
    expect(remoteLine('direct', { ...LOCAL, resumeMs: 61, rtt: stats(1, 2, 100) })).toContain('· resume 61.0 ms · engine start 420.0 ms · rtt p50 1.0 ms (n=100)');
  });
});
