// The filesystem state service (C4 execution document, M2 and M3; charter §4.3): one watcher over the engine's store,
// the discovery scan, the sidecar fold and the holder registry, wired together in the engine host. It knows which
// sessions exist, what their heads and tails say, and who else holds them, and tells main through validated `fs.*`
// events. A followed session (`eventsSnapshot`, `agentEvents`) is backfilled and tailed by a chain follower whose events
// leave as `session.eventBatch`; subagent, workflow and task sidecars are listed and read on change or on request.
// Read-only: it never writes under the config home.
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { SessionEvent } from '@shared/graph/events';
import type { AgentId, AppSessionId, ParentToolUseId, SessionId } from '@shared/graph/ids';
import type { HostEmit } from '@shared/host/runtime';
import type {
  FsHoldersAnswer,
  FsHoldersQuery,
  FsReadSpillInput,
  FsReadSpillOutput,
  FsScanKnown,
  FsScanResult,
  FsState,
  SubagentEntry,
  WorkflowRun,
} from '@shared/ipc/schema/fs';
import type { PersistedTask, TranscriptSummary } from '@shared/wire/store';
import { readSpill } from './artifacts';
import { Bindings } from './bindings';
import type { FileReader } from './chain-follower';
import { Discovery, mapConcurrent, matchesKnown, SUMMARY_CONCURRENCY, type ListedTranscript } from './discovery';
import { Follow, FsFileReader, SNAPSHOT_WAIT_MS } from './follow';
import { HolderRegistry, type HolderDeps } from './holders';
import type { StorePaths } from './paths';
import { SubagentReader, subagentLookup } from './subagents';
import { TaskReader } from './tasks';
import { StoreWatcher, type StoreChange, type WatchFn } from './watcher';
import { progressKey, WorkflowReader, workflowProgressEvent, workflowProgressId } from './workflows';

export const PROGRESS_EVERY = 100;
// The floor under coalesced or dropped FSEvents for followed files (residue *Watcher mechanism*): each is stat'ed.
export const RECONCILE_MS = 30_000;

export interface FsServiceOptions {
  paths: StorePaths;
  emit: HostEmit;
  watch?: WatchFn; // tests substitute fs.watch
  holders?: HolderDeps;
  openReader?: (locate: () => string | null) => FileReader; // tests record the reads; production is FsFileReader
  reconcileMs?: number;
}

type ScanMode =
  | 'command' // fs.scan: every transcript not skipped by `known` is emitted, changed or not (main asked for it)
  | 'refresh'; // host start and rescans: only what changed since the host last looked is emitted

// One followed transcript: the session's own (`agentId` null) or one of its agents'.
interface FollowEntry {
  follow: Follow;
  sessionId: SessionId;
  agentId: AgentId | null;
  location: { path: string | null }; // where the transcript is, as last seen; null until the service has seen it
  workflows: Map<string, string>; // per run: the progress key last delivered (session follows)
  workflowIds: Map<string, number>; // deliveries per workflow.progress id in this follow, for the occurrence suffix
  workflowWork: Promise<unknown>; // workflow deliveries run one at a time, in change order
}

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
  private readonly openReader: (locate: () => string | null) => FileReader;
  private readonly reconcileMs: number;
  private reconcile: ReturnType<typeof setInterval> | null = null;
  private readonly follows = new Map<string, FollowEntry>(); // by followKey(appSessionId, agentId)
  private readonly starting = new Map<string, Promise<FollowEntry>>();
  private readonly subagentReader = new SubagentReader();
  private readonly agents = new Map<SessionId, SubagentEntry[]>(); // each session's agents as last listed
  private readonly agentListing = new Map<SessionId, Promise<SubagentEntry[]>>(); // one listing at a time per session
  private readonly workflowReader = new WorkflowReader();
  private readonly taskReader: TaskReader;

  constructor(options: FsServiceOptions) {
    this.paths = options.paths;
    this.emit = options.emit;
    this.openReader = options.openReader ?? ((locate) => new FsFileReader(locate));
    this.reconcileMs = options.reconcileMs ?? RECONCILE_MS;
    this.taskReader = new TaskReader(options.paths);
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
    this.reconcile = setInterval(() => this.pokeFollows(() => true), this.reconcileMs);
    await Promise.all([this.holders.start(), this.enqueueScan(null, 'refresh')]);
  }

  stop(): void {
    this.stopped = true;
    this.watcher.stop();
    this.holders.stop();
    if (this.reconcile) clearInterval(this.reconcile);
    for (const entry of this.follows.values()) entry.follow.stop();
    this.follows.clear();
  }

  state(): FsState {
    const watches = this.watcher.status();
    return {
      configHome: this.paths.configHome,
      watching: watches.projects === 'open' && watches.sessions === 'open',
      projects: countSlugs(this.listed.values()),
      sessions: this.listed.size,
      bound: this.bindings.size,
      followed: [...this.follows.values()].map(({ follow }) => ({ appSessionId: follow.appSessionId, agentId: follow.agentId })),
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

  // The seam C3's `session.events` calls for an app session with no live process (and the temporary handler until C3
  // lands): starts following the session's transcript if nothing follows it yet and answers the events delivered so
  // far. A fresh follow is given up to SNAPSHOT_WAIT_MS to finish its backfill; whatever comes later arrives as
  // `session.eventBatch`, and the deterministic ids make the overlap harmless. `complete` is true once backfilled.
  async eventsSnapshot(appSessionId: AppSessionId, agentId: AgentId | null): Promise<{ events: SessionEvent[]; complete: boolean }> {
    if (agentId !== null) return this.agentEvents(appSessionId, agentId);
    const sessionId = this.sessionOf(appSessionId);
    const entry = await this.ensureFollow(appSessionId, null, () => this.followSession(appSessionId, sessionId));
    return snapshotOf(entry.follow);
  }

  // `fs.agentEvents`: the child's transcript as X1 events, following it from now on. The agent must be listed under the
  // session's `subagents/` (its transcript exists). An `Agent` tool call's child is attributed to the tool use its meta
  // names, so until the meta has been read the call is refused rather than following with a parent it cannot know for
  // the rest of the follow; the consumer retries on the `fs.subagentsChanged` the meta's arrival emits. A workflow
  // agent's meta names no tool use (nor does the wire), so it follows at once with `parentToolUseId: null`.
  async agentEvents(appSessionId: AppSessionId, agentId: AgentId): Promise<{ events: SessionEvent[]; complete: boolean }> {
    const sessionId = this.sessionOf(appSessionId);
    const entry = await this.ensureFollow(appSessionId, agentId, async () => {
      const agent = (await this.listAgents(sessionId)).find((candidate) => candidate.agentId === agentId);
      if (agent === undefined) throw new Error(`unknown agent: ${agentId}`);
      if (agent.runId === null && agent.meta === null) throw new Error(`agent meta not yet available: ${agentId}`);
      const parentToolUseId = (agent.meta?.toolUseId ?? null) as ParentToolUseId | null;
      return this.newFollow(appSessionId, sessionId, agent.transcriptPath, { agentId, parentToolUseId });
    });
    return snapshotOf(entry.follow);
  }

  // `fs.unfollow`: stops the follower, and with agentId null every follower of the session. Following no one is a no-op.
  async unfollow(appSessionId: AppSessionId, agentId: AgentId | null): Promise<void> {
    this.sessionOf(appSessionId);
    const matches = (key: string) => (agentId === null ? key.startsWith(`${appSessionId}\0`) : key === followKey(appSessionId, agentId));
    await Promise.allSettled([...this.starting].filter(([key]) => matches(key)).map(([, starting]) => starting));
    for (const [key, entry] of this.follows) {
      if (!matches(key)) continue;
      this.follows.delete(key);
      entry.follow.stop();
    }
  }

  async subagents(appSessionId: AppSessionId): Promise<{ agents: SubagentEntry[] }> {
    return { agents: await this.listAgents(this.sessionOf(appSessionId)) };
  }

  async workflows(appSessionId: AppSessionId): Promise<{ runs: WorkflowRun[] }> {
    const dir = this.sessionDir(this.sessionOf(appSessionId));
    return { runs: dir === null ? [] : await this.workflowReader.list(dir) };
  }

  async tasks(listId: string): Promise<{ tasks: PersistedTask[] }> {
    return { tasks: await this.taskReader.list(listId) };
  }

  readSpill(input: FsReadSpillInput): Promise<FsReadSpillOutput> {
    return readSpill(this.paths, input);
  }

  private sessionOf(appSessionId: AppSessionId): SessionId {
    const sessionId = this.bindings.sessionIdOf(appSessionId);
    if (sessionId === null) throw new Error(`unknown app session: ${appSessionId}`);
    return sessionId;
  }

  private sessionDir(sessionId: SessionId): string | null {
    const listed = this.listed.get(sessionId);
    return listed === undefined ? null : join(this.paths.projects, listed.slug, sessionId);
  }

  // One follower per (app session, agent): a request while one is starting waits for it.
  private ensureFollow(appSessionId: AppSessionId, agentId: AgentId | null, create: () => Promise<FollowEntry>): Promise<FollowEntry> {
    const key = followKey(appSessionId, agentId);
    const existing = this.follows.get(key);
    if (existing) return Promise.resolve(existing);
    let starting = this.starting.get(key);
    if (!starting) {
      starting = create().then((entry) => {
        if (this.stopped) entry.follow.stop();
        else this.follows.set(key, entry);
        return entry;
      });
      this.starting.set(key, starting);
      const started = starting;
      void started.then(
        () => this.starting.delete(key),
        () => this.starting.delete(key),
      );
    }
    return starting;
  }

  // The session's own transcript, with its agents listed first so the backfill's `Agent` tool uses find their metas,
  // and its workflow runs' progress delivered once the backfill is done.
  private async followSession(appSessionId: AppSessionId, sessionId: SessionId): Promise<FollowEntry> {
    await this.listAgents(sessionId);
    const entry = this.newFollow(appSessionId, sessionId, this.listed.get(sessionId)?.path ?? null, null);
    void entry.follow.started.then(() => this.syncWorkflows(entry, null));
    return entry;
  }

  private newFollow(
    appSessionId: AppSessionId,
    sessionId: SessionId,
    path: string | null,
    agent: { agentId: AgentId; parentToolUseId: ParentToolUseId | null } | null,
  ): FollowEntry {
    const location = { path };
    const follow = new Follow({
      appSessionId,
      sessionId,
      agent,
      reader: this.openReader(() => location.path),
      subagents: subagentLookup(() => this.agents.get(sessionId) ?? [], this.subagentReader),
      emit: this.send,
    });
    return { follow, sessionId, agentId: agent?.agentId ?? null, location, workflows: new Map(), workflowIds: new Map(), workflowWork: Promise.resolve() };
  }

  // Lists the session's agents (one listing at a time per session) and tells main when a bound session's agent set or
  // one of their metas changed.
  private listAgents(sessionId: SessionId): Promise<SubagentEntry[]> {
    const previous = this.agentListing.get(sessionId) ?? Promise.resolve();
    const run = previous
      .catch(() => undefined)
      .then(async () => {
        const dir = this.sessionDir(sessionId);
        const agents = dir === null ? [] : await this.subagentReader.list(dir);
        const before = this.agents.get(sessionId) ?? [];
        this.agents.set(sessionId, agents);
        const appSessionId = this.bindings.appIdOf(sessionId);
        if (appSessionId !== null && agentSetKey(before) !== agentSetKey(agents)) this.send('fs.subagentsChanged', { appSessionId, agents });
        return agents;
      });
    this.agentListing.set(sessionId, run);
    void run.then(
      () => this.agentListing.get(sessionId) === run && this.agentListing.delete(sessionId),
      () => this.agentListing.get(sessionId) === run && this.agentListing.delete(sessionId),
    );
    return run;
  }

  // One `workflow.progress` per run whose progress changed since this follow last delivered it (every run when
  // `runId` is null), serialised per follow. Each progress is a whole snapshot of the run (pass-2 item 3).
  private syncWorkflows(entry: FollowEntry, runId: string | null): Promise<unknown> {
    entry.workflowWork = entry.workflowWork
      .then(async () => {
        const dir = this.sessionDir(entry.sessionId);
        if (dir === null || this.follows.get(followKey(entry.follow.appSessionId, null)) !== entry) return;
        const runs = runId === null ? await this.workflowReader.list(dir) : [await this.workflowReader.read(dir, runId)];
        const events: SessionEvent[] = [];
        for (const run of runs) {
          if (run.snapshot === null) continue;
          const key = progressKey(run.snapshot);
          if (entry.workflows.get(run.runId) === key) continue;
          entry.workflows.set(run.runId, key);
          const id = workflowProgressId(run.snapshot);
          const occurrence = (entry.workflowIds.get(id) ?? 0) + 1;
          entry.workflowIds.set(id, occurrence);
          events.push(workflowProgressEvent(entry.sessionId, run.snapshot, occurrence));
        }
        entry.follow.deliver(events);
      })
      .catch((error: unknown) => console.error(`[fs] cannot read the workflows of ${entry.sessionId}:`, error instanceof Error ? error.message : error));
    return entry.workflowWork;
  }

  private pokeFollows(which: (entry: FollowEntry) => boolean): void {
    for (const entry of this.follows.values()) if (which(entry)) void entry.follow.poke();
  }

  // Under `<sessionId>/`: the title sidecar folds into the summary; an agent transcript or meta re-lists the agents and
  // pokes that agent's follower; a workflow snapshot or journal tells main, and a snapshot advances a followed
  // session's progress. Workflow scripts and task outputs are read on demand, never on change.
  private onSidecarChange(change: Extract<StoreChange, { kind: 'sidecar' }>): void {
    const { rel, sessionId } = change;
    if (rel === 'custom-title.json') {
      void this.summarizePath(join(this.paths.projects, change.slug, `${sessionId}.jsonl`), sessionId, 'changed');
      return;
    }
    const appSessionId = this.bindings.appIdOf(sessionId);
    const snapshotRun = WORKFLOW_SNAPSHOT.exec(rel)?.[1];
    const run = snapshotRun ?? WORKFLOW_JOURNAL.exec(rel)?.[1];
    if (run !== undefined) {
      if (appSessionId === null) return;
      this.send('fs.workflowChanged', { appSessionId, runId: run });
      const entry = this.follows.get(followKey(appSessionId, null));
      if (entry && snapshotRun !== undefined) void this.syncWorkflows(entry, run);
      return;
    }
    if (!AGENT_SIDECAR.test(rel)) return;
    const followed = [...this.follows.values()].some((entry) => entry.sessionId === sessionId);
    if (appSessionId !== null || followed) this.listAgents(sessionId).catch(logAgentListFailure);
    const path = join(this.paths.projects, change.slug, sessionId, rel);
    this.pokeFollows((entry) => entry.sessionId === sessionId && entry.agentId !== null && entry.location.path === path);
  }

  private onChange(change: StoreChange): void {
    switch (change.kind) {
      case 'transcript':
        // Poke at once (an append to the file being followed is the common case), then take the location from the
        // listing as the re-summary (or removal) left it: a relocation notified new-path-then-old-path-deleted, or the
        // other way round, must leave the follower on the surviving file, not on whichever path was notified last.
        this.pokeFollows((entry) => entry.sessionId === change.sessionId && entry.agentId === null);
        void this.summarizePath(change.path, change.sessionId, 'changed').then(() => this.locateFollows(change.sessionId));
        return;
      case 'sidecar':
        this.onSidecarChange(change);
        return;
      case 'registry':
        void this.holders.refresh();
        return;
      case 'job':
        void this.holders.jobChanged(change.jobId);
        return;
      case 'taskList':
        this.send('fs.tasksChanged', { listId: change.listId });
        return;
      case 'rescan':
        if (change.root === 'projects') {
          void this.enqueueScan(null, 'refresh').then(() => this.relocateFollows(), logScanFailure);
        } else if (change.root === 'sessions') void this.holders.refresh();
        else if (change.root === 'jobs') void this.holders.jobChanged(null);
        return;
    }
  }

  // After a rescan: a session's transcript may have appeared or moved without a reported event; every follower is
  // pointed at what the listing found and poked.
  private relocateFollows(): void {
    for (const entry of this.follows.values()) if (entry.agentId === null) entry.location.path = this.listed.get(entry.sessionId)?.path ?? null;
    this.pokeFollows(() => true);
  }

  // A session's followers take their location from the discovery listing; one that moved is poked (the new file's
  // inode makes it a reload). A session no longer listed has no location: its follower waits for the file to reappear.
  private locateFollows(sessionId: SessionId): void {
    const path = this.listed.get(sessionId)?.path ?? null;
    this.pokeFollows((entry) => {
      if (entry.sessionId !== sessionId || entry.agentId !== null || entry.location.path === path) return false;
      entry.location.path = path;
      return true;
    });
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

// Relative paths under `<sessionId>/` (the watcher's `sidecar` change).
const WORKFLOW_SNAPSHOT = /^workflows\/([^/]+)\.json$/;
const WORKFLOW_JOURNAL = /^subagents\/workflows\/([^/]+)\/journal\.jsonl$/;
const AGENT_SIDECAR = /^subagents\/(?:.+\/)?agent-[^/]+\.(?:jsonl|meta\.json)$/;

// What `fs.subagentsChanged` reports a change of: the agent set and their metas. An agent transcript's size and mtime
// change on every append and ride along in the payload without being a change themselves.
function agentSetKey(agents: readonly SubagentEntry[]): string {
  return JSON.stringify(agents.map(({ agentId, transcriptPath, runId, meta }) => [agentId, transcriptPath, runId, meta]));
}

function followKey(appSessionId: AppSessionId, agentId: AgentId | null): string {
  return `${appSessionId}\0${agentId ?? ''}`;
}

// A fresh follow gets SNAPSHOT_WAIT_MS to finish its backfill before the snapshot answers with what it has.
async function snapshotOf(follow: Follow): Promise<{ events: SessionEvent[]; complete: boolean }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([follow.started, new Promise((resolve) => (timer = setTimeout(resolve, SNAPSHOT_WAIT_MS)))]);
  clearTimeout(timer);
  return follow.snapshot();
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

function logAgentListFailure(error: unknown): void {
  console.error('[fs] cannot list subagents:', error instanceof Error ? error.message : error);
}
