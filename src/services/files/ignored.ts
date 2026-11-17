// What git ignores among a listed directory's entries (UX wave U6b-3a,
// docs/doperpowers/plans/2026-11-17-ux-wave-U6b-3a-what-changed.md, decisions 12 and 13, Interfaces §A; the mechanism as
// Decision Log 9 and 10 amend it).
//
// An ask finds its repository as git's own discovery does in read mode, with no process: the nearest folder at or
// above the listed directory that holds a `.git` entry, a folder or a file (a worktree's, a submodule's), so a folder
// inside a submodule or a nested repository is judged by that repository's own rules. A directory inside a `.git`
// folder, and one in no repository, starts no git and has no answer. The asks of one repository share its runs: while
// a run of the repository is in flight, or waits for a place, the asks that arrive join its next run (Decision Log 10).
// A run is two git calls in read mode in the repository's root: `git --literal-pathspecs ls-files -z -- <dir>/…` for
// the joined directories, whose paths name what is tracked in each, then `git check-ignore --no-index -z --stdin` on
// every joined name that is no tracked path nor the first segment of one, each sent as `./<dir>/<name>` (the `./`
// keeps a name that begins with `:` a name; check-ignore refuses literal pathspecs, and matches a name's `*` or `[` as
// text). A tracked file, and a folder that holds one, is never named, as `check-ignore` without `--no-index` answers,
// and `--no-index` spares git a look into the index for each name (about 0.33 ms a name at 22,000 entries, probe 8's
// first run); with it, a path inside a submodule does not fail the call. Each answer is split back to its ask; nothing
// is kept beyond the run. Exit 1 is "nothing ignored". A run whose `ls-files` lists more than the runner's 64 MiB
// overflows and gives no answer.
//
// The check can only cost what it is allowed: at most `concurrency` runs at once in a daemon, at most one per
// repository, the rest waiting in order; each ask answers within `allowanceMs` of being asked, its wait and its walk
// included, or gives no answer (null), and an ask whose bound passes while it waits leaves its run. A run's timeout is
// the latest deadline among the asks it carries. No answer is never a failure of the listing that asked, and a run
// that fails gives none of its asks an answer. The check owns its runs: its runner is made with a spawn function that
// keeps every child it starts until that child's `close`, so the daemon's stop (`dispose`, a part of the checkouts'
// stop) can end the process group of each run still alive. After a crash nothing is disposed: a run alive then reads
// its input to the end, answers into a pipe nobody reads and exits (decision 13's last paragraph).
import type { ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { createGitRunner, execGit, GitCommandError, GitTimeoutError, NotARepositoryError, type ExecFileFn } from '../git/runner';

export const IGNORED_CHECK_MS = 2_000; // one check's whole allowance, its wait for a place included
export const IGNORED_CHECK_CONCURRENCY = 4; // runs at once in one daemon

export interface IgnoreCheck {
  // The names among `names` that git ignores in `dir`; null when git gives no answer within the allowance, and after `dispose`.
  names(dir: string, names: readonly string[]): Promise<ReadonlySet<string> | null>;
  // One synchronous call: later asks and waiting asks get null, and the process group of every live run gets SIGKILL.
  // The promise settles when every child the check started has closed (the tests wait on it; the stop does not).
  dispose(): Promise<void>;
}

// What the measurement reads (probe 8): each run as it starts, with how long each of its asks waited since it was
// asked; each ask whose bound passed, and whether it was still waiting for its run then.
export type IgnoreCheckEvent = { kind: 'run'; waitedMs: readonly number[] } | { kind: 'expired'; waiting: boolean };

interface Ask {
  names: readonly string[];
  asked: number; // Date.now() when asked
  deadline: number; // Date.now() at which the allowance ends
  rel: string; // the directory from its repository's root; '' for the root itself
  batch: Batch | null; // the run it joined, once its repository is known
  answer(value: ReadonlySet<string> | null): void; // the first call settles; later ones do nothing
}

interface Batch {
  root: string;
  asks: Ask[];
  started: boolean;
}

// `execFile`: the spawn function the check's own runner is made with, `execGit` when absent; `concurrency`,
// `allowanceMs` and `observe`: the tests' and the measurement's.
export function createIgnoreCheck(
  options: { env?: NodeJS.ProcessEnv; execFile?: ExecFileFn; concurrency?: number; allowanceMs?: number; observe?: (event: IgnoreCheckEvent) => void } = {},
): IgnoreCheck {
  const { env, execFile = execGit, concurrency = IGNORED_CHECK_CONCURRENCY, allowanceMs = IGNORED_CHECK_MS, observe } = options;
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
  const open = new Map<string, Batch>(); // per repository root: the run not started yet, which new asks join
  const queue: Batch[] = []; // runs not started, in the order they were opened
  const busy = new Set<string>(); // the roots with a run in flight
  let running = 0;
  let disposed = false;
  const logged = new Set<string>(); // the reasons already written to the daemon's log in this run

  const noAnswer = (reason: string) => {
    if (disposed || logged.has(reason)) return;
    logged.add(reason);
    console.warn(`[files] the ignore check gave no answer: ${reason}; such a listing marks nothing`);
  };

  // A run whose every ask left it before it started is no run
  const forget = (batch: Batch) => {
    if (batch.started || batch.asks.length > 0) return;
    const at = queue.indexOf(batch);
    if (at >= 0) queue.splice(at, 1);
    if (open.get(batch.root) === batch) open.delete(batch.root);
  };

  const enter = (root: string, ask: Ask) => {
    let batch = open.get(root);
    if (!batch) {
      batch = { root, asks: [], started: false };
      open.set(root, batch);
      queue.push(batch);
    }
    batch.asks.push(ask);
    ask.batch = batch;
    start();
  };

  const start = () => {
    for (let i = 0; !disposed && running < concurrency && i < queue.length; ) {
      const batch = queue[i]!;
      if (busy.has(batch.root)) {
        i++; // one run per repository at a time: the next waits for it, and gathers what arrives meanwhile
        continue;
      }
      queue.splice(i, 1);
      open.delete(batch.root);
      batch.started = true;
      running++;
      busy.add(batch.root);
      const now = Date.now();
      observe?.({ kind: 'run', waitedMs: batch.asks.map((ask) => now - ask.asked) });
      void carry(batch).finally(() => {
        running--; // the run has really ended: its place, and its repository, are free
        busy.delete(batch.root);
        start();
      });
    }
  };

  async function carry({ root, asks }: Batch): Promise<void> {
    const deadline = Math.max(...asks.map((ask) => ask.deadline));
    const rest = () => Math.max(1, deadline - Date.now()); // both calls share the latest deadline the run carries
    const live = () => asks.filter((ask) => pending.has(ask));
    try {
      const rels = [...new Set(asks.map((ask) => ask.rel))];
      const listing = await run(root, ['--literal-pathspecs', 'ls-files', '-z', '--', ...rels.map((rel) => (rel === '' ? '.' : `${rel}/`))], { timeoutMs: rest() });
      const tracked = trackedBeneath(listing, rels);
      const carried = live();
      if (carried.length === 0) return; // every ask answered meanwhile (the bounds, the stop): the second call is not made
      const byPath = new Map<string, Ask[]>(); // `./<rel>/<name>` as sent and as git answers it
      const answers = new Map<Ask, Set<string>>(carried.map((ask) => [ask, new Set<string>()]));
      for (const ask of carried) {
        const known = tracked.get(ask.rel)!;
        for (const name of ask.names) {
          if (known.has(name)) continue;
          const path = ask.rel === '' ? `./${name}` : `./${ask.rel}/${name}`;
          byPath.set(path, [...(byPath.get(path) ?? []), ask]);
        }
      }
      if (byPath.size > 0) {
        const out = await run(root, ['check-ignore', '--no-index', '-z', '--stdin'], {
          input: [...byPath.keys()].map((path) => `${path}\0`).join(''),
          acceptExitCodes: [1], // nothing ignored
          timeoutMs: rest(),
        });
        for (const path of out.split('\0')) {
          for (const ask of byPath.get(path) ?? []) answers.get(ask)!.add(path.slice(path.lastIndexOf('/') + 1));
        }
      }
      for (const [ask, names] of answers) ask.answer(names);
    } catch (error) {
      // not a repository is no failure, and silent; a run whose asks were all answered meanwhile logs nothing more
      if (live().length > 0 && !(error instanceof NotARepositoryError)) noAnswer(reasonOf(error));
      for (const ask of asks) ask.answer(null);
    }
  }

  return {
    names(dir, names) {
      if (disposed) return Promise.resolve(null);
      if (names.length === 0) return Promise.resolve(new Set<string>());
      return new Promise((resolve) => {
        const asked = Date.now();
        const ask: Ask = {
          names,
          asked,
          deadline: asked + allowanceMs,
          rel: '',
          batch: null,
          answer: (value) => {
            if (!pending.delete(ask)) return;
            clearTimeout(bound);
            const { batch } = ask;
            if (batch && !batch.started) {
              batch.asks.splice(batch.asks.indexOf(ask), 1); // it leaves the run it waited for
              forget(batch);
            }
            resolve(value);
          },
        };
        const bound = setTimeout(() => {
          observe?.({ kind: 'expired', waiting: ask.batch?.started !== true });
          noAnswer(`no answer within ${allowanceMs} ms`);
          ask.answer(null);
        }, allowanceMs);
        pending.add(ask);
        void repositoryOf(dir).then((root) => {
          if (!pending.has(ask)) return;
          if (root === null) return ask.answer(null); // no repository, or inside a `.git` folder: no answer, and silent
          ask.rel = relative(root, dir);
          enter(root, ask);
        });
      });
    },
    dispose() {
      if (!disposed) {
        disposed = true;
        for (const ask of [...pending]) ask.answer(null);
        queue.length = 0;
        open.clear();
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

// The repository that holds `dir` (an absolute realpath), as git's discovery finds it from there in read mode (no
// GIT_DIR, no ceiling): the nearest folder at or above it with a `.git` entry. Null inside a `.git` folder, where no
// work tree is, and in no repository. Unlike git it does not stop at a mount point; a folder whose `.git` is no
// repository is handed to git, which then answers by the repository above or fails.
async function repositoryOf(dir: string): Promise<string | null> {
  if (dir.split(sep).includes('.git')) return null;
  for (let at = dir; ; at = dirname(at)) {
    const found = await fs.promises.lstat(join(at, '.git')).then(
      () => true,
      () => false,
    );
    if (found) return at;
    if (dirname(at) === at) return null;
  }
}

// For each directory of `rels` (from the root; '' the root), the names in it that are tracked or hold a tracked file:
// the segment after the directory of every path `ls-files -z` lists beneath it. Each entry is cut out before it is
// searched, so a long listing is read once.
function trackedBeneath(listing: string, rels: readonly string[]): Map<string, Set<string>> {
  const tracked = new Map(rels.map((rel) => [rel, new Set<string>()]));
  for (let start = 0; start < listing.length; ) {
    const end = listing.indexOf('\0', start);
    const stop = end < 0 ? listing.length : end;
    const path = listing.slice(start, stop);
    start = stop + 1;
    if (path === '') continue;
    // the root, then every folder above the path's own name: each a directory that may have been asked
    for (let slash = -1; ; ) {
      const next = path.indexOf('/', slash + 1);
      tracked.get(slash < 0 ? '' : path.slice(0, slash))?.add(path.slice(slash + 1, next < 0 ? path.length : next));
      if (next < 0) break;
      slash = next;
    }
  }
  return tracked;
}

// Why a run gave no answer, in words that name no folder (a git message can quote the repository's path)
function reasonOf(error: unknown): string {
  if (error instanceof GitTimeoutError) return 'git timed out';
  if (error instanceof GitCommandError) return `git exited with ${error.exitCode ?? 'a signal'}`;
  if (error instanceof Error && error.message.startsWith('git unavailable')) return 'git is unavailable';
  return 'git failed';
}
