// The prestart measure's numbers (ticket 851, M5; docs/doperpowers/plans/2026-11-24-prestart-engine.md, D14): the arms'
// order, which runs count, what makes the measure invalid, the medians and the bound. The scenes that take the runs are
// e2e/prestart-latency.spec.ts (the bound, on test/support/latency-engine-stub.mjs) and e2e/prestart-engine.spec.ts (the
// acceptance, on the pinned engine), both through e2e/support/prestart-measure.ts.
//
// A run is one New chat on a fresh launch: 3 s of real typing from the first key press to Send, then Send to the first
// assistant row painted, read in the page. The "before" arm is flag-off on this branch (MAWS_E2E_PRESTART unset: Send
// takes today's path), the "after" arm flag-on. A run whose key-to-Send interval falls outside 3 s ± 100 ms is reported
// and not counted. The bound (the regression group's alone): flag-on's median Send-to-paint at least 1.5 s below
// flag-off's, against the stub's 2 s initialize, held only when the measure is valid.
import { createRedactor } from '../live/support/public-evidence.mjs';

export type PrestartArm = 'off' | 'on';

export const PRESTART_BENCH = {
  pairs: 5, // five flag-off and five flag-on runs, one launch each
  typingMs: 3_000,
  typingToleranceMs: 100,
  minCounted: 3, // per arm, for a median worth reading
  initMs: 2_000, // the stub's initialize delay (the regression group's)
  boundMs: 1_500,
} as const;

export interface PrestartRun {
  arm: PrestartArm;
  pair: number;
  keyToSendMs: number; // the page's first keydown to its Send press
  sendToPaintMs: number | null; // the Send press to the first assistant row's frame; null when none was painted
  // the session engines the stub counted, on either side of the Send press by the wall clock; null where nothing counts them
  starts: { beforeSend: number; afterSend: number } | null;
  adopted: boolean; // the session's journal reads a prestart revealed: Send took the prestarted engine
  error: string | null; // why the run failed, at its scene or its teardown; a failed run is never counted
}

export interface PrestartJudgement {
  counted: Record<PrestartArm, number[]>; // each arm's counted Send-to-paint times, in run order
  excluded: { run: PrestartRun; reason: string }[];
  medians: Record<PrestartArm, number | null>;
  gainMs: number | null; // flag-off's median less flag-on's
  reasons: string[]; // why the measure is invalid, each one line; empty when it is valid
  met: boolean | null; // the bound, or null where none is held or the measure is invalid
}

// The starts on either side of the Send press: each start's `at` and `sendAt` are wall-clock instants of the one machine
// (the stub's start line, the test process's reading as it presses Enter), so one clock is compared with itself.
export function startsAroundSend(starts: readonly { at: number }[], sendAt: number): { beforeSend: number; afterSend: number } {
  const beforeSend = starts.filter((start) => start.at < sendAt).length;
  return { beforeSend, afterSend: starts.length - beforeSend };
}

// ABBA: an even pair runs flag-off first, an odd one flag-on first, so neither arm always meets a fresh machine.
export const armsOfPair = (pair: number): [PrestartArm, PrestartArm] => (pair % 2 === 0 ? ['off', 'on'] : ['on', 'off']);

export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const label = (run: PrestartRun) => `flag-${run.arm} run of pair ${run.pair}`;

// What each arm's own path starts: flag-off nothing while typing and one engine at Send, flag-on one engine while typing
// and nothing more at Send.
const EXPECTED_STARTS: Record<PrestartArm, { beforeSend: number; afterSend: number }> = { off: { beforeSend: 0, afterSend: 1 }, on: { beforeSend: 1, afterSend: 0 } };
const startsWord = (n: number) => (n === 1 ? '1 engine start' : `${n} engine starts`);

// `counts`: the engine counts its starts (the stub), so each run must have started its arm's engines, on the right side
// of its Send. `stopped`: why the series ended before its last pair, if it did. The bound is evaluated only on a valid
// measure.
export function judgePrestartRuns(runs: readonly PrestartRun[], opts: { boundMs: number | null; counts: boolean; stopped?: string | null }): PrestartJudgement {
  const counted: Record<PrestartArm, number[]> = { off: [], on: [] };
  const excluded: PrestartJudgement['excluded'] = [];
  const reasons: string[] = [];
  const { typingMs, typingToleranceMs } = PRESTART_BENCH;
  if (opts.stopped) reasons.push(`the series stopped: ${opts.stopped}`);
  for (const run of runs) {
    if (run.error !== null) {
      reasons.push(`${label(run)}: failed: ${run.error}`);
      continue;
    }
    if (run.sendToPaintMs === null) reasons.push(`${label(run)}: no assistant row painted`);
    if (run.arm === 'off' && run.adopted) reasons.push(`${label(run)}: adopted a prestart, which the flag-off path never makes`);
    if (opts.counts) {
      const want = EXPECTED_STARTS[run.arm];
      if (run.starts === null) reasons.push(`${label(run)}: its engine starts were not read`);
      else if (run.starts.beforeSend !== want.beforeSend || run.starts.afterSend !== want.afterSend) {
        reasons.push(`${label(run)}: ${startsWord(run.starts.beforeSend)} before Send and ${run.starts.afterSend} after, not ${want.beforeSend} and ${want.afterSend}`);
      }
    }
    if (run.arm === 'on' && !run.adopted) reasons.push(`${label(run)}: Send launched fresh, the prestart not adopted`);
    if (Math.abs(run.keyToSendMs - typingMs) > typingToleranceMs) {
      excluded.push({ run, reason: `key to Send ${Math.round(run.keyToSendMs)} ms, outside ${typingMs} ± ${typingToleranceMs} ms` });
      continue;
    }
    if (run.sendToPaintMs !== null) counted[run.arm].push(run.sendToPaintMs);
  }
  for (const arm of ['off', 'on'] as const) {
    if (counted[arm].length < PRESTART_BENCH.minCounted) reasons.push(`flag-${arm}: ${counted[arm].length} counted runs, under the ${PRESTART_BENCH.minCounted} a median needs`);
  }
  const medians = { off: counted.off.length > 0 ? median(counted.off) : null, on: counted.on.length > 0 ? median(counted.on) : null };
  const gainMs = medians.off !== null && medians.on !== null ? medians.off - medians.on : null;
  const met = opts.boundMs === null || gainMs === null || reasons.length > 0 ? null : gainMs >= opts.boundMs;
  return { counted, excluded, medians, gainMs, reasons, met };
}

// The run's one line, which the job's log carries (ticket 851's A6: the before and after numbers on one Mac).
export function prestartLine(group: string, judged: PrestartJudgement, opts: { boundMs: number | null; load: number }): string {
  const ms = (value: number | null) => (value === null ? 'none' : `${Math.round(value)} ms`);
  const verdict = judged.met === null ? 'not evaluated, the measure is invalid' : judged.met ? 'met' : 'missed';
  const bound = opts.boundMs === null ? 'reported, no bound' : `bound ≥ ${opts.boundMs} ms: ${verdict}`;
  const notCounted = judged.excluded.length === 1 ? '1 run not counted' : `${judged.excluded.length} runs not counted`;
  return `${group}: Send to first row, flag off median ${ms(judged.medians.off)} (n=${judged.counted.off.length}), flag on median ${ms(judged.medians.on)} (n=${judged.counted.on.length}), difference ${ms(judged.gainMs)} (${bound}); ${notCounted}; 1-minute load ${opts.load.toFixed(2)}`;
}

// A failure's text as it may be logged, asserted and written to the uploaded record of this public repository (the
// gate-offload plan's Decision Log 152): the run's scratch (also as a path not yet resolved through /private names it),
// the checkout and the home named by role, any other account's home anonymized, then the shared redactor's secrets.
export function publicText(text: string, paths: { scratch: readonly string[]; checkout: string; home: string }, env: Record<string, string | undefined> = process.env): string {
  const roles: [string, string][] = [
    ...paths.scratch.flatMap((dir): [string, string][] => [[dir, '<scratch>'], ...(dir.startsWith('/private/') ? [[dir.slice('/private'.length), '<scratch>'] as [string, string]] : [])]),
    [paths.checkout, '<checkout>'],
    [paths.home, '~'],
  ];
  let out = text;
  for (const [path, role] of roles.filter(([path]) => path.length > 3).sort(([a], [b]) => b.length - a.length)) out = out.split(path).join(role);
  return createRedactor(env)(out.replace(/\/Users\/(?!<user>)[^/\s'"]+/g, '/Users/<user>'));
}

/**
 * The acceptance's SessionStart hook (e2e/prestart-engine.spec.ts): a 200 ms sleep, then `marker` written, a hook that
 * failed or never ran writing none. The engine runs it through /bin/sh, so the path is one single-quoted word, each of its
 * own single quotes closed, escaped and reopened (the prestart panel, sweep#8: a scratch whose real path holds one).
 */
export const markerHookCommand = (marker: string): string => `sleep 0.2 && : > '${marker.replaceAll("'", "'\\''")}'`;
