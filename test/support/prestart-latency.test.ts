// The prestart measure's numbers (ticket 851, M5; docs/doperpowers/plans/2026-11-24-prestart-engine.md, D14), proved
// before any Mac run: the arms' order, which runs count, what makes a run invalid, the medians and the bound.
import { describe, expect, it } from 'vitest';
import { armsOfPair, judgePrestartRuns, median, PRESTART_BENCH, prestartLine, publicText, startsAroundSend, type PrestartRun } from './prestart-latency';

// A run as the arm's own path makes it: flag-on's one engine started while typing, flag-off's at Send
const run = (arm: PrestartRun['arm'], pair: number, sendToPaintMs: number | null, over: Partial<PrestartRun> = {}): PrestartRun => ({
  arm, pair, keyToSendMs: 3_000, sendToPaintMs, starts: arm === 'on' ? { beforeSend: 1, afterSend: 0 } : { beforeSend: 0, afterSend: 1 }, adopted: arm === 'on', error: null, ...over,
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

  it('is invalid with too few counted runs in an arm, a missing paint, a flag-on run that did not adopt, or a flag-off run that adopted', () => {
    const runs = [
      run('off', 0, 2_600), run('on', 0, null),
      run('off', 1, 2_600, { adopted: true }), run('on', 1, 400),
      run('off', 2, 2_600), run('on', 2, 400, { adopted: false }),
    ];
    expect(judgePrestartRuns(runs, { boundMs: PRESTART_BENCH.boundMs, counts: true }).reasons).toEqual([
      'flag-on run of pair 0: no assistant row painted',
      'flag-off run of pair 1: adopted a prestart, which the flag-off path never makes',
      'flag-on run of pair 2: Send launched fresh, the prestart not adopted',
      `flag-on: 2 counted runs, under the ${PRESTART_BENCH.minCounted} a median needs`,
    ]);
  });

  // M5's review, finding 4: flag-off counts only if no engine ran before its Send and its Send started one; flag-on's one
  // start came before its Send
  it('reads each run’s engine starts on either side of its Send: flag-off none before and one after, flag-on one before and none after', () => {
    const runs = [
      ...pairs([2_600, 2_700, 2_650], [400, 380, 420]),
      run('off', 3, 2_600, { starts: { beforeSend: 1, afterSend: 1 } }), // a hidden engine while typing, a second at Send
      run('off', 4, 2_600, { starts: { beforeSend: 0, afterSend: 0 } }),
      run('on', 3, 400, { starts: { beforeSend: 1, afterSend: 1 } }), // Send launched one of its own beside the prestart
      run('on', 4, 400, { starts: { beforeSend: 0, afterSend: 1 } }), // the one start came at Send
    ];
    expect(judgePrestartRuns(runs, { boundMs: PRESTART_BENCH.boundMs, counts: true }).reasons).toEqual([
      'flag-off run of pair 3: 1 engine start before Send and 1 after, not 0 and 1',
      'flag-off run of pair 4: 0 engine starts before Send and 0 after, not 0 and 1',
      'flag-on run of pair 3: 1 engine start before Send and 1 after, not 1 and 0',
      'flag-on run of pair 4: 0 engine starts before Send and 1 after, not 1 and 0',
    ]);
    expect(judgePrestartRuns([run('on', 0, 400, { starts: null })], { boundMs: null, counts: true }).reasons[0]).toBe('flag-on run of pair 0: its engine starts were not read');
  });

  it('splits the starts at the Send instant, both on the wall clock', () => {
    expect(startsAroundSend([{ at: 1_000 }, { at: 4_000 }, { at: 4_001 }], 4_000)).toEqual({ beforeSend: 1, afterSend: 2 });
    expect(startsAroundSend([], 4_000)).toEqual({ beforeSend: 0, afterSend: 0 });
  });

  // M5's review, finding 2: a run that failed, at its scene or at its teardown, is not counted and the measure says so
  it('counts no run that failed, even one that painted, and names its failure', () => {
    const runs = [...pairs([2_600, 2_700, 2_650], [400, 380, 420]), run('on', 3, 410, { error: 'cleanup: a keychain prompt was pending' })];
    const judged = judgePrestartRuns(runs, { boundMs: PRESTART_BENCH.boundMs, counts: true });
    expect(judged.counted.on).toEqual([400, 380, 420]);
    expect(judged.reasons).toEqual(['flag-on run of pair 3: failed: cleanup: a keychain prompt was pending']);
  });

  it('is invalid when the series stopped before its last pair', () => {
    const judged = judgePrestartRuns(pairs([2_600, 2_700, 2_650], [400, 380, 420]), { boundMs: PRESTART_BENCH.boundMs, counts: true, stopped: 'the scratch processes of pair 3 could not be cleared' });
    expect(judged.reasons).toEqual(['the series stopped: the scratch processes of pair 3 could not be cleared']);
  });

  // M5's review, finding 9: an invalid measure holds no bound, whatever its medians say
  it('evaluates no bound when the measure is invalid, and says so on its line', () => {
    const judged = judgePrestartRuns([...pairs([2_600, 2_700], [400, 380]), run('off', 2, 2_650)], { boundMs: PRESTART_BENCH.boundMs, counts: true });
    expect(judged.gainMs).toBe(2_260);
    expect(judged.met).toBeNull();
    expect(prestartLine('prestart-latency', judged, { boundMs: 1_500, load: 1 })).toContain('(bound ≥ 1500 ms: not evaluated, the measure is invalid)');
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

  // M5's review, finding 8: a failure's text names the scratch, the checkout and the home by role, and passes the shared
  // redactor (test/live/support/public-evidence.mjs, the gate-offload plan's Decision Log 152) before it is logged or written
  it('makes a failure’s text public: the run’s scratch, the checkout, the home and any other account’s home by role, secrets redacted', () => {
    const paths = { scratch: ['/private/var/folders/ab/cd/T/maws-pre-x1'], checkout: '/Users/someone/work/maws', home: '/Users/someone' };
    const text = [
      'ENOENT: no such file or directory, mkdir \'/private/var/folders/ab/cd/T/maws-pre-x1/ud/claude-config\'',
      'at /var/folders/ab/cd/T/maws-pre-x1/repo', // the same scratch, as a path not yet resolved names it
      'out/main/index.js under /Users/someone/work/maws, the engine at /Users/someone/.local/bin/claude',
      'a log of /Users/other/x; Authorization: Bearer abc.def-123, key sk-ant-api03-xyz, mail a.person@example.com',
      'a value of the runner: s3cr3t-value-1234',
    ].join('\n');
    expect(publicText(text, paths, { MAWS_TEST_TOKEN: 's3cr3t-value-1234' })).toBe([
      'ENOENT: no such file or directory, mkdir \'<scratch>/ud/claude-config\'',
      'at <scratch>/repo',
      'out/main/index.js under <checkout>, the engine at ~/.local/bin/claude',
      'a log of /Users/<user>/x; Authorization: Bearer [REDACTED], key sk-ant-[REDACTED], mail owner@redacted.invalid',
      'a value of the runner: [REDACTED]',
    ].join('\n'));
  });
});
