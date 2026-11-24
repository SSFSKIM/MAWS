// The prestart measure's numbers (ticket 851, M5; docs/doperpowers/plans/2026-11-24-prestart-engine.md, D14), proved
// before any Mac run: the arms' order, which runs count, what makes a run invalid, the medians and the bound.
import { describe, expect, it } from 'vitest';
import { armsOfPair, judgePrestartRuns, median, PRESTART_BENCH, prestartLine, type PrestartRun } from './prestart-latency';

const run = (arm: PrestartRun['arm'], pair: number, sendToPaintMs: number | null, over: Partial<PrestartRun> = {}): PrestartRun => ({
  arm, pair, keyToSendMs: 3_000, sendToPaintMs, starts: 1, adopted: arm === 'on', ...over,
});
const pairs = (off: number[], on: number[]): PrestartRun[] => off.flatMap((ms, pair) => [run('off', pair, ms), run('on', pair, on[pair]!)]);

describe('the prestart measure', () => {
  it('alternates the arms pair by pair, so neither always runs first', () => {
    expect([0, 1, 2, 3].map(armsOfPair)).toEqual([['off', 'on'], ['on', 'off'], ['off', 'on'], ['on', 'off']]);
  });

  it('takes the median of an odd and an even count', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it('counts the runs typed for 3 s ± 100 ms, reports the rest as not counted, and holds the bound on the medians', () => {
    const runs = [...pairs([2_600, 2_700, 2_650, 2_800, 2_620], [400, 380, 420, 500, 390]), run('on', 5, 100, { keyToSendMs: 3_101 }), run('off', 5, 9_000, { keyToSendMs: 2_899 })];
    const judged = judgePrestartRuns(runs, { boundMs: PRESTART_BENCH.boundMs, counts: true });
    expect(judged.counted).toEqual({ off: [2_600, 2_700, 2_650, 2_800, 2_620], on: [400, 380, 420, 500, 390] });
    expect(judged.excluded.map((e) => e.reason)).toEqual(['key to Send 3101 ms, outside 3000 ± 100 ms', 'key to Send 2899 ms, outside 3000 ± 100 ms']);
    expect(judged.medians).toEqual({ off: 2_650, on: 400 });
    expect(judged.gainMs).toBe(2_250);
    expect(judged.reasons).toEqual([]);
    expect(judged.met).toBe(true);
  });

  it('misses the bound when flag-on gains less than 1.5 s', () => {
    const judged = judgePrestartRuns(pairs([2_600, 2_700, 2_650], [1_200, 1_300, 1_250]), { boundMs: PRESTART_BENCH.boundMs, counts: true });
    expect(judged.gainMs).toBe(1_400);
    expect(judged.met).toBe(false);
  });

  it('is invalid with too few counted runs in an arm, a missing paint, a flag-on run that did not adopt or started other than one engine, or a flag-off run that adopted', () => {
    const runs = [
      run('off', 0, 2_600), run('on', 0, null),
      run('off', 1, 2_600, { adopted: true }), run('on', 1, 400, { starts: 2 }),
      run('off', 2, 2_600), run('on', 2, 400, { adopted: false }),
    ];
    expect(judgePrestartRuns(runs, { boundMs: PRESTART_BENCH.boundMs, counts: true }).reasons).toEqual([
      'flag-on run of pair 0: no assistant row painted',
      'flag-off run of pair 1: adopted a prestart, which the flag-off path never makes',
      'flag-on run of pair 1: 2 engine starts for one Send, not 1',
      'flag-on run of pair 2: Send launched fresh, the prestart not adopted',
      `flag-on: 2 counted runs, under the ${PRESTART_BENCH.minCounted} a median needs`,
    ]);
  });

  it('reads no starts where the engine counts none (the pinned engine), and holds no bound where none is given', () => {
    const judged = judgePrestartRuns(pairs([3_100, 3_000, 3_200], [1_000, 900, 1_100]).map((r) => ({ ...r, starts: null })), { boundMs: null, counts: false });
    expect(judged.reasons).toEqual([]);
    expect(judged.met).toBeNull();
    expect(judged.gainMs).toBe(2_100);
  });

  it('says both medians, their difference, the counts and the bound on one line', () => {
    const judged = judgePrestartRuns([...pairs([2_600, 2_700, 2_650], [400, 380, 420]), run('on', 3, 100, { keyToSendMs: 3_150 })], { boundMs: 1_500, counts: true });
    expect(prestartLine('prestart-latency', judged, { boundMs: 1_500, load: 1.234 })).toBe(
      'prestart-latency: Send to first row, flag off median 2650 ms (n=3), flag on median 400 ms (n=3), difference 2250 ms (bound ≥ 1500 ms: met); 1 run not counted; 1-minute load 1.23',
    );
    expect(prestartLine('prestart-engine', judgePrestartRuns(pairs([3_100, 3_000, 3_200], [1_000, 900, 1_100]), { boundMs: null, counts: false }), { boundMs: null, load: 2 })).toBe(
      'prestart-engine: Send to first row, flag off median 3100 ms (n=3), flag on median 1000 ms (n=3), difference 2100 ms (reported, no bound); 0 runs not counted; 1-minute load 2.00',
    );
  });
});
