// The watches behind `files.watch` (C8c execution document, Interfaces "The open-first boundary", `watch`): one
// non-recursive `fs.watch` per confirmed directory realpath, shared by every holder, a holder being one requesting
// window, one session and the path it asked for. `fs.watch` takes a path, not a descriptor (libuv's darwin backend is
// FSEvents, by path), so the service confirms the directory after installing the watcher, and this table confirms it
// again before forwarding every batch: `stat(real)` must still name the object whose `(dev, ino)` the install
// recorded. On a mismatch the batch is dropped unforwarded, the watcher closed, the entry removed, and each holder
// session told once with `invalidated`, so it re-lists and re-watches through the boundary.
import fs, { type FSWatcher } from 'node:fs';
import { basename, join, sep } from 'node:path';
import type { AppSessionId } from '@shared/graph/ids';
import type { FilesChanged } from '@shared/ipc/schema/files';

export interface Identity {
  dev: bigint;
  ino: bigint;
}
export const sameIdentity = (a: Identity, b: Identity) => a.dev === b.dev && a.ino === b.ino;

// A holder of a watch: the requesting window (`sender.id`), the session it asked for, and the path it named.
export interface Holder {
  owner: number;
  appSessionId: AppSessionId;
  path: string;
}

export interface WatchTableOptions {
  emit(payload: FilesChanged): void;
  beforeBatch(real: string): Promise<void>; // the `before-batch` boundary point
  debounceMs?: number;
  maxWaitMs?: number;
  createdWithinMs?: number;
}

// C4's watcher's timing (src/main/git/watcher.ts): a 250 ms trailing debounce, capped at 1 s from the window's first
// event so a writer that never pauses cannot hold a batch off.
const DEBOUNCE_MS = 250;
const MAX_WAIT_MS = 1000;
const CREATED_WITHIN_MS = 2000; // a name whose birth time is this recent is reported `created`

interface Entry {
  real: string;
  identity: Identity;
  watcher: FSWatcher;
  holders: Map<string, Holder & { count: number }>;
  pending: Set<string>; // filenames since the last batch; '' for an event that named none
  timer: NodeJS.Timeout | null;
  windowStart: number | null;
  closed: boolean;
}

// A watcher installed but not yet adopted: the service confirms the directory, then adopts it or closes it.
export interface Installation {
  adopt(holder: Holder): boolean; // false when the watch failed a confirmation before it was adopted
  close(): void;
}

const holderKey = ({ owner, appSessionId, path }: Holder) => `${owner}\u0000${appSessionId}\u0000${path}`;

export class WatchTable {
  private readonly entries = new Map<string, Entry>();
  private readonly debounceMs: number;
  private readonly maxWaitMs: number;
  private readonly createdWithinMs: number;

  constructor(private readonly options: WatchTableOptions) {
    this.debounceMs = options.debounceMs ?? DEBOUNCE_MS;
    this.maxWaitMs = options.maxWaitMs ?? MAX_WAIT_MS;
    this.createdWithinMs = options.createdWithinMs ?? CREATED_WITHIN_MS;
  }

  identityOf(real: string): Identity | null {
    return this.entries.get(real)?.identity ?? null;
  }

  // The confirmed realpaths being watched, for tests and diagnostics.
  watching(): string[] {
    return [...this.entries.keys()];
  }

  // Joins an existing entry for `real`; the caller has confirmed its own open names the entry's identity.
  join(real: string, holder: Holder): void {
    const entry = this.entries.get(real);
    if (!entry) throw new Error(`no watch for ${real}`);
    this.hold(entry, holder);
  }

  // Installs a watcher on `real`, recording the identity the caller's descriptor confirmed. Events that arrive before
  // adoption are batched like any other; a batch with no holder forwards nothing.
  install(real: string, identity: Identity): Installation {
    const entry: Entry = { real, identity, watcher: undefined as unknown as FSWatcher, holders: new Map(), pending: new Set(), timer: null, windowStart: null, closed: false };
    entry.watcher = fs.watch(real, { persistent: false }, (_event, filename) => this.onEvent(entry, filename));
    entry.watcher.on('error', () => this.invalidate(entry)); // the directory went away under the watcher, or its stream failed
    return {
      adopt: (holder) => {
        if (entry.closed) return false; // a batch confirmation or a watcher error invalidated it while the caller confirmed
        this.entries.set(real, entry);
        this.hold(entry, holder);
        return true;
      },
      close: () => this.close(entry),
    };
  }

  // The stale entry for `real` gives way, as a failed batch confirmation would.
  invalidateReal(real: string): void {
    const entry = this.entries.get(real);
    if (entry) this.invalidate(entry);
  }

  // Removes one hold on the watch `holder` named; closes the watcher when none remains. Unknown holds are no-ops. The same
  // holder can hold two entries when its path's realpath moved between two watches; the hold on `real`, the entry the
  // path names now, goes first, else the first one found.
  unwatch(holder: Holder, real: string | null): void {
    const key = holderKey(holder);
    const named = real === null ? undefined : this.entries.get(real);
    for (const entry of named?.holders.has(key) ? [named] : this.entries.values()) {
      const held = entry.holders.get(key);
      if (!held) continue;
      if (--held.count === 0) entry.holders.delete(key);
      if (entry.holders.size === 0) this.close(entry);
      return;
    }
  }

  // Everything a window held: its page can no longer unwatch, and a reloaded page watches afresh.
  release(owner: number): void {
    for (const entry of [...this.entries.values()]) {
      for (const [key, held] of entry.holders) if (held.owner === owner) entry.holders.delete(key);
      if (entry.holders.size === 0) this.close(entry);
    }
  }

  dispose(): void {
    for (const entry of [...this.entries.values()]) this.close(entry);
  }

  private hold(entry: Entry, holder: Holder): void {
    const key = holderKey(holder);
    const held = entry.holders.get(key);
    if (held) held.count++;
    else entry.holders.set(key, { ...holder, count: 1 });
  }

  private onEvent(entry: Entry, filename: string | Buffer | null): void {
    if (entry.closed) return;
    const name = typeof filename === 'string' && filename !== '' && !filename.includes(sep) ? filename : '';
    entry.pending.add(name);
    const now = Date.now();
    entry.windowStart ??= now;
    if (entry.timer) clearTimeout(entry.timer);
    const wait = Math.max(0, Math.min(this.debounceMs, entry.windowStart + this.maxWaitMs - now));
    entry.timer = setTimeout(() => void this.fire(entry), wait);
  }

  private async fire(entry: Entry): Promise<void> {
    entry.timer = null;
    entry.windowStart = null;
    const names = [...entry.pending];
    entry.pending.clear();
    await this.options.beforeBatch(entry.real);
    if (entry.closed) return;
    const confirmed = await fs.promises.stat(entry.real, { bigint: true }).then(
      (stat) => sameIdentity(stat, entry.identity),
      () => false,
    );
    if (entry.closed) return;
    if (!confirmed) {
      this.invalidate(entry);
      return;
    }
    const changes = (await Promise.all(names.map((name) => this.classify(entry.real, name)))).flat();
    if (entry.closed) return;
    for (const change of changes) for (const appSessionId of sessionsOf(entry)) this.options.emit({ appSessionId, ...change });
  }

  // Classified by the full path the name gives under the directory: present, it is that child created or changed;
  // absent, that child removed. FSEvents names an event on the watched directory itself by the directory's own basename
  // (measured: a watch installed just after a write replays `change <basename>`), so an absent child bearing that name
  // may be either; both are reported, the child removed and the directory changed, so neither reading is lost.
  private async classify(real: string, name: string): Promise<Omit<FilesChanged, 'appSessionId'>[]> {
    if (name === '') return [{ path: real, kind: 'changed' }];
    const path = join(real, name);
    const stat = await fs.promises.lstat(path).catch(() => null);
    if (stat) return [{ path, kind: stat.birthtimeMs >= Date.now() - this.createdWithinMs ? 'created' : 'changed' }];
    return name === basename(real) ? [{ path, kind: 'removed' }, { path: real, kind: 'changed' }] : [{ path, kind: 'removed' }];
  }

  private invalidate(entry: Entry): void {
    if (entry.closed) return;
    const sessions = sessionsOf(entry);
    this.close(entry);
    for (const appSessionId of sessions) this.options.emit({ appSessionId, path: entry.real, kind: 'invalidated' });
  }

  private close(entry: Entry): void {
    if (entry.closed) return;
    entry.closed = true;
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = null;
    entry.watcher.close();
    if (this.entries.get(entry.real) === entry) this.entries.delete(entry.real);
  }
}

// Events go once per holder session, however many windows or paths hold the watch for it.
function sessionsOf(entry: Entry): AppSessionId[] {
  return [...new Set([...entry.holders.values()].map((held) => held.appSessionId))];
}
