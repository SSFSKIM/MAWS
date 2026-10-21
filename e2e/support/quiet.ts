// The measured specs' quiet admission (P4 tracker row 2026-10-18, the measured-run quiet admission protocol): after its
// setup, a measured spec admits its first trial once two consecutive reads of the 1-minute load, 30 s apart, each read
// under 5, the rule ci-kit's measured-job guard (mac/settle) applies before the checkout (gate-offload Decision Log 75).
// The guard settles the machine before the job builds; this wait covers what the build, the app's launch and the spec's
// own setup leave behind. It is bounded: when the next read would come after the budget, the wait ends, and the trials
// run anyway under the spec's own admission and bounds, each recording its load. The record (the wait, the load it
// started at, every read) goes into the spec's results beside the rows. Free of Playwright, so test/support/quiet.test.ts
// runs it on a fake clock and load.
import { loadavg } from 'node:os';

export const QUIET_LOAD_BELOW = 5;
export const QUIET_READ_EVERY_MS = 30_000;
export const QUIET_BUDGET_MS = 3 * 60_000;

export interface QuietClock {
  now(): number;
  sleep(ms: number): Promise<void>;
  /** The 1-minute load, read to two decimals as the specs and the guard's `sysctl` read it. */
  load(): number;
}

export interface QuietAdmission {
  rule: string;
  /** False when the budget ran out first: the trials ran anyway. */
  quiet: boolean;
  waitedMs: number;
  budgetMs: number;
  startedAt: string;
  startLoad: number;
  endLoad: number;
  /** Every read, ms after the wait started. */
  reads: { atMs: number; load: number }[];
  summary: string;
}

const SYSTEM: QuietClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  load: () => +loadavg()[0]!.toFixed(2),
};

/** Waits for two consecutive reads, each at least 30 s after the one before, under load 5; no read after `budgetMs`. */
export async function quietWait({ budgetMs = QUIET_BUDGET_MS, clock = SYSTEM }: { budgetMs?: number; clock?: QuietClock } = {}): Promise<QuietAdmission> {
  const start = clock.now();
  const reads: QuietAdmission['reads'] = [];
  let under = 0; // the consecutive reads under the load so far
  for (;;) {
    const read = { atMs: clock.now() - start, load: clock.load() };
    reads.push(read);
    under = read.load < QUIET_LOAD_BELOW ? under + 1 : 0;
    if (under >= 2 || read.atMs + QUIET_READ_EVERY_MS > budgetMs) break;
    await clock.sleep(QUIET_READ_EVERY_MS);
    if (clock.now() - start > budgetMs) break; // a sleep that woke past the budget: no read after it
  }
  const quiet = under >= 2;
  const waitedMs = clock.now() - start;
  const last = reads.at(-1)!;
  const loads = reads.map((r) => r.load).join(', ');
  return {
    rule: `the 1-minute load under ${QUIET_LOAD_BELOW} on two consecutive reads ${QUIET_READ_EVERY_MS / 1000} s apart, waited for at most ${budgetMs / 1000} s (gate-offload Decision Log 75, ci-kit's mac/settle)`,
    quiet,
    waitedMs,
    budgetMs,
    startedAt: new Date(start).toISOString(),
    startLoad: reads[0]!.load,
    endLoad: last.load,
    reads,
    summary: quiet ? `quiet after ${+(waitedMs / 1000).toFixed(1)} s (loads ${loads})` : `not quiet within ${budgetMs / 1000} s (loads ${loads}): the trials run, each recording its load`,
  };
}
