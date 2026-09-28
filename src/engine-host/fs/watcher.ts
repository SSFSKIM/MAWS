// One watcher over the engine's store (charter §4.3; residue *Watcher mechanism*; C4 execution document, M2). Node's
// `fs.watch` (FSEvents on macOS, one stream per root): recursive over `projects/`, `jobs/` and `tasks/`, flat over
// `sessions/`. Each event is classified by its path relative to the root into a `StoreChange` and coalesced per key
// with a 50 ms trailing debounce. An event with no filename, or a watcher error, becomes a `rescan` of that root (the
// consumer readdir-diffs it); an errored watch re-opens after 1 s, and a root that does not exist yet (a fresh config
// home has no `jobs/`) is retried every 5 s. FSEvents starts its stream asynchronously after `fs.watch` returns and
// does not report a write made in its first milliseconds, so every root is rescanned once 250 ms after its watch
// opens (at start, on appearing, on re-opening). Nothing here reads or writes a file.
import { watch as fsWatch } from 'node:fs';
import { join, sep } from 'node:path';
import type { SessionId } from '@shared/graph/ids';
import type { StorePaths } from './paths';

export type StoreRoot = Exclude<keyof StorePaths, 'configHome' | 'taskOutput'>; // task outputs are read on demand, not watched
export const STORE_ROOTS: readonly StoreRoot[] = ['projects', 'sessions', 'jobs', 'tasks'];

export type StoreChange =
  | { kind: 'transcript'; slug: string; sessionId: SessionId; path: string }
  | { kind: 'sidecar'; slug: string; sessionId: SessionId; rel: string } // custom-title.json, subagents/**, workflows/**, tasks/**
  | { kind: 'registry'; pid: number; path: string } // sessions/<pid>.json
  | { kind: 'job'; jobId: string; path: string } // jobs/<8hex>/state.json
  | { kind: 'taskList'; listId: string }
  | { kind: 'rescan'; root: StoreRoot }; // no filename, or the watch errored: readdir-diff that root

export type WatchStatus = 'open' | 'missing' | 'reopening' | 'failed' | 'stopped';

export interface WatchHandle {
  on(event: 'error', listener: (error: Error) => void): unknown;
  close(): void;
}
export type WatchFn = (path: string, options: { recursive: boolean }, listener: (event: string, filename: string | null) => void) => WatchHandle;

export const DEBOUNCE_MS = 50;
export const REOPEN_MS = 1_000;
export const MISSING_RETRY_MS = 5_000;
export const SETTLE_MS = 250;

// The engine lists only transcripts whose stem is a UUID (SPEC 35.14.1, 35.16.2), which also excludes the
// `.orphaned-` and `.superseded-` names (SPEC 35.2.6, 35.23).
export const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRANSCRIPT = /^(.+)\.jsonl$/;
// Temp files, lock keys, recordings, heartbeats and alias tables are the engine's bookkeeping, never state MAWS reads.
const IGNORED_NAME = /\.tmp\.|\.key|\.cast$|^\.fleetview-heartbeat$|^\.session-aliases$/;

export function classifyStoreEvent(paths: StorePaths, root: StoreRoot, rel: string): StoreChange | null {
  const parts = rel.split(sep).filter((part) => part.length > 0);
  const name = parts.at(-1);
  if (name === undefined || IGNORED_NAME.test(name)) return null;
  switch (root) {
    case 'projects': {
      const slug = parts[0];
      // A slug directory itself appeared, vanished or was moved: its files may not be reported one by one.
      if (parts.length === 1) return slug.startsWith('.') ? null : { kind: 'rescan', root };
      const sessionPart = parts[1];
      if (parts.length === 2) {
        const stem = TRANSCRIPT.exec(sessionPart)?.[1];
        if (stem === undefined || !SESSION_ID.test(stem)) return null;
        return { kind: 'transcript', slug, sessionId: stem as SessionId, path: join(paths.projects, slug, sessionPart) };
      }
      if (!SESSION_ID.test(sessionPart) || parts[2] === 'tool-results') return null; // `memory/` and spills
      return { kind: 'sidecar', slug, sessionId: sessionPart as SessionId, rel: parts.slice(2).join('/') };
    }
    case 'sessions': {
      const pid = parts.length === 1 ? /^(\d+)\.json$/.exec(name)?.[1] : undefined;
      return pid === undefined ? null : { kind: 'registry', pid: Number(pid), path: join(paths.sessions, name) };
    }
    case 'jobs':
      return parts.length === 2 && name === 'state.json' ? { kind: 'job', jobId: parts[0], path: join(paths.jobs, parts[0], name) } : null;
    case 'tasks':
      return parts.length === 2 && name.endsWith('.json') ? { kind: 'taskList', listId: parts[0] } : null;
  }
}

function changeKey(change: StoreChange): string {
  switch (change.kind) {
    case 'transcript':
      return `transcript:${change.path}`;
    case 'sidecar':
      return `sidecar:${change.slug}/${change.sessionId}/${change.rel}`;
    case 'registry':
      return `registry:${change.pid}`;
    case 'job':
      return `job:${change.jobId}`;
    case 'taskList':
      return `taskList:${change.listId}`;
    case 'rescan':
      return `rescan:${change.root}`;
  }
}

interface RootWatch {
  status: WatchStatus;
  handle: WatchHandle | null;
  timer: ReturnType<typeof setTimeout> | null;
}

export class StoreWatcher {
  private readonly watch: WatchFn;
  private readonly roots = new Map<StoreRoot, RootWatch>();
  private readonly pending = new Map<string, { change: StoreChange; timer: ReturnType<typeof setTimeout> }>();
  private stopped = false;

  constructor(
    private readonly paths: StorePaths,
    private readonly sink: (change: StoreChange) => void,
    deps: { watch?: WatchFn } = {},
  ) {
    this.watch = deps.watch ?? ((path, options, listener) => fsWatch(path, { recursive: options.recursive, encoding: 'utf8' }, listener));
    for (const root of STORE_ROOTS) this.roots.set(root, { status: 'missing', handle: null, timer: null });
  }

  start(): void {
    for (const root of STORE_ROOTS) this.open(root);
  }

  stop(): void {
    this.stopped = true;
    for (const watch of this.roots.values()) {
      if (watch.timer) clearTimeout(watch.timer);
      watch.handle?.close();
      Object.assign(watch, { status: 'stopped', handle: null, timer: null });
    }
    for (const { timer } of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
  }

  status(): Record<StoreRoot, WatchStatus> {
    return Object.fromEntries(STORE_ROOTS.map((root) => [root, this.roots.get(root)!.status])) as Record<StoreRoot, WatchStatus>;
  }

  private open(root: StoreRoot): void {
    if (this.stopped) return;
    const watch = this.roots.get(root)!;
    watch.timer = null;
    let handle: WatchHandle;
    try {
      handle = this.watch(this.paths[root], { recursive: root !== 'sessions' }, (_event, filename) => this.onEvent(root, filename));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        watch.status = 'missing';
        watch.timer = setTimeout(() => this.open(root), MISSING_RETRY_MS);
      } else {
        watch.status = 'failed';
        console.error(`[fs] cannot watch ${this.paths[root]}:`, error instanceof Error ? error.message : error);
      }
      return;
    }
    handle.on('error', (error) => this.onError(root, handle, error));
    // The settle rescan: whatever changed while the stream was starting (or while the root was missing or closed).
    const settle = setTimeout(() => {
      if (watch.timer === settle) watch.timer = null;
      this.enqueue({ kind: 'rescan', root });
    }, SETTLE_MS);
    Object.assign(watch, { status: 'open', handle, timer: settle });
  }

  private onError(root: StoreRoot, handle: WatchHandle, error: Error): void {
    const watch = this.roots.get(root)!;
    if (this.stopped || watch.handle !== handle) return;
    console.error(`[fs] watch on ${this.paths[root]} failed; re-opening in ${REOPEN_MS} ms:`, error.message);
    handle.close();
    if (watch.timer) clearTimeout(watch.timer);
    Object.assign(watch, { status: 'reopening', handle: null, timer: setTimeout(() => this.open(root), REOPEN_MS) });
    this.enqueue({ kind: 'rescan', root });
  }

  private onEvent(root: StoreRoot, filename: string | null): void {
    if (this.stopped) return;
    const change = filename === null ? { kind: 'rescan' as const, root } : classifyStoreEvent(this.paths, root, filename);
    if (change) this.enqueue(change);
  }

  private enqueue(change: StoreChange): void {
    const key = changeKey(change);
    const previous = this.pending.get(key);
    if (previous) clearTimeout(previous.timer);
    const timer = setTimeout(() => {
      this.pending.delete(key);
      if (!this.stopped) this.sink(change);
    }, DEBOUNCE_MS);
    this.pending.set(key, { change, timer });
  }
}
