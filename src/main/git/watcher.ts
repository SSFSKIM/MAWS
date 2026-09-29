// The repository watcher (C4 execution document, Interfaces "Git service" and M6): per repository root, one recursive
// `fs.watch` on the root and one on the git dir when it lies outside the root (a linked worktree's lives under the
// common dir's `worktrees/<name>/`), and for a linked worktree one on the common dir for the refs, packed-refs and
// config it shares. Paths are classified, a 250 ms trailing debounce capped at 1 s gathers them, at most one
// `git status` runs per root with one re-run for whatever arrived meanwhile, and `git.changed` carries the fresh status
// only when the compared projection moved. The projection is the status's own facts plus the size and mtime of every
// listed file, so a second content write to an already-dirty file emits although its porcelain line is unchanged (C8a's
// ask), while a save that leaves bytes and mtime as they were is silent. Watches are ref-counted per root by the
// directories callers passed; the first watch of a root emits its status as `initial`.
import { watch as fsWatch } from 'node:fs';
import { stat } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import type { GitChangeReason, GitChanged, GitStatus } from '@shared/ipc/schema/git';
import { GitTimeoutError } from './runner';

export type WatchFn = (
  path: string,
  options: { recursive: boolean },
  listener: (event: string, filename: string | null) => void,
) => { close(): void; on(event: 'error', listener: (error: Error) => void): unknown };

export interface FileFacts {
  size: number;
  mtimeMs: number;
}

export interface GitWatcherDeps {
  status(directory: string): Promise<GitStatus>;
  emit(change: GitChanged): void;
  watch?: WatchFn;
  statFile?(path: string): Promise<FileFacts | null>;
}

const DEBOUNCE_MS = 250;
const MAX_WAIT_MS = 1000; // the longest a debounce window runs from its first event
const BACKOFF_MS = 5000; // after a status timeout, until a status succeeds
// When several kinds of path changed in one window, the event names the weightiest; HEAD moving outranks them all.
const WEIGHT: Record<Exclude<GitChangeReason, 'initial'>, number> = { worktree: 0, index: 1, refs: 2, head: 3 };

// A path inside the git dir, relative to it. `config` holds the upstream and the remote URL (`branch -u`,
// `remote set-url`), so it counts as `refs`. Git's own `*.lock` files are ignored here, and only here.
export function classifyGitPath(sub: string): Exclude<GitChangeReason, 'initial' | 'worktree'> | null {
  if (sub.endsWith('.lock') || sub === 'objects' || sub.startsWith('objects/')) return null;
  if (sub === 'HEAD' || sub === 'ORIG_HEAD' || sub === 'MERGE_HEAD') return 'head';
  if (sub === 'index') return 'index';
  if (sub === 'packed-refs' || sub.startsWith('refs/') || sub === 'config') return 'refs';
  return null;
}

// A path inside a linked worktree's common dir, relative to it: only what the worktree shares — branch and
// remote-tracking refs, packed-refs, config. The main worktree's own HEAD and index there are not this worktree's.
export function classifyCommonPath(sub: string): 'refs' | null {
  return classifyGitPath(sub) === 'refs' ? 'refs' : null;
}

// A path under the root, relative to it; `gitDirRel` is the git dir relative to the root when it lies inside (`.git`).
// Everything outside the git dir is the worktree, a tracked `Cargo.lock` or `yarn.lock` included.
export function classifyRootPath(rel: string, gitDirRel: string | null): Exclude<GitChangeReason, 'initial'> | null {
  if (gitDirRel !== null && (rel === gitDirRel || rel.startsWith(`${gitDirRel}/`))) return rel === gitDirRel ? null : classifyGitPath(rel.slice(gitDirRel.length + 1));
  if (rel === '.git') return null; // a linked worktree's `.git` pointer file
  return 'worktree';
}

interface Root {
  root: string;
  count: number;
  closed: boolean;
  handles: { close(): void }[];
  timer: NodeJS.Timeout | null;
  windowStart: number | null; // when the pending debounce window's first event arrived
  inFlight: boolean;
  again: boolean;
  pending: Set<Exclude<GitChangeReason, 'initial'>>;
  last: { status: GitStatus; projection: string };
  backoff: boolean;
  failing: boolean;
}

export class GitWatcher {
  private readonly roots = new Map<string, Root>();
  private readonly directories = new Map<string, { root: string; count: number }>();
  private readonly watchFn: WatchFn;
  private readonly statFile: (path: string) => Promise<FileFacts | null>;

  constructor(private readonly deps: GitWatcherDeps) {
    this.watchFn = deps.watch ?? (fsWatch as unknown as WatchFn);
    this.statFile = deps.statFile ?? ((path) => stat(path).then((s) => ({ size: s.size, mtimeMs: s.mtimeMs }), () => null));
  }

  // Resolves the directory's status (failing as `status` fails, with nothing registered), then counts one more watcher
  // on its root, opening the root's watches when it is the first.
  async watch(directory: string): Promise<GitStatus> {
    const status = await this.deps.status(directory);
    const projection = await this.project(status);
    let root = this.roots.get(status.repoRoot);
    if (!root) {
      root = this.open(status, projection);
      this.deps.emit({ repoRoot: root.root, status, reason: 'initial' });
    }
    root.count++;
    const entry = this.directories.get(directory);
    this.directories.set(directory, { root: status.repoRoot, count: (entry?.count ?? 0) + 1 });
    return status;
  }

  // One watcher fewer for the directory's root; the last closes the root's watches. A directory never watched, or
  // already released as often as it was watched, is a no-op.
  unwatch(directory: string): void {
    const entry = this.directories.get(directory);
    if (!entry) return;
    if (--entry.count === 0) this.directories.delete(directory);
    const root = this.roots.get(entry.root);
    if (root && --root.count === 0) this.close(root);
  }

  dispose(): void {
    for (const root of [...this.roots.values()]) this.close(root);
    this.directories.clear();
  }

  private open(status: GitStatus, projection: string): Root {
    const root: Root = {
      root: status.repoRoot,
      count: 0,
      closed: false,
      handles: [],
      timer: null,
      windowStart: null,
      inFlight: false,
      again: false,
      pending: new Set(),
      last: { status, projection },
      backoff: false,
      failing: false,
    };
    const inside = relative(root.root, status.gitDir);
    const gitDirRel = inside !== '' && !inside.startsWith('..') && !isAbsolute(inside) ? inside.split(sep).join('/') : null;
    const onError = (error: Error) => console.warn(`[git] watch failed under ${root.root}: ${error.message}`);
    // A watch that cannot open (the directory vanished since its status was read) fails this call and leaves no root.
    try {
      const rootWatch = this.watchFn(root.root, { recursive: true }, (_event, filename) =>
        this.changed(root, filename === null ? 'worktree' : classifyRootPath(filename.split(sep).join('/'), gitDirRel)),
      );
      root.handles.push(rootWatch);
      rootWatch.on('error', onError);
      if (gitDirRel === null) {
        const gitDirWatch = this.watchFn(status.gitDir, { recursive: true }, (_event, filename) =>
          this.changed(root, filename === null ? 'index' : classifyGitPath(filename.split(sep).join('/'))),
        );
        root.handles.push(gitDirWatch);
        gitDirWatch.on('error', onError);
      }
      // A linked worktree's branch and remote-tracking refs, packed-refs and config live in the common dir: a push from
      // the worktree or a fetch anywhere moves ahead/behind there and nowhere else. One recursive watch filtered to
      // those paths, rather than separate watches on `refs/` and `packed-refs`, since `packed-refs` may not exist yet
      // (a watch on a missing file cannot open) and `config` sits beside them.
      if (status.isWorktree) {
        const commonWatch = this.watchFn(status.commonDir, { recursive: true }, (_event, filename) =>
          this.changed(root, filename === null ? 'refs' : classifyCommonPath(filename.split(sep).join('/'))),
        );
        root.handles.push(commonWatch);
        commonWatch.on('error', onError);
      }
    } catch (error) {
      for (const handle of root.handles) handle.close();
      throw error;
    }
    this.roots.set(root.root, root);
    // FSEvents starts its stream asynchronously, and the status above was read before the watch opened: one pass after
    // the debounce closes both gaps (the store watcher's settle rescan, M2, for the same reason).
    this.schedule(root);
    return root;
  }

  private close(root: Root): void {
    root.closed = true;
    if (root.timer) clearTimeout(root.timer);
    for (const handle of root.handles) handle.close();
    this.roots.delete(root.root);
    for (const [directory, entry] of this.directories) if (entry.root === root.root) this.directories.delete(directory);
  }

  private changed(root: Root, reason: Exclude<GitChangeReason, 'initial'> | null): void {
    if (reason === null || root.closed) return;
    root.pending.add(reason);
    this.schedule(root);
  }

  // Trailing debounce, capped from the window's first event so a writer that never pauses cannot hold the status off
  // forever: 250 ms after the last event but at most 1 s after the first; under back-off, 5 s both ways.
  private schedule(root: Root): void {
    if (root.timer) clearTimeout(root.timer);
    const now = Date.now();
    root.windowStart ??= now;
    const wait = root.backoff ? BACKOFF_MS : DEBOUNCE_MS;
    const cap = root.backoff ? BACKOFF_MS : MAX_WAIT_MS;
    root.timer = setTimeout(
      () => {
        root.timer = null;
        root.windowStart = null;
        if (root.inFlight) root.again = true;
        else void this.refresh(root);
      },
      Math.max(0, Math.min(wait, root.windowStart + cap - now)),
    );
  }

  private async refresh(root: Root): Promise<void> {
    root.inFlight = true;
    const reasons = root.pending;
    root.pending = new Set();
    try {
      const status = await this.deps.status(root.root);
      const projection = await this.project(status);
      root.backoff = false;
      root.failing = false;
      if (root.closed || projection === root.last.projection) return;
      const previous = root.last.status;
      const headMoved = status.head !== previous.head || status.branch !== previous.branch;
      root.last = { status, projection };
      this.deps.emit({ repoRoot: root.root, status, reason: headMoved ? 'head' : weightiest(reasons) });
    } catch (error) {
      for (const reason of reasons) root.pending.add(reason); // carried to the next pass
      const timedOut = error instanceof GitTimeoutError;
      if (timedOut) root.backoff = true;
      if (!root.failing) console.warn(`[git] status failed under ${root.root}${timedOut ? '; debouncing at 5 s until it succeeds' : ''}: ${error instanceof Error ? error.message : String(error)}`);
      root.failing = true;
    } finally {
      root.inFlight = false;
      if (root.again && !root.closed) {
        root.again = false;
        if (root.backoff) this.schedule(root); // a timed-out root waits out the long debounce first
        else void this.refresh(root);
      }
    }
  }

  // What a change is judged by: every status fact except the time it was read, plus each listed file's size and mtime
  // (a deleted file is null).
  private async project(status: GitStatus): Promise<string> {
    const stats = await Promise.all(
      status.files.map(async (file) => {
        const facts = await this.statFile(join(status.repoRoot, file.path));
        return facts === null ? null : [facts.size, facts.mtimeMs];
      }),
    );
    const { files, branch, head, upstream, remoteUrl, ahead, behind, stashCount } = status;
    return JSON.stringify({ files, branch, head, upstream, remoteUrl, ahead, behind, stashCount, stats });
  }
}

function weightiest(reasons: Set<Exclude<GitChangeReason, 'initial'>>): Exclude<GitChangeReason, 'initial'> {
  let best: Exclude<GitChangeReason, 'initial'> = 'worktree';
  for (const reason of reasons) if (WEIGHT[reason] > WEIGHT[best]) best = reason;
  return best;
}
