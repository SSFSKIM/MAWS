// The watch tree (P5 O3-E M1, Interfaces §A; O3-G's recommendation, research/org/p5-o3-linux-repo-watch.md): a
// directory-level recursive watch MAWS owns, for Linux, where Node's own recursive `fs.watch` watches every file, walks
// synchronously, re-reads a directory per event and fails silently at inotify's limits. One non-recursive `fs.watch`
// per directory and none per file (inotify names a directory's changed children, which is all the callers'
// classifiers read); what the caller's predicate prunes never walked; the walk asynchronous, at most `concurrency`
// listings at once, each directory watched before it is listed so a child made meanwhile is seen by one or the other.
// A directory made later is added from its parent's event: held until the predicate answers, then watched, and what it
// already holds reported entry by entry, its own event last, so a file written before its watch opened is still named.
// A removed directory's watches close. Every pass that walks the whole tree (the initial walk, a reconcile on a slow
// timer, and one a settle after a burst of events) watches what it finds unwatched (a directory a watch error other
// than exhaustion left unwatched included), names what a later pass finds as a late directory's is named, and ends in
// one event with no filename, which both callers read as "rescan the root": Node cannot report inotify's queue
// overflow (libuv drops the kernel's event on descriptor -1), so the reconcile is the recovery for a lost event. The
// root's own watch follows the root: replaced under its name, it is watched afresh and its contents named; gone, every
// watch closes until a pass finds it back. ENOSPC or EMFILE from a watch
// call closes the tree and is reported once, on a later tick, as an 'error' naming the code and the directory: the
// caller's cue to fall back to polling. Imports Node's builtins alone (the engine host and the services library both
// take it).
import { watch as fsWatch } from 'node:fs';
import { lstat as fsLstat, opendir as fsOpendir } from 'node:fs/promises';
import { basename, join } from 'node:path';

export type WatchListener = (event: string, filename: string | null) => void; // filename relative to the root, '/'-joined; null: rescan the root
export interface WatchHandle {
  close(): void;
  on(event: 'error', listener: (error: NodeJS.ErrnoException) => void): unknown;
}
export interface WatchTreeOptions {
  prune?(dir: string): boolean | Promise<boolean>; // `dir` relative to the root; true: never walk or watch it (its ancestors are watched regardless)
  reconcileMs?: number;
  burst?: { events: number; windowMs: number; settleMs: number };
  concurrency?: number;
  fs?: Pick<typeof import('node:fs/promises'), 'opendir' | 'lstat'> & { watch: typeof import('node:fs').watch }; // tests
}
export type WatchFn = (path: string, options: { recursive: boolean; prune?: WatchTreeOptions['prune'] }, listener: WatchListener) => WatchHandle;

export const RECONCILE_MS = 120_000;
export const BURST_EVENTS = 200;
export const BURST_WINDOW_MS = 1_000;
export const BURST_SETTLE_MS = 1_000;
export const WALK_CONCURRENCY = 8;

// A watch call past inotify's per-user limits: watches (ENOSPC) or instances (EMFILE).
export function isExhaustion(error: unknown): error is NodeJS.ErrnoException & { code: 'ENOSPC' | 'EMFILE' } {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === 'ENOSPC' || code === 'EMFILE';
}

// The platform's recursive watch: the tree on Linux for `recursive: true`, `fs.watch` otherwise (FSEvents on macOS
// is one native stream per root). `tree` sets the tree's own options (the store's longer reconcile).
export function recursiveWatch(platform: NodeJS.Platform = process.platform, tree: Omit<WatchTreeOptions, 'prune'> = {}): WatchFn {
  return (path, { recursive, prune }, listener) => (recursive && platform === 'linux' ? watchTree(path, { ...tree, prune }, listener) : fsWatch(path, { recursive }, listener));
}

export function watchTree(root: string, options: WatchTreeOptions, listener: WatchListener): WatchHandle {
  return new WatchTree(root, options, listener);
}

type TreeFs = NonNullable<WatchTreeOptions['fs']>;
type DirWatch = ReturnType<TreeFs['watch']>;

// One pass over directories: `discover` names every entry of a directory the pass newly watches (a late directory's,
// whose own event `done` tells last, or one a later whole-tree pass found), `relist` lists a directory already watched
// (a whole-tree pass, which notes what it `seen`); `done` runs once every directory the pass reached is listed.
interface Walk {
  pending: number;
  discover: boolean;
  relist: boolean;
  top?: string;
  seen?: Set<string>;
  done?: () => void;
}

class WatchTree implements WatchHandle {
  private readonly fs: TreeFs;
  private readonly prune: (dir: string) => boolean | Promise<boolean>;
  private readonly reconcileMs: number;
  private readonly burst: { events: number; windowMs: number; settleMs: number };
  private readonly concurrency: number;
  // Root-relative ('' the root) → its watch and the directory's identity when it was watched, null until read.
  private readonly watches = new Map<string, { watch: DirWatch; identity: string | null; pass: number }>();
  private readonly held = new Set<string>(); // directories admitted or awaiting the predicate, not yet watched
  private readonly queue: { rel: string; walk: Walk; report: boolean }[] = [];
  private readonly errorListeners: ((error: NodeJS.ErrnoException) => void)[] = [];
  private active = 0;
  private closed = false; // nothing more is watched or heard
  private disposed = false; // the caller closed it: not even a pending error is told
  private passes = 0; // whole-tree passes begun
  private reconciling = false;
  private reconcileAgain = false;
  private reconcileTimer: ReturnType<typeof setTimeout> | null = null;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  private windowStart = 0;
  private windowEvents = 0;
  private lastEventAt = 0;

  constructor(
    private readonly root: string,
    options: WatchTreeOptions,
    private readonly listener: WatchListener,
  ) {
    this.fs = options.fs ?? { watch: fsWatch, opendir: fsOpendir, lstat: fsLstat };
    this.prune = options.prune ?? (() => false);
    this.reconcileMs = options.reconcileMs ?? RECONCILE_MS;
    this.burst = options.burst ?? { events: BURST_EVENTS, windowMs: BURST_WINDOW_MS, settleMs: BURST_SETTLE_MS };
    this.concurrency = options.concurrency ?? WALK_CONCURRENCY;
    try {
      this.open('');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw error; // as fs.watch throws it: the caller fails its call
      this.fail(error as NodeJS.ErrnoException, root);
      return;
    }
    this.reconcile(); // the initial walk is the first whole-tree pass
    this.armReconcile();
  }

  on(event: 'error', listener: (error: NodeJS.ErrnoException) => void): this {
    if (event === 'error') this.errorListeners.push(listener);
    return this;
  }

  close(): void {
    this.disposed = true;
    this.shut();
  }

  private abs(rel: string): string {
    return rel === '' ? this.root : join(this.root, rel);
  }

  // Throws what the watch call throws.
  private open(rel: string): void {
    const watch = this.fs.watch(this.abs(rel), { persistent: true }, (event, name) => this.onEvent(rel, event, name));
    watch.on('error', (error: NodeJS.ErrnoException) => this.onWatchError(rel, watch, error));
    this.watches.set(rel, { watch, identity: null, pass: this.passes });
  }

  // Whether the directory is watched now. A directory that vanished since its listing (ENOENT, ENOTDIR) or that this
  // user may not read stays unwatched, silently (a reconcile tries it again); exhaustion closes the tree.
  private place(rel: string): boolean {
    try {
      this.open(rel);
      return true;
    } catch (error) {
      if (isExhaustion(error)) this.fail(error, this.abs(rel));
      return false;
    }
  }

  // Closes the tree and tells the error once, on a later tick: never thrown, never before the caller could listen.
  private fail(error: NodeJS.ErrnoException, path: string): void {
    if (this.closed) return;
    error.path ??= path;
    this.shut();
    queueMicrotask(() => {
      if (this.disposed) return;
      for (const listener of [...this.errorListeners]) listener(error);
    });
  }

  private shut(): void {
    if (this.closed) return;
    this.closed = true;
    for (const { watch } of this.watches.values()) watch.close();
    this.watches.clear();
    this.held.clear();
    this.queue.length = 0;
    if (this.reconcileTimer) clearTimeout(this.reconcileTimer);
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.reconcileTimer = null;
    this.settleTimer = null;
  }

  // An errored FSWatcher is closed by Node. The root's error ends the tree as it would end fs.watch; a directory beneath
  // it is dropped, unless the error is exhaustion's.
  private onWatchError(rel: string, watch: DirWatch, error: NodeJS.ErrnoException): void {
    if (this.closed || this.watches.get(rel)?.watch !== watch) return;
    if (rel === '' || isExhaustion(error)) this.fail(error, this.abs(rel));
    else this.drop(rel);
  }

  private onEvent(rel: string, event: string, name: string | null): void {
    if (this.closed) return;
    this.count();
    if (name === null) return this.listener(event, null);
    const child = rel === '' ? name : `${rel}/${name}`;
    // libuv names an event about the watched directory itself (its removal, its move, its attributes) by the
    // directory's own name, which a child may share.
    if (name === basename(this.abs(rel))) void this.selfOrChild(rel, event, child);
    else if (event === 'rename') void this.renamed(event, child);
    else this.listener(event, child);
  }

  private async selfOrChild(rel: string, event: string, child: string): Promise<void> {
    const childStat = await this.stat(child);
    if (this.closed) return;
    if (childStat !== null) return this.classify(event, child, childStat);
    const own = await this.stat(rel);
    if (this.closed) return;
    if (own === null) {
      if (rel !== '') return; // a directory's own removal: its parent tells it
      if (event !== 'rename' || !this.watches.has('')) return;
      this.drop(''); // the root itself went: nothing is watched until a pass finds it back
      return this.listener(event, null);
    }
    const entry = this.watches.get(rel);
    if (entry && entry.identity !== null && entry.identity !== identityOf(own)) {
      this.drop(rel);
      if (rel === '') return this.reconcile(); // the root replaced: the pass watches the new one and names its contents
      return void this.admit(rel, this.lateWalk(rel), true); // replaced under its name: the new one is watched afresh
    }
    if (event === 'rename') this.listener(event, child); // a child of that name removed
    // else the directory's own attributes changed, which its parent tells
  }

  private async renamed(event: string, child: string): Promise<void> {
    const stat = await this.stat(child);
    if (this.closed) return;
    this.classify(event, child, stat);
  }

  private classify(event: string, child: string, stat: Stat | null): void {
    const entry = this.watches.get(child);
    if (stat === null || !stat.isDirectory()) {
      if (entry || this.held.has(child)) this.drop(child);
      return this.listener(event, child);
    }
    if (entry && entry.identity !== null && entry.identity !== identityOf(stat)) this.drop(child); // replaced
    else if (entry || this.held.has(child)) return this.listener(event, child);
    void this.admit(child, this.lateWalk(child), true);
  }

  // A directory first seen after the walk that found its parent: everything it holds is named, its own name last.
  private lateWalk(top: string): Walk {
    return { pending: 0, discover: true, relist: false, top, done: () => this.listener('rename', top) };
  }

  // The directory and every one beneath it ('' is the whole tree): watches closed, holds forgotten.
  private drop(rel: string): void {
    const beneath = (key: string) => rel === '' || key === rel || key.startsWith(`${rel}/`);
    for (const [key, { watch }] of this.watches) {
      if (!beneath(key)) continue;
      watch.close();
      this.watches.delete(key);
    }
    for (const key of [...this.held]) if (beneath(key)) this.held.delete(key);
  }

  // A directory a walk reached: the predicate asked (once while held), then queued to be watched and listed, its
  // listing named when the walk discovers. A pruned directory a late walk reached (`named`: its parent's listing is
  // named) is still named, once; a whole-tree pass cannot tell a pruned directory new from old, and names none.
  private async admit(rel: string, walk: Walk, named = false): Promise<void> {
    if (this.watches.has(rel)) {
      if (walk.relist) this.enqueue(rel, walk, false); // watched already: listed for what is new beneath it, silently
      return;
    }
    if (this.held.has(rel)) return;
    this.held.add(rel);
    let pruned: boolean;
    try {
      pruned = (await this.prune(rel)) === true;
    } catch {
      pruned = false; // a predicate that cannot answer watches rather than miss
    }
    if (this.closed || !this.held.has(rel)) return; // removed meanwhile
    if (!pruned) return this.enqueue(rel, walk, walk.discover); // held until visited
    this.held.delete(rel);
    if (named && walk.top !== undefined) this.listener('rename', rel);
  }

  private enqueue(rel: string, walk: Walk, report: boolean): void {
    walk.pending++;
    this.queue.push({ rel, walk, report });
    this.pump();
  }

  private pump(): void {
    while (!this.closed && this.active < this.concurrency && this.queue.length > 0) {
      const { rel, walk, report } = this.queue.shift()!;
      this.active++;
      void this.visit(rel, walk, report).finally(() => {
        this.active--;
        if (--walk.pending === 0 && !this.closed) walk.done?.();
        this.pump();
      });
    }
  }

  // `report`: name what the listing finds, and the directory itself after it (but the root, and a late walk's top,
  // whose `done` names it).
  private async visit(rel: string, walk: Walk, report: boolean): Promise<void> {
    if (this.closed) return;
    const entry = this.watches.get(rel);
    if (entry) {
      this.held.delete(rel);
      if (!walk.relist) return; // another walk watched it first
      const now = await this.stat(rel);
      if (this.closed || this.watches.get(rel) !== entry) return;
      if (now === null || !now.isDirectory()) return this.drop(rel);
      if (entry.identity !== null && entry.identity !== identityOf(now)) {
        this.drop(rel); // replaced while an event was lost (the root included): watched afresh, its contents new
        if (!this.place(rel)) return;
        report = walk.discover;
      }
    } else {
      if (!this.held.delete(rel)) return; // dropped while queued
      if (!this.place(rel)) return;
    }
    walk.seen?.add(rel);
    const children: string[] = [];
    try {
      const [dir, stat] = await Promise.all([this.fs.opendir(this.abs(rel)), this.stat(rel)]);
      const placed = this.watches.get(rel);
      if (placed && stat !== null && placed.identity === null) placed.identity = identityOf(stat);
      for await (const dirent of dir) {
        if (this.closed) return;
        const path = rel === '' ? dirent.name : `${rel}/${dirent.name}`;
        if (dirent.isDirectory()) children.push(path); // a symlink is no directory here, so never descended
        else if (report) this.listener('rename', path);
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') return this.drop(rel);
      // A listing that failed otherwise (no permission, no descriptor left) says nothing of what lies beneath: a pass
      // keeps those watches rather than sweep them.
      if (walk.seen) for (const key of this.watches.keys()) if (key.startsWith(`${rel}/`)) walk.seen.add(key);
      return;
    }
    await Promise.all(children.map((child) => this.admit(child, walk, report)));
    if (report && rel !== '' && rel !== walk.top && !this.closed) this.listener('rename', rel);
  }

  private async stat(rel: string): Promise<Stat | null> {
    try {
      return await this.fs.lstat(this.abs(rel));
    } catch {
      return null;
    }
  }

  // A whole-tree pass; one at a time, and one more for whatever asked meanwhile. The first, the initial walk, names
  // nothing; a later one names what it newly watches. A root gone is watched again once a pass finds it back, its
  // contents named; while it is gone a pass has nothing to tell.
  private reconcile(): void {
    if (this.closed) return;
    if (this.reconciling) {
      this.reconcileAgain = true;
      return;
    }
    const discover = this.passes > 0;
    const pass = ++this.passes;
    let report = false;
    if (!this.watches.has('')) {
      if (!this.place('')) return;
      report = discover;
    }
    this.reconciling = true;
    const seen = new Set<string>();
    this.enqueue('', {
      pending: 0,
      discover,
      relist: true,
      seen,
      done: () => {
        this.reconciling = false;
        // A directory watched before the pass that no listing found any more went while its event was lost.
        for (const [rel, entry] of [...this.watches]) if (!seen.has(rel) && entry.pass < pass && this.watches.get(rel) === entry) this.drop(rel);
        this.listener('rename', null);
        if (!this.reconcileAgain) return;
        this.reconcileAgain = false;
        this.reconcile();
      },
    }, report);
  }

  private armReconcile(): void {
    this.reconcileTimer = setTimeout(() => {
      this.reconcile();
      this.armReconcile();
    }, this.reconcileMs);
    this.reconcileTimer.unref?.();
  }

  // A burst: at least `events` events within one window. Its pass runs `settleMs` after the last event, so a churn
  // that goes on costs one pass at its end (the slow timer still runs meanwhile).
  private count(): void {
    const now = Date.now();
    if (now - this.windowStart >= this.burst.windowMs) {
      this.windowStart = now;
      this.windowEvents = 0;
    }
    this.lastEventAt = now;
    if (++this.windowEvents >= this.burst.events && this.settleTimer === null) this.settle(this.burst.settleMs);
  }

  private settle(ms: number): void {
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      const quiet = Date.now() - this.lastEventAt;
      if (quiet < this.burst.settleMs) this.settle(this.burst.settleMs - quiet);
      else this.reconcile();
    }, ms);
    this.settleTimer.unref?.();
  }
}

type Stat = Awaited<ReturnType<TreeFs['lstat']>>;

function identityOf(stat: Stat): string {
  return `${stat.dev}:${stat.ino}`;
}
