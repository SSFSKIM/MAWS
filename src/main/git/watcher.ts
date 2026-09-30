// The repository watcher (C4 execution document, Interfaces "Git service" and M6): per repository root, one recursive
// `fs.watch` on the root and one on the git dir when it lies outside the root (a linked worktree's lives under the
// common dir's `worktrees/<name>/`), and for a linked worktree one on the common dir for the refs, packed-refs and
// config it shares. Paths are classified (writes inside a linked worktree nested under the root are that worktree's, and
// a ref counts only when it can move this root's status), a 250 ms trailing debounce capped at 1 s gathers them, at most one
// `git status` runs per root with one re-run for whatever arrived meanwhile, and `git.changed` carries the fresh status
// only when the compared projection moved. The projection is the status's own facts plus the size and mtime of every
// listed file, so a second content write to an already-dirty file emits although its porcelain line is unchanged (C8a's
// ask), while a save that leaves bytes and mtime as they were is silent. An untracked directory is one porcelain line
// (`dir/`) whose own mtime moves only when its entries do, so each file an event touched beneath it joins the
// projection too, for as long as the directory stays listed untracked, up to INNER_CAP files per root; a touched file
// beyond the cap is not kept and counts as a change. Watches are ref-counted per root by the
// directories each owner (the requesting window) passed, and an owner's are released together when it goes; the first
// watch of a root emits its status as `initial`.
import { watch as fsWatch } from 'node:fs';
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
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
  linkedWorktrees?(commonDir: string): Promise<string[]>; // absolute paths; the common dir's `worktrees/*/gitdir` by default
}

const DEBOUNCE_MS = 250;
export const INNER_CAP = 2_000; // files beneath untracked directories whose facts a root keeps (an unignored node_modules)
const MAX_WAIT_MS = 1000; // the longest a debounce window runs from its first event
const BACKOFF_MS = 5000; // after a status timeout, until a status succeeds
// When several kinds of path changed in one window, the event names the weightiest; HEAD moving outranks them all.
const WEIGHT: Record<Exclude<GitChangeReason, 'initial'>, number> = { worktree: 0, index: 1, refs: 2, head: 3 };

// A path inside the git dir, relative to it. `config` holds the upstream and the remote URL (`branch -u`,
// `remote set-url`), so it counts as `refs`. Git's own `*.lock` files are ignored here, and only here; so are the object
// stores, git's and git-lfs's (whose clean filter runs under `git status` and writes under `lfs/`).
export function classifyGitPath(sub: string): Exclude<GitChangeReason, 'initial' | 'worktree'> | null {
  if (sub.endsWith('.lock') || under(sub, 'objects') || under(sub, 'lfs')) return null;
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

// Whether a ref event (a path in the common dir, relative to it) can move this status: the branch's own ref, the
// upstream's (a remote-tracking ref, or a local branch's), the stash; `packed-refs` and `config` may hold any of them.
// A directory above one of them (an event naming `refs/heads`) counts. The per-worktree HEAD and index are not refs.
export function refMatters(sub: string, status: Pick<GitStatus, 'branch' | 'upstream'>): boolean {
  if (sub === 'packed-refs' || sub === 'config') return true;
  const refs = ['refs/stash'];
  if (status.branch !== null) refs.push(`refs/heads/${status.branch}`);
  if (status.upstream !== null) refs.push(`refs/remotes/${status.upstream}`, `refs/heads/${status.upstream}`);
  return refs.some((ref) => under(ref, sub));
}

// The engine's linked worktrees, and MAWS's, live at `<root>/.claude/worktrees/<name>` (its runtime exclude reads
// `**/.claude/worktrees/`, at any depth).
const ENGINE_WORKTREE = /(^|\/)\.claude\/worktrees\/[^/]+\//;

// Whether a root-relative path lies inside another checkout nested under the root, whose files git never reads as the
// root's: a linked worktree of the engine's layout (known before git has registered it), one the common dir lists
// (`nested`, root-relative), or a nested checkout's own `.git`. The nested checkout's directory itself appearing or
// going stays the root's.
export function insideNestedCheckout(rel: string, nested: readonly string[]): boolean {
  return ENGINE_WORKTREE.test(rel) || rel.endsWith('/.git') || nested.some((dir) => rel.startsWith(`${dir}/`));
}

// The common dir's `worktrees/<name>/gitdir` names each linked worktree's `.git`: its registration, which `worktree
// add` writes and `remove` and `prune` delete, and what an event re-reads the list on.
function registration(sub: string): boolean {
  return /^worktrees(\/[^/]+(\/gitdir)?)?$/.test(sub);
}

// Every linked worktree the common dir registers, by absolute path (a relative `gitdir`, `worktree.useRelativePaths`,
// resolved against its own directory); none when the common dir has no `worktrees/`.
async function readLinkedWorktrees(commonDir: string): Promise<string[]> {
  const dir = join(commonDir, 'worktrees');
  const names = await readdir(dir).catch(() => [] as string[]);
  const paths = await Promise.all(
    names.map(async (name) => {
      const pointer = await readFile(join(dir, name, 'gitdir'), 'utf8').catch(() => null);
      if (pointer === null || pointer.trim() === '') return null;
      const path = dirname(resolve(dir, name, pointer.trim()));
      return realpath(path).catch(() => path);
    }),
  );
  return paths.filter((path): path is string => path !== null);
}

function under(path: string, dir: string): boolean {
  return path === dir || path.startsWith(`${dir}/`);
}

// Who holds a watch: main passes the requesting window's `webContents.id`; 0 is a caller without a window.
export type WatchOwner = number;

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
  touched: Set<string>; // worktree paths (root-relative) the pending events named
  inner: Map<string, FileFacts | null>; // touched files beneath an untracked directory, as last read
  last: { status: GitStatus; projection: string };
  backoff: boolean;
  failing: boolean;
  nested: string[]; // the linked worktrees under the root, root-relative
  nestedRead: 'idle' | 'reading' | 'again';
}

export class GitWatcher {
  private readonly roots = new Map<string, Root>();
  private readonly owners = new Map<WatchOwner, Map<string, { root: string; count: number }>>(); // by directory
  private readonly generations = new Map<WatchOwner, number>(); // bumped by each release of the owner
  private readonly watchFn: WatchFn;
  private readonly statFile: (path: string) => Promise<FileFacts | null>;
  private readonly linkedWorktrees: (commonDir: string) => Promise<string[]>;

  constructor(private readonly deps: GitWatcherDeps) {
    this.watchFn = deps.watch ?? (fsWatch as unknown as WatchFn);
    this.statFile = deps.statFile ?? ((path) => stat(path).then((s) => ({ size: s.size, mtimeMs: s.mtimeMs }), () => null));
    this.linkedWorktrees = deps.linkedWorktrees ?? readLinkedWorktrees;
  }

  // Resolves the directory's status (failing as `status` fails, with nothing registered), then counts one more watcher
  // on its root, opening the root's watches when it is the first.
  // A watch whose owner was released while its status was being read (the window navigated or closed meanwhile) answers
  // the status and holds nothing: its page is gone and could never unwatch.
  async watch(directory: string, owner: WatchOwner = 0): Promise<GitStatus> {
    const generation = this.generations.get(owner) ?? 0;
    const status = await this.deps.status(directory);
    const [projection, nested] = await Promise.all([this.project(status, new Map()), this.nestedUnder(status)]);
    if ((this.generations.get(owner) ?? 0) !== generation) return status;
    let root = this.roots.get(status.repoRoot);
    if (!root) {
      root = this.open(status, projection, nested);
      this.deps.emit({ repoRoot: root.root, status, reason: 'initial' });
    }
    root.count++;
    let directories = this.owners.get(owner);
    if (!directories) this.owners.set(owner, (directories = new Map()));
    const entry = directories.get(directory);
    directories.set(directory, { root: status.repoRoot, count: (entry?.count ?? 0) + 1 });
    return status;
  }

  // One watcher fewer for the directory's root; the last closes the root's watches. A directory the owner never
  // watched, or already released as often as it watched it, is a no-op.
  unwatch(directory: string, owner: WatchOwner = 0): void {
    const directories = this.owners.get(owner);
    const entry = directories?.get(directory);
    if (!directories || !entry) return;
    if (--entry.count === 0) directories.delete(directory);
    this.drop(entry.root, 1);
  }

  // Everything the owner still holds (its window closed or reloaded without unwatching).
  release(owner: WatchOwner): void {
    this.generations.set(owner, (this.generations.get(owner) ?? 0) + 1);
    const directories = this.owners.get(owner);
    this.owners.delete(owner);
    for (const entry of directories?.values() ?? []) this.drop(entry.root, entry.count);
  }

  dispose(): void {
    for (const root of [...this.roots.values()]) this.close(root);
    this.owners.clear();
  }

  private drop(repoRoot: string, count: number): void {
    const root = this.roots.get(repoRoot);
    if (root && (root.count -= count) <= 0) this.close(root);
  }

  private open(status: GitStatus, projection: string, nested: string[]): Root {
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
      touched: new Set(),
      inner: new Map(),
      last: { status, projection },
      backoff: false,
      failing: false,
      nested,
      nestedRead: 'idle',
    };
    const inside = relative(root.root, status.gitDir);
    const gitDirRel = inside !== '' && !inside.startsWith('..') && !isAbsolute(inside) ? inside.split(sep).join('/') : null;
    const onError = (error: Error) => console.warn(`[git] watch failed under ${root.root}: ${error.message}`);
    // A path in the git dir or the common dir, relative to it; `common`: the directory is the common dir, where the
    // linked worktrees are registered.
    const onGitPath = (sub: string, reason: Exclude<GitChangeReason, 'initial'> | null, common: boolean) => {
      if (common && registration(sub)) this.readNested(root, status);
      this.changed(root, reason, null, sub);
    };
    const gitDirIsCommon = status.gitDir === status.commonDir;
    // A watch that cannot open (the directory vanished since its status was read) fails this call and leaves no root.
    try {
      const rootWatch = this.watchFn(root.root, { recursive: true }, (_event, filename) => {
        if (filename === null) return this.changed(root, 'worktree');
        const rel = filename.split(sep).join('/');
        if (gitDirRel !== null && rel.startsWith(`${gitDirRel}/`)) return onGitPath(rel.slice(gitDirRel.length + 1), classifyRootPath(rel, gitDirRel), gitDirIsCommon);
        if (insideNestedCheckout(rel, root.nested)) return;
        this.changed(root, classifyRootPath(rel, gitDirRel), rel);
      });
      root.handles.push(rootWatch);
      rootWatch.on('error', onError);
      if (gitDirRel === null) {
        const gitDirWatch = this.watchFn(status.gitDir, { recursive: true }, (_event, filename) => {
          if (filename === null) return this.changed(root, 'index');
          const sub = filename.split(sep).join('/');
          onGitPath(sub, classifyGitPath(sub), gitDirIsCommon);
        });
        root.handles.push(gitDirWatch);
        gitDirWatch.on('error', onError);
      }
      // A linked worktree's branch and remote-tracking refs, packed-refs and config live in the common dir: a push from
      // the worktree or a fetch anywhere moves ahead/behind there and nowhere else. One recursive watch filtered to
      // those paths, rather than separate watches on `refs/` and `packed-refs`, since `packed-refs` may not exist yet
      // (a watch on a missing file cannot open) and `config` sits beside them.
      if (status.isWorktree) {
        const commonWatch = this.watchFn(status.commonDir, { recursive: true }, (_event, filename) => {
          if (filename === null) return this.changed(root, 'refs');
          const sub = filename.split(sep).join('/');
          onGitPath(sub, classifyCommonPath(sub), true);
        });
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
    for (const directories of this.owners.values()) {
      for (const [directory, entry] of directories) if (entry.root === root.root) directories.delete(directory);
    }
  }

  // `sub`: the path of a git dir event, relative to that dir. A ref is judged by the last status's branch and upstream,
  // unless a status is in flight, which may be about to move them.
  private changed(root: Root, reason: Exclude<GitChangeReason, 'initial'> | null, rel: string | null = null, sub: string | null = null): void {
    if (reason === null || root.closed) return;
    if (reason === 'refs' && sub !== null && !root.inFlight && !refMatters(sub, root.last.status)) return;
    root.pending.add(reason);
    if (reason === 'worktree' && rel !== null) root.touched.add(rel);
    this.schedule(root);
  }

  // The linked worktrees under the status's root, root-relative (the root itself, and those outside it, are not).
  private async nestedUnder(status: GitStatus): Promise<string[]> {
    const paths = await this.linkedWorktrees(status.commonDir).catch(() => []);
    return paths
      .map((path) => relative(status.repoRoot, path))
      .filter((rel) => rel !== '' && !rel.startsWith('..') && !isAbsolute(rel))
      .map((rel) => rel.split(sep).join('/'));
  }

  // Re-reads them after a registration moved: one read at a time, and one more for whatever moved meanwhile. Until it
  // lands, a write in a worktree being added still counts, costing one status that finds nothing new.
  private readNested(root: Root, status: GitStatus): void {
    if (root.nestedRead !== 'idle') {
      root.nestedRead = 'again';
      return;
    }
    root.nestedRead = 'reading';
    void this.nestedUnder(status).then((nested) => {
      root.nested = nested;
      const again = root.nestedRead === 'again';
      root.nestedRead = 'idle';
      if (again && !root.closed) this.readNested(root, status);
    });
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
    const touched = root.touched;
    root.pending = new Set();
    root.touched = new Set();
    try {
      const status = await this.deps.status(root.root);
      const { inner, overflow } = await this.innerFacts(root, status, touched);
      const projection = await this.project(status, inner);
      root.inner = inner;
      root.backoff = false;
      root.failing = false;
      if (root.closed || (projection === root.last.projection && !overflow)) return;
      const previous = root.last.status;
      const headMoved = status.head !== previous.head || status.branch !== previous.branch;
      root.last = { status, projection };
      this.deps.emit({ repoRoot: root.root, status, reason: headMoved ? 'head' : weightiest(reasons) });
    } catch (error) {
      for (const reason of reasons) root.pending.add(reason); // carried to the next pass
      for (const rel of touched) root.touched.add(rel);
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

  // The files beneath the status's untracked directories: those already known that are still beneath one, and those
  // the events touched, read afresh (in parallel), while the root keeps fewer than INNER_CAP. `overflow`: a touched file
  // beyond the cap, whose change cannot be judged, so the pass emits.
  private async innerFacts(root: Root, status: GitStatus, touched: Set<string>): Promise<{ inner: Map<string, FileFacts | null>; overflow: boolean }> {
    const dirs = status.files.filter((file) => file.untracked && file.path.endsWith('/')).map((file) => file.path);
    const beneath = (rel: string) => dirs.some((dir) => rel.startsWith(dir));
    const inner = new Map([...root.inner].filter(([rel]) => beneath(rel)));
    const read: string[] = [];
    let room = INNER_CAP - inner.size;
    let overflow = false;
    for (const rel of touched) {
      if (!beneath(rel)) continue;
      if (inner.has(rel)) read.push(rel);
      else if (room > 0) {
        read.push(rel);
        room--;
      } else overflow = true;
    }
    const facts = await Promise.all(read.map((rel) => this.statFile(join(status.repoRoot, rel))));
    read.forEach((rel, i) => inner.set(rel, facts[i]));
    return { inner, overflow };
  }

  // What a change is judged by: every status fact except the time it was read, plus each listed file's size and mtime
  // (a deleted file is null), and the facts of the touched files beneath an untracked directory.
  private async project(status: GitStatus, inner: Map<string, FileFacts | null>): Promise<string> {
    const stats = await Promise.all(
      status.files.map(async (file) => {
        const facts = await this.statFile(join(status.repoRoot, file.path));
        return facts === null ? null : [facts.size, facts.mtimeMs];
      }),
    );
    const { files, branch, head, upstream, remoteUrl, ahead, behind, stashCount } = status;
    const beneath = [...inner].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return JSON.stringify({ files, branch, head, upstream, remoteUrl, ahead, behind, stashCount, stats, beneath });
  }
}

function weightiest(reasons: Set<Exclude<GitChangeReason, 'initial'>>): Exclude<GitChangeReason, 'initial'> {
  let best: Exclude<GitChangeReason, 'initial'> = 'worktree';
  for (const reason of reasons) if (WEIGHT[reason] > WEIGHT[best]) best = reason;
  return best;
}
