// What git ignores among a listed directory's entries (UX wave U6b-3a,
// docs/doperpowers/plans/2026-11-17-ux-wave-U6b-3a-what-changed.md, decisions 12 and 13, Interfaces §A; the mechanism as
// Decision Log 9 and 10 amend it).
//
// An ask finds its repository as git's own discovery does in read mode, with no process: the nearest folder at or
// above the listed directory that holds a `.git` entry, a folder or a file (a worktree's, a submodule's), so a folder
// inside a submodule or a nested repository is judged by that repository's own rules. A directory inside a `.git`
// folder, and one in no repository, starts no git and has no answer.
//
// Git runs only in the repository the walk found, for folders that are still what the files service confirmed (the
// branch panel's security findings): each call names that `.git` as GIT_DIR and its folder as GIT_WORK_TREE, so neither
// git's own discovery nor a `core.worktree` in the configuration a gitdir pointer leads to can judge the names by
// another tree's rules; and before each call every ask's folder is confirmed at the very spelling git is handed (its
// realpath that spelling, the object the service opened) and the `.git` as the walk found it, so a substitution made
// between the walk and the run is refused before git reads anything. An explicit GIT_DIR skips git's own check of who
// owns a repository (`safe.directory`), so the check makes one over what git will read (Decision Log 18, as ruled): the
// folder and its `.git` entry, and, by `stat`, the git directory the entry leads to as git resolves it (a folder, a link
// followed, a gitdir pointer read), a linked worktree's common directory, and the `config` in each, all this user's;
// that resolution is made again before each call and must name the same directories, so a pointer rewritten in place
// is caught too. The walk stops where the device changes above the asked folder, as git's discovery does
// (GIT_DISCOVERY_ACROSS_FILESYSTEM unset), so a folder below a mount point is judged by nothing. The threat model, and
// what it leaves: whoever can write a `.git` the daemon's user owns already runs code as that user (a hook, in a terminal's
// git; board ticket 756), so what that `.git` holds is trusted as the user's own; a substitution that stands when the
// listing's last confirmation runs is refused there; one made and undone while git itself runs is not seen, and can
// answer by another tree's rules for names the listing read in the confirmed folder, as a swap and a restore between a
// listing's reads and its last confirmation can show outside names (service.ts).
//
// The asks of one repository share its runs: while a run of the repository is in flight, or waits for a place, the asks
// that arrive join its next run (Decision Log 10).
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
// repository, the rest waiting in order, a run holding its place until the runner settled and its every child closed;
// each ask answers within `allowanceMs` of being asked, its wait and its walk included, or gives no answer (null), and
// an ask whose bound passes while it waits leaves its run. A run's timeout is
// the latest deadline among the asks it carries. No answer is never a failure of the listing that asked, and a run
// that fails gives none of its asks an answer. The check owns its runs: its runner is made with a spawn function that
// keeps every child it starts until that child's `close`, so the daemon's stop (`dispose`, a part of the checkouts'
// stop) can end the process group of each run still alive. After a crash nothing is disposed: a run alive then reads
// its input to the end, answers into a pipe nobody reads and exits (decision 13's last paragraph).
import type { ChildProcess } from 'node:child_process';
import fs, { type BigIntStats } from 'node:fs';
import { dirname, join, relative, resolve as resolvePath, sep } from 'node:path';
import { createGitRunner, execGit, GitCommandError, GitTimeoutError, NotARepositoryError, type ExecFileFn, type GitRun } from '../git/runner';
import { sameIdentity, type Identity } from './watch';

export const IGNORED_CHECK_MS = 2_000; // one check's whole allowance, its wait for a place included
export const IGNORED_CHECK_CONCURRENCY = 4; // runs at once in one daemon

export interface IgnoreCheck {
  // The names among `names` that git ignores in `dir`; null when git gives no answer within the allowance, and after `dispose`.
  // `opened`: the object the files service confirmed at `dir`, which git is asked about only while `dir` still names it;
  // absent, the object `dir` names when it is asked.
  names(dir: string, names: readonly string[], opened?: Identity): Promise<ReadonlySet<string> | null>;
  // One synchronous call: later asks and waiting asks get null, and the process group of every live run gets SIGKILL.
  // The promise settles when every child the check started has closed (the tests wait on it; the stop does not).
  dispose(): Promise<void>;
}

// What the measurement reads (probe 8): each run as it starts, with how long each of its asks waited since it was
// asked; each ask whose bound passed, and whether it was still waiting for its run then.
export type IgnoreCheckEvent = { kind: 'run'; waitedMs: readonly number[] } | { kind: 'expired'; waiting: boolean };

interface Ask {
  dir: string; // as asked: the spelling git is handed, from its repository's root
  names: readonly string[];
  asked: number; // Date.now() when asked
  deadline: number; // Date.now() at which the allowance ends
  rel: string; // the directory from its repository's root; '' for the root itself
  opened: Identity | null; // the object `dir` must still name, once known
  marker: Identity | null; // the repository's `.git` as the walk found it
  repo: string; // the directories the `.git` led git to at the walk, with their identities (`repositoryAt`)
  batch: Batch | null; // the run it joined, once its repository is known
  answer(value: ReadonlySet<string> | null): void; // the first call settles; later ones do nothing
}

interface Owned {
  children: Set<ChildProcess>; // the run's children not yet closed
  closed: (() => void)[]; // called when `children` is empty
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
  // Each run's own runner, over a spawn function that keeps every child it starts, in the check's set and in the run's,
  // until that child's `close`: after a timeout the runner gives a run up at its SIGKILL, before the child has closed,
  // and the run's place is freed only once its own set is empty (Decision Log 12). Every call names the repository the
  // walk found to git, its `.git` and its folder as the work tree (the panel's security findings).
  const runnerFor = (owned: Owned, root: string) => {
    const pinned = { GIT_DIR: join(root, '.git'), GIT_WORK_TREE: root };
    const keeping: ExecFileFn = (file, args, execOptions, callback) => {
      const child = execFile(file, args, { ...execOptions, env: { ...execOptions.env, ...pinned } }, callback);
      if (child) {
        children.add(child);
        owned.children.add(child);
        child.once('close', () => {
          children.delete(child);
          owned.children.delete(child);
          if (owned.children.size === 0) for (const settle of owned.closed.splice(0)) settle();
          if (children.size === 0) for (const settle of idle.splice(0)) settle();
        });
      }
      return child;
    };
    return createGitRunner({ ...(env === undefined ? {} : { env }), execFile: keeping });
  };
  const allClosed = (owned: Owned) => (owned.children.size === 0 ? Promise.resolve() : new Promise<void>((resolve) => owned.closed.push(resolve)));
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
      const owned: Owned = { children: new Set(), closed: [] };
      void carry(batch, runnerFor(owned, batch.root))
        .then(() => allClosed(owned))
        .finally(() => {
          running--; // the run has really ended, its every child closed: its place, and its repository, are free
          busy.delete(batch.root);
          start();
        });
    }
  };

  async function carry({ root, asks }: Batch, run: GitRun): Promise<void> {
    const deadline = Math.max(...asks.map((ask) => ask.deadline));
    const rest = () => Math.max(1, deadline - Date.now()); // both calls share the latest deadline the run carries
    const live = () => asks.filter((ask) => pending.has(ask));
    // Before each call: the asks whose folder and repository are still what was confirmed; the others get no answer
    const holding = async (): Promise<Ask[]> => {
      const marker = await fs.promises.lstat(join(root, '.git'), { bigint: true }).catch(() => null);
      const repo = marker === null ? null : await repositoryAt(root, marker);
      const asked = live();
      const held = await Promise.all(asked.map(async (ask) => marker !== null && sameIdentity(marker, ask.marker!) && repo === ask.repo && (await stillNames(ask.dir, ask.opened!))));
      asked.forEach((ask, i) => {
        if (held[i] || !pending.has(ask)) return;
        noAnswer(repo === OWNED_ELSEWHERE ? 'the repository belongs to another user' : 'the folder or its repository changed before git ran');
        ask.answer(null);
      });
      return live();
    };
    try {
      const listed = await holding();
      if (listed.length === 0) return; // nothing left to ask: no git runs
      const rels = [...new Set(listed.map((ask) => ask.rel))];
      const listing = await run(root, ['--literal-pathspecs', 'ls-files', '-z', '--', ...rels.map((rel) => (rel === '' ? '.' : `${rel}/`))], { timeoutMs: rest() });
      const tracked = trackedBeneath(listing, rels);
      const carried = await holding();
      if (carried.length === 0) return; // every ask answered meanwhile (the bounds, the stop, a substitution): the second call is not made
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
    names(dir, names, opened) {
      if (disposed) return Promise.resolve(null);
      if (names.length === 0) return Promise.resolve(new Set<string>());
      return new Promise((resolve) => {
        const asked = Date.now();
        const ask: Ask = {
          dir,
          names,
          asked,
          deadline: asked + allowanceMs,
          rel: '',
          opened: opened ?? null,
          marker: null,
          repo: '',
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
        const known = opened === undefined ? fs.promises.stat(dir, { bigint: true }).catch(() => null) : Promise.resolve(opened);
        const device = known.then((identity) => identity?.dev ?? null);
        void Promise.all([repositoryOf(dir, device, () => pending.has(ask)), known]).then(([found, identity]) => {
          if (!pending.has(ask)) return;
          if (found === null || identity === null) return ask.answer(null); // no repository, inside a `.git` folder, or gone: no answer, and silent
          if (found === OWNED_ELSEWHERE) {
            noAnswer('the repository belongs to another user');
            return ask.answer(null);
          }
          ask.rel = relative(found.root, dir);
          ask.opened = identity;
          ask.marker = found.marker;
          ask.repo = found.repo;
          enter(found.root, ask);
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

const OWNED_ELSEWHERE = 'owned elsewhere';

// The repository that holds `dir` (an absolute realpath), as git's discovery finds it from there in read mode: the
// nearest folder at or above it with a `.git` entry, that entry's identity, and the directories it leads git to
// (`repositoryAt`). Null inside a `.git` folder, where no work tree is, in no repository, above a change of device (git's
// discovery stops at a filesystem boundary: it compares each folder above with the device of the one it started in,
// `device`), for a `.git` that leads git to no directory, and once `live` says the ask is answered (its bound passed, the
// check disposed: the branch panel's scalpel 1); `OWNED_ELSEWHERE` when the folder, its `.git` or what that leads git
// to is another user's. A folder whose `.git` is no repository is judged by nothing: git, named that `.git`, fails.
async function repositoryOf(dir: string, device: Promise<bigint | null>, live: () => boolean): Promise<{ root: string; marker: BigIntStats; repo: string } | typeof OWNED_ELSEWHERE | null> {
  if (dir.split(sep).includes('.git')) return null;
  for (let at = dir; live(); at = dirname(at)) {
    let folder: BigIntStats | null = null;
    if (at !== dir) {
      const [here, start] = await Promise.all([fs.promises.lstat(at, { bigint: true }).catch(() => null), device]);
      if (here === null || start === null || here.dev !== start) return null;
      folder = here;
    }
    const marker = await fs.promises.lstat(join(at, '.git'), { bigint: true }).catch(() => null);
    if (marker !== null) {
      folder ??= await fs.promises.lstat(at, { bigint: true }).catch(() => null);
      if (folder === null) return null;
      if (!ownedHere(marker) || !ownedHere(folder)) return OWNED_ELSEWHERE;
      const repo = await repositoryAt(at, marker);
      return repo === null || repo === OWNED_ELSEWHERE ? repo : { root: at, marker, repo };
    }
    if (dirname(at) === at) return null;
  }
  return null;
}

// The directories `<root>/.git` leads git to, as git resolves them, with their identities, as one string two
// resolutions are compared by: the git directory (the folder, a link followed, or the path a gitdir pointer names, read
// relative to `root` as git reads it) and, for a linked worktree, the common directory its `commondir` names. Each of
// them, and the `config` in each where there is one, must be this user's by `stat`, which follows a link to what git
// reads (the ruling on ownership: an explicit GIT_DIR skips git's own check; a root-owned one passes git's only for git
// run as root, which the daemon never is). Null when the entry leads git to no directory.
async function repositoryAt(root: string, marker: BigIntStats): Promise<string | typeof OWNED_ELSEWHERE | null> {
  const entry = join(root, '.git');
  let gitDir: string | null;
  if (marker.isFile()) {
    const text = (await fs.promises.readFile(entry, 'utf8').catch(() => null))?.trimEnd() ?? null;
    gitDir = text?.startsWith('gitdir: ') ? await fs.promises.realpath(resolvePath(root, text.slice('gitdir: '.length))).catch(() => null) : null;
  } else gitDir = await fs.promises.realpath(entry).catch(() => null);
  if (gitDir === null) return null;
  const pointed = (await fs.promises.readFile(join(gitDir, 'commondir'), 'utf8').catch(() => null))?.trimEnd() ?? null;
  const common = pointed === null ? null : await fs.promises.realpath(resolvePath(gitDir, pointed)).catch(() => null);
  if (pointed !== null && common === null) return null;
  const dirs = common === null ? [gitDir] : [gitDir, common];
  const stats = await Promise.all(dirs.map((dir) => fs.promises.stat(dir, { bigint: true }).catch(() => null)));
  const configs = await Promise.all(dirs.map((dir) => fs.promises.stat(join(dir, 'config'), { bigint: true }).catch(() => null)));
  if (stats.some((stat) => stat === null)) return null;
  if (![...stats, ...configs].every((stat) => stat === null || ownedHere(stat))) return OWNED_ELSEWHERE;
  return dirs.map((dir, i) => `${dir}\0${stats[i]!.dev}:${stats[i]!.ino}`).join('\0');
}

// Whether this process's user owns the entry, as git's own check of a discovered repository asks (`lstat`'s owner)
function ownedHere(stat: BigIntStats): boolean {
  const uid = process.getuid?.();
  return uid === undefined || stat.uid === BigInt(uid);
}

// Whether `dir` still names `opened`, at that very spelling: its realpath is the spelling itself, so no link stands on
// its way, and the object there is the one confirmed
async function stillNames(dir: string, opened: Identity): Promise<boolean> {
  if ((await fs.promises.realpath(dir).catch(() => null)) !== dir) return false;
  const now = await fs.promises.stat(dir, { bigint: true }).catch(() => null);
  return now !== null && sameIdentity(now, opened);
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
