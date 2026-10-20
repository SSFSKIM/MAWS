// The margin's settle (P4-B1's follow-up wave; docs/doperpowers/plans/2026-10-20-p4-b1-margin-comments.md, "Follow-up:
// the margin's pass off the typing frame"). A change that only edits the document (the owner's typing, an agent's
// write, the provisional layer's growth) no longer runs the margin's measure-and-layout pass in the frame that paints
// it: it marks the margin stale, and the pass runs once the changes pause or, under changes that never pause, at a
// ceiling, and then in an idle moment of the main thread (`requestIdleCallback`), so a keystroke's frame never carries
// it. Google Docs settles its margin about 600 ms after the last key (LC-1 item 2); MAWS adds the ceiling because agents
// write without pausing. Any pass, whatever caused it, reads every anchor afresh and so settles what is owed.
//
// The bound: a pass starts within MARGIN_SETTLE_QUIET_MS + MARGIN_SETTLE_IDLE_MS (700 ms) of the last change once the
// changes pause, and never later than MARGIN_SETTLE_MAX_MS (1,000 ms) after the first change it had not read, a task
// already running on the main thread when it falls due excepted.

/** The quiet after the last change at which the margin settles: Docs' (LC-1 item 2), past nearly every typist's gap between keys. */
export const MARGIN_SETTLE_QUIET_MS = 600;
/** The ceiling: no change waits longer than this for the pass that reads it, however the changes keep coming. */
export const MARGIN_SETTLE_MAX_MS = 1_000;
/** The longest a due pass waits for an idle moment (inside the ceiling: the ceiling's timer falls due this much earlier). */
export const MARGIN_SETTLE_IDLE_MS = 100;

/** The clock a settle runs on: the page's by default, a test's own otherwise. Each scheduling call answers its cancel. */
export interface SettleClock {
  now(): number;
  later(run: () => void, ms: number): () => void;
  /** Runs `run` in an idle moment, within `timeoutMs` at the latest. */
  idle(run: () => void, timeoutMs: number): () => void;
}

export interface Settle {
  /** A change that only edits the document: a pass is owed, within the bound. */
  changed(): void;
  /** A pass ran, whatever caused it: nothing is owed. Answers how long the oldest change it read had waited (ms), or null when none was owed. */
  settled(): number | null;
  /** Whether a change waits for a pass. */
  readonly stale: boolean;
  dispose(): void;
}

export const pageClock: SettleClock = {
  now: () => performance.now(),
  later: (run, ms) => {
    const id = setTimeout(run, ms);
    return () => clearTimeout(id);
  },
  idle: (run, timeoutMs) => {
    // happy-dom has no idle callback: a task of its own there (Chromium's always has one)
    if (typeof requestIdleCallback !== 'function') {
      const id = setTimeout(run, 0);
      return () => clearTimeout(id);
    }
    const id = requestIdleCallback(() => run(), { timeout: timeoutMs });
    return () => cancelIdleCallback(id);
  },
};

/** A settle that calls `run` (the margin's pass, which calls `settled()`) when a pass is owed and due. */
export function createSettle(run: () => void, clock: SettleClock = pageClock): Settle {
  let since: number | null = null; // the oldest change no pass has read
  let quiet: (() => void) | null = null;
  let ceiling: (() => void) | null = null;
  let idle: (() => void) | null = null;
  const clear = () => {
    quiet?.();
    ceiling?.();
    idle?.();
    quiet = ceiling = idle = null;
  };
  const due = () => {
    quiet?.();
    ceiling?.();
    quiet = ceiling = null;
    idle ??= clock.idle(() => {
      idle = null;
      run();
      // a pass that drew nothing (the margin off meanwhile) leaves nothing owed: the next pass reads every anchor anyway
      since = null;
    }, MARGIN_SETTLE_IDLE_MS);
  };
  return {
    changed() {
      const now = clock.now();
      since ??= now;
      if (idle) return; // already due: that pass reads this change too
      quiet?.();
      quiet = clock.later(due, MARGIN_SETTLE_QUIET_MS);
      ceiling ??= clock.later(due, Math.max(0, since + MARGIN_SETTLE_MAX_MS - MARGIN_SETTLE_IDLE_MS - now));
    },
    settled() {
      if (since === null) return null;
      const waited = clock.now() - since;
      since = null;
      clear();
      return waited;
    },
    get stale() {
      return since !== null;
    },
    dispose() {
      since = null;
      clear();
    },
  };
}
