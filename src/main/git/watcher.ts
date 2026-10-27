// The repository watcher (C4 execution document, Interfaces "Git service" and M6): per repository root, one recursive
// `fs.watch` on the root and one on the git dir when it lies outside the root (a linked worktree's lives under the
// common dir's `worktrees/<name>/`), and for a linked worktree one on the common dir for the refs, packed-refs and
// config it shares. Paths are classified (writes inside a linked worktree nested under the root are that worktree's, so
// are those inside a repository nested in an untracked directory, a submodule's git dir counts as the worktree, and a ref
// counts only when it can move this root's status), a 250 ms trailing debounce capped at 1 s gathers them, at most one
// `git status` runs per root with one re-run for whatever arrived meanwhile, and `git.changed` carries the fresh status
// only when the compared projection moved. The projection is the status's own facts plus the size and mtime of every
// listed file, so a second content write to an already-dirty file emits although its porcelain line is unchanged (C8a's
// ask), while a save that leaves bytes and mtime as they were is silent. An untracked directory is one porcelain line
// (`dir/`) whose own mtime moves only when its entries do, so each file an event touched beneath it joins the
// projection too, for as long as the directory stays listed untracked, up to INNER_CAP files per root; a touched file
// beyond the cap is not kept and counts as a change. Watches are ref-counted per root by the
// directories each owner (the requesting window) passed, and an owner's are released together when it goes; the first
// watch of a root emits its status as `initial`.
import { constants, watch as fsWatch } from 'node:fs';
import { access, readdir, readFile, readlink, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { GitChangeReason, GitChanged, GitStatus } from '@shared/ipc/schema/git';
import { ReleaseFences } from '../release-fences';
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
  isRepository?(directory: string): Promise<boolean>; // whether git reads the directory as a repository of its own; isNestedRepository by default
}

const DEBOUNCE_MS = 250;
export const INNER_CAP = 2_000; // files beneath untracked directories whose facts a root keeps (an unignored node_modules)
const MAX_WAIT_MS = 1000; // the longest a debounce window runs from its first event
const BACKOFF_MS = 5000; // after a status timeout, until a status succeeds
// When several kinds of path changed in one window, the event names the weightiest; HEAD moving outranks them all.
const WEIGHT: Record<Exclude<GitChangeReason, 'initial'>, number> = { worktree: 0, index: 1, refs: 2, head: 3 };

// A path inside the git dir, relative to it. `config` holds the upstream and the remote URL (`branch -u`,
// `remote set-url`), so it counts as `refs`, and so does a reftable repository's `reftable/`, where every ref lives,
// HEAD's too. Git's own `*.lock` files are ignored here, and only here; so are the object stores, git's and git-lfs's
// (whose clean filter runs under `git status` and writes under `lfs/`).
export function classifyGitPath(sub: string): Exclude<GitChangeReason, 'initial'> | null {
  if (sub.endsWith('.lock') || under(sub, 'objects') || under(sub, 'lfs')) return null;
  if (sub === 'HEAD' || sub === 'ORIG_HEAD' || sub === 'MERGE_HEAD') return 'head';
  if (sub === 'index') return 'index';
  if (sub === 'packed-refs' || sub.startsWith('refs/') || sub === 'config' || under(sub, 'reftable')) return 'refs';
  if (SUBMODULE.test(sub)) return 'worktree';
  return null;
}

// P4 W2-B (tracker 2026-09-30, git watcher blind spots): a submodule's git dir is `modules/<name>/`, the name possibly
// holding '/', and a nested submodule's lies under its parent's own `modules/`. The parent's status reads each one's HEAD,
// index and refs for the gitlink's line, so its HEAD, its reflog's `logs/HEAD` (which a commit on a branch moves while the
// HEAD file stays), its index and its reftable count, as the worktree: the gitlink is a worktree entry of the parent's.
const SUBMODULE = /^modules\/.+\/(?:HEAD|index|reftable(?:\/.*)?)$/;

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
// upstream's, the stash; `packed-refs` and `config` may hold any of them. A directory above one of them (an event
// naming `refs/heads`) counts. The upstream is git's short name, which drops `refs/remotes/` or `refs/heads/`, or only
// `refs/` for a ref elsewhere (a remote fetched into `refs/custom/<remote>/*` tracks as `custom/<remote>/main`), so all
// three readings count. Only the namespaces that cannot hold a status's ref under another name (other branches, other
// remote-tracking refs, tags, notes) are ruled out; a ref anywhere else counts. The per-worktree HEAD and index are not refs.
// A reftable repository's tables may hold any ref and their names carry none, so they always count.
const RULED_OUT = ['refs/heads', 'refs/remotes', 'refs/tags', 'refs/notes'];
export function refMatters(sub: string, status: Pick<GitStatus, 'branch' | 'upstream'>): boolean {
  if (sub === 'packed-refs' || sub === 'config' || under(sub, 'reftable')) return true;
  const refs = ['refs/stash'];
  if (status.branch !== null) refs.push(`refs/heads/${status.branch}`);
  if (status.upstream !== null) refs.push(`refs/remotes/${status.upstream}`, `refs/heads/${status.upstream}`, `refs/${status.upstream}`);
  if (refs.some((ref) => under(ref, sub))) return true;
  return sub.startsWith('refs/') && !RULED_OUT.some((ns) => under(sub, ns));
}

// The engine's linked worktrees, and MAWS's, live at `<root>/.claude/worktrees/<name>` (its runtime exclude reads
// `**/.claude/worktrees/`, at any depth).
const ENGINE_WORKTREE = /(^|\/)\.claude\/worktrees\/[^/]+\//;

// Whether a root-relative path lies inside another checkout nested under the root, whose files git never reads as the
// root's: a linked worktree of the engine's layout (known before git has registered it), one the common dir lists
// (`nested`, root-relative), a repository a pass found in an untracked directory (`clones`, root-relative), or a nested
// checkout's own `.git`. The nested checkout's directory itself appearing or going stays the root's.
export function insideNestedCheckout(rel: string, nested: readonly string[], clones: readonly string[]): boolean {
  return ENGINE_WORKTREE.test(rel) || rel.endsWith('/.git') || within(rel, nested) || within(rel, clones);
}

function within(rel: string, dirs: readonly string[]): boolean {
  return dirs.some((dir) => rel.startsWith(`${dir}/`));
}

// Whether an event's path names the directory itself, its `.git`, or a directory above it.
function names(rel: string, dir: string): boolean {
  return rel === dir || rel === `${dir}/.git` || dir.startsWith(`${rel}/`);
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

// P4 W2-B review fix: whether git reads the directory as a repository of its own while it lists untracked files, as
// dir.c's is_nonbare_repository_dir does: its `.git` is a git directory, or a gitfile (`gitdir: <path>`, relative to
// the gitfile's directory) naming one; a `.git` file git cannot read counts too, the side git takes. An empty `.git`
// directory, a junk file or a repository not yet given its HEAD is not one: git enters the directory as any other.
export async function isNestedRepository(directory: string): Promise<boolean> {
  const dotGit = join(directory, '.git');
  const kind = await stat(dotGit).catch(() => null);
  if (kind === null) return false;
  if (kind.isDirectory()) return isGitDirectory(dotGit);
  if (!kind.isFile()) return false;
  const text = await readFile(dotGit, 'utf8').catch(() => null);
  if (text === null) return true;
  if (!text.startsWith('gitdir: ')) return false;
  return isGitDirectory(resolve(directory, text.slice('gitdir: '.length).replace(/[\r\n]+$/, '')));
}

// setup.c's is_git_directory: a HEAD that is a symlink into `refs/`, a `ref: refs/…` or an object name, and `objects/`
// and `refs/` in the common dir (the one `commondir` names, for a linked worktree's git dir).
async function isGitDirectory(dir: string): Promise<boolean> {
  const head = join(dir, 'HEAD');
  const link = await readlink(head).catch(() => null);
  const text = link === null ? await readFile(head, 'utf8').catch(() => null) : null;
  const valid = link !== null ? link.startsWith('refs/') : text !== null && (/^ref:\s*refs\//.test(text) || /^(?:[0-9a-f]{40})/i.test(text));
  if (!valid) return false;
  const common = await readFile(join(dir, 'commondir'), 'utf8').then((path) => resolve(dir, path.replace(/[\r\n]+$/, '')), () => dir);
  const searchable = (path: string) => access(path, constants.X_OK).then(() => true, () => false);
  const [objects, refs] = await Promise.all([searchable(join(common, 'objects')), searchable(join(common, 'refs'))]);
  return objects && refs;
}

function under(path: string, dir: string): boolean {
  return path === dir || path.startsWith(`${dir}/`);
}

// Who holds a watch: main passes the requesting client's id (`ClientRef.id`); '' is a caller without a client.
export type WatchOwner = string;

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
  retry: boolean; // the pending pass is the one automatic retry after a timeout; a new event clears it
  nested: string[]; // the linked worktrees under the root, root-relative
  nestedRead: 'idle' | 'reading' | 'again';
  clones: string[]; // the repositories nested in the status's untracked directories that a pass found, root-relative
}

export class GitWatcher {
  private readonly roots = new Map<string, Root>();
  private readonly owners = new Map<WatchOwner, Map<string, { root: string; count: number }>>(); // by directory
  private readonly releases = new ReleaseFences<WatchOwner>(); // a watch in flight across its owner's release holds nothing
  private readonly watchFn: WatchFn;
  private readonly statFile: (path: string) => Promise<FileFacts | null>;
  private readonly linkedWorktrees: (commonDir: string) => Promise<string[]>;
  private readonly isRepository: (directory: string) => Promise<boolean>;

  constructor(private readonly deps: GitWatcherDeps) {
    this.watchFn = deps.watch ?? (fsWatch as unknown as WatchFn);
    this.statFile = deps.statFile ?? ((path) => stat(path).then((s) => ({ size: s.size, mtimeMs: s.mtimeMs }), () => null));
    this.linkedWorktrees = deps.linkedWorktrees ?? readLinkedWorktrees;
    this.isRepository = deps.isRepository ?? isNestedRepository;
  }

  // Resolves the directory's status (failing as `status` fails, with nothing registered), then counts one more watcher
  // on its root, opening the root's watches when it is the first.
  // A watch whose owner was released while its status was being read (the window navigated or closed meanwhile) answers
  // the status and holds nothing: its page is gone and could never unwatch.
  // The owner's release fence is taken at once, before the first await (registerGitHandlers relies on it).
  watch(directory: string, owner: WatchOwner = ''): Promise<GitStatus> {
    return this.releases.hold(owner, async (released) => {
      const status = await this.deps.status(directory);
      const [projection, nested] = await Promise.all([this.project(status, new Map()), this.nestedUnder(status)]);
      if (released()) return status;
      this.adopt(directory, owner, status, projection, nested);
      return status;
    });
  }

  private adopt(directory: string, owner: WatchOwner, status: GitStatus, projection: string, nested: string[]): void {
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
  }

  // One watcher fewer for the directory's root; the last closes the root's watches. A directory the owner never
  // watched, or already released as often as it watched it, is a no-op.
  unwatch(directory: string, owner: WatchOwner = ''): void {
    const directories = this.owners.get(owner);
    const entry = directories?.get(directory);
    if (!directories || !entry) return;
    if (--entry.count === 0) directories.delete(directory);
    this.drop(entry.root, 1);
  }

  // Everything the owner still holds (its window closed or reloaded without unwatching).
  release(owner: WatchOwner): void {
    this.releases.release(owner);
    const directories = this.owners.get(owner);
    this.owners.delete(owner);
    for (const entry of directories?.values() ?? []) this.drop(entry.root, entry.count);
  }

  // E6: re-read a watched root now rather than after the debounce (a mutation from the panel just moved it). The pending
  // window is cancelled and its reasons ride this pass; a status in flight is followed by exactly one more. The pass is
  // the ordinary one, so it emits only when the projection moved and `last` stays the watcher's alone. A root nobody
  // watches has nobody to tell: nothing runs.
  refreshNow(repoRoot: string): void {
    const root = this.roots.get(repoRoot);
    if (!root || root.closed) return;
    if (root.timer) clearTimeout(root.timer);
    root.timer = null;
    root.windowStart = null;
    root.retry = false; // as an event does: this pass replaces a pending retry after a timeout
    if (root.inFlight) root.again = true;
    else void this.refresh(root);
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
      retry: false,
      nested,
      nestedRead: 'idle',
      clones: [],
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
        // An event naming a found repository's directory, its `.git` or a directory above it (a rename names only what
        // moved, never what lay beneath) forgets it, so a replacement's writes count at once; a pass finds a repository
        // still there again from the next write beneath it, for one status.
        if (root.clones.some((dir) => names(rel, dir))) root.clones = root.clones.filter((dir) => !names(rel, dir));
        if (insideNestedCheckout(rel, root.nested, root.clones)) return;
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
    if (root.retry) {
      root.retry = false; // the event's own window replaces the pending retry
      root.windowStart = null;
    }
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
    const retrying = root.retry;
    root.retry = false;
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
      // The failed change may be the last one: retry once after the back-off rather than wait for the next event,
      // unless this pass was that retry, so a repository whose status always times out is not polled.
      if (timedOut && !retrying && !root.again && !root.timer && !root.closed) {
        root.retry = true;
        this.schedule(root);
      }
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
  // P4 W2-B (tracker 2026-09-30, git watcher blind spots): git never enters a repository nested in a directory it lists
  // untracked (isNestedRepository: the repository is one `dir/` line, or lies inside an untracked parent's), nor any
  // `.git` entry, so a file beneath either is not the root's. A touched file's repository is found here, asked once per
  // directory per pass (a known file is asked again whenever it is touched, so a repository caught half-created is found
  // by a later pass), and joins `clones`, whose writes the watch drops from then on. Each pass asks the found ones again
  // and forgets those no longer a repository beneath an untracked directory (gone, renamed away, added to the index). A
  // gitlink, a submodule's or an embedded clone's, is tracked, never beneath one, and stays the root's.
  private async innerFacts(root: Root, status: GitStatus, touched: Set<string>): Promise<{ inner: Map<string, FileFacts | null>; overflow: boolean }> {
    const dirs = status.files.filter((file) => file.untracked && file.path.endsWith('/')).map((file) => file.path);
    const beneath = (rel: string) => dirs.some((dir) => rel.startsWith(dir));
    const ask = this.asker(status.repoRoot);
    const stale = await Promise.all(root.clones.map(async (dir) => (!beneath(`${dir}/`) || !(await ask(dir)) ? dir : null)));
    root.clones = root.clones.filter((dir) => !stale.includes(dir)); // the watch may have forgotten some meanwhile
    const counts = (rel: string) => beneath(rel) && !within(rel, root.clones);
    const inner = new Map([...root.inner].filter(([rel]) => counts(rel)));
    const room = INNER_CAP - inner.size;
    const known: string[] = [];
    const fresh: string[] = [];
    const beyond: string[] = [];
    const asked = new Set<string>(); // the directories whose repository is in question
    for (const rel of touched) {
      if (!counts(rel)) continue;
      const dotGit = rel.indexOf('/.git/');
      if (dotGit >= 0) asked.add(rel.slice(0, dotGit)); // never the root's file: only a sign of where a repository may be
      else {
        if (inner.has(rel)) known.push(rel);
        else if (fresh.length < room) fresh.push(rel);
        else {
          beyond.push(rel);
          continue;
        }
        asked.add(dirname(rel));
      }
    }
    const found = await this.nestedRepositories(ask, dirs, [...asked]);
    root.clones.push(...found);
    for (const rel of inner.keys()) if (within(rel, found)) inner.delete(rel); // a repository created over known files
    const read = [...known, ...fresh].filter((rel) => !within(rel, found));
    const overflow = beyond.some((rel) => !within(rel, found));
    const facts = await Promise.all(read.map((rel) => this.statFile(join(status.repoRoot, rel))));
    read.forEach((rel, i) => inner.set(rel, facts[i]));
    return { inner, overflow };
  }

  // Whether a root-relative directory is a repository of its own, each directory asked at most once by the one asker.
  private asker(repoRoot: string): (dir: string) => Promise<boolean> {
    const answers = new Map<string, Promise<boolean>>();
    return (dir) => {
      let answer = answers.get(dir);
      if (!answer) answers.set(dir, (answer = this.isRepository(join(repoRoot, dir))));
      return answer;
    };
  }

  // The repositories the given directories lie in: for each, the outermost from its untracked directory down to itself
  // that is one. Bounded as the touched files are, by INNER_CAP.
  private async nestedRepositories(ask: (dir: string) => Promise<boolean>, dirs: string[], paths: string[]): Promise<string[]> {
    const found = await Promise.all(
      paths.map(async (path) => {
        const top = dirs.find((dir) => `${path}/`.startsWith(dir));
        if (top === undefined) return null;
        let dir = top.slice(0, -1);
        const below = path === dir ? [] : path.slice(top.length).split('/');
        if (await ask(dir)) return dir;
        for (const name of below) {
          dir = `${dir}/${name}`;
          if (await ask(dir)) return dir;
        }
        return null;
      }),
    );
    return [...new Set(found.filter((dir): dir is string => dir !== null))];
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
