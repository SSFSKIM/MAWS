// The remote bench's numbers (P5 O7 M7, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M7 and Interfaces §S;
// acceptance 3): what e2e/remote-latency.spec.ts measures through the remote pane against the same run's local case,
// and the bounds acceptance 3 holds each carrier to.
//
//   delta to frame   as the local bench measures it (test/support/local-latency.ts): the stub engine's write of a text
//                    delta to the end of the main-thread work of the frame that renders it, here with the engine on
//                    profile B's `mawsd` and the frame in A's pane; 3 turns of 300 deltas, the first discarded.
//   round trip       220 sequential `session.getContextUsage` invokes from A's page, the first 20 discarded.
//   open to first row  from the pointer's press on the session's row to the first marker of its history in the pane.
//   resume           from the restore of a forced carrier drop (and the network probe the restore brings) to the first
//                    event after the gap in A's renderer. A local session has no carrier to drop: its resume is null.
//   engine start     from `session.start` to the session's process `ready`, on the machine that runs it.
//   rtt              the link's own round trip: 100 `ping`/`pong` pairs on the carrier (link.ts `ping`), `arrived − at`.
//
// The bounds (acceptance 3), each carrier's against the same run's local numbers and that carrier's rtt p50:
//   deltaToFrame.p50 ≤ local.deltaToFrame.p50 + rtt.p50 + 10;  roundTrip.p50 ≤ 2 · rtt.p50 + 20;
//   openToFirstRowMs ≤ 1500;  resumeMs ≤ local.engineStartMs + rtt.p50.
//
// Validity is the local bench's (each case's samples, markers and renderer clock) and Rule B's on the machine's load
// (P5 Decision Log 139, test/support/daemon-idle.ts): the run is void on load only when its 1-minute peak reached 5 and
// its 30 s pair reached 4.7.
import { IDLE_RUN, loadPair } from './daemon-idle';
import { BENCH, invalidReasons as localInvalidReasons, summarize, type ClockCheck, type LatencySummary } from './local-latency';

export type Stats = LatencySummary;
export type Carrier = 'direct' | 'relay';
export const CARRIERS: readonly Carrier[] = ['direct', 'relay'];

/** The bench's shape beyond the local bench's (BENCH): the link's pings per carrier. */
export const REMOTE_BENCH = { pings: 100, openToFirstRowMs: 1500, deltaAllowanceMs: 10, roundTripAllowanceMs: 20 } as const;

export interface Measures {
  deltaToFrame: Stats;
  roundTrip: Stats;
  openToFirstRowMs: number;
  /** null for the local case: no carrier to drop */
  resumeMs: number | null;
  engineStartMs: number;
}
export type RemoteMeasures = Measures & { resumeMs: number; rtt: Stats };

export interface Bounds {
  deltaToFrameP50Ms: number;
  roundTripP50Ms: number;
  openToFirstRowMs: number;
  resumeMs: number;
}

/** One pong's stamps as link.ts keeps them (`PongStamps`), as far as the bench reads them. */
export interface Exchange {
  at: number;
  received: number | null;
  sent: number | null;
  arrived: number;
}

/** The link's round trip over `exchanges`: each pong's arrival less its ping's send, by this device's clock. */
export function rttStats(exchanges: readonly Exchange[]): Stats {
  return summarize(exchanges.map((e) => e.arrived - e.at), 0);
}

/** A carrier's bounds (acceptance 3), from the run's local numbers and the carrier's own rtt. */
export function boundsOf(local: Measures, rtt: Stats): Bounds {
  return {
    deltaToFrameP50Ms: local.deltaToFrame.p50 + rtt.p50 + REMOTE_BENCH.deltaAllowanceMs,
    roundTripP50Ms: 2 * rtt.p50 + REMOTE_BENCH.roundTripAllowanceMs,
    openToFirstRowMs: REMOTE_BENCH.openToFirstRowMs,
    resumeMs: local.engineStartMs + rtt.p50,
  };
}

const ms = (value: number) => Number(value.toFixed(1));

/** What of acceptance 3 a carrier misses, each one line naming the carrier; empty when it holds every bound. */
export function budgetMisses(carrier: Carrier, measured: RemoteMeasures, bounds: Bounds): string[] {
  const misses: string[] = [];
  const over = (label: string, value: number, bound: number) => {
    if (value > bound) misses.push(`${carrier}: ${label} ${ms(value)} ms over its bound ${ms(bound)} ms`);
  };
  over('delta-to-frame p50', measured.deltaToFrame.p50, bounds.deltaToFrameP50Ms);
  over('round trip p50', measured.roundTrip.p50, bounds.roundTripP50Ms);
  over('open to first row', measured.openToFirstRowMs, bounds.openToFirstRowMs);
  over('resume', measured.resumeMs, bounds.resumeMs);
  return misses;
}

/** One case's run as the local bench's validity reads it: the kept markers' delays, the markers a turn lacked, the clock. */
export interface CaseRun {
  samples: readonly number[];
  expected: number;
  missing: readonly { turn: number; markers: readonly string[] }[];
  clock: ClockCheck;
}

/** Rule B over the run's 1-minute load samples: its peak, its 30 s pair (null under three samples), and whether it voids. */
export function loadVerdict(loads: readonly number[]): { peak: number; pair: number | null; void: boolean } {
  const peak = Math.max(...loads);
  const pair = loads.length >= 3 ? loadPair(loads) : null;
  // under three samples no pair is rebuilt, and the peak alone says: a peak under the ceiling never voids
  return { peak, pair, void: peak >= IDLE_RUN.maxLoad && (pair === null || pair >= IDLE_RUN.pairLoad) };
}

/** Why the run is invalid, each reason one line naming its case; empty when it is valid. */
export function invalidReasons(run: { cases: Readonly<Record<'local' | Carrier, CaseRun | null>>; pings: Readonly<Record<Carrier, number>>; loads: readonly number[] }): string[] {
  const reasons: string[] = [];
  for (const [name, one] of Object.entries(run.cases)) {
    if (one === null) reasons.push(`${name}: not measured`);
    else for (const reason of localInvalidReasons(one)) reasons.push(`${name}: ${reason}`);
  }
  for (const carrier of CARRIERS) {
    if (run.pings[carrier] < REMOTE_BENCH.pings) reasons.push(`${carrier}: ${run.pings[carrier]} of ${REMOTE_BENCH.pings} pings answered`);
  }
  const load = loadVerdict(run.loads);
  if (load.void) reasons.push(`the machine's load: peak ${ms(load.peak)} at or over ${IDLE_RUN.maxLoad}, ${IDLE_RUN.everyS} s pair ${load.pair === null ? 'not rebuilt (under three samples)' : `${ms(load.pair)} at or over ${IDLE_RUN.pairLoad}`} (Rule B)`);
  return reasons;
}

/** The kept markers a run expects per case. */
export const EXPECTED_MARKERS = BENCH.markersPerTurn * (BENCH.turns - BENCH.warmupTurns);

/** The job log's line per case. */
export function remoteLine(name: 'local' | Carrier, m: Measures & { rtt?: Stats }): string {
  const f = (value: number) => value.toFixed(1);
  const rtt = m.rtt === undefined ? '' : ` · rtt p50 ${f(m.rtt.p50)} ms (n=${m.rtt.n})`;
  const resume = m.resumeMs === null ? '' : ` · resume ${f(m.resumeMs)} ms`;
  return `[remote-latency] ${name}: delta-to-frame p50 ${f(m.deltaToFrame.p50)} ms p95 ${f(m.deltaToFrame.p95)} ms (n=${m.deltaToFrame.n}) · round trip p50 ${f(m.roundTrip.p50)} ms p95 ${f(m.roundTrip.p95)} ms · open to first row ${f(m.openToFirstRowMs)} ms${resume} · engine start ${f(m.engineStartMs)} ms${rtt}`;
}
