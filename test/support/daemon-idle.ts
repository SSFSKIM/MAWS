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
import { cpus } from 'node:os';
import { basename } from 'node:path';
import type { SpineFixtureCounts } from './spine-fixture';

// The window, and its load rule (the architect's Rule B at 4.7). A window is void on load when its 1-minute
// load reaches maxLoad at a sample and its 30 s pair reaches pairLoad: the highest load two adjacent 30 s intervals both
// held, each interval's own average rebuilt from the 1-minute series (loadPair). What voids a window is sustained load.
// A burst, one short system-wide wakeup the 1-minute average smears over about 90 s so that two or three samples read 5
// or more, raises one interval alone and leaves the window valid. The pair guards the peak rule and can only exempt: a
// window under maxLoad throughout is valid whatever its pair. pairLoad sits in the middle of the thresholds, 4.2 to 5.2,
// that score every re-scored window alike: the exempted bursts' pairs reach 4.15 at most, the sustained windows' read
// 5.24 at least (the boundary windows are daemon-idle.test.ts's fixtures).
export const IDLE_RUN = { settleS: 120, windowS: 600, everyS: 30, samples: 21, maxLoad: 5, pairLoad: 4.7 } as const;

// The 1-minute load is an exponential average with a 60 s time constant, so across an interval of everyS it moves from
// l(t-1) to e^(-everyS/60) l(t-1) + (1 - e^(-everyS/60)) u(t), u(t) the interval's own average load. Inverted, at the
// window's nominal spacing: u(t) for each interval after the first sample.
const SPACING_DECAY = Math.exp(-IDLE_RUN.everyS / 60);

export function intervalLoads(loads: readonly number[]): number[] {
  return loads.slice(1).map((load, t) => (load - SPACING_DECAY * loads[t]!) / (1 - SPACING_DECAY));
}

// The window's 30 s pair: the highest load two adjacent intervals both reached, max over t of min(u(t), u(t+1)).
export function loadPair(loads: readonly number[]): number {
  const u = intervalLoads(loads);
  if (u.length < 2) throw new Error(`${loads.length} samples rebuild no two adjacent ${IDLE_RUN.everyS} s intervals`);
  return Math.max(...u.slice(1).map((next, t) => Math.min(u[t]!, next)));
}

// A window's load as the lines print it: the highest 1-minute load, and the 30 s pair beside it.
const loadText = (load: number, pair: number) => `${load.toFixed(1)} (${IDLE_RUN.everyS} s pair ${pair.toFixed(1)})`;

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

// History, no longer the bound's: O2's landing record, from three valid e2e:daemon-idle-baseline runs on the mini: 65729
// KiB at 7ff8f582 (40650181035, load 4.2, CPU 0.10 s), 70881 KiB (40669418019, load 3.4, 0.11 s) and 67409 KiB
// (40673974571, load 4.6, 0.14 s), the latter two at d6037a48a; three more were invalid on the load rule: 40647561480
// (11.0), 40652728419 (14.8) and 40657230165 (25.8). It gave the bound 101113 KiB and 1.11 s, which master itself read
// above on 2026-10-28 (103203 KiB) while the mini held 9.76 GB wired from a tart leak.
export const DAEMON_IDLE_BASELINE_O2: DaemonIdleBaseline = { commit: 'd6037a48a', runs: ['40650181035', '40669418019', '40673974571'], footprintKiB: 67409, cpuS: 0.11 };

// The bound's baseline: today's detached supervisor on the landing tree itself. The architect's ruling at O2's landing
// (superseding P5 Decision Log 57's fixed number): the bound is 1.5 times today's supervisor measured on the same tree,
// re-measured with e2e:daemon-idle-baseline whenever a landing misses it. Re-derived after P5 O10 M10 (P5 Decision Log
// 107) on the mini rebooted at 2026-10-28 21:27Z (1.83 GB wired, 82% free), Activity Monitor open on its desktop at
// about 5% CPU in every window, all at d0802b29d: 66737 KiB (40791210494, load 2.4, CPU 0.12 s), 66097 KiB
// (40795119204, load 3.7, 0.11 s), and the A-B-A 40778748076 as the mean of its two detached windows, 66073 KiB (65537
// at load 4.5 and 66609 at 3.7, 0.12 s each), the reading its own daemon window is paired with. Void on load: 40789442114
// (66001 KiB, 9.5) and 40793346639 (66273 KiB, 5.4, at 178eb02d8, whose supervisor bundle differs from d0802b29d's only
// by O8 M3's org ipc schema, 48 lines of module-level zod objects), each from Apple Intelligence's post-reboot
// app-content indexing (corespotlightd, spotlightknowledged; Spotlight's file indexing is off on the mini).
export const DAEMON_IDLE_BASELINE: DaemonIdleBaseline = { commit: 'd0802b29d', runs: ['40778748076', '40791210494', '40795119204'], footprintKiB: 66097, cpuS: 0.12 };

// A diagnostic (P5 Decision Log 57), recorded from three valid e2e:daemon-idle-floor runs on the mini at 36704c984:
// footprints 12689, 13153 and 13185 KiB (1.04x), CPU 0.00 s each, load 2.9, 4.3 and 3.3; a fourth run (40502284016,
// 12657 KiB) was invalid on the peak rule then (7.7). The 30 s pair reclassifies it as a burst by its shape, 2.5, 7.7,
// 5.4, 3.7, 2.7 (30 s pair 2.8), so it is valid today; it was a diagnostic run, and the record stands as recorded.
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

// 99145 KiB and 1.12 s. The daemon shape in the same series: the A-B-A's daemon window, 95907 KiB (mawsd 29409, engine
// host 66497; load 4.7), x1.452 its own detached mean, within it. At O2's landing it was 101113 KiB, the daemon shape on
// d6037a48a reading 97683 KiB (40671838782, load 3.4) and 99219 KiB (40676048769, load 3.8).
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

// The window's diagnostics, recorded at every sample beside the readings and read by no verdict: what the machine was
// doing while the load moved. The cores' cumulative times (os.cpus(), summed, in ms), from which each interval's busy
// share follows, and the process outside the measured set that used the most CPU over the interval, from the one
// process table the sample reads anyway (it also tells which measured processes are still alive).
export interface CpuTimes {
  user: number;
  nice: number;
  sys: number;
  idle: number;
  irq: number;
}

export function cpuTimes(cores: readonly { times: CpuTimes }[] = cpus()): CpuTimes {
  const sum = (field: keyof CpuTimes) => cores.reduce((total, core) => total + core.times[field], 0);
  return { user: sum('user'), nice: sum('nice'), sys: sum('sys'), idle: sum('idle'), irq: sum('irq') };
}

const totalMs = (t: CpuTimes) => t.user + t.nice + t.sys + t.idle + t.irq;

// The interval's busy share across the cores, 1 - idle delta / total delta, to three places.
export function busyShare(before: CpuTimes, after: CpuTimes): number {
  return Math.round((1 - (after.idle - before.idle) / (totalMs(after) - totalMs(before))) * 1_000) / 1_000;
}

export interface ProcessRow {
  pid: number;
  started: string; // `ps -o lstart=`, as ps() reads it, so a reused pid is told apart
  cpuS: number; // the CPU time it has used, in seconds
  name: string; // its executable's name
}

// One `ps -axo pid=,lstart=,time=,comm=` (macOS, LC_ALL=C), by pid. A line of another form is not a process row.
export function processTable(text: string): Map<number, ProcessRow> {
  const rows = new Map<number, ProcessRow>();
  for (const line of text.split('\n')) {
    const match = /^\s*(\d+)\s+((?:\S+\s+){4}\S+)\s+(\d+(?::\d{2})+(?:\.\d{1,2})?)\s+(.*\S)\s*$/.exec(line);
    if (match) rows.set(Number(match[1]), { pid: Number(match[1]), started: match[2]!, cpuS: cpuSeconds(match[3]!), name: basename(match[4]!) });
  }
  return rows;
}

export function readProcessTable(): Map<number, ProcessRow> {
  return processTable(execFileSync('ps', ['-axo', 'pid=,lstart=,time=,comm='], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } }));
}

export interface TopProcess {
  pid: number;
  name: string;
  cpuS: number; // its CPU seconds over the interval
}

// The process outside `measuredPids` that used the most CPU between two tables, in centiseconds; a process the earlier
// table does not hold as the same process (started since, or a pid reused) counts all its time. Null with no earlier
// table, at the window's first sample. A process that ran and exited within the interval is in neither table.
export function topOutside(before: ReadonlyMap<number, ProcessRow> | null, after: ReadonlyMap<number, ProcessRow>, measuredPids: readonly number[]): TopProcess | null {
  if (before === null) return null;
  let top: TopProcess | null = null;
  for (const row of after.values()) {
    if (measuredPids.includes(row.pid)) continue;
    const was = before.get(row.pid);
    const cpuS = Math.round((was?.started === row.started ? row.cpuS - was.cpuS : row.cpuS) * 100) / 100;
    if (top === null || cpuS > top.cpuS) top = { pid: row.pid, name: row.name, cpuS };
  }
  return top;
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
  const pair = peak >= IDLE_RUN.maxLoad ? loadPair(run.loads) : null; // the pair only ever exempts a window the peak voids
  if (pair !== null && pair >= IDLE_RUN.pairLoad) {
    reasons.push(`the 1-minute load reached ${peak.toFixed(1)} and its ${IDLE_RUN.everyS} s pair ${pair.toFixed(1)} (a valid run stays under ${IDLE_RUN.maxLoad} throughout, or its ${IDLE_RUN.everyS} s pair under ${IDLE_RUN.pairLoad})`);
  }
  for (const p of run.lost) reasons.push(`${p.argv0} pid ${p.pid} was gone at ${p.atS} s of the ${IDLE_RUN.windowS} s window`);
  if (run.sessionEnded) reasons.push('the kept session ended before the window did (the scene measures one held idle session)');
  reasons.push(...run.mismatches);
  return reasons;
}

// The runtime floor's line, with the Electron version the floor measured.
export function floorLine(run: { footprintKiB: number; rssKiB: number; samples: number; cpuS: number; electron: string; load: number; loadPair: number }): string {
  return `[daemon-idle] runtime floor footprint ${Math.round(run.footprintKiB)} KiB (median of ${run.samples}) · rss ${Math.round(run.rssKiB)} KiB · cpu ${run.cpuS.toFixed(2)} s · electron ${run.electron} · load ${loadText(run.load, run.loadPair)}`;
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

// The job log's line; `load` is the highest 1-minute load the window read, printed with the window's 30 s pair
// (`loadPair`) beside it, so a window that peaked and still counted shows why. Each measured process is named with its own
// footprint (a miss then names its hop; the per-process medians need not sum to the summed median). `bound` is the
// daemon shape's (M9), whose verdict the line states; null for the supervisor's scene, which records only. The Electron
// version is compared with the runtime floor's, a diagnostic: a floor recorded on another Electron says less.
export function idleLine(run: { footprintKiB: number; rssKiB: number; samples: number; cpuS: number; processes: readonly ProcessFootprint[]; bound: DaemonIdleBound | null; electron: string; load: number; loadPair: number }): string {
  const processes = run.processes.map((p) => `${p.argv0} ${Math.round(p.footprintKiB)} KiB`).join(', ');
  const limit = run.bound === null ? null : `the bound ${run.bound.footprintKiB} KiB and ${run.bound.cpuS.toFixed(2)} s`;
  const misses = run.bound === null ? [] : boundMisses(run, run.bound);
  const verdict = limit === null ? '' : misses.length === 0 ? ` · within ${limit}` : ` · over ${limit}: ${misses.join('; ')}`;
  const floor = DAEMON_IDLE_RUNTIME_FLOOR.electron;
  const electron = run.electron === floor ? `${run.electron}, the runtime floor's` : `${run.electron}, not the runtime floor's ${floor}`;
  return `[daemon-idle] footprint ${Math.round(run.footprintKiB)} KiB (median of ${run.samples}) · rss ${Math.round(run.rssKiB)} KiB · cpu ${run.cpuS.toFixed(2)} s over ${IDLE_RUN.windowS} s · processes ${processes}${verdict} · electron ${electron} · load ${loadText(run.load, run.loadPair)}`;
}

// P5 O2 M5 (P5 Decision Log 57's early check): `mawsd` alone, idle, with no hosts and no app. The line names its
// footprint beside what the combined bound leaves it once the engine host's baseline is counted: the bound less the
// baseline's footprint. A miss is no failure here; it reaches the architect as a P5 §10 finding.
export const MAWSD_HEADROOM_KIB = DAEMON_IDLE_BOUND.footprintKiB - DAEMON_IDLE_BASELINE.footprintKiB;

export function mawsdLine(run: { footprintKiB: number; rssKiB: number; samples: number; cpuS: number; load: number; loadPair: number }): string {
  const fits = run.footprintKiB <= MAWSD_HEADROOM_KIB ? 'within' : 'over';
  return `[daemon-idle] mawsd footprint ${Math.round(run.footprintKiB)} KiB (median of ${run.samples}) · rss ${Math.round(run.rssKiB)} KiB · cpu ${run.cpuS.toFixed(2)} s over ${IDLE_RUN.windowS} s · ${fits} the ${MAWSD_HEADROOM_KIB} KiB the bound leaves it beside the engine host's ${DAEMON_IDLE_BASELINE.footprintKiB} KiB · load ${loadText(run.load, run.loadPair)}`;
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
  loadPair: number; // the window's 30 s pair (loadPair)
  processes: readonly ProcessReading[];
}

const signed = (value: number, digits = 0) => `${value < 0 ? '-' : '+'}${Math.abs(value).toFixed(digits)}`;

// The job log's line: the increment in footprint and CPU, each process's share of it (matched by pid across the two
// windows), the budget's verdict, whether the run is valid (`reasons`, both windows' and the scene's) and both loads,
// each with its 30 s pair.
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
  return `[daemon-idle] enrolled endpoint footprint ${signed(footprint)} KiB (enrolled ${Math.round(enrolled.footprintKiB)} KiB, unenrolled ${Math.round(unenrolled.footprintKiB)} KiB; medians of ${enrolled.samples} and ${unenrolled.samples}) · cpu ${signed(cpu, 2)} s over ${IDLE_RUN.windowS} s (enrolled ${enrolled.cpuS.toFixed(2)} s, unenrolled ${unenrolled.cpuS.toFixed(2)} s) · processes ${processes} · ${budget} · ${validity} · load ${loadText(enrolled.load, enrolled.loadPair)} enrolled, ${loadText(unenrolled.load, unenrolled.loadPair)} unenrolled`;
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
// load and 30 s pair, the sample counts and the validity, every window's (`reasons`). `windowS` is the run's window.
export function abaLine(run: { a: ShapeReading; b: ShapeReading; a2: ShapeReading; reasons: readonly string[]; windowS: number }): string {
  const { a, b, a2 } = run;
  const d = abaDeltas(a, b, a2);
  const window = (name: string, shape: string, r: ShapeReading) =>
    `${name} ${shape} ${Math.round(r.footprintKiB)} KiB ${r.cpuS.toFixed(2)} s (${r.processes.map((p) => `${p.argv0} ${Math.round(p.footprintKiB)} KiB ${p.cpuS.toFixed(2)} s`).join(', ')}; load ${r.load.toFixed(1)}, ${IDLE_RUN.everyS} s pair ${r.loadPair.toFixed(1)})`;
  const processes = b.processes.map((p) => {
    const delta = d.processes.find((q) => q.argv0 === p.argv0);
    return delta === undefined ? `${p.argv0} in B alone` : `${p.argv0} ${signed(delta.footprintKiB)} KiB ${signed(delta.cpuS, 2)} s`;
  }).join(', ');
  const validity = run.reasons.length === 0 ? 'valid' : `invalid: ${run.reasons.join('; ')}`;
  return `[daemon-idle] A-B-A footprint B ${signed(d.footprintKiB)} KiB against the A mean ${d.aMean.footprintKiB} KiB (x${d.ratio.toFixed(3)}), A ${signed(d.spread.footprintKiB)} KiB against A' · cpu B ${signed(d.cpuS, 2)} s against the A mean ${d.aMean.cpuS.toFixed(2)} s, A ${signed(d.spread.cpuS, 2)} s against A' · B's processes against the A mean: ${processes} · ${window('A', 'detached', a)} · ${window('B', 'daemon', b)} · ${window("A'", 'detached', a2)} · medians of ${a.samples}, ${b.samples} and ${a2.samples} over ${run.windowS} s each · ${validity}`;
}

// P5 O3-C M5 (docs/doperpowers/plans/2026-10-28-p5-o3-c-spine-library.md, D18 and D19): the spine composed alone, the
// services entry's idleReading under the Electron binary as Node over the profile-sized fixture, read in IDLE_RUN's
// window while loaded, then, once its root has stopped and its data is released (V8's last-resort collection, P5 O3-D
// M2), after this settle in a window half as long. O3-D's starting point, recorded without a bound.
export const SPINE_RELEASED_RUN = { settleS: 120, windowS: 300, everyS: 30, samples: 11, maxLoad: IDLE_RUN.maxLoad, pairLoad: IDLE_RUN.pairLoad } as const;

// The job log's line: the loaded and released medians and what the release gave back, each window's CPU, the fixture's
// counts, what the release's collection said (P5 O3-D M2: the last-resort collection, with the heap before and after),
// the validity (both windows' `reasons`) and both loads, each with its 30 s pair.
export function spineLine(run: { loaded: ShapeReading; released: ShapeReading; counts: SpineFixtureCounts; collection: string; reasons: readonly string[] }): string {
  const { loaded, released, counts } = run;
  const drop = Math.round(released.footprintKiB) - Math.round(loaded.footprintKiB);
  const fixture = `${counts.sessions} sessions in ${counts.projects} projects, ${counts.attention} attention items (${counts.pending} pending), ${counts.library} library rows, ${counts.drafts} drafts, ${counts.history} prompt-history lines`;
  const validity = run.reasons.length === 0 ? 'valid' : `invalid: ${run.reasons.join('; ')}`;
  return `[daemon-idle] spine loaded footprint ${Math.round(loaded.footprintKiB)} KiB (median of ${loaded.samples}) · released ${Math.round(released.footprintKiB)} KiB (median of ${released.samples}), ${signed(drop)} KiB · cpu ${loaded.cpuS.toFixed(2)} s over ${IDLE_RUN.windowS} s loaded, ${released.cpuS.toFixed(2)} s over ${SPINE_RELEASED_RUN.windowS} s released · fixture ${fixture} · before the released window, ${run.collection} · ${validity} · load ${loadText(loaded.load, loaded.loadPair)} loaded, ${loadText(released.load, released.loadPair)} released`;
}

// P5 O3-D M2 (docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md, Interfaces §K; D5): `mawsd` with the spine over the
// profile-sized fixture, read in three windows of SPINE_RELEASED_RUN's form: loaded (a private daemon, a client holding
// its connection), released (the same daemon once the quiet passed) and re-executed (a unit daemon after its exit 75
// and restart). The line names, per window, mawsd's median and the engine host's (the host the spine's start wakes,
// read beside it), the window's CPU, load and validity; then the peak load with its 30 s pair, and the verdict the
// architect reads (§11's mechanism): the released mawsd against MAWSD_HEADROOM_KIB, then the re-executed one. It
// asserts no bound.
export type SpineWindow = 'loaded' | 'released' | 'reexecuted';
const SPINE_WINDOWS: readonly [SpineWindow, string][] = [['loaded', 'loaded'], ['released', 'released'], ['reexecuted', 're-executed']];

export function mawsdSpineLine(run: { windows: Record<SpineWindow, ShapeReading | null>; reasons: Record<SpineWindow, readonly string[]>; counts: SpineFixtureCounts }): string {
  const own = (reading: ShapeReading, argv0: string) => reading.processes.find((p) => p.argv0 === argv0);
  const window = ([key, name]: [SpineWindow, string]) => {
    const reading = run.windows[key];
    const validity = run.reasons[key].length === 0 ? 'valid' : `invalid: ${run.reasons[key].join('; ')}`;
    if (reading === null) return `${name}: not read, ${validity}`;
    const mawsd = own(reading, 'mawsd');
    const engine = own(reading, 'maws-supervisor');
    const kib = (p: ProcessReading | undefined, what: string) => (p === undefined ? `${what} not running` : `${what} ${Math.round(p.footprintKiB)} KiB`);
    return `${name}: ${kib(mawsd, 'mawsd')}, ${kib(engine, 'engine host')} (medians of ${reading.samples}), cpu ${reading.cpuS.toFixed(2)} s, load ${loadText(reading.load, reading.loadPair)}, ${validity}`;
  };
  const read = SPINE_WINDOWS.flatMap(([key]) => (run.windows[key] === null ? [] : [run.windows[key]!]));
  const peak = read.reduce<ShapeReading | null>((top, reading) => (top === null || reading.load > top.load ? reading : top), null);
  const fits = (key: SpineWindow) => {
    const mawsd = run.windows[key] === null ? undefined : own(run.windows[key]!, 'mawsd');
    return mawsd === undefined ? 'not read' : mawsd.footprintKiB <= MAWSD_HEADROOM_KIB ? 'within' : 'over';
  };
  const released = fits('released');
  const reexecuted = fits('reexecuted');
  const verdict = `released mawsd ${released === 'not read' ? 'not read' : `${released} the ${MAWSD_HEADROOM_KIB} KiB headroom`}, re-executed mawsd ${reexecuted === 'not read' ? 'not read' : released === 'not read' ? `${reexecuted} the ${MAWSD_HEADROOM_KIB} KiB headroom` : `${reexecuted} it`}`;
  return `[daemon-idle] mawsd with the spine · ${SPINE_WINDOWS.map(window).join(' · ')} · peak load ${peak === null ? 'not read' : loadText(peak.load, peak.loadPair)} · ${verdict} · fixture ${run.counts.sessions} sessions in ${run.counts.projects} projects`;
}

// ---- P5 O17 M8: what O17 adds at mawsd's cold start and idle (OX7) -----------------------------------------------------

// mawsd's e2e resource report (src/mawsd/e2e-seam.ts, SIGUSR2 under MAWS_E2E=1): Node's active resources, a `Timeout`
// per armed timer, and the modules loaded so far by file name
export interface E2eResources {
  at: string;
  resources: string[];
  modules: string[];
  browser?: BrowserFacts | null; // P5 O17 M8: the daemon's e2eBrowser(), when it runs
}
export interface BrowserFacts {
  broker: { cold: number; promoting: number; spliced: number; buffered: number } | null;
  sockets: Record<string, { listening: boolean; relayed: number; refused: number; waiting: number }>;
  holds: string[];
}

// The deferred chunks O17 keeps off the cold start and the idle (their file names are the module's and a hash)
const BROWSER_CHUNKS: readonly [string, string][] = [
  ['cua-broker-', 'the broker’s chunk loads at the first admitted peer'],
  ['browser-feed-', 'the feed’s chunk loads at the first viewer'],
];
const timerCount = (report: E2eResources) => report.resources.filter((name) => name === 'Timeout').length;

// What O17 must not hold at `moment`: session listeners beyond those allowed (none at the cold start; after it one per
// live session with no app, P5 Decision Log 187), the broker's or the feed's chunk, and, against the cold start's report,
// a timer it did not have. Empty when there is none.
export function o17IdleProblems(moment: string, report: E2eResources, o: { listeners: number; allowedListeners: number; cold?: E2eResources }): string[] {
  const problems: string[] = [];
  if (o.listeners > o.allowedListeners) {
    const noun = `${o.listeners} session listener${o.listeners === 1 ? '' : 's'}`;
    problems.push(`${moment}: ${noun} (${o.allowedListeners === 0 ? 'none allowed' : `at most ${o.allowedListeners}, one per live session with no app`})`);
  }
  for (const [prefix, why] of BROWSER_CHUNKS) for (const module of report.modules.filter((name) => name.startsWith(prefix))) problems.push(`${moment}: ${module} loaded (${why})`);
  if (o.cold !== undefined && timerCount(report) > timerCount(o.cold)) problems.push(`${moment}: ${timerCount(report)} timers, ${timerCount(report) - timerCount(o.cold)} more than at the cold start`);
  return problems;
}

// What the measured browser cases (e2e:daemon-idle-render) assert at their window's edges, M8's Decisions: every
// connector still connected and served cold by the broker, no render child, render.starts where the first exit left it,
// no pending broker request (no promotion, nothing spliced or buffered, no peer waiting on its root), no browser timer
// (the feed's chunk absent; the render host, which holds the frame timers, gone) and no browser-work hold. Empty when idle.
export function browserWindowProblems(moment: string, report: E2eResources, o: { sessions: number; connected: number; renderPid: number | null; starts: number; startsAtFirstExit: number }): string[] {
  const browser = report.browser ?? null;
  if (browser === null) return [`${moment}: mawsd reported no browser facts`];
  const problems: string[] = [];
  if (o.connected !== o.sessions) problems.push(`${moment}: ${o.connected} of ${o.sessions} connectors connected`);
  if (o.renderPid !== null) problems.push(`${moment}: a render child, pid ${o.renderPid}`);
  if (o.starts !== o.startsAtFirstExit) problems.push(`${moment}: render.starts ${o.starts}, ${o.startsAtFirstExit} at the first exit`);
  const { broker } = browser;
  if (broker === null) problems.push(`${moment}: the broker’s chunk is not loaded, though cua is connected`);
  else if (broker.promoting > 0 || broker.spliced > 0 || broker.buffered > 0 || broker.cold !== o.sessions) {
    problems.push(`${moment}: the broker holds ${broker.promoting} promoting, ${broker.spliced} spliced, ${broker.buffered} bytes buffered (${broker.cold} cold served of ${o.sessions})`);
  }
  const waiting = Object.values(browser.sockets).reduce((sum, socket) => sum + socket.waiting, 0);
  if (waiting > 0) problems.push(`${moment}: ${waiting} peer${waiting === 1 ? '' : 's'} waiting on ${waiting === 1 ? 'its' : 'their'} root`);
  for (const module of report.modules.filter((name) => name.startsWith('browser-feed-'))) problems.push(`${moment}: ${module} loaded (the feed’s frame timers)`);
  if (browser.holds.length > 0) problems.push(`${moment}: browser work held for ${browser.holds.join(', ')}`);
  return problems;
}
