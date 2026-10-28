// The idle-cost measurement's numbers (P5 O2, M1; docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, acceptance 7; P5
// acceptance 14): the statistics, the readers, the run's validity, the baseline and the bound. The measurement itself is
// e2e/daemon-idle.spec.ts: the physical footprint and CPU time of the processes that stay behind on a machine with the
// app quit and one kept session held idle. At M1 that is today's detached supervisor (argv0 `maws-supervisor`); M9
// measures the daemon shape's processes (`mawsd` beside the engine host, and the pty host if it runs) against the bound.
//
// Memory is each process's physical footprint (P5 Decision Log 48): `ri_phys_footprint`, what macOS charges a process
// and Activity Monitor's Memory column shows. RSS falls as macOS compresses an idle process's dirty pages under other
// jobs' pressure and counts shared clean pages, so three runs of the same supervisor spread 2x on the mini; the
// footprint keeps compressed pages and leaves shared clean ones out. RSS stays in the line and the JSON as a diagnostic.
//
// The baseline is three runs of the supervisor's scene on the mini (e2e:daemon-idle-baseline): the median of their
// footprint medians and the median of their CPU times, with the run ids and the commit. M1 recorded it at M1's `src/`;
// since O2's landing it is the landing tree's own supervisor, re-measured when a landing misses. The bound is derived
// from it alone (P5 Decision Log 57's derivation). The runtime floor is a diagnostic: three runs of the floor's scene,
// the bare Electron binary as Node holding an empty script alive, which is what `mawsd` runs on, recorded as the median
// of their footprint medians with the Electron version, since it measures the runtime and not `src/`. It tells how much
// of a footprint is the runtime's, and enters no bound. Each record is written by a recording commit touching only this
// file (and, at O2's landing, its test, which since derives from the records).
import { execFileSync } from 'node:child_process';

export const IDLE_RUN = { settleS: 120, windowS: 600, everyS: 30, samples: 21, maxLoad: 5 } as const;

interface IdleRecord {
  commit: string;
  runs: string[]; // the three GitHub Actions run ids
  footprintKiB: number; // the median of the runs' footprint medians, the measured processes summed per sample
}

export interface DaemonIdleBaseline extends IdleRecord {
  cpuS: number; // the median of the runs' CPU seconds over the window, summed across the measured processes
}

export interface DaemonIdleRuntimeFloor extends IdleRecord {
  electron: string; // process.versions.electron of the binary the floor ran
}

// History, no longer the bound's: M1's record, from three e2e:daemon-idle runs on the mini at d14e92991, the footprint
// reader on M1's `src/` (P5 Decision Log 54): footprints 64481, 66033 and 63969 KiB, CPU 0.12, 0.11 and 0.11 s, load
// 3.3, 3.0 and 2.7. It gave the bound 96721 KiB and 1.11 s.
export const DAEMON_IDLE_BASELINE_M1: DaemonIdleBaseline = { commit: 'd14e92991', runs: ['40490756731', '40492851056', '40495339208'], footprintKiB: 64481, cpuS: 0.11 };

// The bound's baseline: today's detached supervisor on the landing tree itself. The architect's ruling at O2's landing
// (superseding P5 Decision Log 57's fixed number): the bound is 1.5 times today's supervisor measured on the same tree,
// re-measured with e2e:daemon-idle-baseline whenever a landing misses it. Three valid runs on the mini: 65729 KiB at
// 7ff8f582 (40650181035, load 4.2, CPU 0.10 s), 70881 KiB (40669418019, load 3.4, 0.11 s) and 67409 KiB (40673974571,
// load 4.6, 0.14 s), the latter two at d6037a48a; three more were invalid on the load rule: 40647561480 (11.0),
// 40652728419 (14.8) and 40657230165 (25.8).
export const DAEMON_IDLE_BASELINE: DaemonIdleBaseline = { commit: 'd6037a48a', runs: ['40650181035', '40669418019', '40673974571'], footprintKiB: 67409, cpuS: 0.11 };

// A diagnostic (P5 Decision Log 57), recorded from three valid e2e:daemon-idle-floor runs on the mini at 36704c984:
// footprints 12689, 13153 and 13185 KiB (1.04x), CPU 0.00 s each, load 2.9, 4.3 and 3.3; a fourth run (40502284016,
// 12657 KiB) was invalid on the load rule (7.7).
export const DAEMON_IDLE_RUNTIME_FLOOR: DaemonIdleRuntimeFloor = { commit: '36704c984', runs: ['40498387866', '40500435129', '40504203813'], footprintKiB: 13153, electron: '44.4.5' };

export interface DaemonIdleBound {
  footprintKiB: number; // the daemon shape's processes together
  cpuS: number; // the daemon shape's processes together, over IDLE_RUN.windowS
}

export const FOOTPRINT_FACTOR = 1.5;
export const CPU_ALLOWANCE_S_PER_600 = 1.0;

// The daemon shape's processes together (`mawsd` and the engine host, and the pty host if it runs) stay within 1.5
// times today's supervisor's footprint, in whole KiB and never above 1.5x, and within its CPU time plus 1.0 s per 600 s
// of window, in centiseconds (ps's resolution). That is acceptance 14's statement to the owner: the daemon shape costs
// the laptop at most half again what today's supervisor does (P5 Decision Log 57, reversing 54's per-process rule: the
// bare runtime is 13 MiB, so 1.5x of it would fail `mawsd` by construction).
export function idleBound(baseline: DaemonIdleBaseline, windowS: number = IDLE_RUN.windowS): DaemonIdleBound {
  return {
    footprintKiB: Math.floor(baseline.footprintKiB * FOOTPRINT_FACTOR),
    cpuS: Math.round((baseline.cpuS + (CPU_ALLOWANCE_S_PER_600 * windowS) / 600) * 100) / 100,
  };
}

// 101113 KiB and 1.11 s. The daemon shape at the landing, judged in the same quiet window on d6037a48a: 40671838782 at
// 97683 KiB (load 3.4) and 40676048769 at 99219 KiB (load 3.8) within it; 40678158535 at 96675 KiB was invalid on load
// (7.6). Two of the two valid runs are within.
export const DAEMON_IDLE_BOUND: DaemonIdleBound = idleBound(DAEMON_IDLE_BASELINE);

// What is wrong with a recorded baseline or runtime floor, each one line; empty when it is well formed, and for none
// recorded yet.
export function baselineProblems(record: DaemonIdleBaseline | DaemonIdleRuntimeFloor | null): string[] {
  if (record === null) return [];
  const problems: string[] = [];
  if (!/^[0-9a-f]{7,40}$/.test(record.commit)) problems.push(`commit ${record.commit} is not a sha`);
  if (record.runs.length !== 3 || new Set(record.runs).size !== 3) problems.push(`runs [${record.runs.join(', ')}] are not three distinct run ids`);
  if (!(record.footprintKiB > 0)) problems.push(`footprintKiB ${record.footprintKiB} is not a positive number of KiB`);
  if ('cpuS' in record && !(record.cpuS >= 0)) problems.push(`cpuS ${record.cpuS} is negative`);
  if ('electron' in record && !/^\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(record.electron)) problems.push(`electron ${record.electron} is not a version`);
  return problems;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error('no samples to take the median of');
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

// `ps -o time=`, the CPU time (user and system) a process has used, in seconds to the centisecond. macOS prints m:ss.cc
// with the minutes unbounded (`919:56.57`); Linux's procps prints hh:mm:ss, with `d-` before it past a day.
export function cpuSeconds(text: string): number {
  const match = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d{2})(?:\.(\d{1,2}))?$/.exec(text.trim());
  const [days, hours, minutes, seconds] = (match?.slice(1, 5) ?? []).map((part) => Number(part ?? 0));
  const hourly = match?.[2] !== undefined;
  if (!match || (match[1] !== undefined && !hourly) || seconds! >= 60 || (hourly && minutes! >= 60)) throw new Error(`not a ps time: ${JSON.stringify(text)}`);
  const centis = Number((match[5] ?? '0').padEnd(2, '0'));
  return Math.round(((days! * 24 + hours!) * 3_600 + minutes! * 60 + seconds!) * 100 + centis) / 100;
}

// The footprint reader (macOS): libproc's proc_pid_rusage, which needs no task port, no root and no TCC grant for a
// process of the same user, so it reads a hardened-runtime binary such as Electron's. It runs through the python3 the
// runner already has (ctypes, no package), one call for every pid, and prints per pid `<pid> <ri_phys_footprint>
// <ri_resident_size>` in bytes, or `<pid> errno <n>`. RUSAGE_INFO_V0's struct is 12 64-bit words: the 16-byte uuid, then
// user and system time, idle and interrupt wakeups, pageins, wired size, resident size (word 8), footprint (word 9).
const FOOTPRINT_READER = `
import ctypes, sys
libproc = ctypes.CDLL('/usr/lib/libproc.dylib', use_errno=True)
for pid in sys.argv[1:]:
    info = (ctypes.c_uint64 * 12)()
    if libproc.proc_pid_rusage(int(pid), 0, info) == 0: print(pid, info[9], info[8])
    else: print(pid, 'errno', ctypes.get_errno())
`;

export interface Footprint {
  footprintKiB: number;
  residentKiB: number;
}

// The reader's output, by pid: a pid it could not read (gone, or not ours) gives the call's errno. A pid with no line,
// or a line of another form, is the reader failing, and throws quoting what it printed.
export function footprints(text: string, pids: readonly number[]): Map<number, Footprint | { errno: number }> {
  const lines = new Map(text.split('\n').map((line) => [line.split(' ')[0], line] as const));
  return new Map(
    pids.map((pid): [number, Footprint | { errno: number }] => {
      const line = lines.get(String(pid)) ?? '';
      const failed = new RegExp(`^${pid} errno (\\d+)$`).exec(line);
      if (failed) return [pid, { errno: Number(failed[1]) }];
      const match = new RegExp(`^${pid} (\\d+) (\\d+)$`).exec(line);
      if (!match) throw new Error(`the footprint reader printed no line for pid ${pid}: ${JSON.stringify(text)}`);
      return [pid, { footprintKiB: Number(match[1]) / 1_024, residentKiB: Number(match[2]) / 1_024 }];
    }),
  );
}

export function readFootprints(pids: readonly number[]): Map<number, Footprint | { errno: number }> {
  return footprints(execFileSync('python3', ['-I', '-c', FOOTPRINT_READER, ...pids.map(String)], { encoding: 'utf8' }), pids);
}

// The second, independent reader: top's MEM column, which top(1) documents as the physical memory footprint. It prints
// a value rounded to its unit (`9985K`, `12M`, `2G`), sometimes with a `+` or `-` change marker.
export interface TopMem {
  kiB: number;
  resolutionKiB: number; // one step of what top printed
  text: string;
}

const TOP_UNIT_KIB: Record<string, number> = { B: 1 / 1_024, K: 1, M: 1_024, G: 1_048_576, T: 1_073_741_824 };

export function topMem(text: string): Map<number, TopMem> {
  const lines = text.split('\n');
  const header = lines.findIndex((line) => /^\s*PID\s+MEM\s*$/.test(line));
  if (header < 0) throw new Error(`top printed no PID MEM header: ${JSON.stringify(text)}`);
  const rows = new Map<number, TopMem>();
  for (const line of lines.slice(header + 1).filter((l) => l.trim() !== '')) {
    const match = /^\s*(\d+)\s+((\d+)(?:\.(\d+))?([BKMGT])[+-]?)\s*$/.exec(line);
    if (!match) throw new Error(`not a top MEM row: ${JSON.stringify(line)}`);
    const unit = TOP_UNIT_KIB[match[5]!]!;
    const decimals = match[4]?.length ?? 0;
    rows.set(Number(match[1]), { kiB: Number(`${match[3]}.${match[4] ?? '0'}`) * unit, resolutionKiB: unit / 10 ** decimals, text: match[2]! });
  }
  return rows;
}

export function readTopMem(pids: readonly number[]): Map<number, TopMem> {
  const args = ['-l', '1', '-stats', 'pid,mem', ...pids.flatMap((pid) => ['-pid', String(pid)])];
  return topMem(execFileSync('top', args, { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } }));
}

export const READER_TOLERANCE = 0.02; // beyond one step of top's printed value

// Where the two readers, read back to back, disagree by more than one step of top's value and 2% of the footprint,
// each one line; a run with any is invalid (its footprint reader is not reading what top calls the footprint).
export function readerMismatches(readings: readonly { pid: number; argv0: string; footprintKiB: number; top: TopMem | null }[]): string[] {
  return readings.flatMap(({ pid, argv0, footprintKiB, top }) => {
    const kiB = Math.round(footprintKiB);
    if (top === null) return [`top printed no MEM for ${argv0} pid ${pid} (the footprint reader read ${kiB} KiB)`];
    const tolerance = top.resolutionKiB + READER_TOLERANCE * footprintKiB;
    if (Math.abs(top.kiB - footprintKiB) <= tolerance) return [];
    return [`the footprint readers disagree for ${argv0} pid ${pid}: proc_pid_rusage ${kiB} KiB, top ${top.text} (${Math.round(top.kiB)} KiB), beyond the ${Math.round(tolerance)} KiB tolerance`];
  });
}

export interface MeasuredProcess {
  pid: number;
  argv0: string;
  command: string;
}

// The processes measured among those naming the profile's root (every process MAWS starts for a scratch profile names
// its directory in argv): those whose argv0 is one of `names`. The app and the sessions' `claude` children are not the
// daemon's cost.
export function measured(processes: readonly { pid: number; command: string }[], root: string, names: readonly string[] = ['maws-supervisor']): MeasuredProcess[] {
  return processes
    .filter((p) => p.command.includes(root))
    .map((p) => ({ pid: p.pid, argv0: p.command.split(' ')[0]!, command: p.command }))
    .filter((p) => names.includes(p.argv0));
}

export interface IdleRunCheck {
  loads: readonly number[]; // the 1-minute load at each sample
  measured: readonly string[]; // the argv0 of each process measured
  lost: readonly { pid: number; argv0: string; atS: number }[]; // a measured process found gone, and when in the window
  sessionEnded: boolean; // the kept session's launch ended before the window did
  mismatches: readonly string[]; // readerMismatches at the window's first sample
}

// Why a run is invalid, each reason one line; empty when it is valid.
export function invalidReasons(run: IdleRunCheck): string[] {
  const reasons: string[] = [];
  if (run.measured.length === 0) reasons.push('no process of the profile to measure');
  const peak = Math.max(...run.loads);
  if (peak >= IDLE_RUN.maxLoad) reasons.push(`the 1-minute load reached ${peak.toFixed(1)} (a valid run stays under ${IDLE_RUN.maxLoad} throughout)`);
  for (const p of run.lost) reasons.push(`${p.argv0} pid ${p.pid} was gone at ${p.atS} s of the ${IDLE_RUN.windowS} s window`);
  if (run.sessionEnded) reasons.push('the kept session ended before the window did (the scene measures one held idle session)');
  reasons.push(...run.mismatches);
  return reasons;
}

// The runtime floor's line, with the Electron version the floor measured.
export function floorLine(run: { footprintKiB: number; rssKiB: number; samples: number; cpuS: number; electron: string; load: number }): string {
  return `[daemon-idle] runtime floor footprint ${Math.round(run.footprintKiB)} KiB (median of ${run.samples}) · rss ${Math.round(run.rssKiB)} KiB · cpu ${run.cpuS.toFixed(2)} s · electron ${run.electron} · load ${run.load.toFixed(1)}`;
}

// P5 O2 M9: where the daemon shape's processes together exceed the bound, each one line; empty when within it. The
// footprint is compared in whole KiB, as the line prints it and the bound is derived.
export function boundMisses(run: { footprintKiB: number; cpuS: number }, bound: DaemonIdleBound = DAEMON_IDLE_BOUND): string[] {
  const misses: string[] = [];
  const footprint = Math.round(run.footprintKiB);
  if (footprint > bound.footprintKiB) misses.push(`the footprint ${footprint} KiB is ${footprint - bound.footprintKiB} KiB over the bound ${bound.footprintKiB} KiB`);
  if (run.cpuS > bound.cpuS) misses.push(`the cpu ${run.cpuS.toFixed(2)} s is ${(run.cpuS - bound.cpuS).toFixed(2)} s over the bound ${bound.cpuS.toFixed(2)} s`);
  return misses;
}

export interface ProcessFootprint {
  argv0: string;
  footprintKiB: number; // the median of this process's own samples over the window
}

// The job log's line; `load` is the highest 1-minute load the window read. Each measured process is named with its own
// footprint (a miss then names its hop; the per-process medians need not sum to the summed median). `bound` is the
// daemon shape's (M9), whose verdict the line states; null for the supervisor's scene, which records only. The Electron
// version is compared with the runtime floor's, a diagnostic: a floor recorded on another Electron says less.
export function idleLine(run: { footprintKiB: number; rssKiB: number; samples: number; cpuS: number; processes: readonly ProcessFootprint[]; bound: DaemonIdleBound | null; electron: string; load: number }): string {
  const processes = run.processes.map((p) => `${p.argv0} ${Math.round(p.footprintKiB)} KiB`).join(', ');
  const limit = run.bound === null ? null : `the bound ${run.bound.footprintKiB} KiB and ${run.bound.cpuS.toFixed(2)} s`;
  const misses = run.bound === null ? [] : boundMisses(run, run.bound);
  const verdict = limit === null ? '' : misses.length === 0 ? ` · within ${limit}` : ` · over ${limit}: ${misses.join('; ')}`;
  const floor = DAEMON_IDLE_RUNTIME_FLOOR.electron;
  const electron = run.electron === floor ? `${run.electron}, the runtime floor's` : `${run.electron}, not the runtime floor's ${floor}`;
  return `[daemon-idle] footprint ${Math.round(run.footprintKiB)} KiB (median of ${run.samples}) · rss ${Math.round(run.rssKiB)} KiB · cpu ${run.cpuS.toFixed(2)} s over ${IDLE_RUN.windowS} s · processes ${processes}${verdict} · electron ${electron} · load ${run.load.toFixed(1)}`;
}

// P5 O2 M5 (P5 Decision Log 57's early check): `mawsd` alone, idle, with no hosts and no app. The line names its
// footprint beside what the combined bound leaves it once the engine host's baseline is counted: the bound less the
// baseline's footprint. A miss is no failure here; it reaches the architect as a P5 §10 finding.
export const MAWSD_HEADROOM_KIB = DAEMON_IDLE_BOUND.footprintKiB - DAEMON_IDLE_BASELINE.footprintKiB;

export function mawsdLine(run: { footprintKiB: number; rssKiB: number; samples: number; cpuS: number; load: number }): string {
  const fits = run.footprintKiB <= MAWSD_HEADROOM_KIB ? 'within' : 'over';
  return `[daemon-idle] mawsd footprint ${Math.round(run.footprintKiB)} KiB (median of ${run.samples}) · rss ${Math.round(run.rssKiB)} KiB · cpu ${run.cpuS.toFixed(2)} s over ${IDLE_RUN.windowS} s · ${fits} the ${MAWSD_HEADROOM_KIB} KiB the bound leaves it beside the engine host's ${DAEMON_IDLE_BASELINE.footprintKiB} KiB · load ${run.load.toFixed(1)}`;
}

// P5 O10 M10 (P5 Decision Log 114): an enrolled machine's endpoint has a budget of its own, 8 MiB of physical footprint
// over the unenrolled daemon shape (its idle CPU share set at landing to 1.5 times the enrolled reading). The scene
// measures both in one run (e2e/daemon-idle.spec.ts): its window unenrolled, then the same processes' window once the
// scene's mawsd is enrolled and listed. The line states the budget's verdict and asserts nothing.
export const ENROLLED_INCREMENT_BUDGET_KIB = 8 * 1024;

export interface ProcessReading extends ProcessFootprint {
  pid: number;
  cpuS: number; // this process's CPU seconds over the window
}

export interface ShapeReading {
  footprintKiB: number; // the measured processes summed per sample, the median
  cpuS: number;
  samples: number;
  load: number; // the highest 1-minute load the window read
  processes: readonly ProcessReading[];
}

const signed = (value: number, digits = 0) => `${value < 0 ? '-' : '+'}${Math.abs(value).toFixed(digits)}`;

// The job log's line: the increment in footprint and CPU, each process's share of it (matched by pid across the two
// windows), the budget's verdict, whether the run is valid (`reasons`, both windows' and the scene's) and both loads.
export function enrolledLine(run: { unenrolled: ShapeReading; enrolled: ShapeReading; reasons: readonly string[] }): string {
  const { unenrolled, enrolled } = run;
  const footprint = Math.round(enrolled.footprintKiB) - Math.round(unenrolled.footprintKiB);
  const cpu = Math.round((enrolled.cpuS - unenrolled.cpuS) * 100) / 100;
  const before = new Map(unenrolled.processes.map((p) => [p.pid, p]));
  const after = new Set(enrolled.processes.map((p) => p.pid));
  const share = (p: ProcessReading) => {
    const was = before.get(p.pid);
    return was === undefined ? `${p.argv0} ${Math.round(p.footprintKiB)} KiB ${p.cpuS.toFixed(2)} s, in the enrolled window alone` : `${p.argv0} ${signed(Math.round(p.footprintKiB) - Math.round(was.footprintKiB))} KiB ${signed(Math.round((p.cpuS - was.cpuS) * 100) / 100, 2)} s`;
  };
  const gone = unenrolled.processes.filter((p) => !after.has(p.pid)).map((p) => `${p.argv0} ${Math.round(p.footprintKiB)} KiB ${p.cpuS.toFixed(2)} s, in the unenrolled window alone`);
  const processes = [...enrolled.processes.map(share), ...gone].join(', ');
  const budget = `${footprint <= ENROLLED_INCREMENT_BUDGET_KIB ? 'within' : 'over'} the ${ENROLLED_INCREMENT_BUDGET_KIB} KiB budget (P5 Decision Log 114)`;
  const validity = run.reasons.length === 0 ? 'valid' : `invalid: ${run.reasons.join('; ')}`;
  return `[daemon-idle] enrolled endpoint footprint ${signed(footprint)} KiB (enrolled ${Math.round(enrolled.footprintKiB)} KiB, unenrolled ${Math.round(unenrolled.footprintKiB)} KiB; medians of ${enrolled.samples} and ${unenrolled.samples}) · cpu ${signed(cpu, 2)} s over ${IDLE_RUN.windowS} s (enrolled ${enrolled.cpuS.toFixed(2)} s, unenrolled ${unenrolled.cpuS.toFixed(2)} s) · processes ${processes} · ${budget} · ${validity} · load ${enrolled.load.toFixed(1)} enrolled, ${unenrolled.load.toFixed(1)} unenrolled`;
}

// The A-B-A reading, for the bound's re-derivation (after P5 O10 M10): the first case's scene three times back to back
// in one job, each window on a fresh launch: today's detached supervisor (A), the daemon shape (B), the supervisor again
// (A'). The engine host reads 65 to 73 MiB run to run with no code change while mawsd holds at 31.2 to 31.8, so a fixed
// bound on B flaps. When A and A' agree with each other but not with other jobs, the spread is the machine's state and
// pairing B with them cancels it; when they differ as much as runs do, it is each launch's, and pairing does not help.
// Recorded only: no bound is asserted.
export interface AbaDeltas {
  aMean: { footprintKiB: number; cpuS: number }; // the mean of A and A', in whole KiB and centiseconds
  footprintKiB: number; // B less the A mean, in whole KiB as the line prints them
  cpuS: number;
  ratio: number; // B's footprint over the A mean, to three places
  spread: { footprintKiB: number; cpuS: number }; // A less A'
  processes: { argv0: string; footprintKiB: number; cpuS: number }[]; // each of B's processes both A windows measured, less its A mean
  alone: string[]; // the argv0 of B's processes neither A window measured (mawsd, and the pty host if it ran)
}

const centis = (value: number) => Math.round(value * 100) / 100;

export function abaDeltas(a: ShapeReading, b: ShapeReading, a2: ShapeReading): AbaDeltas {
  const aMean = { footprintKiB: Math.round((a.footprintKiB + a2.footprintKiB) / 2), cpuS: centis((a.cpuS + a2.cpuS) / 2) };
  const own = (run: ShapeReading, argv0: string) => run.processes.find((p) => p.argv0 === argv0);
  const processes = b.processes.flatMap((p) => {
    const [first, second] = [own(a, p.argv0), own(a2, p.argv0)];
    return first === undefined || second === undefined ? [] : [{ argv0: p.argv0, footprintKiB: Math.round(p.footprintKiB) - Math.round((first.footprintKiB + second.footprintKiB) / 2), cpuS: centis(p.cpuS - (first.cpuS + second.cpuS) / 2) }];
  });
  return {
    aMean,
    footprintKiB: Math.round(b.footprintKiB) - aMean.footprintKiB,
    cpuS: centis(b.cpuS - aMean.cpuS),
    ratio: Math.round((Math.round(b.footprintKiB) / aMean.footprintKiB) * 1_000) / 1_000,
    spread: { footprintKiB: Math.round(a.footprintKiB) - Math.round(a2.footprintKiB), cpuS: centis(a.cpuS - a2.cpuS) },
    processes,
    alone: b.processes.filter((p) => !processes.some((q) => q.argv0 === p.argv0)).map((p) => p.argv0),
  };
}

// The job log's line: the deltas first (B against the A mean, with the ratio a paired bound would read, and A against
// A'), each of B's processes against its A mean, then each window's footprint, CPU and per-process medians with its
// load, the sample counts and the validity, every window's (`reasons`). `windowS` is the window the run read.
export function abaLine(run: { a: ShapeReading; b: ShapeReading; a2: ShapeReading; reasons: readonly string[]; windowS: number }): string {
  const { a, b, a2 } = run;
  const d = abaDeltas(a, b, a2);
  const window = (name: string, shape: string, r: ShapeReading) =>
    `${name} ${shape} ${Math.round(r.footprintKiB)} KiB ${r.cpuS.toFixed(2)} s (${r.processes.map((p) => `${p.argv0} ${Math.round(p.footprintKiB)} KiB ${p.cpuS.toFixed(2)} s`).join(', ')}; load ${r.load.toFixed(1)})`;
  const processes = b.processes.map((p) => {
    const delta = d.processes.find((q) => q.argv0 === p.argv0);
    return delta === undefined ? `${p.argv0} in B alone` : `${p.argv0} ${signed(delta.footprintKiB)} KiB ${signed(delta.cpuS, 2)} s`;
  }).join(', ');
  const validity = run.reasons.length === 0 ? 'valid' : `invalid: ${run.reasons.join('; ')}`;
  return `[daemon-idle] A-B-A footprint B ${signed(d.footprintKiB)} KiB against the A mean ${d.aMean.footprintKiB} KiB (x${d.ratio.toFixed(3)}), A ${signed(d.spread.footprintKiB)} KiB against A' · cpu B ${signed(d.cpuS, 2)} s against the A mean ${d.aMean.cpuS.toFixed(2)} s, A ${signed(d.spread.cpuS, 2)} s against A' · B's processes against the A mean: ${processes} · ${window('A', 'detached', a)} · ${window('B', 'daemon', b)} · ${window("A'", 'detached', a2)} · medians of ${a.samples}, ${b.samples} and ${a2.samples} over ${run.windowS} s each · ${validity}`;
}
