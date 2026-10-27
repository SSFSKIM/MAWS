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
// The baseline is three runs of `e2e:daemon-idle` at M1's commit on the mini: the median of their footprint medians and
// the median of their CPU times, with the run ids and the commit. Until the recording commit (touching only this file)
// writes it, it is null and the spec records only; the bound is derived from it, so it is null too.
import { execFileSync } from 'node:child_process';

export const IDLE_RUN = { settleS: 120, windowS: 600, everyS: 30, samples: 21, maxLoad: 5 } as const;

export interface DaemonIdleBaseline {
  commit: string;
  runs: string[]; // the three GitHub Actions run ids
  footprintKiB: number; // the median of the runs' footprint medians, the measured processes summed per sample
  cpuS: number; // the median of the runs' CPU seconds over the window, summed across the measured processes
}

// PENDING: recorded from three e2e:daemon-idle runs at M1's commit on the mini (Concrete Steps 7).
export const DAEMON_IDLE_BASELINE: DaemonIdleBaseline | null = null;

export interface DaemonIdleBound {
  footprintKiB: number;
  cpuS: number; // over IDLE_RUN.windowS
}

export const FOOTPRINT_FACTOR = 1.5;
export const CPU_ALLOWANCE_S_PER_600 = 1.0;

// The daemon shape's processes together stay within 1.5 times the baseline's footprint (in whole KiB, never above it)
// and within its CPU time plus 1.0 s per 600 s of window (in centiseconds, ps's resolution): the shape adds one Node
// process that loads less than the engine host and adds no periodic work.
export function idleBound(baseline: DaemonIdleBaseline, windowS: number = IDLE_RUN.windowS): DaemonIdleBound {
  return {
    footprintKiB: Math.floor(baseline.footprintKiB * FOOTPRINT_FACTOR),
    cpuS: Math.round((baseline.cpuS + (CPU_ALLOWANCE_S_PER_600 * windowS) / 600) * 100) / 100,
  };
}

export const DAEMON_IDLE_BOUND: DaemonIdleBound | null = DAEMON_IDLE_BASELINE === null ? null : idleBound(DAEMON_IDLE_BASELINE);

// What is wrong with a recorded baseline, each one line; empty when it is well formed, and for none recorded yet.
export function baselineProblems(baseline: DaemonIdleBaseline | null): string[] {
  if (baseline === null) return [];
  const problems: string[] = [];
  if (!/^[0-9a-f]{7,40}$/.test(baseline.commit)) problems.push(`commit ${baseline.commit} is not a sha`);
  if (baseline.runs.length !== 3 || new Set(baseline.runs).size !== 3) problems.push(`runs [${baseline.runs.join(', ')}] are not three distinct run ids`);
  if (!(baseline.footprintKiB > 0)) problems.push(`footprintKiB ${baseline.footprintKiB} is not a positive number of KiB`);
  if (!(baseline.cpuS >= 0)) problems.push(`cpuS ${baseline.cpuS} is negative`);
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

// The job log's line; `load` is the highest 1-minute load the window read.
export function idleLine(run: { footprintKiB: number; rssKiB: number; samples: number; cpuS: number; measured: readonly string[]; load: number }): string {
  return `[daemon-idle] footprint ${Math.round(run.footprintKiB)} KiB (median of ${run.samples}) · rss ${Math.round(run.rssKiB)} KiB · cpu ${run.cpuS.toFixed(2)} s over ${IDLE_RUN.windowS} s · processes ${run.measured.join(', ')} · load ${run.load.toFixed(1)}`;
}
