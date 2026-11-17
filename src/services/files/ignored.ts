// What git ignores among a listed directory's entries (UX wave U6b-3a,
// docs/doperpowers/plans/2026-11-17-ux-wave-U6b-3a-what-changed.md, decisions 12 and 13, Interfaces §A; the mechanism as
// Decision Log 9 and 10 amend it).
//
// An ask finds its repository as git's own discovery does in read mode, with no process: the nearest folder at or
// above the listed directory that holds a `.git` entry, a folder or a file (a worktree's, a submodule's), so a folder
// inside a submodule or a nested repository is judged by that repository's own rules. A directory inside a `.git`
// folder, and one in no repository, starts no git and has no answer.
//
// Git runs only in the repository git itself names, for folders that are still what the files service confirmed (the
// branch panel's security findings, the delta review's): before each call every ask's folder is confirmed at the very
// spelling git is handed (its realpath that spelling, the object the service opened) and the `.git` as the walk found
// it (the same object, and a gitdir pointer not rewritten since), and then git is asked where the repository is, from
// the repository's root by its own discovery, with no GIT_DIR (`git rev-parse`): git reads the `.git` entry, a gitdir
// pointer and a `commondir` itself, and makes its own check of who owns what it found (the runner resets
// `safe.directory`). That check reads a `.git` link's own owner, not its target's, so the check makes one of its own
// over what git will read (as the architect ruled): the git directory and the common directory git printed, and the
// `config` in each, this user's by `stat`; and the work tree git printed must be the folder the walk found, so neither a
// `core.worktree` nor a pointer that leads elsewhere can judge the names by another tree's rules. The call is then pinned
// to that answer (GIT_DIR, GIT_COMMON_DIR and GIT_WORK_TREE), so git reads no pointer again; the answer is asked again
// before the run's second call and must name the same directories, so a pointer rewritten in place is caught too. The
// walk stops where the device changes above the asked folder, as git's discovery does (GIT_DISCOVERY_ACROSS_FILESYSTEM
// unset), so a folder below a mount point is judged by nothing; the walk's stop comes first and starts no git. The threat
// model, and what it leaves: whoever can write a `.git` the daemon's user owns already runs code as that user (a hook, in
// a terminal's git; board ticket 756), so what that `.git` holds is trusted as the user's own; a substitution that stands
// when the listing's last confirmation runs is refused there; one made and undone while git itself runs is not seen, and
// can answer by another tree's rules for names the listing read in the confirmed folder, as a swap and a restore between
// a listing's reads and its last confirmation can show outside names (service.ts).
//
// The asks of one repository share its runs: while a run of the repository is in flight, or waits for a place, the asks
// that arrive join its next run (Decision Log 10).
// A run is two git calls in read mode in the repository's root, each after the question of where it is:
// `git --literal-pathspecs ls-files -z -- <dir>/…` for the joined directories, whose paths name what is tracked in each, then `git check-ignore --no-index -z --stdin` on
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
import { dirname, join, relative, sep } from 'node:path';
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
  marker: BigIntStats | null; // the repository's `.git` as the walk found it
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
  // and the run's place is freed only once its own set is empty (Decision Log 12). `pinned`: the repository a read is
  // named to git by; the question of where the repository is is asked with none.
  const runnerFor = (owned: Owned, pinned: Record<string, string> = {}) => {
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
      void carry(batch, owned)
        .then(() => allClosed(owned))
        .finally(() => {
          running--; // the run has really ended, its every child closed: its place, and its repository, are free
          busy.delete(batch.root);
          start();
        });
    }
  };

  async function carry({ root, asks }: Batch, owned: Owned): Promise<void> {
    const deadline = Math.max(...asks.map((ask) => ask.deadline));
    const rest = () => Math.max(1, deadline - Date.now()); // every call shares the latest deadline the run carries
    const live = () => asks.filter((ask) => pending.has(ask));
    const asking = runnerFor(owned); // where the repository is: git's own discovery
    let named: Repository | null = null; // the repository git named before the run's first call
    // Before each call: the asks whose folder and `.git` are still what was confirmed, in the repository git names now,
    // the one it named before the first call; the others get no answer
    const holding = async (): Promise<Ask[]> => {
      const marker = await fs.promises.lstat(join(root, '.git'), { bigint: true }).catch(() => null);
      const asked = live();
      const held = await Promise.all(asked.map(async (ask) => marker !== null && sameMarker(marker, ask.marker!) && (await stillNames(ask.dir, ask.opened!))));
      // asked again after the awaits: an ask answered meanwhile (the stop, its bound) is no reason to start git
      const stillAsked = !disposed && asked.some((ask, i) => held[i] && pending.has(ask));
      const found = stillAsked ? await repositoryAt(root, asking, rest()) : CHANGED;
      if (typeof found !== 'string') named ??= found;
      asked.forEach((ask, i) => {
        if ((held[i] && typeof found !== 'string' && found.key === named!.key) || !pending.has(ask)) return;
        noAnswer(held[i] && typeof found === 'string' ? found : CHANGED);
        ask.answer(null);
      });
      return live();
    };
    try {
      const listed = await holding();
      if (listed.length === 0) return; // nothing left to ask: no git runs
      const { gitDir, commonDir } = named!;
      const run = runnerFor(owned, { GIT_DIR: gitDir, GIT_COMMON_DIR: commonDir, GIT_WORK_TREE: root });
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
            noAnswer(OWNED_ELSEWHERE);
            return ask.answer(null);
          }
          ask.rel = relative(found.root, dir);
          ask.opened = identity;
          ask.marker = found.marker;
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

// Why an ask has no answer, as the daemon's log says it
const OWNED_ELSEWHERE = 'the repository belongs to another user';
const CHANGED = 'the folder or its repository changed before git ran';
const ANOTHER_TREE = 'git names another work tree for the folder';
const UNREADABLE = 'git named a repository path the check cannot read';
const NO_PATH_FORMAT = 'the git in use does not know rev-parse --path-format (older than the option)';

// The repository that holds `dir` (an absolute realpath), as git's discovery finds it from there in read mode: the
// nearest folder at or above it with a `.git` entry, and that entry. Null inside a `.git` folder, where no work tree
// is, in no repository, above a change of device (git's discovery stops at a filesystem boundary: it compares each
// folder above with the device of the one it started in, `device`), and once `live` says the ask is answered (its bound
// passed, the check disposed: the branch panel's scalpel 1); `OWNED_ELSEWHERE` when the folder or its `.git` is another
// user's. Where the `.git` leads git is git's to say (`repositoryAt`).
async function repositoryOf(dir: string, device: Promise<bigint | null>, live: () => boolean): Promise<{ root: string; marker: BigIntStats } | typeof OWNED_ELSEWHERE | null> {
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
      return { root: at, marker };
    }
    if (dirname(at) === at) return null;
  }
  return null;
}

// The repository git names for a folder: the git directory and the common directory, as absolute real paths, and
// `key`, the two with their identities, by which two answers are compared
interface Repository {
  gitDir: string;
  commonDir: string;
  key: string;
}

// The repository git itself finds from `root`, asked with no repository named (`rev-parse`, which runs no hook and no
// fsmonitor): git reads the `.git` entry, a gitdir pointer and a `commondir` as it does for every command, and refuses
// one it finds another user's (`dubious ownership`: `OWNED_ELSEWHERE`). The work tree it names must be `root`
// (`ANOTHER_TREE` otherwise: a `core.worktree` elsewhere, a `.git` that is no repository and one above it); the git
// directory and the common directory, and the `config` in each where there is one, must be this user's by `stat`, which
// follows a link to what git reads (git's own check reads a `.git` link's owner, not its target's; a root-owned one
// passes git's only for git run as root, which the daemon never is). A path with a line break in it cannot be read out
// of git's answer, and nor can one that is no UTF-8: git's bytes are decoded with each that is no UTF-8 read as U+FFFD
// (`execGit`), which names another path, one that may be another repository of this user's (`UNREADABLE`; a name that
// truly holds U+FFFD is refused with them). A git that does not know `--path-format` takes it for a flag to show,
// prints it back first and exits 0 (rev-parse's `show_flag`): `NO_PATH_FORMAT`, so the log says why nothing is marked.
// Any other failure of git is thrown, as a call's is.
async function repositoryAt(root: string, run: GitRun, timeoutMs: number): Promise<Repository | string> {
  let printed: string;
  try {
    printed = await run(root, ['rev-parse', '--path-format=absolute', '--absolute-git-dir', '--git-common-dir', '--show-toplevel'], { timeoutMs });
  } catch (error) {
    if (error instanceof GitCommandError && /dubious ownership/.test(error.stderr)) return OWNED_ELSEWHERE;
    throw error;
  }
  const lines = printed.split('\n');
  if (lines[0] === '--path-format=absolute') return NO_PATH_FORMAT;
  if (lines.length !== 4 || lines[3] !== '' || printed.includes('\uFFFD')) return UNREADABLE;
  const [gitDir, commonDir, workTree] = lines as [string, string, string];
  if (workTree !== root) return ANOTHER_TREE;
  const dirs = [gitDir, commonDir];
  const stats = await Promise.all(dirs.map((dir) => fs.promises.stat(dir, { bigint: true }).catch(() => null)));
  const configs = await Promise.all(dirs.map((dir) => fs.promises.stat(join(dir, 'config'), { bigint: true }).catch(() => null)));
  if (stats.some((stat) => stat === null)) return CHANGED;
  if (![...stats, ...configs].every((stat) => stat === null || ownedHere(stat))) return OWNED_ELSEWHERE;
  return { gitDir, commonDir, key: dirs.map((dir, i) => `${dir}\0${stats[i]!.dev}:${stats[i]!.ino}`).join('\0') };
}

// The `.git` as the walk found it: the same object, and a gitdir pointer not rewritten since (one rewritten in place
// keeps its inode)
function sameMarker(now: BigIntStats, then: BigIntStats): boolean {
  return sameIdentity(now, then) && (!now.isFile() || (now.mtimeNs === then.mtimeNs && now.ctimeNs === then.ctimeNs));
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
