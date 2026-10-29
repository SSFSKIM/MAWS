import { describe, expect, it } from 'vitest';
import {
  abaDeltas,
  abaLine,
  baselineProblems,
  boundMisses,
  cpuSeconds,
  DAEMON_IDLE_BASELINE,
  DAEMON_IDLE_BASELINE_M1,
  DAEMON_IDLE_BOUND,
  DAEMON_IDLE_RUNTIME_FLOOR,
  ENROLLED_INCREMENT_BUDGET_KIB,
  enrolledLine,
  floorLine,
  footprints,
  IDLE_RUN,
  idleBound,
  idleLine,
  MAWSD_HEADROOM_KIB,
  mawsdLine,
  invalidReasons,
  measured,
  median,
  readerMismatches,
  topMem,
} from './daemon-idle';

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

  it('calls a run invalid when the load reaches 5, when a measured process is gone before the window ends, with nothing measured, when the kept session ended, or when the footprint readers disagree, saying which', () => {
    const loads = Array.from({ length: 21 }, () => 1.2);
    const valid = { loads, measured: ['maws-supervisor'], lost: [], sessionEnded: false, mismatches: [] };
    expect(invalidReasons(valid)).toEqual([]);
    expect(invalidReasons({ ...valid, loads: [...loads.slice(1), 4.99] })).toEqual([]);
    expect(invalidReasons({ ...valid, loads: [...loads.slice(2), 5, 6.234] })).toEqual(['the 1-minute load reached 6.2 (a valid run stays under 5 throughout)']);
    expect(invalidReasons({ ...valid, lost: [{ pid: 11, argv0: 'maws-supervisor', atS: 270 }] })).toEqual([`maws-supervisor pid 11 was gone at 270 s of the ${IDLE_RUN.windowS} s window`]);
    expect(invalidReasons({ ...valid, measured: [] })).toEqual(['no process of the profile to measure']);
    expect(invalidReasons({ ...valid, sessionEnded: true })).toEqual(['the kept session ended before the window did (the scene measures one held idle session)']);
    expect(invalidReasons({ ...valid, mismatches: ['top printed no MEM for maws-supervisor pid 11 (the footprint reader read 50000 KiB)'] })).toEqual([
      'top printed no MEM for maws-supervisor pid 11 (the footprint reader read 50000 KiB)',
    ]);
  });
});

describe('the physical footprint, read by pid without privilege (P5 Decision Log 48)', () => {
  it("reads the proc_pid_rusage reader's lines: the footprint and the resident size in KiB, or the errno for a pid it could not read", () => {
    const text = '11 51200000 79425536\n12 errno 3\n13 1023 2048\n';
    expect(footprints(text, [11, 12, 13])).toEqual(
      new Map([
        [11, { footprintKiB: 50_000, residentKiB: 77_564 }],
        [12, { errno: 3 }],
        [13, { footprintKiB: 1023 / 1024, residentKiB: 2 }],
      ]),
    );
  });

  it('refuses reader output that misses a pid asked for or says something else, quoting it', () => {
    expect(() => footprints('11 51200000 79425536\n', [11, 12])).toThrow('the footprint reader printed no line for pid 12: "11 51200000 79425536\\n"');
    expect(() => footprints('11 lots 79425536\n', [11])).toThrow('the footprint reader printed no line for pid 11: "11 lots 79425536\\n"');
  });

  it("reads top's MEM column, each value with its unit and the resolution it prints to, past top's header and its change markers", () => {
    const text = [
      'Processes: 642 total, 11 running, 3 stuck, 628 sleeping, 4901 threads ',
      '2026/10/27 03:37:13',
      'Load Avg: 1.93, 1.66, 1.63 ',
      'PhysMem: 31G used (11G wired, 7961M compressor), 119M unused.',
      '',
      'PID    MEM',
      '92242  12M',
      '1      9985K',
      '7      26M+',
      '8      2G-',
      '9      512B',
      '10     1.5G',
      '',
    ].join('\n');
    expect(topMem(text)).toEqual(
      new Map([
        [92242, { kiB: 12_288, resolutionKiB: 1_024, text: '12M' }],
        [1, { kiB: 9_985, resolutionKiB: 1, text: '9985K' }],
        [7, { kiB: 26_624, resolutionKiB: 1_024, text: '26M+' }],
        [8, { kiB: 2 * 1_048_576, resolutionKiB: 1_048_576, text: '2G-' }],
        [9, { kiB: 0.5, resolutionKiB: 1 / 1_024, text: '512B' }],
        [10, { kiB: 1.5 * 1_048_576, resolutionKiB: 104_857.6, text: '1.5G' }],
      ]),
    );
    expect(topMem('PID    MEM\n\n')).toEqual(new Map()); // top prints the header alone for a pid that is gone
    expect(() => topMem('PID    MEM\n11     12Q\n')).toThrow('not a top MEM row: "11     12Q"');
    expect(() => topMem('11  12M\n')).toThrow('top printed no PID MEM header: "11  12M\\n"');
  });

  it("agrees when top's value is within its printed resolution and 2% of the reader's, and says which process disagrees otherwise", () => {
    const supervisor = { pid: 11, argv0: 'maws-supervisor' };
    const top = (text: string) => topMem(`PID MEM\n11 ${text}\n`).get(11)!;
    expect(readerMismatches([{ ...supervisor, footprintKiB: 12_449, top: top('12M') }])).toEqual([]); // 12.16 MiB prints as 12M
    expect(readerMismatches([{ ...supervisor, footprintKiB: 9_985, top: top('9985K') }])).toEqual([]);
    expect(readerMismatches([{ ...supervisor, footprintKiB: 60_000, top: top('60M') }])).toEqual([]); // 1440 KiB apart: past top's MiB, within it and 2%
    expect(readerMismatches([{ ...supervisor, footprintKiB: 50_000, top: top('52M') }])).toEqual([
      'the footprint readers disagree for maws-supervisor pid 11: proc_pid_rusage 50000 KiB, top 52M (53248 KiB), beyond the 2024 KiB tolerance',
    ]);
    expect(readerMismatches([{ ...supervisor, footprintKiB: 50_000, top: null }])).toEqual(['top printed no MEM for maws-supervisor pid 11 (the footprint reader read 50000 KiB)']);
    expect(readerMismatches([])).toEqual([]);
  });
});

describe('the window', () => {
  it('settles 120 s, then reads every 30 s for 600 s: 21 samples', () => {
    expect(IDLE_RUN).toEqual({ settleS: 120, windowS: 600, everyS: 30, samples: 21, maxLoad: 5 });
  });
});

describe('the baseline, the runtime floor and the bound (acceptance 7; P5 acceptance 14, Decision Logs 48 and 57)', () => {
  const baseline = { commit: '1a2b3c4d5', runs: ['41000000001', '41000000002', '41000000003'], footprintKiB: 98_304, cpuS: 0.41 };
  const floor = { commit: '1a2b3c4d5', runs: ['41000000004', '41000000005', '41000000006'], footprintKiB: 20_480, electron: '44.4.5' };

  it("holds the daemon shape's processes together within 1.5 times the supervisor's footprint and its CPU plus 1.0 s per 600 s", () => {
    expect(idleBound(baseline)).toEqual({ footprintKiB: 147_456, cpuS: 1.41 });
    expect(idleBound({ ...baseline, footprintKiB: 98_305, cpuS: 2.07 })).toEqual({ footprintKiB: 147_457, cpuS: 3.07 }); // whole KiB, never above 1.5x
    expect(idleBound(baseline, 1_200)).toEqual({ footprintKiB: 147_456, cpuS: 2.41 }); // the allowance is per 600 s
  });

  it('is derived from the recorded baseline alone, the runtime floor a diagnostic outside it', () => {
    expect(DAEMON_IDLE_BOUND).toEqual(idleBound(DAEMON_IDLE_BASELINE));
  });

  it("re-derives on the landing tree's own supervisor: M1's record stays as history, the bound it gave no longer held", () => {
    expect(idleBound(DAEMON_IDLE_BASELINE_M1)).toEqual({ footprintKiB: 96_721, cpuS: 1.11 });
    expect(DAEMON_IDLE_BASELINE.commit).not.toBe(DAEMON_IDLE_BASELINE_M1.commit);
  });

  it('a record is three distinct runs at a commit with a positive footprint, a baseline a CPU time that is not negative, and a floor the Electron version it ran on', () => {
    expect(baselineProblems(null)).toEqual([]); // not yet recorded: nothing to hold
    expect(baselineProblems(baseline)).toEqual([]);
    expect(baselineProblems(floor)).toEqual([]);
    expect(baselineProblems({ commit: 'HEAD', runs: ['1', '1'], footprintKiB: 0, cpuS: -0.01 })).toEqual([
      'commit HEAD is not a sha',
      'runs [1, 1] are not three distinct run ids',
      'footprintKiB 0 is not a positive number of KiB',
      'cpuS -0.01 is negative',
    ]);
    expect(baselineProblems({ ...floor, runs: ['1', '2'], footprintKiB: Number.NaN, electron: 'v44' })).toEqual([
      'runs [1, 2] are not three distinct run ids',
      'footprintKiB NaN is not a positive number of KiB',
      'electron v44 is not a version',
    ]);
  });

  it('the recorded baselines are well formed', () => {
    expect(baselineProblems(DAEMON_IDLE_BASELINE)).toEqual([]);
    expect(baselineProblems(DAEMON_IDLE_BASELINE_M1)).toEqual([]);
  });

  it('the recorded runtime floor is well formed', () => {
    expect(baselineProblems(DAEMON_IDLE_RUNTIME_FLOOR)).toEqual([]);
  });
});

describe('the daemon shape against the bound (P5 O2 M9, acceptance 7)', () => {
  const bound = { footprintKiB: 96_721, cpuS: 1.11 };

  it('misses nothing at or under the bound, rounding the footprint as the line prints it', () => {
    expect(boundMisses({ footprintKiB: 90_950, cpuS: 0.2 }, bound)).toEqual([]);
    expect(boundMisses({ footprintKiB: 96_721.4, cpuS: 1.11 }, bound)).toEqual([]);
  });

  it('names each measure over the bound, and by how much', () => {
    expect(boundMisses({ footprintKiB: 97_950, cpuS: 0.2 }, bound)).toEqual(['the footprint 97950 KiB is 1229 KiB over the bound 96721 KiB']);
    expect(boundMisses({ footprintKiB: 96_722, cpuS: 1.5 }, bound)).toEqual([
      'the footprint 96722 KiB is 1 KiB over the bound 96721 KiB',
      'the cpu 1.50 s is 0.39 s over the bound 1.11 s',
    ]);
  });

  it('is held against the recorded bound when none is given', () => {
    expect(boundMisses({ footprintKiB: DAEMON_IDLE_BOUND.footprintKiB + 1, cpuS: 0 })).toHaveLength(1);
  });
});

describe('the printed line', () => {
  const supervisor = [{ argv0: 'maws-supervisor', footprintKiB: 61_440.2 }];

  it("reads as the document quotes it: the footprint measured and each process's own, the RSS beside it as a diagnostic, the Electron version against the runtime floor's", () => {
    expect(idleLine({ footprintKiB: 61_440, rssKiB: 98_304, samples: 21, cpuS: 0.41, processes: supervisor, bound: null, electron: '44.4.5', load: 1.83 })).toBe(
      "[daemon-idle] footprint 61440 KiB (median of 21) · rss 98304 KiB · cpu 0.41 s over 600 s · processes maws-supervisor 61440 KiB · electron 44.4.5, the runtime floor's · load 1.8",
    );
    expect(idleLine({ footprintKiB: 61_440, rssKiB: 98_304, samples: 21, cpuS: 0.41, processes: supervisor, bound: null, electron: '45.0.1', load: 1.83 })).toContain(
      "· electron 45.0.1, not the runtime floor's 44.4.5 ·",
    );
  });

  it("on the daemon shape names every process's footprint, so a miss names its hop, and says whether the run is within the bound", () => {
    const processes = [{ argv0: 'mawsd', footprintKiB: 26_480.6 }, { argv0: 'maws-supervisor', footprintKiB: 64_470 }];
    expect(idleLine({ footprintKiB: 90_950.5, rssKiB: 160_000, samples: 21, cpuS: 0.2, processes, bound: { footprintKiB: 96_721, cpuS: 1.11 }, electron: '44.4.5', load: 0.04 })).toBe(
      "[daemon-idle] footprint 90951 KiB (median of 21) · rss 160000 KiB · cpu 0.20 s over 600 s · processes mawsd 26481 KiB, maws-supervisor 64470 KiB · within the bound 96721 KiB and 1.11 s · electron 44.4.5, the runtime floor's · load 0.0",
    );
    expect(idleLine({ footprintKiB: 97_950, rssKiB: 160_000, samples: 21, cpuS: 1.5, processes, bound: { footprintKiB: 96_721, cpuS: 1.11 }, electron: '44.4.5', load: 3 })).toContain(
      '· over the bound 96721 KiB and 1.11 s: the footprint 97950 KiB is 1229 KiB over the bound 96721 KiB; the cpu 1.50 s is 0.39 s over the bound 1.11 s ·',
    );
  });

  it("reads the runtime floor's line with the Electron version it measured", () => {
    expect(floorLine({ footprintKiB: 20_480.4, rssKiB: 41_000, samples: 21, cpuS: 0.03, electron: '44.4.5', load: 2.71 })).toBe(
      '[daemon-idle] runtime floor footprint 20480 KiB (median of 21) · rss 41000 KiB · cpu 0.03 s · electron 44.4.5 · load 2.7',
    );
  });

  // P5 O2 M5: Decision Log 57's early check
  it("reads mawsd's line against what the combined bound leaves it beside the engine host's baseline", () => {
    expect(MAWSD_HEADROOM_KIB).toBe(DAEMON_IDLE_BOUND.footprintKiB - DAEMON_IDLE_BASELINE.footprintKiB);
    expect(mawsdLine({ footprintKiB: MAWSD_HEADROOM_KIB - 0.4, rssKiB: 52_000, samples: 21, cpuS: 0.02, load: 3.04 })).toBe(
      `[daemon-idle] mawsd footprint ${MAWSD_HEADROOM_KIB} KiB (median of 21) · rss 52000 KiB · cpu 0.02 s over 600 s · within the ${MAWSD_HEADROOM_KIB} KiB the bound leaves it beside the engine host's ${DAEMON_IDLE_BASELINE.footprintKiB} KiB · load 3.0`,
    );
    expect(mawsdLine({ footprintKiB: MAWSD_HEADROOM_KIB + 1, rssKiB: 60_000, samples: 21, cpuS: 0.02, load: 3 })).toContain(`· over the ${MAWSD_HEADROOM_KIB} KiB`);
  });
});

// P5 O10 M10 and Decision Log 114: the enrolled endpoint's increment over the unenrolled daemon shape, one scene's two
// windows, recorded without a bound asserted.
describe("the enrolled endpoint's line", () => {
  const unenrolled = {
    footprintKiB: 97_439.4, cpuS: 0.15, samples: 21, load: 2.94,
    processes: [{ argv0: 'mawsd', pid: 11, footprintKiB: 30_100.2, cpuS: 0.05 }, { argv0: 'maws-supervisor', pid: 12, footprintKiB: 67_339, cpuS: 0.1 }],
  };
  const enrolled = {
    footprintKiB: 103_583.6, cpuS: 0.21, samples: 20, load: 3.12,
    processes: [{ argv0: 'mawsd', pid: 11, footprintKiB: 36_250.4, cpuS: 0.11 }, { argv0: 'maws-supervisor', pid: 12, footprintKiB: 67_333, cpuS: 0.1 }],
  };

  it("reads the increment in memory and CPU, each process's share of it, the budget's verdict, the validity and both loads", () => {
    expect(ENROLLED_INCREMENT_BUDGET_KIB).toBe(8 * 1024);
    expect(enrolledLine({ unenrolled, enrolled, reasons: [] })).toBe(
      '[daemon-idle] enrolled endpoint footprint +6145 KiB (enrolled 103584 KiB, unenrolled 97439 KiB; medians of 20 and 21) · cpu +0.06 s over 600 s (enrolled 0.21 s, unenrolled 0.15 s) · processes mawsd +6150 KiB +0.06 s, maws-supervisor -6 KiB +0.00 s · within the 8192 KiB budget (P5 Decision Log 114) · valid · load 3.1 enrolled, 2.9 unenrolled',
    );
  });

  it('says over the budget, and names why a run is invalid', () => {
    const heavy = { ...enrolled, footprintKiB: unenrolled.footprintKiB + 9_000 };
    expect(enrolledLine({ unenrolled, enrolled: heavy, reasons: ['the 1-minute load reached 5.2 (a valid run stays under 5 throughout)', 'the hub link was down at the window’s end'] })).toContain(
      '· over the 8192 KiB budget (P5 Decision Log 114) · invalid: the 1-minute load reached 5.2 (a valid run stays under 5 throughout); the hub link was down at the window’s end ·',
    );
  });

  it('names a process measured in one window alone', () => {
    const woken = { ...enrolled, processes: [...enrolled.processes, { argv0: 'maws-pty-host', pid: 13, footprintKiB: 9_000.4, cpuS: 0.01 }] };
    expect(enrolledLine({ unenrolled, enrolled: woken, reasons: [] })).toContain(', maws-pty-host 9000 KiB 0.01 s, in the enrolled window alone ·');
  });
});

// The bound's re-derivation (after P5 O10 M10): A-B-A, the supervisor's scene, the daemon shape's and the supervisor's
// again, each a fresh launch in one job, recorded without a bound asserted.
describe('the A-B-A line', () => {
  const a = { footprintKiB: 66_120.4, cpuS: 0.11, samples: 21, load: 3.12, processes: [{ argv0: 'maws-supervisor', pid: 21, footprintKiB: 66_120.4, cpuS: 0.11 }] };
  const b = {
    footprintKiB: 98_201.6, cpuS: 0.16, samples: 21, load: 3.44,
    processes: [{ argv0: 'mawsd', pid: 31, footprintKiB: 31_500, cpuS: 0.03 }, { argv0: 'maws-supervisor', pid: 32, footprintKiB: 66_701.2, cpuS: 0.13 }],
  };
  const a2 = { footprintKiB: 66_541, cpuS: 0.13, samples: 20, load: 2.9, processes: [{ argv0: 'maws-supervisor', pid: 41, footprintKiB: 66_541, cpuS: 0.13 }] };

  it('holds B against the mean of A and A’, and A against A’, per process where both A windows measured it', () => {
    expect(abaDeltas(a, b, a2)).toEqual({
      aMean: { footprintKiB: 66_331, cpuS: 0.12 }, // 66330.7 KiB
      footprintKiB: 98_202 - 66_331,
      cpuS: 0.04,
      ratio: 1.48,
      spread: { footprintKiB: 66_120 - 66_541, cpuS: -0.02 },
      processes: [{ argv0: 'maws-supervisor', footprintKiB: 66_701 - 66_331, cpuS: 0.01 }],
      alone: ['mawsd'],
    });
  });

  it("reads the deltas, B's processes against the A mean, each window's footprint, CPU, processes and load, the sample counts, the window and the validity", () => {
    expect(abaLine({ a, b, a2, reasons: [], windowS: 600 })).toBe(
      "[daemon-idle] A-B-A footprint B +31871 KiB against the A mean 66331 KiB (x1.480), A -421 KiB against A' · cpu B +0.04 s against the A mean 0.12 s, A -0.02 s against A' · B's processes against the A mean: mawsd in B alone, maws-supervisor +370 KiB +0.01 s · A detached 66120 KiB 0.11 s (maws-supervisor 66120 KiB 0.11 s; load 3.1) · B daemon 98202 KiB 0.16 s (mawsd 31500 KiB 0.03 s, maws-supervisor 66701 KiB 0.13 s; load 3.4) · A' detached 66541 KiB 0.13 s (maws-supervisor 66541 KiB 0.13 s; load 2.9) · medians of 21, 21 and 20 over 600 s each · valid",
    );
  });

  it('names why a run is invalid, each window’s reasons', () => {
    expect(abaLine({ a, b, a2, reasons: ['B: the 1-minute load reached 5.2 (a valid run stays under 5 throughout)'], windowS: 60 })).toMatch(/ · medians of 21, 21 and 20 over 60 s each · invalid: B: the 1-minute load reached 5\.2 \(a valid run stays under 5 throughout\)$/);
  });
});
