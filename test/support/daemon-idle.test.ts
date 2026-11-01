import { describe, expect, it } from 'vitest';
import {
  abaDeltas,
  abaLine,
  baselineProblems,
  boundMisses,
  busyShare,
  cpuSeconds,
  cpuTimes,
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
  intervalLoads,
  loadPair,
  MAWSD_HEADROOM_KIB,
  mawsdLine,
  invalidReasons,
  measured,
  median,
  processTable,
  readerMismatches,
  SESSION_HOST_BOUND_KIB,
  SESSION_HOST_RUN,
  sessionHostLine,
  sessionHostMisses,
  sessionHosts,
  SPINE_RELEASED_RUN,
  spineLine,
  mawsdSpineLine,
  topMem,
  topOutside,
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

  it('calls a run invalid when the load reaches 5 and its 30 s pair 4.7, when a measured process is gone before the window ends, with nothing measured, when the kept session ended, or when the footprint readers disagree, saying which', () => {
    const loads = Array.from({ length: 21 }, () => 1.2);
    const valid = { loads, measured: ['maws-supervisor'], lost: [], sessionEnded: false, mismatches: [] };
    expect(invalidReasons(valid)).toEqual([]);
    expect(invalidReasons({ ...valid, loads: [...loads.slice(1), 4.99] })).toEqual([]);
    expect(invalidReasons({ ...valid, loads: [...loads.slice(2), 5, 6.234] })).toEqual(['the 1-minute load reached 6.2 and its 30 s pair 8.1 (a valid run stays under 5 throughout, or its 30 s pair under 4.7)']);
    expect(invalidReasons({ ...valid, loads: [...loads.slice(3), 7.5, 5.2, 3.5] })).toEqual([]); // a burst: one interval at 17.2, its neighbours 1.2 and 1.7
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
    expect(IDLE_RUN).toEqual({ settleS: 120, windowS: 600, everyS: 30, samples: 21, maxLoad: 5, pairLoad: 4.7 });
  });
});

// The 1-minute load as the kernel keeps it: each 5 s tick moves it toward the runnable count by 1 - e^(-5/60), so over a
// 30 s interval of constant load u it moves l to e^-0.5 l + (1 - e^-0.5) u.
const oneMinute = (start: number, intervals: readonly number[]) => intervals.reduce((series, u) => [...series, Math.exp(-0.5) * series.at(-1)! + (1 - Math.exp(-0.5)) * u], [start]);

describe('the load rule: the 1-minute peak, and the 30 s pair guarding it (the architect’s Rule B at 4.7)', () => {
  it("rebuilds each 30 s interval's own load from the 1-minute series", () => {
    const intervals = [2, 2, 16, 1.5, 1.2, 8, 8.5, 2];
    intervalLoads(oneMinute(2.4, intervals)).forEach((u, t) => expect(u, `interval ${t + 1}`).toBeCloseTo(intervals[t]!, 9));
    expect(intervalLoads([3, 3, 3])).toEqual([3, 3].map((u) => expect.closeTo(u, 9)));
  });

  it('takes as the 30 s pair the highest load two adjacent intervals both reached', () => {
    expect(loadPair(oneMinute(2, [2, 16, 1.5, 6, 6.5, 2]))).toBeCloseTo(6, 9); // the burst's 16 stands alone
    expect(loadPair(oneMinute(2, [2, 16, 9, 1, 6, 6.5]))).toBeCloseTo(9, 9);
    expect(loadPair([1, 2, 3])).toBeCloseTo(Math.min(...intervalLoads([1, 2, 3])), 9); // three samples: one pair
    expect(() => loadPair([1, 9])).toThrow('2 samples rebuild no two adjacent 30 s intervals');
  });

  it('can only exempt: a series under 5 throughout stays valid whatever its 30 s pair, and the rule voids no window the peak rule alone would pass', () => {
    // A deterministic spread of 21-sample series: quiet, sustained near the threshold, bursts and ramps.
    let seed = 0x5eed;
    const random = () => (seed = (seed * 48_271) % 2_147_483_647) / 2_147_483_647; // MINSTD, exact in doubles
    const shapes = Array.from({ length: 4_000 }, (_, n) => {
      const base = 0.5 + random() * 4.4;
      const intervals = Array.from({ length: 20 }, () => Math.max(0, base + (random() - 0.5) * (n % 4) * 3 + (random() < 0.08 ? random() * 25 : 0)));
      return oneMinute(base, intervals);
    });
    const sustained = [Array.from({ length: 21 }, () => 4.99), oneMinute(4.9, Array.from({ length: 20 }, () => 4.99)), oneMinute(1, Array.from({ length: 20 }, (_, t) => (t < 10 ? 1 : 4.999)))];
    const runs = [...shapes, ...sustained];
    const under = runs.filter((loads) => Math.max(...loads) < IDLE_RUN.maxLoad);
    expect(under.length, 'the spread holds series under the threshold').toBeGreaterThan(500);
    expect(under.filter((loads) => loadPair(loads) >= IDLE_RUN.pairLoad).length, 'some of them at a 30 s pair of 4.7 or more').toBeGreaterThan(10);
    expect(runs.filter((loads) => Math.max(...loads) >= IDLE_RUN.maxLoad && loadPair(loads) < IDLE_RUN.pairLoad).length, 'and bursts the pair exempts').toBeGreaterThan(10);
    for (const loads of runs) {
      const voidNow = invalidReasons({ loads, measured: ['maws-supervisor'], lost: [], sessionEnded: false, mismatches: [] }).length > 0;
      if (voidNow) expect(Math.max(...loads), JSON.stringify(loads)).toBeGreaterThanOrEqual(IDLE_RUN.maxLoad);
    }
  });

  // The boundary windows, each its 21 1-minute loads as the run's test-results JSON recorded them, copied literally.
  const VOID: Record<string, number[]> = {
    // daemon-idle-baseline at d0802b29d: Apple Intelligence's post-reboot app-content indexing, sustained (peak 9.5)
    '40789442114': [1.8896484375, 2.13134765625, 1.82470703125, 2.017578125, 1.822265625, 2.17724609375, 2.142578125, 2.03271484375, 2.27197265625, 2.44384765625, 2.2734375, 1.90673828125, 2.49658203125, 2.23583984375, 1.90771484375, 1.8388671875, 2.27587890625, 9.49951171875, 7.8232421875, 5.89501953125, 4.3125],
    // daemon-idle-baseline at 178eb02d8: the same indexer, sustained (peak 5.4)
    '40793346639': [2.1640625, 2.240234375, 2.7744140625, 2.2001953125, 2.1259765625, 2.27734375, 2.67431640625, 3.1962890625, 2.919921875, 3.025390625, 3.60205078125, 3.4091796875, 4.0615234375, 3.6875, 3.55810546875, 5.3896484375, 5.353515625, 4.13525390625, 3.4853515625, 2.84619140625, 2.98486328125],
    // daemon-idle-baseline at 7ff8f582, O2's landing record (peak 11.0)
    '40647561480': [3.34814453125, 3.38818359375, 3.49267578125, 4.10791015625, 3.61376953125, 3.75048828125, 3.0869140625, 3.3271484375, 3.3876953125, 3.43701171875, 3.21923828125, 5.12890625, 4.27587890625, 3.9345703125, 3.71875, 10.9697265625, 7.91015625, 8.37548828125, 8.02197265625, 5.86083984375, 4.5166015625],
  };
  const BURST: Record<string, number[]> = {
    // daemon-idle at 781b88cb, two bursts (peak 7.6)
    '40805962574': [2.2451171875, 2.287109375, 2.28125, 2.30615234375, 2.00537109375, 7.576171875, 5.240234375, 3.66748046875, 3.0966796875, 5.01708984375, 3.8955078125, 3.21484375, 3.12158203125, 2.59033203125, 2.56982421875, 2.58935546875, 2.919921875, 2.75341796875, 2.6767578125, 2.60693359375, 2.67431640625],
    // daemon-idle at 781b88cb (peak 6.4)
    '40809164967': [3.19140625, 2.64404296875, 2.30322265625, 2.2822265625, 3.2734375, 3.037109375, 2.6298828125, 2.3203125, 1.93603515625, 2.111328125, 2.51318359375, 2.28466796875, 1.8466796875, 1.986328125, 2.02880859375, 6.439453125, 4.66162109375, 3.35400390625, 3.09814453125, 2.568359375, 2.62646484375],
    // daemon-idle-floor at 36704c984, the runtime floor's fourth run, reclassified by its shape 2.5, 7.7, 5.4, 3.7, 2.7 (peak 7.7)
    '40502284016': [2.0322265625, 1.923828125, 1.92822265625, 2.00048828125, 2.455078125, 2.4345703125, 2.36328125, 2.51806640625, 7.68994140625, 5.35498046875, 3.7060546875, 2.69189453125, 2.28125, 2.1142578125, 1.7470703125, 1.6572265625, 1.619140625, 1.6298828125, 1.5732421875, 1.38525390625, 1.80810546875],
    // daemon-idle at d9419bb6: of every exempted window the highest 30 s pair, 4.15, the threshold's lower edge (peak 5.7)
    '40634705341': [3.25048828125, 3.32080078125, 4.12255859375, 4.0302734375, 5.740234375, 5.11376953125, 3.90576171875, 3.3427734375, 3.31396484375, 3.19189453125, 2.791015625, 2.44775390625, 1.9501953125, 2.017578125, 1.69287109375, 1.7802734375, 2.6181640625, 3.134765625, 2.5859375, 2.41650390625, 2.294921875],
  };
  const reasonsOf = (loads: number[]) => invalidReasons({ loads, measured: ['maws-supervisor'], lost: [], sessionEnded: false, mismatches: [] });

  it('voids the windows of sustained load, naming the peak and the 30 s pair', () => {
    expect(Object.values({ ...VOID, ...BURST }).map((loads) => loads.length)).toEqual(Array.from({ length: 7 }, () => IDLE_RUN.samples));
    expect(reasonsOf(VOID['40789442114']!)).toEqual(['the 1-minute load reached 9.5 and its 30 s pair 5.2 (a valid run stays under 5 throughout, or its 30 s pair under 4.7)']);
    expect(reasonsOf(VOID['40793346639']!)).toEqual(['the 1-minute load reached 5.4 and its 30 s pair 5.3 (a valid run stays under 5 throughout, or its 30 s pair under 4.7)']);
    expect(reasonsOf(VOID['40647561480']!)).toEqual(['the 1-minute load reached 11.0 and its 30 s pair 7.5 (a valid run stays under 5 throughout, or its 30 s pair under 4.7)']);
  });

  it('passes the bursts, each of which the peak rule alone voided', () => {
    for (const [run, loads] of Object.entries(BURST)) {
      expect(Math.max(...loads), run).toBeGreaterThanOrEqual(IDLE_RUN.maxLoad);
      expect(reasonsOf(loads), run).toEqual([]);
    }
    expect(Object.values(BURST).map((loads) => loadPair(loads).toFixed(2))).toEqual(['2.62', '2.67', '2.76', '4.15']);
  });

  it('scores every boundary window the same at any threshold from 4.2 to 5.2, and 4.7 is their middle', () => {
    for (const [run, loads] of Object.entries(VOID)) expect(loadPair(loads), run).toBeGreaterThanOrEqual(5.2);
    for (const [run, loads] of Object.entries(BURST)) expect(loadPair(loads), run).toBeLessThan(4.2);
    expect(IDLE_RUN.pairLoad).toBe((4.2 + 5.2) / 2);
  });
});

describe("the window's diagnostics, recorded beside the readings and read by no verdict", () => {
  it("sums os.cpus()'s cumulative times over the cores, and takes an interval's busy share from two readings", () => {
    const core = (user: number, idle: number) => ({ model: 'm', speed: 0, times: { user, nice: 0, sys: 10, idle, irq: 0 } });
    expect(cpuTimes([core(100, 900), core(50, 950)])).toEqual({ user: 150, nice: 0, sys: 20, idle: 1_850, irq: 0 });
    expect(busyShare({ user: 150, nice: 0, sys: 20, idle: 1_850, irq: 0 }, { user: 450, nice: 0, sys: 120, idle: 3_450, irq: 0 })).toBe(0.2); // 400 busy of 2000
    expect(Object.keys(cpuTimes())).toEqual(['user', 'nice', 'sys', 'idle', 'irq']); // this machine's own
  });

  it("reads one `ps -axo pid=,lstart=,time=,comm=`: each process's start, CPU time and name, past a name with spaces", () => {
    const text = [
      '    1 Wed Dec 31 16:00:12 1969     712:00.53 /sbin/launchd',
      '  163 Tue Oct  7 22:28:16 2026       0:30.20 /System/Library/CoreServices/Software Update.app/Contents/Resources/suhelperd',
      '  900 Wed Oct 28 20:31:42 2026       0:00.04 Core Audio Driver (ParrotAudioPlugin.driver)',
      'not a row',
      '',
    ].join('\n');
    expect(processTable(text)).toEqual(
      new Map([
        [1, { pid: 1, started: 'Wed Dec 31 16:00:12 1969', cpuS: 42_720.53, name: 'launchd' }],
        [163, { pid: 163, started: 'Tue Oct  7 22:28:16 2026', cpuS: 30.2, name: 'suhelperd' }],
        [900, { pid: 900, started: 'Wed Oct 28 20:31:42 2026', cpuS: 0.04, name: 'Core Audio Driver (ParrotAudioPlugin.driver)' }],
      ]),
    );
  });

  it('names the process outside the measured set that used the most CPU since the previous sample, a process started meanwhile counting its whole time', () => {
    const row = (pid: number, cpuS: number, name: string, started = 'Wed Oct 28 20:00:00 2026') => [pid, { pid, started, cpuS, name }] as const;
    const before = new Map([row(11, 5, 'maws-supervisor'), row(20, 100, 'WindowServer'), row(30, 40, 'corespotlightd'), row(40, 2, 'mdworker')]);
    const after = new Map([row(11, 9, 'maws-supervisor'), row(20, 100.5, 'WindowServer'), row(30, 43.25, 'corespotlightd'), row(50, 0.1, 'ps')]);
    expect(topOutside(before, after, [11])).toEqual({ pid: 30, name: 'corespotlightd', cpuS: 3.25 }); // the supervisor's 4 s is measured
    expect(topOutside(before, new Map([...after, row(40, 4, 'mds', 'Wed Oct 28 20:10:00 2026')]), [11])).toEqual({ pid: 40, name: 'mds', cpuS: 4 }); // a reused pid: not 4 less 2
    expect(topOutside(before, new Map([...after, row(60, 3.5, 'spotlightknowledged')]), [11])).toEqual({ pid: 60, name: 'spotlightknowledged', cpuS: 3.5 });
    expect(topOutside(null, after, [11])).toBeNull(); // the window's first sample has no interval behind it
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
    expect(idleLine({ footprintKiB: 61_440, rssKiB: 98_304, samples: 21, cpuS: 0.41, processes: supervisor, bound: null, electron: '44.4.5', load: 1.83, loadPair: 1.21 })).toBe(
      "[daemon-idle] footprint 61440 KiB (median of 21) · rss 98304 KiB · cpu 0.41 s over 600 s · processes maws-supervisor 61440 KiB · electron 44.4.5, the runtime floor's · load 1.8 (30 s pair 1.2)",
    );
    expect(idleLine({ footprintKiB: 61_440, rssKiB: 98_304, samples: 21, cpuS: 0.41, processes: supervisor, bound: null, electron: '45.0.1', load: 1.83, loadPair: 1.21 })).toContain(
      "· electron 45.0.1, not the runtime floor's 44.4.5 ·",
    );
  });

  it("on the daemon shape names every process's footprint, so a miss names its hop, and says whether the run is within the bound", () => {
    const processes = [{ argv0: 'mawsd', footprintKiB: 26_480.6 }, { argv0: 'maws-supervisor', footprintKiB: 64_470 }];
    expect(idleLine({ footprintKiB: 90_950.5, rssKiB: 160_000, samples: 21, cpuS: 0.2, processes, bound: { footprintKiB: 96_721, cpuS: 1.11 }, electron: '44.4.5', load: 0.04, loadPair: 0.02 })).toBe(
      "[daemon-idle] footprint 90951 KiB (median of 21) · rss 160000 KiB · cpu 0.20 s over 600 s · processes mawsd 26481 KiB, maws-supervisor 64470 KiB · within the bound 96721 KiB and 1.11 s · electron 44.4.5, the runtime floor's · load 0.0 (30 s pair 0.0)",
    );
    expect(idleLine({ footprintKiB: 97_950, rssKiB: 160_000, samples: 21, cpuS: 1.5, processes, bound: { footprintKiB: 96_721, cpuS: 1.11 }, electron: '44.4.5', load: 3, loadPair: 2 })).toContain(
      '· over the bound 96721 KiB and 1.11 s: the footprint 97950 KiB is 1229 KiB over the bound 96721 KiB; the cpu 1.50 s is 0.39 s over the bound 1.11 s ·',
    );
  });

  it("reads the runtime floor's line with the Electron version it measured", () => {
    expect(floorLine({ footprintKiB: 20_480.4, rssKiB: 41_000, samples: 21, cpuS: 0.03, electron: '44.4.5', load: 7.69, loadPair: 2.757 })).toBe(
      '[daemon-idle] runtime floor footprint 20480 KiB (median of 21) · rss 41000 KiB · cpu 0.03 s · electron 44.4.5 · load 7.7 (30 s pair 2.8)',
    );
  });

  // P5 O2 M5: Decision Log 57's early check
  it("reads mawsd's line against what the combined bound leaves it beside the engine host's baseline", () => {
    expect(MAWSD_HEADROOM_KIB).toBe(DAEMON_IDLE_BOUND.footprintKiB - DAEMON_IDLE_BASELINE.footprintKiB);
    expect(mawsdLine({ footprintKiB: MAWSD_HEADROOM_KIB - 0.4, rssKiB: 52_000, samples: 21, cpuS: 0.02, load: 3.04, loadPair: 2.36 })).toBe(
      `[daemon-idle] mawsd footprint ${MAWSD_HEADROOM_KIB} KiB (median of 21) · rss 52000 KiB · cpu 0.02 s over 600 s · within the ${MAWSD_HEADROOM_KIB} KiB the bound leaves it beside the engine host's ${DAEMON_IDLE_BASELINE.footprintKiB} KiB · load 3.0 (30 s pair 2.4)`,
    );
    expect(mawsdLine({ footprintKiB: MAWSD_HEADROOM_KIB + 1, rssKiB: 60_000, samples: 21, cpuS: 0.02, load: 3, loadPair: 2 })).toContain(`· over the ${MAWSD_HEADROOM_KIB} KiB`);
  });
});

// P5 O10 M10 and Decision Log 114: the enrolled endpoint's increment over the unenrolled daemon shape, one scene's two
// windows, recorded without a bound asserted.
describe("the enrolled endpoint's line", () => {
  const unenrolled = {
    footprintKiB: 97_439.4, cpuS: 0.15, samples: 21, load: 2.94, loadPair: 1.84,
    processes: [{ argv0: 'mawsd', pid: 11, footprintKiB: 30_100.2, cpuS: 0.05 }, { argv0: 'maws-supervisor', pid: 12, footprintKiB: 67_339, cpuS: 0.1 }],
  };
  const enrolled = {
    footprintKiB: 103_583.6, cpuS: 0.21, samples: 20, load: 3.12, loadPair: 2.04,
    processes: [{ argv0: 'mawsd', pid: 11, footprintKiB: 36_250.4, cpuS: 0.11 }, { argv0: 'maws-supervisor', pid: 12, footprintKiB: 67_333, cpuS: 0.1 }],
  };

  it("reads the increment in memory and CPU, each process's share of it, the budget's verdict, the validity and both loads", () => {
    expect(ENROLLED_INCREMENT_BUDGET_KIB).toBe(8 * 1024);
    expect(enrolledLine({ unenrolled, enrolled, reasons: [] })).toBe(
      '[daemon-idle] enrolled endpoint footprint +6145 KiB (enrolled 103584 KiB, unenrolled 97439 KiB; medians of 20 and 21) · cpu +0.06 s over 600 s (enrolled 0.21 s, unenrolled 0.15 s) · processes mawsd +6150 KiB +0.06 s, maws-supervisor -6 KiB +0.00 s · within the 8192 KiB budget (P5 Decision Log 114) · valid · load 3.1 (30 s pair 2.0) enrolled, 2.9 (30 s pair 1.8) unenrolled',
    );
  });

  it('says over the budget, and names why a run is invalid', () => {
    const heavy = { ...enrolled, footprintKiB: unenrolled.footprintKiB + 9_000 };
    expect(enrolledLine({ unenrolled, enrolled: heavy, reasons: ['the 1-minute load reached 5.2 and its 30 s pair 4.9 (a valid run stays under 5 throughout, or its 30 s pair under 4.7)', 'the hub link was down at the window’s end'] })).toContain(
      '· over the 8192 KiB budget (P5 Decision Log 114) · invalid: the 1-minute load reached 5.2 and its 30 s pair 4.9 (a valid run stays under 5 throughout, or its 30 s pair under 4.7); the hub link was down at the window’s end ·',
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
  const a = { footprintKiB: 66_120.4, cpuS: 0.11, samples: 21, load: 3.12, loadPair: 2.31, processes: [{ argv0: 'maws-supervisor', pid: 21, footprintKiB: 66_120.4, cpuS: 0.11 }] };
  const b = {
    footprintKiB: 98_201.6, cpuS: 0.16, samples: 21, load: 3.44, loadPair: 2.61,
    processes: [{ argv0: 'mawsd', pid: 31, footprintKiB: 31_500, cpuS: 0.03 }, { argv0: 'maws-supervisor', pid: 32, footprintKiB: 66_701.2, cpuS: 0.13 }],
  };
  const a2 = { footprintKiB: 66_541, cpuS: 0.13, samples: 20, load: 2.9, loadPair: 1.98, processes: [{ argv0: 'maws-supervisor', pid: 41, footprintKiB: 66_541, cpuS: 0.13 }] };

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
      "[daemon-idle] A-B-A footprint B +31871 KiB against the A mean 66331 KiB (x1.480), A -421 KiB against A' · cpu B +0.04 s against the A mean 0.12 s, A -0.02 s against A' · B's processes against the A mean: mawsd in B alone, maws-supervisor +370 KiB +0.01 s · A detached 66120 KiB 0.11 s (maws-supervisor 66120 KiB 0.11 s; load 3.1, 30 s pair 2.3) · B daemon 98202 KiB 0.16 s (mawsd 31500 KiB 0.03 s, maws-supervisor 66701 KiB 0.13 s; load 3.4, 30 s pair 2.6) · A' detached 66541 KiB 0.13 s (maws-supervisor 66541 KiB 0.13 s; load 2.9, 30 s pair 2.0) · medians of 21, 21 and 20 over 600 s each · valid",
    );
  });

  it('names why a run is invalid, each window’s reasons', () => {
    expect(abaLine({ a, b, a2, reasons: ['B: the 1-minute load reached 5.2 and its 30 s pair 4.9 (a valid run stays under 5 throughout, or its 30 s pair under 4.7)'], windowS: 60 })).toMatch(/ · medians of 21, 21 and 20 over 60 s each · invalid: B: the 1-minute load reached 5\.2 and its 30 s pair 4\.9 \(a valid run stays under 5 throughout, or its 30 s pair under 4\.7\)$/);
  });
});

// P5 O3-C M5 (D18, D19): the spine composed alone over the profile-sized fixture, read idle while loaded and again
// after its root stopped and its data was released, recorded without a bound.
describe("the spine's line", () => {
  const loaded = { footprintKiB: 61_234.4, cpuS: 0.05, samples: 21, load: 3.12, loadPair: 2.41, processes: [{ argv0: 'maws-spine', pid: 51, footprintKiB: 61_234.4, cpuS: 0.05 }] };
  const released = { footprintKiB: 48_001.6, cpuS: 0.01, samples: 11, load: 2.94, loadPair: 2.63, processes: [{ argv0: 'maws-spine', pid: 51, footprintKiB: 48_001.6, cpuS: 0.01 }] };
  const counts = { sessions: 5_000, projects: 50, attention: 300, pending: 40, library: 1_000, drafts: 50, history: 2_000 };

  it('reads the released window as a 120 s settle and 300 s of samples every 30 s: 11', () => {
    expect(SPINE_RELEASED_RUN).toEqual({ settleS: 120, windowS: 300, everyS: 30, samples: 11, maxLoad: 5, pairLoad: 4.7 });
  });

  it('reads the loaded and released medians and the drop, each window’s CPU, the fixture’s counts, the collection, the validity and both loads', () => {
    expect(spineLine({ loaded, released, counts, collection: 'collected: heap 52.0 to 31.0 MiB, used 40.0 to 28.0 MiB', reasons: [] })).toBe(
      '[daemon-idle] spine loaded footprint 61234 KiB (median of 21) · released 48002 KiB (median of 11), -13232 KiB · cpu 0.05 s over 600 s loaded, 0.01 s over 300 s released · fixture 5000 sessions in 50 projects, 300 attention items (40 pending), 1000 library rows, 50 drafts, 2000 prompt-history lines · before the released window, collected: heap 52.0 to 31.0 MiB, used 40.0 to 28.0 MiB · valid · load 3.1 (30 s pair 2.4) loaded, 2.9 (30 s pair 2.6) released',
    );
  });

  it('says when the collection failed, and names why a run is invalid', () => {
    expect(spineLine({ loaded, released, counts, collection: 'the collection failed: no gc', reasons: ['released: the 1-minute load reached 5.2 and its 30 s pair 4.9 (a valid run stays under 5 throughout, or its 30 s pair under 4.7)'] })).toContain(
      ' · before the released window, the collection failed: no gc · invalid: released: the 1-minute load reached 5.2 and its 30 s pair 4.9 (a valid run stays under 5 throughout, or its 30 s pair under 4.7) · load 3.1 (30 s pair 2.4) loaded, 2.9 (30 s pair 2.6) released',
    );
  });
});

// P5 O3-D M2 (docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md, Interfaces §K): mawsd with the spine, read loaded,
// released and re-executed, each window mawsd's median and the engine host's; the verdict D5 reads is the released
// mawsd against the headroom, then the re-executed one.
describe("mawsd with the spine's line", () => {
  const reading = (mawsd: number, engine: number | null, load: number, loadPair: number) => ({
    footprintKiB: mawsd + (engine ?? 0), cpuS: 0.04, samples: 11, load, loadPair,
    processes: [{ argv0: 'mawsd', pid: 61, footprintKiB: mawsd, cpuS: 0.03 }, ...(engine === null ? [] : [{ argv0: 'maws-supervisor', pid: 62, footprintKiB: engine, cpuS: 0.01 }])],
  });
  const counts = { sessions: 5_000, projects: 50, attention: 300, pending: 40, library: 1_000, drafts: 50, history: 2_000 };
  const windows = { loaded: reading(98_765.4, 60_123.6, 3.1, 2.4), released: reading(41_000.2, 60_200, 4.2, 3.0), reexecuted: reading(31_500, null, 2.9, 2.2) };
  const valid = { loaded: [], released: [], reexecuted: [] };

  it('reads each window’s medians for mawsd and the engine host, the peak load with its pair, each window’s validity, and both verdicts', () => {
    expect(MAWSD_HEADROOM_KIB).toBe(33_048);
    expect(mawsdSpineLine({ windows, reasons: valid, counts })).toBe(
      '[daemon-idle] mawsd with the spine · loaded: mawsd 98765 KiB, engine host 60124 KiB (medians of 11), cpu 0.04 s, load 3.1 (30 s pair 2.4), valid · released: mawsd 41000 KiB, engine host 60200 KiB (medians of 11), cpu 0.04 s, load 4.2 (30 s pair 3.0), valid · re-executed: mawsd 31500 KiB, engine host not running (medians of 11), cpu 0.04 s, load 2.9 (30 s pair 2.2), valid · peak load 4.2 (30 s pair 3.0) · released mawsd over the 33048 KiB headroom, re-executed mawsd within it · fixture 5000 sessions in 50 projects',
    );
  });

  it('names an unread window and why a window is invalid', () => {
    const line = mawsdSpineLine({ windows: { ...windows, reexecuted: null }, reasons: { ...valid, released: ['the 1-minute load reached 5.2 and its 30 s pair 4.9'] }, counts });
    expect(line).toContain(' · released: mawsd 41000 KiB, engine host 60200 KiB (medians of 11), cpu 0.04 s, load 4.2 (30 s pair 3.0), invalid: the 1-minute load reached 5.2 and its 30 s pair 4.9 · re-executed: not read, valid · ');
    expect(line).toContain(' · released mawsd over the 33048 KiB headroom, re-executed mawsd not read · ');
  });
});

// P5 O16 M6 (docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, Interfaces §I; D3, D18): one session host holding an idle
// stub-engine session on the daemon shape, measured alone against its own bound.
describe("the session host's case", () => {
  const root = '/private/var/folders/x/T/maws-di-sh-abc';
  const hosts = `${root}/ud/supervisor/hosts`;

  it('settles 60 s, then reads every 30 s for 300 s: 11 samples, under the same load rule; the bound is 4 MiB', () => {
    expect(SESSION_HOST_RUN).toEqual({ settleS: 60, windowS: 300, everyS: 30, samples: 11, maxLoad: 5, pairLoad: 4.7 });
    expect(SESSION_HOST_BOUND_KIB).toBe(4_096);
  });

  it("measures the profile's session hosts by their argv0's name, a checkout's prebuild or a packaged one: never the engine host, the engine, a look-alike, a process naming the binary in an argument, or another profile's host", () => {
    const processes = [
      { pid: 20, command: `/repo/native/session-host/prebuilds/darwin-arm64/maws-session-host ${hosts}/abcd1234.sock --hosts ${hosts}` },
      { pid: 21, command: `maws-supervisor /repo/out/engine-host/index.js --detached ${root}/ud/supervisor` },
      { pid: 22, command: `node ${root}/stub-engine/claude -p --session-id x` },
      { pid: 23, command: `/repo/bin/maws-session-host-old ${hosts}/efgh5678.sock --hosts ${hosts}` },
      { pid: 24, command: `file /repo/native/session-host/prebuilds/darwin-arm64/maws-session-host ${hosts}` },
      { pid: 25, command: '/repo/native/session-host/prebuilds/darwin-arm64/maws-session-host /x/T/maws-session-hosts-0123456789ab/ijkl9012.sock --hosts /private/var/folders/x/T/maws-di-other/ud/supervisor/hosts' },
      { pid: 26, command: `/Applications/MAWS.app/Contents/Resources/session-host/maws-session-host /x/T/maws-session-hosts-0123456789ab/mnop3456.sock --hosts ${hosts}` },
      { pid: 27, command: `maws-session-host ${hosts}/qrst7890.sock --hosts ${hosts}` },
    ];
    expect(sessionHosts(processes, root)).toEqual([
      { pid: 20, argv0: 'maws-session-host', command: processes[0]!.command },
      { pid: 26, argv0: 'maws-session-host', command: processes[6]!.command },
      { pid: 27, argv0: 'maws-session-host', command: processes[7]!.command },
    ]);
  });

  it('misses nothing at or under the bound, rounding the footprint as the line prints it, and names a miss and by how much', () => {
    expect(sessionHostMisses(3_089)).toEqual([]);
    expect(sessionHostMisses(4_096.4)).toEqual([]);
    expect(sessionHostMisses(4_096.6)).toEqual(["the footprint 4097 KiB is 1 KiB over the session host's bound 4096 KiB"]);
    expect(sessionHostMisses(5_000)).toEqual(["the footprint 5000 KiB is 904 KiB over the session host's bound 4096 KiB"]);
  });

  it('reads as the document quotes it, `session host: footprint <KiB> (bound 4096) <verdict>`, then the samples, the RSS and CPU as diagnostics and the load with its pair', () => {
    expect(sessionHostLine({ footprintKiB: 3_089.4, rssKiB: 4_784, samples: 11, cpuS: 0.01, load: 2.31, loadPair: 1.52 })).toBe(
      '[daemon-idle] session host: footprint 3089 KiB (bound 4096) within · median of 11 · rss 4784 KiB · cpu 0.01 s over 300 s · load 2.3 (30 s pair 1.5)',
    );
    expect(sessionHostLine({ footprintKiB: 5_000, rssKiB: 6_000, samples: 11, cpuS: 0.2, load: 3, loadPair: 2 })).toBe(
      '[daemon-idle] session host: footprint 5000 KiB (bound 4096) over by 904 KiB · median of 11 · rss 6000 KiB · cpu 0.20 s over 300 s · load 3.0 (30 s pair 2.0)',
    );
  });
});
