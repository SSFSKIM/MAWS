// The remote bench's numbers (P5 O7 M7, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M7 and Interfaces §S;
// acceptance 3): what e2e/remote-latency.spec.ts measures through the remote pane against the same run's local case,
// and the bounds acceptance 3 holds each carrier to.
//
//   delta to frame   as the local bench measures it (test/support/local-latency.ts): the stub engine's write of a text
//                    delta to the end of the main-thread work of the frame that renders it, here with the engine on
//                    profile B's `mawsd` and the frame in A's pane; 3 turns of 300 deltas, the first discarded.
//   round trip       220 sequential `session.getContextUsage` invokes from A's page, the first 20 discarded.
//   open to first row  from the pointer's press on the session's row to the first marker of its history in the pane.
//   resume           from the restore of a forced carrier drop (the case's own way alone, and the network probe the restore
//                    brings) to the first event after the gap in A's renderer, voided with a reason when the link came back
//                    over another carrier. A local session has no carrier to drop: its resume is null.
//   engine start     the local case's, which the resume bound reads: in A's page, `session.start` to the first
//                    `session.status` saying `ready`, less the largest renderer-to-main round trip just before (an
//                    observation delay only narrows the allowance). B's is recorded, polled, and read by no bound.
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
/** `resumeMs` null: the case's recovery came back over another carrier, so no resume of its own was measured. */
export type RemoteMeasures = Measures & { rtt: Stats };

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

/**
 * The local engine start the resume bound reads: what the page observed (just before `session.start` to the first
 * `session.status` saying `ready`), less `hopMs`, the largest renderer-to-main round trip, which covers both hops the
 * observation adds. Never more than observed: an observation delay narrows the allowance, never widens it.
 */
export const engineStartOf = (observedMs: number, hopMs: number): number => Math.max(0, observedMs - Math.max(0, hopMs));

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
  if (measured.resumeMs !== null) over('resume', measured.resumeMs, bounds.resumeMs);
  return misses;
}

/** One case's run as the local bench's validity reads it: the kept markers' delays, the markers a turn lacked, the clock. */
export interface CaseRun {
  samples: readonly number[];
  expected: number;
  missing: readonly { turn: number; markers: readonly string[] }[];
  clock: ClockCheck;
}

/**
 * Rule B over the run's 1-minute load: `loads` sampled every 30 s from the start, the 30 s pair rebuilt from them alone
 * (null under three), and `terminal`, the reading at the run's end a shorter interval after the last, counted in the peak
 * but never in the pair, whose rebuild assumes the 30 s spacing.
 */
export function loadVerdict(loads: readonly number[], terminal: number | null = null): { peak: number; pair: number | null; void: boolean } {
  const peak = Math.max(...loads, ...(terminal === null ? [] : [terminal]));
  const pair = loads.length >= 3 ? loadPair(loads) : null;
  // under three samples no pair is rebuilt, and the peak alone says: a peak under the ceiling never voids
  return { peak, pair, void: peak >= IDLE_RUN.maxLoad && (pair === null || pair >= IDLE_RUN.pairLoad) };
}

/** Why the run is invalid, each reason one line naming its case; empty when it is valid. */
export function invalidReasons(run: { cases: Readonly<Record<'local' | Carrier, CaseRun | null>>; pings: Readonly<Record<Carrier, number>>; loads: readonly number[]; terminalLoad?: number | null; notes?: readonly string[] }): string[] {
  const reasons: string[] = [...(run.notes ?? [])];
  for (const [name, one] of Object.entries(run.cases)) {
    if (one === null) reasons.push(`${name}: not measured`);
    else for (const reason of localInvalidReasons(one)) reasons.push(`${name}: ${reason}`);
  }
  for (const carrier of CARRIERS) {
    if (run.pings[carrier] < REMOTE_BENCH.pings) reasons.push(`${carrier}: ${run.pings[carrier]} of ${REMOTE_BENCH.pings} pings answered`);
  }
  const load = loadVerdict(run.loads, run.terminalLoad ?? null);
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

// ---- The live bench's clock (P5 O7 M7, e2e:remote-latency-live; Interfaces §S) ----------------------------------------
//
// Two machines, two clocks. Each exchange's four stamps (link.ts `PongStamps`: this Mac's `at` and `arrived`, the
// machine's `received` and `sent`, all whole milliseconds) place the machine's offset θ = its clock − this Mac's: the
// ping can't arrive before it left and the pong can't arrive before it was sent, so θ lies in
// [sent − arrived, received − at], widened by one millisecond at each end for the stamps' resolution. Its midpoint is the
// estimate `((received − at) + (sent − arrived)) / 2`, and its half-width the exchange's own round trip (less the
// machine's time between the stamps) over two plus the resolution: a route's asymmetry hides anywhere inside it, so the
// whole interval is what the judgement carries, never the estimate alone. Of an exchange set, the narrowest interval (the
// fastest exchange) is kept, as NTP keeps its lowest-delay sample. The run takes one set at its start and one at its end;
// their intervals' union is the run's, and the distance between their estimates its spread, which voids the run past 5 ms
// (the clocks moved apart, or a route changed, during it).
//
// A delta read across the two clocks (this Mac's frame less the machine's write) is the true delta less θ, so the true p50
// lies in [raw p50 + low, raw p50 + high]: a bound holds when that interval's worst edge holds, is missed when its best
// edge misses, and is otherwise inconclusive, as it is whenever the interval is wider than the bound's own allowance.

export const LIVE_BENCH = { clockExchanges: 50, spreadVoidMs: 5, stampResolutionMs: 1 } as const;
export type Verdict = 'pass' | 'miss' | 'inconclusive';

export interface ClockEstimate {
  offsetMs: number;
  intervalMs: [number, number];
  /** the exchanges that carried the machine's stamps */
  samples: number;
}

/** The narrowest offset interval of the exchanges that carry the machine's stamps; null with none. */
export function clockEstimate(exchanges: readonly Exchange[]): ClockEstimate | null {
  const q = LIVE_BENCH.stampResolutionMs;
  let best: [number, number] | null = null;
  let samples = 0;
  for (const e of exchanges) {
    if (e.received === null || e.sent === null) continue;
    samples += 1;
    const interval: [number, number] = [e.sent - e.arrived - q, e.received - e.at + q];
    if (best === null || interval[1] - interval[0] < best[1] - best[0]) best = interval;
  }
  return best === null ? null : { offsetMs: (best[0] + best[1]) / 2, intervalMs: best, samples };
}

export interface LiveClock {
  offsetMs: number;
  intervalMs: [number, number];
  spreadMs: number;
  samples: { start: number; end: number };
  start: ClockEstimate;
  end: ClockEstimate;
}

/** The run's clock from its start's and its end's exchanges; null when either carried none of the machine's stamps. */
export function liveClock(start: readonly Exchange[], end: readonly Exchange[]): LiveClock | null {
  const [s, e] = [clockEstimate(start), clockEstimate(end)];
  if (s === null || e === null) return null;
  return {
    offsetMs: (s.offsetMs + e.offsetMs) / 2,
    intervalMs: [Math.min(s.intervalMs[0], e.intervalMs[0]), Math.max(s.intervalMs[1], e.intervalMs[1])],
    spreadMs: Math.abs(e.offsetMs - s.offsetMs),
    samples: { start: s.samples, end: e.samples },
    start: s,
    end: e,
  };
}

/** Why a carrier's live clock voids its run, or null: too few exchanges at either end, or a spread past 5 ms. */
export function clockVoid(clock: LiveClock | null): string | null {
  if (clock === null) return 'no exchange carried the machine’s clock (its endpoint lists no rl2.pong-clock)';
  const few = (['start', 'end'] as const).filter((at) => clock.samples[at] < LIVE_BENCH.clockExchanges);
  if (few.length > 0) return few.map((at) => `${clock.samples[at]} clock exchanges at the run’s ${at}, under ${LIVE_BENCH.clockExchanges}`).join('; ');
  if (clock.spreadMs > LIVE_BENCH.spreadVoidMs) return `the clock’s spread ${ms(clock.spreadMs)} ms is over ${LIVE_BENCH.spreadVoidMs} ms`;
  return null;
}

/**
 * A cross-clock delta's verdict against `bound`: `rawP50` read as this Mac's frame less the machine's write, the true p50
 * in [rawP50 + low, rawP50 + high]. `allowance` is the bound's own (10 ms plus the round trip).
 */
export function deltaVerdict(rawP50: number, clock: LiveClock, bound: number, allowance: number): { verdict: Verdict; p50IntervalMs: [number, number]; wide: boolean } {
  const p50IntervalMs: [number, number] = [rawP50 + clock.intervalMs[0], rawP50 + clock.intervalMs[1]];
  const wide = clock.intervalMs[1] - clock.intervalMs[0] > allowance;
  const verdict: Verdict = p50IntervalMs[1] <= bound ? 'pass' : p50IntervalMs[0] > bound ? 'miss' : 'inconclusive';
  return { verdict: wide ? 'inconclusive' : verdict, p50IntervalMs, wide };
}
