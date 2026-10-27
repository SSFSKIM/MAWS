import { describe, expect, it } from 'vitest';
import { baselineProblems, cpuSeconds, DAEMON_IDLE_BASELINE, DAEMON_IDLE_BOUND, IDLE_RUN, idleBound, idleLine, invalidReasons, measured, median } from './daemon-idle';

describe('the idle statistics (P5 O2, M1)', () => {
  it('takes the median: the middle sample of an odd count, the mean of the middle two of an even one', () => {
    expect(median([5, 1, 3])).toBe(3); // unsorted on purpose
    expect(median([7])).toBe(7);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    const window = Array.from({ length: 21 }, (_, k) => 98_000 + ((k * 4) % 21)); // 21 distinct samples, shuffled
    expect(median(window)).toBe(98_010);
    expect(() => median([])).toThrow(/no samples/);
  });

  it("reads `ps -o time=` in macOS's m:ss.cc form, minutes unbounded", () => {
    expect(cpuSeconds('0:00.41')).toBe(0.41);
    expect(cpuSeconds('  0:07.05\n')).toBe(7.05);
    expect(cpuSeconds('12:03.10')).toBe(723.1);
    expect(cpuSeconds('919:56.57')).toBe(55_196.57);
  });

  it("reads `ps -o time=` in Linux's hh:mm:ss form, with days when there are any", () => {
    expect(cpuSeconds('00:00:00')).toBe(0);
    expect(cpuSeconds('00:01:05')).toBe(65);
    expect(cpuSeconds('01:02:03')).toBe(3_723);
    expect(cpuSeconds('2-01:00:00')).toBe(2 * 86_400 + 3_600);
    expect(cpuSeconds('1:02:03.50')).toBe(3_723.5);
  });

  it('refuses any other text, quoting it', () => {
    for (const text of ['', '0.41', 'abc', '1:2:3:4', '0:61.00', '1:60:00', '-1:00.00', '0:00.4x']) expect(() => cpuSeconds(text), text).toThrow(`not a ps time: ${JSON.stringify(text)}`);
  });

  it("measures the profile's processes by their argv0 alone: the supervisor, never the app, a claude child or another profile's", () => {
    const root = '/private/var/folders/x/T/maws-di-abc';
    const processes = [
      { pid: 10, command: `/Applications/Electron.app/Contents/MacOS/Electron --lang=en-US ${root}/out/main/index.js` },
      { pid: 11, command: `maws-supervisor /repo/out/engine-host/index.js --detached ${root}/ud/supervisor` },
      { pid: 12, command: `claude -p --resume x --cwd ${root}/repo` },
      { pid: 13, command: `maws-supervisorish --detached ${root}/ud/supervisor` },
      { pid: 14, command: 'maws-supervisor /repo/out/engine-host/index.js --detached /private/var/folders/x/T/maws-di-other/ud/supervisor' },
    ];
    expect(measured(processes, root)).toEqual([{ pid: 11, argv0: 'maws-supervisor', command: processes[1]!.command }]);
    expect(measured(processes, root, ['claude', 'maws-supervisor']).map((p) => p.pid)).toEqual([11, 12]); // M9 adds names
  });

  it('calls a run invalid when the load reaches 5, when a measured process is gone before the window ends, with nothing measured, or when the kept session ended, saying which', () => {
    const loads = Array.from({ length: 21 }, () => 1.2);
    const valid = { loads, measured: ['maws-supervisor'], lost: [], sessionEnded: false };
    expect(invalidReasons(valid)).toEqual([]);
    expect(invalidReasons({ ...valid, loads: [...loads.slice(1), 4.99] })).toEqual([]);
    expect(invalidReasons({ ...valid, loads: [...loads.slice(2), 5, 6.234] })).toEqual(['the 1-minute load reached 6.2 (a valid run stays under 5 throughout)']);
    expect(invalidReasons({ ...valid, lost: [{ pid: 11, argv0: 'maws-supervisor', atS: 270 }] })).toEqual([`maws-supervisor pid 11 was gone at 270 s of the ${IDLE_RUN.windowS} s window`]);
    expect(invalidReasons({ ...valid, measured: [] })).toEqual(['no process of the profile to measure']);
    expect(invalidReasons({ ...valid, sessionEnded: true })).toEqual(['the kept session ended before the window did (the scene measures one held idle session)']);
  });
});

describe('the window', () => {
  it('settles 120 s, then reads every 30 s for 600 s: 21 samples', () => {
    expect(IDLE_RUN).toEqual({ settleS: 120, windowS: 600, everyS: 30, samples: 21, maxLoad: 5 });
  });
});

describe('the baseline and the bound (acceptance 7; P5 acceptance 14)', () => {
  const baseline = { commit: '1a2b3c4d5', runs: ['41000000001', '41000000002', '41000000003'], rssKiB: 98_304, cpuS: 0.41 };

  it("is 1.5 times the baseline's RSS and its CPU plus 1.0 s per 600 s", () => {
    expect(idleBound(baseline)).toEqual({ rssKiB: 147_456, cpuS: 1.41 });
    expect(idleBound({ ...baseline, rssKiB: 98_305, cpuS: 2.07 })).toEqual({ rssKiB: 147_457, cpuS: 3.07 }); // whole KiB, never above 1.5x
    expect(idleBound(baseline, 1_200)).toEqual({ rssKiB: 147_456, cpuS: 2.41 }); // the allowance is per 600 s
  });

  it('is derived from the recorded baseline, and is none while none is recorded', () => {
    expect(DAEMON_IDLE_BOUND).toEqual(DAEMON_IDLE_BASELINE === null ? null : idleBound(DAEMON_IDLE_BASELINE));
  });

  it('a baseline is three distinct runs at a commit, with a positive RSS and a CPU time that is not negative', () => {
    expect(baselineProblems(null)).toEqual([]); // not yet recorded: nothing to hold
    expect(baselineProblems(baseline)).toEqual([]);
    expect(baselineProblems({ commit: 'HEAD', runs: ['1', '1'], rssKiB: 0, cpuS: -0.01 })).toEqual([
      'commit HEAD is not a sha',
      'runs [1, 1] are not three distinct run ids',
      'rssKiB 0 is not a positive number of KiB',
      'cpuS -0.01 is negative',
    ]);
  });

  // The recorded baseline itself, once the commit that records it (touching only daemon-idle.ts) lands; until then the
  // case is reported as skipped, not passed.
  it.skipIf(DAEMON_IDLE_BASELINE === null)('the recorded baseline is well formed', () => {
    expect(baselineProblems(DAEMON_IDLE_BASELINE)).toEqual([]);
  });
});

describe('the printed line', () => {
  it('reads as the document quotes it', () => {
    expect(idleLine({ rssKiB: 98_304, samples: 21, cpuS: 0.41, measured: ['maws-supervisor'], load: 1.83 })).toBe(
      '[daemon-idle] rss 98304 KiB (median of 21) · cpu 0.41 s over 600 s · processes maws-supervisor · load 1.8',
    );
    expect(idleLine({ rssKiB: 120_000.5, samples: 21, cpuS: 1, measured: ['mawsd', 'maws-supervisor'], load: 0.04 })).toBe(
      '[daemon-idle] rss 120001 KiB (median of 21) · cpu 1.00 s over 600 s · processes mawsd, maws-supervisor · load 0.0',
    );
  });
});
