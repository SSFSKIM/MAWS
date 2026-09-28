// The filesystem state service (C4 execution document, M2; charter §4.3): one watcher over the engine's store, the
// discovery scan, the sidecar fold and the holder registry, wired together in the engine host. It knows which sessions
// exist, what their heads and tails say, and who else holds them, and tells main through validated `fs.*` events.
// Nothing is tailed past the 64 KiB windows yet (M3). Read-only: it never writes under the config home.
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { SessionId } from '@shared/graph/ids';
import type { HostEmit } from '@shared/host/runtime';
import type { FsHoldersAnswer, FsHoldersQuery, FsScanKnown, FsScanResult, FsState } from '@shared/ipc/schema/fs';
import type { TranscriptSummary } from '@shared/wire/store';
import { Bindings } from './bindings';
import { Discovery, mapConcurrent, matchesKnown, SUMMARY_CONCURRENCY, type ListedTranscript } from './discovery';
import { HolderRegistry, type HolderDeps } from './holders';
import type { StorePaths } from './paths';
import { StoreWatcher, type StoreChange, type WatchFn } from './watcher';

export const PROGRESS_EVERY = 100;

export interface FsServiceOptions {
  paths: StorePaths;
  emit: HostEmit;
  watch?: WatchFn; // tests substitute fs.watch
  holders?: HolderDeps;
}

type ScanMode =
  | 'command' // fs.scan: every transcript not skipped by `known` is emitted, changed or not (main asked for it)
  | 'refresh'; // host start and rescans: only what changed since the host last looked is emitted

export class FsService {
  private readonly paths: StorePaths;
  private readonly emit: HostEmit;
  private readonly bindings = new Bindings();
  private readonly discovery: Discovery;
  private readonly watcher: StoreWatcher;
  private readonly holders: HolderRegistry;
  private readonly listed = new Map<SessionId, ListedTranscript>(); // the store's transcripts as last listed or seen
  private readonly summaries = new Map<SessionId, TranscriptSummary>();
  private readonly perPath = new Map<string, Promise<unknown>>(); // one summarisation at a time per file, in call order
  // Sessions whose transcript was read (found or found gone) since the running scan began listing. Such a read is
  // newer than the listing, so the scan neither forgets nor re-lists them from its snapshot.
  private readonly observedSinceListing = new Set<SessionId>();
  private scans: Promise<unknown> = Promise.resolve();
  private lastScanAt: string | null = null;
  private stopped = false;

  constructor(options: FsServiceOptions) {
    this.paths = options.paths;
    this.emit = options.emit;
    this.discovery = new Discovery(options.paths);
    this.watcher = new StoreWatcher(options.paths, (change) => this.onChange(change), { watch: options.watch });
    this.holders = new HolderRegistry(
      options.paths,
      (sessionId, holder, registry, job) => this.send('fs.holderChanged', { sessionId, appSessionId: this.bindings.appIdOf(sessionId), holder, registry, job }),
      options.holders,
    );
  }

  // Watch first, so nothing written during the first scan is missed; then read the registry and scan the store.
  async start(): Promise<void> {
    this.watcher.start();
    await Promise.all([this.holders.start(), this.enqueueScan(null, 'refresh')]);
  }

  stop(): void {
    this.stopped = true;
    this.watcher.stop();
    this.holders.stop();
  }

  state(): FsState {
    const watches = this.watcher.status();
    return {
      configHome: this.paths.configHome,
      watching: watches.projects === 'open' && watches.sessions === 'open',
      projects: countSlugs(this.listed.values()),
      sessions: this.listed.size,
      bound: this.bindings.size,
      followed: [], // M3
      holders: this.holders.holders().map(({ sessionId, holder }) => ({ sessionId, appSessionId: this.bindings.appIdOf(sessionId), holder })),
      lastScanAt: this.lastScanAt,
    };
  }

  // Main's scan: binds every known pair, skips the transcripts whose size and mtime it already holds, and emits
  // `fs.sessionChanged` for every other one, plus `fs.sessionRemoved` for known sessions whose transcript is gone.
  // Scans run one at a time; `durationMs` is the time from this call to its answer, including any scan it waited behind
  // (at start-up, the host's own first pass), so it reads as what the caller waited for.
  scan(known: readonly FsScanKnown[]): Promise<FsScanResult> {
    for (const { sessionId, appSessionId } of known) this.bindings.bind(sessionId, appSessionId);
    return this.enqueueScan(new Map(known.map((entry) => [entry.sessionId, entry])), 'command');
  }

  bind(bindings: readonly { sessionId: SessionId; appSessionId: FsScanKnown['appSessionId'] }[]): void {
    for (const { sessionId, appSessionId } of bindings) this.bindings.bind(sessionId, appSessionId);
  }

  // `fs.holders`: the registry read now, filtered by session id or directory (HolderRegistry.liveNow).
  async holdersNow(query: FsHoldersQuery): Promise<FsHoldersAnswer> {
    const live = await this.holders.liveNow(query);
    return {
      refreshedAt: new Date().toISOString(),
      holders: live.map(({ sessionId, holder, cwd }) => ({ sessionId, appSessionId: this.bindings.appIdOf(sessionId), holder, cwd })),
    };
  }

  private onChange(change: StoreChange): void {
    switch (change.kind) {
      case 'transcript':
        void this.summarizePath(change.path, change.sessionId, 'changed');
        return;
      case 'sidecar':
        // The title sidecar folds into the session's summary; subagents/**, workflows/** and tasks/** are M3's.
        if (change.rel === 'custom-title.json') void this.summarizePath(join(this.paths.projects, change.slug, `${change.sessionId}.jsonl`), change.sessionId, 'changed');
        return;
      case 'registry':
        void this.holders.refresh();
        return;
      case 'job':
        void this.holders.jobChanged(change.jobId);
        return;
      case 'taskList':
        return; // M3
      case 'rescan':
        if (change.root === 'projects') void this.enqueueScan(null, 'refresh').catch(logScanFailure);
        else if (change.root === 'sessions') void this.holders.refresh();
        else if (change.root === 'jobs') void this.holders.jobChanged(null);
        return;
    }
  }

  private enqueueScan(known: Map<SessionId, FsScanKnown> | null, mode: ScanMode): Promise<FsScanResult> {
    const issued = performance.now();
    const run = this.scans.then(() => this.pass(known, mode, issued));
    this.scans = run.catch(() => undefined);
    return run;
  }

  private async pass(known: Map<SessionId, FsScanKnown> | null, mode: ScanMode, started: number): Promise<FsScanResult> {
    this.observedSinceListing.clear();
    const files = await this.discovery.list();
    // Reconcile the snapshot against the live table as it is now: the watcher may have found a transcript the listing
    // missed, or seen one vanish that the listing still holds, while `list()` was in flight.
    const stale = (sessionId: SessionId) => this.observedSinceListing.has(sessionId);
    const present = new Map(files.map((file) => [file.sessionId, file]));

    const gone = new Set([...this.listed.keys()].filter((sessionId) => !present.has(sessionId)));
    for (const sessionId of known?.keys() ?? []) if (!present.has(sessionId)) gone.add(sessionId);
    for (const sessionId of gone) if (!stale(sessionId)) this.forget(sessionId);
    for (const file of files) if (!stale(file.sessionId)) this.listed.set(file.sessionId, file);

    const todo = files.filter((file) => !matchesKnown(file, known?.get(file.sessionId))).sort((a, b) => b.mtimeMs - a.mtimeMs);
    let scanned = 0;
    const visit = async (file: ListedTranscript) => {
      const cached = this.summaries.get(file.sessionId);
      if (cached && cached.transcriptPath === file.path && matchesKnown(file, cached)) {
        if (mode === 'command') this.sendSummary(cached);
      } else {
        await this.summarizePath(file.path, file.sessionId, mode === 'command' ? 'always' : 'changed');
      }
      scanned += 1;
      if (scanned % PROGRESS_EVERY === 0 && scanned < todo.length) this.send('fs.scanProgress', { scanned, total: todo.length });
    };
    const visits = mapConcurrent(todo, SUMMARY_CONCURRENCY, visit)[Symbol.asyncIterator]();
    while (!(await visits.next()).done); // drain: every visit has run
    this.send('fs.scanProgress', { scanned, total: todo.length });

    this.lastScanAt = new Date().toISOString();
    return { projects: countSlugs(this.listed.values()), sessions: this.listed.size, changed: todo.length, durationMs: Math.round(performance.now() - started) };
  }

  // Re-reads one transcript's head and tail (serialised per file, so results land in the order they were asked for)
  // and emits `fs.sessionChanged` when any summary field changed, or always when main asked. A transcript that no
  // longer exists is reported removed; one that cannot be read keeps its previous summary.
  private summarizePath(path: string, sessionId: SessionId, emit: 'always' | 'changed'): Promise<void> {
    const previous = this.perPath.get(path) ?? Promise.resolve();
    const run = previous.then(async () => {
      if (this.stopped) return;
      let summary: TranscriptSummary | null;
      try {
        summary = await this.discovery.summarizeOne(path);
      } catch (error) {
        console.error(`[fs] cannot summarise ${path}:`, error instanceof Error ? error.message : error);
        return;
      }
      this.observedSinceListing.add(sessionId);
      if (summary === null) {
        if (this.listed.get(sessionId)?.path === path) this.forget(sessionId);
        return;
      }
      const before = this.summaries.get(sessionId);
      this.summaries.set(sessionId, summary);
      this.listed.set(sessionId, { sessionId, slug: summary.slug, path, size: summary.size, mtimeMs: summary.mtimeMs });
      if (emit === 'always' || before === undefined || !sameSummary(before, summary)) this.sendSummary(summary);
    });
    this.perPath.set(path, run);
    void run.finally(() => {
      if (this.perPath.get(path) === run) this.perPath.delete(path);
    });
    return run;
  }

  private forget(sessionId: SessionId): void {
    this.listed.delete(sessionId);
    this.summaries.delete(sessionId);
    this.send('fs.sessionRemoved', { sessionId, appSessionId: this.bindings.appIdOf(sessionId) });
  }

  private sendSummary(summary: TranscriptSummary): void {
    this.send('fs.sessionChanged', { summary, appSessionId: this.bindings.appIdOf(summary.sessionId) });
  }

  private send: HostEmit = (name, payload) => {
    if (!this.stopped) this.emit(name, payload);
  };
}

function countSlugs(files: Iterable<ListedTranscript>): number {
  const slugs = new Set<string>();
  for (const file of files) slugs.add(file.slug);
  return slugs.size;
}

function sameSummary(a: TranscriptSummary, b: TranscriptSummary): boolean {
  return (Object.keys(a) as (keyof TranscriptSummary)[]).every((key) => a[key] === b[key]);
}

function logScanFailure(error: unknown): void {
  console.error('[fs] store scan failed:', error instanceof Error ? error.message : error);
}
