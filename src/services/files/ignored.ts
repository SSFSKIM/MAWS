// What git ignores among a listed directory's entries (UX wave U6b-3a, docs/doperpowers/plans/2026-11-17-ux-wave-U6b-3a-what-changed.md,
// decisions 12 and 13, Interfaces §A). Not built yet: every ask has no answer.
import type { ExecFileFn } from '../git/runner';

export const IGNORED_CHECK_MS = 2_000; // one check's whole allowance, its wait for a place included
export const IGNORED_CHECK_CONCURRENCY = 4; // checks running at once in one daemon

export interface IgnoreCheck {
  // The names among `names` that git ignores in `dir`; null when git gives no answer within the allowance, and after `dispose`.
  names(dir: string, names: readonly string[]): Promise<ReadonlySet<string> | null>;
  // One synchronous call: later asks and waiting asks get null, and the process group of every live run gets SIGKILL.
  // The promise settles when every child the check started has closed (the tests wait on it; the stop does not).
  dispose(): Promise<void>;
}

export function createIgnoreCheck(_options: { env?: NodeJS.ProcessEnv; execFile?: ExecFileFn; concurrency?: number; allowanceMs?: number } = {}): IgnoreCheck {
  return { names: async () => null, dispose: async () => {} };
}
