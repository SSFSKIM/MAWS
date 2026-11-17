// What git ignores among a listed directory's entries (UX wave U6b-3a,
// docs/doperpowers/plans/2026-11-17-ux-wave-U6b-3a-what-changed.md, decisions 12 and 13, Interfaces §A; the mechanism as
// Decision Log 9 amends it). Two runs in read mode, both in the listed directory itself, so git answers by the innermost
// repository that holds it (a submodule's or a nested repository's own rules) and no path asked lies in a submodule:
// `git ls-files -z`, whose paths' first segments are the names tracked there or holding a tracked file, then
// `git check-ignore --no-index -z --stdin` on the other names. A tracked file, and a folder that holds one, is never
// named, as `check-ignore` without `--no-index` answers; asking with `--no-index` spares git a look into the index for
// each name, which cost about 0.33 ms a name at 22,000 entries (probe 8's first run). Each name is sent as `./<name>`,
// so a name that begins with `:` stays a name and not pathspec magic. Exit 1 is "nothing ignored". A listing of more
// than the runner's 64 MiB of tracked paths beneath the directory overflows and gives no answer.
//
// The check can only cost what it is allowed: at most `concurrency` run at once in a daemon and the rest wait in order;
// each answers within `allowanceMs` of being asked, its wait included, or gives no answer (null). No answer is never a
// failure of the listing that asked. The check owns its runs: its runner is made with a spawn function that keeps every
// child it starts until that child's `close`, so the daemon's stop (`dispose`, a part of the checkouts' stop) can end
// the process group of each run still alive. After a crash nothing is disposed: a check alive then reads its input to
// the end, answers into a pipe nobody reads and exits (decision 13's last paragraph).
import type { ChildProcess } from 'node:child_process';
import { createGitRunner, execGit, GitCommandError, GitTimeoutError, NotARepositoryError, type ExecFileFn } from '../git/runner';

export const IGNORED_CHECK_MS = 2_000; // one check's whole allowance, its wait for a place included
export const IGNORED_CHECK_CONCURRENCY = 4; // checks running at once in one daemon

export interface IgnoreCheck {
  // The names among `names` that git ignores in `dir`; null when git gives no answer within the allowance, and after `dispose`.
  names(dir: string, names: readonly string[]): Promise<ReadonlySet<string> | null>;
  // One synchronous call: later asks and waiting asks get null, and the process group of every live run gets SIGKILL.
  // The promise settles when every child the check started has closed (the tests wait on it; the stop does not).
  dispose(): Promise<void>;
}

interface Ask {
  dir: string;
  names: readonly string[];
  deadline: number; // Date.now() at which the allowance ends
  answer(value: ReadonlySet<string> | null): void; // the first call settles; later ones do nothing
}

// `execFile`: the spawn function the check's own runner is made with, `execGit` when absent; `concurrency` and
// `allowanceMs`: the tests' and the measurement's.
export function createIgnoreCheck(options: { env?: NodeJS.ProcessEnv; execFile?: ExecFileFn; concurrency?: number; allowanceMs?: number } = {}): IgnoreCheck {
  const { env, execFile = execGit, concurrency = IGNORED_CHECK_CONCURRENCY, allowanceMs = IGNORED_CHECK_MS } = options;
  const children = new Set<ChildProcess>(); // every child started and not yet closed
  const idle: (() => void)[] = []; // `dispose`'s waiters, called when `children` is empty
  const keeping: ExecFileFn = (file, args, execOptions, callback) => {
    const child = execFile(file, args, execOptions, callback);
    if (child) {
      children.add(child);
      child.once('close', () => {
        children.delete(child);
        if (children.size === 0) for (const settle of idle.splice(0)) settle();
      });
    }
    return child;
  };
  const run = createGitRunner({ ...(env === undefined ? {} : { env }), execFile: keeping });
  const pending = new Set<Ask>(); // asked and not answered
  const waiting: Ask[] = []; // asked and not started, in order
  let running = 0;
  let disposed = false;
  const logged = new Set<string>(); // the reasons already written to the daemon's log in this run

  const noAnswer = (reason: string) => {
    if (disposed || logged.has(reason)) return;
    logged.add(reason);
    console.warn(`[files] the ignore check gave no answer: ${reason}; such a listing marks nothing`);
  };

  const start = () => {
    while (!disposed && running < concurrency && waiting.length > 0) {
      const ask = waiting.shift()!;
      running++;
      void check(ask).then(ask.answer, () => ask.answer(null)).finally(() => {
        running--; // the run has really ended: its place is free
        start();
      });
    }
  };

  async function check(ask: Ask): Promise<ReadonlySet<string> | null> {
    const { dir, names, deadline } = ask;
    const rest = () => Math.max(1, deadline - Date.now()); // both runs share the ask's one deadline
    try {
      const tracked = firstSegments(await run(dir, ['ls-files', '-z'], { timeoutMs: rest() }));
      const asked = names.filter((name) => !tracked.has(name));
      if (!pending.has(ask)) return null; // answered meanwhile (the bound, the stop): the second run is not started
      if (asked.length === 0) return new Set();
      const out = await run(dir, ['check-ignore', '--no-index', '-z', '--stdin'], {
        input: asked.map((name) => `./${name}\0`).join(''),
        acceptExitCodes: [1], // nothing ignored
        timeoutMs: rest(),
      });
      return new Set(out.split('\0').filter((path) => path !== '').map((path) => (path.startsWith('./') ? path.slice(2) : path)));
    } catch (error) {
      // not a repository is no failure, and silent; a run that ends after its ask was answered (the bound, the stop) was logged then, or is no failure
      if (pending.has(ask) && !(error instanceof NotARepositoryError)) noAnswer(reasonOf(error));
      return null;
    }
  }

  return {
    names(dir, names) {
      if (disposed) return Promise.resolve(null);
      if (names.length === 0) return Promise.resolve(new Set<string>());
      return new Promise((resolve) => {
        const ask: Ask = {
          dir,
          names,
          deadline: Date.now() + allowanceMs,
          answer: (value) => {
            if (!pending.delete(ask)) return;
            clearTimeout(bound);
            const at = waiting.indexOf(ask);
            if (at >= 0) waiting.splice(at, 1); // a check that waited its whole bound never starts
            resolve(value);
          },
        };
        const bound = setTimeout(() => {
          noAnswer(`no answer within ${allowanceMs} ms`);
          ask.answer(null);
        }, allowanceMs);
        pending.add(ask);
        waiting.push(ask);
        start();
      });
    },
    dispose() {
      if (!disposed) {
        disposed = true;
        for (const ask of [...pending]) ask.answer(null);
        for (const child of children) {
          if (child.pid === undefined) continue;
          try {
            process.kill(-child.pid, 'SIGKILL'); // the group git leads (`execGit` starts it detached)
          } catch {
            // the group is gone already
          }
        }
      }
      return children.size === 0 ? Promise.resolve() : new Promise((resolve) => idle.push(resolve));
    },
  };
}

// The first segment of every path `ls-files -z` lists: the names in the directory that are tracked or hold a tracked
// file. Each entry is cut out before it is searched for a slash, so a long listing is read once.
function firstSegments(listing: string): ReadonlySet<string> {
  const segments = new Set<string>();
  for (let start = 0; start < listing.length; ) {
    const end = listing.indexOf('\0', start);
    const stop = end < 0 ? listing.length : end;
    const path = listing.slice(start, stop);
    const slash = path.indexOf('/');
    if (path !== '') segments.add(slash < 0 ? path : path.slice(0, slash));
    start = stop + 1;
  }
  return segments;
}

// Why a run gave no answer, in words that name no folder (a git message can quote the repository's path)
function reasonOf(error: unknown): string {
  if (error instanceof GitTimeoutError) return 'git timed out';
  if (error instanceof GitCommandError) return `git exited with ${error.exitCode ?? 'a signal'}`;
  if (error instanceof Error && error.message.startsWith('git unavailable')) return 'git is unavailable';
  return 'git failed';
}
