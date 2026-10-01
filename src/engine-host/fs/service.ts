// The filesystem state service (C4 execution document, M2 and M3; charter §4.3): one watcher over the engine's store,
// the discovery scan, the sidecar fold and the holder registry, wired together in the engine host. It knows which
// sessions exist, what their heads and tails say, and who else holds them, and tells main through validated `fs.*`
// events. A followed session (`eventsSnapshot`, `agentEvents`) is backfilled and tailed by a chain follower whose events
// leave as `session.eventBatch`; subagent, workflow and task sidecars are listed and read on change or on request.
// W7: it also watches a contested session (MAWS's own process and a foreign one both hold it) for the foreign process's
// first write, which it reports as `fs.foreignWrite` (main yields MAWS's process), and re-folds a follower that held a
// branch back once the foreign holder exits.
// Read-only: it never writes under the config home.
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { SessionEvent } from '@shared/graph/events';
import type { AgentId, AppSessionId, ParentToolUseId, SessionId } from '@shared/graph/ids';
import type { ForeignHolder } from '@shared/graph/session';
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
import { HolderRegistry, OWN_ENTRYPOINT, type HolderDeps } from './holders';
import { isMissing } from './sidecars';
import type { StorePaths } from './paths';
import { SubagentReader, subagentLookup } from './subagents';
import { sanitizeListId, TaskReader } from './tasks';
import { StoreWatcher, type StoreChange, type WatchFn } from './watcher';
import { progressKey, WorkflowReader, workflowProgressEvent, workflowProgressId } from './workflows';

export const PROGRESS_EVERY = 100;
// The host's start-up pass lists and watches but summarises nothing until main's `fs.scan { known }` arrives, so an
// unchanged store costs main one readdir pass; a host that hears nothing from main (driven alone: tests, diagnostics)
// summarises on its own after this long (M4 fix wave).
export const START_SCAN_FALLBACK_MS = 3_000;
// The floor under coalesced or dropped FSEvents for followed files (residue *Watcher mechanism*): each is stat'ed.
export const RECONCILE_MS = 30_000;
// W7: the most a contest's check reads of what was appended since it last looked; the rest is skipped, not misread.
export const CONTEST_READ_BYTES = 16 * 1024 * 1024;
// The task lists a rescan of tasks/ announces again: the most recently read, so the set is bounded over the host's
// lifetime (debt wave 4). A list read longer ago than this misses only a rescan's announcement; reading it again
// re-admits it, and a watched change to it is announced either way.
export const READ_LISTS_CAP = 256;

export interface FsServiceOptions {
  paths: StorePaths;
  emit: HostEmit;
  watch?: WatchFn; // tests substitute fs.watch
  holders?: HolderDeps;
  openReader?: (locate: () => string | null) => FileReader; // tests record the reads; production is FsFileReader
  reconcileMs?: number;
  startScanFallbackMs?: number;
}

// The replay runs' side of the snapshot seam (ReplayHost): null for an app id no run has.
export interface ReplaySnapshots {
  snapshot(appSessionId: AppSessionId): { events: SessionEvent[]; complete: boolean } | null;
}

type ScanMode =
  | 'command' // fs.scan: every transcript not skipped by `known` is emitted, changed or not (main asked for it)
  | 'refresh'; // fallback and rescans: only what changed since the host or main last looked is emitted; before main's
// first fs.scan (and the fallback) a refresh only lists

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

// W7: one contested session, watched for the foreign process's first write since the contest began.
interface Contest {
  by: ForeignHolder;
  since: string; // when the contest began (ISO): a record written before it is history, whoever wrote it
  offset: number | null; // where the next check reads from; null until the baseline is taken
  reported: boolean;
  work: Promise<unknown>; // checks run one at a time, in change order
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
  private registryRead: Promise<unknown> = Promise.resolve(); // the holder registry's first read, which a scan orders by
  private lastScanAt: string | null = null;
  private lastScan: FsScanResult | null = null;
  // Until main's first fs.scan (or the fallback), passes list and nothing is summarised.
  private summarising = false;
  private commandsQueued = 0; // main's fs.scan passes enqueued and not yet begun
  private fallback: ReturnType<typeof setTimeout> | null = null;
  private readonly startScanFallbackMs: number;
  // The (size, mtime) main holds each transcript's summary for, from its fs.scan `known`: a refresh reads none of those
  // that still match.
  private readonly known = new Map<SessionId, { size: number; mtimeMs: number }>();
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
  // C8b start (M4 task 6): the lists a reader asked for, by sanitised id, announced again after a rescan of tasks/;
  // insertion-ordered as least to most recently read, at most READ_LISTS_CAP (debt wave 4)
  private readonly readLists = new Set<string>();
  // C8b end
  private replays: ReplaySnapshots | null = null;
  private readonly contests = new Map<SessionId, Contest>(); // W7

  constructor(options: FsServiceOptions) {
    this.paths = options.paths;
    this.emit = options.emit;
    this.openReader = options.openReader ?? ((locate) => new FsFileReader(locate));
    this.reconcileMs = options.reconcileMs ?? RECONCILE_MS;
    this.startScanFallbackMs = options.startScanFallbackMs ?? START_SCAN_FALLBACK_MS;
    this.taskReader = new TaskReader(options.paths);
    this.discovery = new Discovery(options.paths);
    this.watcher = new StoreWatcher(options.paths, (change) => this.onChange(change), { watch: options.watch });
    this.holders = new HolderRegistry(
      options.paths,
      (sessionId, holder, registry, job) => {
        this.send('fs.holderChanged', { sessionId, appSessionId: this.bindings.appIdOf(sessionId), holder, registry, job });
        // W7: the foreign holder exited; a follower that kept MAWS's branch in view meanwhile folds the other one in
        if (holder.kind === 'none') for (const entry of this.follows.values()) if (entry.sessionId === sessionId && entry.agentId === null) void entry.follow.refold();
      },
      { ...options.holders, contests: (sessionId, by) => this.contestChanged(sessionId, by) },
    );
  }

  // Watch first, so nothing written meanwhile is missed; then read the registry and list the store. Summarising waits
  // for main's fs.scan, which says what it already holds; without one the fallback summarises everything.
  async start(): Promise<void> {
    this.watcher.start();
    this.reconcile = setInterval(() => this.pokeFollows(() => true), this.reconcileMs);
    this.fallback = setTimeout(() => {
      this.fallback = null;
      if (this.summarising || this.stopped) return;
      this.summarising = true;
      void this.enqueueScan(null, 'refresh').catch(logScanFailure);
    }, this.startScanFallbackMs);
    this.registryRead = this.holders.start();
    await Promise.all([this.registryRead, this.enqueueScan(null, 'refresh')]);
  }

  stop(): void {
    this.stopped = true;
    if (this.fallback) clearTimeout(this.fallback);
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
      lastScan: this.lastScan,
    };
  }

  // Main's scan: binds every known pair, skips the transcripts whose size and mtime it already holds, and emits
  // `fs.sessionChanged` for every other one, plus `fs.sessionRemoved` for known sessions whose transcript is gone.
  // Scans run one at a time; `durationMs` is the time from this call to its answer, including any scan it waited behind
  // (at start-up, the host's own first pass), so it reads as what the caller waited for.
  scan(known: readonly FsScanKnown[]): Promise<FsScanResult> {
    this.summarising = true;
    if (this.fallback) clearTimeout(this.fallback);
    this.fallback = null;
    for (const { sessionId, appSessionId, size, mtimeMs } of known) {
      this.bindings.bind(sessionId, appSessionId);
      this.known.set(sessionId, { size, mtimeMs });
    }
    this.commandsQueued += 1;
    return this.enqueueScan(new Map(known.map((entry) => [entry.sessionId, entry])), 'command');
  }

  // `fs.bind`: each pair replaces whatever pair either id held. The pairs are in place when this returns (a replay's
  // launch relies on that); an app id whose engine id changed (the engine's `/clear` starts a new transcript under the
  // same process) has its followers stopped, and a followed session is followed again on its new transcript, which
  // the returned promise waits for.
  bind(bindings: readonly { sessionId: SessionId; appSessionId: FsScanKnown['appSessionId'] }[]): Promise<void> {
    const moved = new Set<AppSessionId>();
    for (const { sessionId, appSessionId } of bindings) {
      const previous = this.bindings.sessionIdOf(appSessionId);
      if (previous !== null && previous !== sessionId) moved.add(appSessionId);
      const displaced = this.bindings.appIdOf(sessionId);
      if (displaced !== null && displaced !== appSessionId) moved.add(displaced);
      this.bindings.bind(sessionId, appSessionId);
    }
    // The stale followers leave now, before anything awaits, so a snapshot asked the moment this returns follows the new
    // transcript rather than answering or joining the old one. A follower still starting was started under the old id:
    // its key is released at once, and when it resolves `ensureFollow` stops it instead of storing it.
    return Promise.all(
      [...moved].map((appSessionId) => {
        const starts = [...this.starting].filter(([key]) => key.startsWith(`${appSessionId}\0`));
        for (const [key] of starts) this.starting.delete(key);
        const followed = this.dropStaleFollows(appSessionId) || starts.some(([key]) => key === followKey(appSessionId, null));
        return this.refollow(appSessionId, followed, starts.map(([, starting]) => starting));
      }),
    ).then(() => undefined);
  }

  // Stops the followers of an app id that follow a transcript other than the one it is bound to now; answers whether
  // the session's own follower was among them.
  private dropStaleFollows(appSessionId: AppSessionId): boolean {
    const current = this.bindings.sessionIdOf(appSessionId);
    let followed = false;
    for (const [key, entry] of this.follows) {
      if (!key.startsWith(`${appSessionId}\0`) || entry.sessionId === current) continue;
      followed ||= entry.agentId === null;
      this.follows.delete(key);
      entry.follow.stop();
    }
    return followed;
  }

  // Followers of an app id whose engine id changed describe a transcript that is no longer the app session's: they stop,
  // and the session's own is started again on the transcript the app id is bound to now, if any.
  private async refollow(appSessionId: AppSessionId, followed: boolean, staleStarts: Promise<FollowEntry>[]): Promise<void> {
    const current = this.bindings.sessionIdOf(appSessionId);
    if (followed && current !== null) await this.ensureFollow(appSessionId, null, () => this.followSession(appSessionId, current));
    await Promise.allSettled(staleStarts); // each stops itself on resolving (ensureFollow)
  }

  // Replay runs (M5) bind their ids here and answer the snapshot for them from the runner's materialised events.
  serveReplays(replays: ReplaySnapshots): void {
    this.replays = replays;
  }

  // `fs.unbind` (C10's ask, M4): main cleared the record's engine id, so the pair goes and whatever followed the session
  // under that app id stops; later events for the engine id carry no app id until main binds it again. An app id main
  // never bound (or already unbound) is a no-op, not an error.
  async unbind(appSessionId: AppSessionId): Promise<void> {
    if (this.bindings.sessionIdOf(appSessionId) === null) return;
    await this.unfollow(appSessionId, null);
    this.bindings.unbind(appSessionId);
  }

  // W7: whether a foreign process holds the app session's engine session now (C3's `session.events` reads disk then).
  heldElsewhere(appSessionId: AppSessionId): boolean {
    const sessionId = this.bindings.sessionIdOf(appSessionId);
    return sessionId !== null && this.holders.holderOf(sessionId).kind !== 'none';
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
    const replay = this.replays?.snapshot(appSessionId);
    if (replay) return replay;
    const sessionId = this.sessionOf(appSessionId);
    const entry = await this.ensureFollow(appSessionId, null, () => this.followSession(appSessionId, sessionId));
    return snapshotOf(entry.follow);
  }

  // `fs.agentEvents`: the child's transcript as X1 events, following it from now on. The agent must be listed under the
  // session's `subagents/` (its transcript exists). An `Agent` tool call's child is attributed to the tool use its meta
  // names, so until a meta naming it has been read the call is refused rather than following with a parent it cannot know for
  // the rest of the follow; the consumer retries on the `fs.subagentsChanged` the meta's arrival emits. A workflow
  // agent's meta names no tool use (nor does the wire), so it follows at once with `parentToolUseId: null`.
  async agentEvents(appSessionId: AppSessionId, agentId: AgentId): Promise<{ events: SessionEvent[]; complete: boolean }> {
    const sessionId = this.sessionOf(appSessionId);
    const entry = await this.ensureFollow(appSessionId, agentId, async () => {
      const agent = (await this.listAgents(sessionId)).find((candidate) => candidate.agentId === agentId);
      if (agent === undefined) throw new Error(`unknown agent: ${agentId}`);
      // A meta without `toolUseId` (the schema requires only `agentType`) attributes nothing either.
      if (agent.runId === null && typeof agent.meta?.toolUseId !== 'string') throw new Error(`agent meta not yet available: ${agentId}`);
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
    // C8b (M4 task 6), bounded in debt wave 4: re-inserted as the most recent, the least recent dropped past the cap
    const id = sanitizeListId(listId);
    this.readLists.delete(id);
    this.readLists.add(id);
    if (this.readLists.size > READ_LISTS_CAP) this.readLists.delete(this.readLists.values().next().value!);
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
    const pending = this.starting.get(key);
    if (pending) return pending;
    // A start stores its follower only while it still owns its key: a rebind (fs.bind) releases the key, so a start
    // it displaced is stopped, not stored — even when a later rebind names the same transcript again (A → B → A), whose
    // own start holds the key now and stores its follower.
    const started: Promise<FollowEntry> = create().then((entry) => {
      if (this.stopped || this.starting.get(key) !== started || entry.sessionId !== this.bindings.sessionIdOf(appSessionId)) entry.follow.stop();
      else this.follows.set(key, entry);
      return entry;
    });
    this.starting.set(key, started);
    const release = () => {
      if (this.starting.get(key) === started) this.starting.delete(key); // a start after a rebind holds the key now
    };
    void started.then(release, release);
    return started;
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
      holders: () => this.holders.liveCount(sessionId),
      pinned: () => this.holders.holderOf(sessionId).kind !== 'none', // W7
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
        this.checkContest(change.sessionId, change.path); // W7
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
        // C8b start (M4 task 6): a rescan of tasks/ (the settle rescan after the root appears in a fresh config home, or
        // a dropped FSEvents name) says nothing of which list changed, so every list read so far is announced; a
        // checklist queried before its directory existed would otherwise keep its empty answer.
        else if (change.root === 'tasks') for (const listId of this.readLists) this.send('fs.tasksChanged', { listId });
        // C8b end
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
    if (mode === 'command') this.commandsQueued -= 1;
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

    // Only list until main has spoken (or the fallback fired), and while main's fs.scan waits behind this pass: that
    // scan reads everything main does not hold itself, so a refresh ahead of it (at a cold start, the start-up pass)
    // that read too would emit each transcript twice (debt wave 6). A refresh skips what main holds unchanged.
    const summarising = mode === 'command' || (this.summarising && this.commandsQueued === 0);
    const baseline = mode === 'command' ? known : this.known;
    const todo = summarising ? files.filter((file) => !matchesKnown(file, baseline?.get(file.sessionId))).sort((a, b) => b.mtimeMs - a.mtimeMs) : [];
    // Debt wave 5 (the cold first paint): the pass says how much it has to read before its first read, and reads the
    // transcripts a live process holds (the registry's, read at start) before the rest, so a cold index shows the
    // sessions running now within the first reads rather than after the store's history.
    if (todo.length > 0) {
      await this.registryRead.catch(() => undefined); // a registry that failed to read orders nothing first
      this.send('fs.scanProgress', { scanned: 0, total: todo.length });
    }
    const held = new Set(this.holders.holders().map(({ sessionId }) => sessionId));
    const first = todo.filter((file) => held.has(file.sessionId));
    const rest = todo.filter((file) => !held.has(file.sessionId));
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
    for (const batch of [first, rest]) {
      const visits = mapConcurrent(batch, SUMMARY_CONCURRENCY, visit)[Symbol.asyncIterator]();
      while (!(await visits.next()).done); // drain: every visit has run
    }
    const result = { projects: countSlugs(this.listed.values()), sessions: this.listed.size, changed: todo.length, durationMs: Math.round(performance.now() - started) };
    if (!summarising) return result;
    this.send('fs.scanProgress', { scanned, total: todo.length });
    this.lastScanAt = new Date().toISOString();
    this.lastScan = result;
    return result;
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
    this.known.delete(sessionId);
    this.summaries.delete(sessionId);
    this.send('fs.sessionRemoved', { sessionId, appSessionId: this.bindings.appIdOf(sessionId) });
  }

  private sendSummary(summary: TranscriptSummary): void {
    this.send('fs.sessionChanged', { summary, appSessionId: this.bindings.appIdOf(summary.sessionId) });
  }

  // W7: a contest began, changed holder or ended. At its start the transcript's size is the baseline: what the foreign
  // process writes from then on is read at each change of the file.
  private contestChanged(sessionId: SessionId, by: Contest['by'] | null): void {
    if (by === null) {
      this.contests.delete(sessionId);
      return;
    }
    const existing = this.contests.get(sessionId);
    if (existing) {
      existing.by = by;
      return;
    }
    const contest: Contest = { by, since: new Date().toISOString(), offset: null, reported: false, work: Promise.resolve() };
    this.contests.set(sessionId, contest);
    const path = this.listed.get(sessionId)?.path ?? null;
    contest.work = (path === null ? Promise.resolve(0) : sizeOf(path)).then(
      (size) => void (contest.offset ??= size),
      () => void (contest.offset ??= 0), // a baseline it cannot take reads from the start; `since` still screens history
    );
  }

  // The first record a foreign process writes into a contested transcript (any record with a uuid whose entrypoint is
  // not MAWS's, written after the contest began) is reported once; main decides what MAWS's process does about it.
  private checkContest(sessionId: SessionId, path: string): void {
    const contest = this.contests.get(sessionId);
    if (!contest || contest.reported) return;
    contest.work = contest.work
      .then(async () => {
        if (contest.reported || this.contests.get(sessionId) !== contest) return;
        const { records, next } = await readAppended(path, contest.offset ?? 0);
        contest.offset = next;
        const foreign = records.some((r) => typeof r.uuid === 'string' && r.entrypoint !== OWN_ENTRYPOINT && typeof r.timestamp === 'string' && r.timestamp >= contest.since);
        if (!foreign || this.contests.get(sessionId) !== contest) return;
        contest.reported = true;
        this.send('fs.foreignWrite', { sessionId, appSessionId: this.bindings.appIdOf(sessionId), holder: contest.by });
      })
      .catch((error: unknown) => console.error(`[fs] cannot check the contested transcript ${path}:`, error instanceof Error ? error.message : error));
  }

  private send: HostEmit = (name, payload) => {
    if (!this.stopped) this.emit(name, payload);
  };
}

async function sizeOf(path: string): Promise<number> {
  const file = await open(path, 'r');
  try {
    return (await file.stat()).size;
  } finally {
    await file.close();
  }
}

// The whole lines appended to `path` since `offset` (at most CONTEST_READ_BYTES of them), parsed where they parse, and
// the offset after the last whole line. A file that shrank was rewritten: nothing is read and the offset restarts at
// its size; a file that is gone reads nothing.
async function readAppended(path: string, offset: number): Promise<{ records: Record<string, unknown>[]; next: number }> {
  let file;
  try {
    file = await open(path, 'r');
  } catch (error) {
    if (isMissing(error)) return { records: [], next: offset };
    throw error;
  }
  try {
    const size = (await file.stat()).size;
    if (size < offset) return { records: [], next: size };
    const from = Math.max(offset, size - CONTEST_READ_BYTES);
    const buffer = Buffer.alloc(size - from);
    let filled = 0;
    while (filled < buffer.length) {
      const { bytesRead } = await file.read(buffer, filled, buffer.length - filled, from + filled);
      if (bytesRead === 0) break;
      filled += bytesRead;
    }
    const end = buffer.subarray(0, filled).lastIndexOf(0x0a);
    if (end < 0) return { records: [], next: from === offset ? offset : from };
    const records: Record<string, unknown>[] = [];
    for (const line of buffer.subarray(0, end).toString('utf8').split('\n')) {
      try {
        const parsed: unknown = JSON.parse(line.replace(/^\0+/, ''));
        if (parsed !== null && typeof parsed === 'object') records.push(parsed as Record<string, unknown>);
      } catch {
        // a torn or foreign line says nothing about who wrote it
      }
    }
    return { records, next: from + end + 1 };
  } finally {
    await file.close();
  }
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
