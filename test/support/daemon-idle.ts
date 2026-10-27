// The idle-cost measurement's numbers (P5 O2, M1; docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, acceptance 7; P5
// acceptance 14): the statistics, the run's validity, the baseline and the bound. The measurement itself is
// e2e/daemon-idle.spec.ts: the resident memory and CPU time of the processes that stay behind on a machine with the app
// quit and one kept session held idle. At M1 that is today's detached supervisor (argv0 `maws-supervisor`); M9 measures
// the daemon shape's processes (`mawsd` beside the engine host, and the pty host if it runs) against the bound.
//
// The baseline is three runs of `e2e:daemon-idle` at M1's commit on the mini: the median of their RSS medians and the
// median of their CPU times, with the run ids and the commit. Until the recording commit (touching only this file)
// writes it, it is null and the spec records only; the bound is derived from it, so it is null too.

export const IDLE_RUN = { settleS: 120, windowS: 600, everyS: 30, samples: 21, maxLoad: 5 } as const;

export interface DaemonIdleBaseline {
  commit: string;
  runs: string[]; // the three GitHub Actions run ids
  rssKiB: number; // the median of the runs' RSS medians, the measured processes summed per sample
  cpuS: number; // the median of the runs' CPU seconds over the window, summed across the measured processes
}

// PENDING: recorded from three e2e:daemon-idle runs at M1's commit on the mini (Concrete Steps 7).
export const DAEMON_IDLE_BASELINE: DaemonIdleBaseline | null = null;

export interface DaemonIdleBound {
  rssKiB: number;
  cpuS: number; // over IDLE_RUN.windowS
}

export const RSS_FACTOR = 1.5;
export const CPU_ALLOWANCE_S_PER_600 = 1.0;

// The daemon shape's processes together stay within 1.5 times the baseline's RSS (in whole KiB, never above it) and
// within its CPU time plus 1.0 s per 600 s of window (in centiseconds, ps's resolution): the shape adds one Node process
// that loads less than the engine host and adds no periodic work.
export function idleBound(baseline: DaemonIdleBaseline, windowS: number = IDLE_RUN.windowS): DaemonIdleBound {
  return {
    rssKiB: Math.floor(baseline.rssKiB * RSS_FACTOR),
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
  if (!(baseline.rssKiB > 0)) problems.push(`rssKiB ${baseline.rssKiB} is not a positive number of KiB`);
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
}

// Why a run is invalid, each reason one line; empty when it is valid.
export function invalidReasons(run: IdleRunCheck): string[] {
  const reasons: string[] = [];
  if (run.measured.length === 0) reasons.push('no process of the profile to measure');
  const peak = Math.max(...run.loads);
  if (peak >= IDLE_RUN.maxLoad) reasons.push(`the 1-minute load reached ${peak.toFixed(1)} (a valid run stays under ${IDLE_RUN.maxLoad} throughout)`);
  for (const p of run.lost) reasons.push(`${p.argv0} pid ${p.pid} was gone at ${p.atS} s of the ${IDLE_RUN.windowS} s window`);
  if (run.sessionEnded) reasons.push('the kept session ended before the window did (the scene measures one held idle session)');
  return reasons;
}

// The job log's line; `load` is the highest 1-minute load the window read.
export function idleLine(run: { rssKiB: number; samples: number; cpuS: number; measured: readonly string[]; load: number }): string {
  return `[daemon-idle] rss ${Math.round(run.rssKiB)} KiB (median of ${run.samples}) · cpu ${run.cpuS.toFixed(2)} s over ${IDLE_RUN.windowS} s · processes ${run.measured.join(', ')} · load ${run.load.toFixed(1)}`;
}
