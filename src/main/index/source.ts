// The production session source (C4 execution document, Interfaces "Index", `IndexSessionSource`; wave-2 ledger d.5,
// d.7, d.14): folds the engine host's `fs.*` events and C3's `session.status` into the index, feeds C5's read model
// through its writer, tells the renderer (`session.changed`, `session.removed`, `session.projects.changed`, coalesced per
// tick with the index's revision), and keeps the host's `appSessionId ↔ sessionId` bindings in step with the index
// (`fs.bind` for every id it allocates or binds, `fs.unbind` for every id it clears, `fs.unfollow` for an id that goes
// live). Whenever the engine host becomes ready (at start, and after a restart that lost its bindings) it re-sends every
// binding, scans with what the index already holds, and folds the registry's holders once, since the host's start-up
// holder events predate the subscription. It also runs the unread rule, from the visible set C5 reports through `onSetVisible`.
import type { AppSessionId, ProjectId, SessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { CommandInput, CommandName, CommandOutput, EventName, EventPayload } from '@shared/ipc/schema';
import type { Holder, TranscriptSummary } from '@shared/wire/store';
import type { HostSupervisor } from '../hosts/supervisor';
import type { ReadModelWriter as ShellReadModelWriter, SessionSource } from '../sessions/read-model';
import { toSessionRecordPatch } from '@shared/engine/status';
import type { Index } from './index';
import { warmLinkedWorktrees } from './projects';
import { contested, type BindingChange, type ChangeCause } from './sessions';

// C5's read-model port (C5 execution document, "Main modules"), as far as this source writes through it: records,
// projects and the seed digest of a session with no live fold. The shell's writer also folds event batches, statuses
// and attention, which main feeds it from the host directly (src/main/sessions/index.ts).
export type ReadModelWriter = Pick<ShellReadModelWriter, 'observeRecord' | 'observeRemoved' | 'observeProject' | 'observeProjectRemoved' | 'setDigest'>;

export type SourceHost = Pick<HostSupervisor, 'dispatch' | 'onEvent' | 'onState' | 'snapshot'>;

export interface SourceOptions {
  emit: <N extends EventName>(name: N, payload: EventPayload<N>) => boolean; // main → renderer (src/main/ipc/events)
  tickMs?: number; // session.changed coalescing and fs.bind batching; 16 ms
  now?: () => string;
  warmLinkedWorktrees?: (directories: string[]) => Promise<void>; // projects.ts's; a test holds the warm-up open
}

const TICK_MS = 16;
const LAST_LINE_CHARS = 160; // C5's digest `lastAssistantLine`

// A record's change waiting for the tick: its latest committed state and that change's revision.
type Pending = { t: 'changed'; record: SessionRecord; cause: Exclude<ChangeCause, 'removed'>; revision: number } | { t: 'removed'; revision: number };

export class IndexSessionSource implements SessionSource {
  private readonly tickMs: number;
  private readonly now: () => string;
  private readonly visible = new Set<AppSessionId>();
  private readonly holders = new Map<SessionId, Holder>(); // the registry's live holders by engine id, as last reported
  private readonly pending = new Map<AppSessionId, Pending>();
  private projectsRevision: number | null = null; // the latest project change waiting for the tick
  private shownProjects = new Set<ProjectId>();
  private bindingQueue: BindingChange[] = [];
  private readonly live = new Set<AppSessionId>(); // app ids with a process in the engine host, from session.status
  private unfollows: AppSessionId[] = []; // disk follows to stop at the tick (liveStatus)
  private hostWork: Promise<unknown> = Promise.resolve(); // bindings go to the host in the order the index made them
  private syncs: Promise<unknown> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private writer: ReadModelWriter | null = null;
  private offs: (() => void)[] = [];
  private unavailableLogged = false;

  constructor(
    private readonly index: Index,
    private readonly host: SourceHost,
    private readonly options: SourceOptions,
  ) {
    this.tickMs = options.tickMs ?? TICK_MS;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  start(writer: ReadModelWriter): () => void {
    // A newer app's index: this source neither reads nor writes a schema it does not know, and the app runs on without
    // session records (session.* answers `index unavailable`).
    if (this.index.unavailable !== null) {
      this.logUnavailable();
      return () => {};
    }
    this.writer = writer;
    const projects = this.index.projects.list();
    for (const project of projects) writer.observeProject(project);
    this.shownProjects = new Set(projects.map((p) => p.id));
    for (const record of this.index.sessions.list({ includeArchived: true })) {
      writer.observeRecord(record);
      this.digest(record);
    }

    this.offs = [
      this.index.sessions.onChange((record, cause, revision) => this.recordChanged(record, cause, revision)),
      this.index.sessions.onBinding((change) => this.bindingChanged(change)),
      this.index.projects.onChange((revision) => this.projectsChangedNow(revision)),
      this.host.onEvent('fs.sessionChanged', ({ summary }) => this.write('fs.sessionChanged', () => this.discovered(summary))),
      this.host.onEvent('fs.sessionRemoved', ({ sessionId }) => this.write('fs.sessionRemoved', () => this.index.sessions.markTranscriptRemoved(sessionId))),
      this.host.onEvent('fs.holderChanged', ({ sessionId, holder }) => {
        this.remember(sessionId, holder);
        this.write('fs.holderChanged', () => this.index.sessions.setHolder(sessionId, holder));
      }),
      this.host.onEvent('session.status', ({ appSessionId, status }) => {
        const record = this.index.sessions.get(appSessionId);
        if (record === null) return; // not a record the index holds (yet)
        // C3's patch leaves the holder out once the process has exited, the index's call. W7: the registry's foreign
        // holder of the session, remembered from fs.holderChanged, holds it then (the registry tells only changes, and
        // MAWS's own record is never one); none otherwise. While the process runs it is self, contested when a foreign
        // process holds the session too.
        const patch = toSessionRecordPatch(status);
        const engineId = status.engineSessionId ?? record.engineSessionId;
        const foreign = (engineId === null ? undefined : this.holders.get(engineId)) ?? { kind: 'none' as const };
        if (status.process === 'exited') patch.holder = foreign;
        else patch.holder = contested(foreign);
        this.write('session.status', () => this.index.sessions.applyEngineStatus(appSessionId, patch));
        this.liveStatus(appSessionId, status.process === 'exited', record.engineSessionId !== null);
      }),
      this.host.onState('engine-host', (state) => {
        this.live.clear(); // a host that went away took its processes with it
        if (state.state === 'ready') void this.sync();
      }),
    ];
    if (this.host.snapshot('engine-host').state === 'ready') void this.sync();

    // Sessions an earlier membership rule left in a linked worktree's own project move under its main checkout. Telling
    // linked worktrees apart takes git, a few hundred calls on a large store, so they run off main's thread first (the
    // visible projects' directories warm `locate`'s cache), and the refold then reads the cache, its moves going out as
    // ordinary changes: the sidebar regroups live. A source stopped before the warm-up ends refolds nothing.
    let stopped = false;
    const warm = this.options.warmLinkedWorktrees ?? warmLinkedWorktrees;
    warm(projects.map((p) => p.directory))
      .then(() => {
        if (!stopped) this.write('linked-worktree refold', () => this.index.sessions.refoldLinkedWorktrees());
      })
      .catch((error: unknown) => console.error('[index] linked-worktree warm-up failed:', error instanceof Error ? error.message : error));

    return () => {
      stopped = true;
      for (const off of this.offs) off();
      this.offs = [];
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      this.pending.clear();
      this.bindingQueue = [];
      this.unfollows = [];
      this.writer = null;
    };
  }

  // C5's visibility report. A session becoming visible is seen at once; the unread rule reads the set on every advance.
  onSetVisible(appSessionId: AppSessionId, visible: boolean): void {
    if (!visible) {
      this.visible.delete(appSessionId);
      return;
    }
    this.visible.add(appSessionId);
    if (this.index.unavailable !== null) return;
    const record = this.index.sessions.get(appSessionId);
    if (record === null) return; // an unstarted tab: nothing to mark until its record exists
    this.write('session.setVisible', () => this.markSeen(record));
  }

  // One transcript's summary: the record created or refreshed; a registry holder that arrived before the record is
  // applied to it; an advance of its last record is read or unread by the visible set (in the same transaction, so a
  // visible record never goes out unread).
  private discovered(summary: TranscriptSummary): void {
    this.index.transaction(() => {
      const { record, created, advanced } = this.index.sessions.upsertFromSummary(summary);
      const holder = this.holders.get(summary.sessionId);
      if (created && holder !== undefined) this.index.sessions.setHolder(summary.sessionId, holder);
      if (!advanced) return;
      if (this.visible.has(record.appId)) this.markSeen(record, summary);
      else this.index.sessions.setUnread(record.appId, true);
    });
  }

  // A process this app runs is the session's live source from its first status to its exit: a disk follow of the same
  // app id (a `session.events` read before the launch, then a resume of that id) stops then, once per run, so disk and
  // live events never both flow for one id. Only an id bound before the status can have been followed (the host follows
  // bound ids only); the unfollow goes out at the tick, in order after the bindings.
  private liveStatus(appSessionId: AppSessionId, exited: boolean, wasBound: boolean): void {
    if (exited) {
      this.live.delete(appSessionId);
      return;
    }
    if (this.live.has(appSessionId)) return;
    this.live.add(appSessionId);
    if (!wasBound || this.index.unavailable !== null) return;
    this.unfollows.push(appSessionId);
    this.schedule();
  }

  private markSeen(record: SessionRecord, summary = this.index.sessions.summaryOf(record.appId)): void {
    this.index.sessions.markSeen(record.appId, { messageUuid: summary?.leafUuid ?? record.lastSeen.messageUuid, at: this.now() });
  }

  private remember(sessionId: SessionId, holder: Holder): void {
    if (holder.kind === 'none') this.holders.delete(sessionId);
    else this.holders.set(sessionId, holder);
  }

  // The registry as the host sees it now, folded once per sync: live holders applied, and a foreign holder the index
  // kept from an earlier run whose process is gone cleared (W7: a contest whose foreign process is gone, too).
  private foldHolders(live: { sessionId: SessionId; holder: Holder }[]): void {
    this.write('fs.state', () =>
      this.index.transaction(() => {
        const now = new Map(live.map(({ sessionId, holder }) => [sessionId, holder]));
        for (const [sessionId, holder] of now) {
          this.remember(sessionId, holder);
          this.index.sessions.setHolder(sessionId, holder);
        }
        for (const record of this.index.sessions.list({ includeArchived: true })) {
          const { holder } = record;
          const foreign = holder.kind === 'terminal' || holder.kind === 'background_job' || (holder.kind === 'self' && holder.contestedBy !== undefined); // W7: a contest too
          if (foreign && record.engineSessionId !== null && !now.has(record.engineSessionId)) {
            this.holders.delete(record.engineSessionId);
            this.index.sessions.setHolder(record.engineSessionId, { kind: 'none' });
          }
        }
      }),
    );
  }

  private sync(): Promise<unknown> {
    this.syncs = this.syncs.then(async () => {
      const bindings = this.index.sessions.bindings();
      const bare = bindings.filter((b) => b.size === null || b.mtimeMs === null).map(({ sessionId, appSessionId }) => ({ sessionId, appSessionId }));
      const known = bindings.flatMap(({ sessionId, appSessionId, size, mtimeMs }) => (size === null || mtimeMs === null ? [] : [{ sessionId, appSessionId, size, mtimeMs }]));
      if (bare.length > 0) await this.command('fs.bind', { bindings: bare });
      await this.command('fs.scan', { known });
      const state = await this.command('fs.state', undefined);
      if (state !== null) this.foldHolders(state.holders);
    });
    return this.syncs;
  }

  private recordChanged(record: SessionRecord, cause: ChangeCause, revision: number): void {
    const appId = record.appId;
    // Within a tick a record goes out once, in its final state, under the first cause the tick saw (a row discovered
    // and then refreshed is still news of a discovery); re-inserted last, so it follows whatever preceded it.
    const previous = this.pending.get(appId);
    this.pending.delete(appId);
    if (cause === 'removed') {
      this.writer?.observeRemoved(appId);
      this.pending.set(appId, { t: 'removed', revision });
    } else {
      this.writer?.observeRecord(record);
      if (cause === 'discovered' || cause === 'facts' || cause === 'holder') this.digest(record);
      this.pending.set(appId, { t: 'changed', record, cause: previous?.t === 'changed' ? previous.cause : cause, revision });
    }
    this.schedule();
  }

  private projectsChangedNow(revision: number): void {
    const projects = this.index.projects.list();
    const shown = new Set(projects.map((p) => p.id));
    for (const project of projects) this.writer?.observeProject(project);
    for (const id of this.shownProjects) if (!shown.has(id)) this.writer?.observeProjectRemoved(id);
    this.shownProjects = shown;
    this.projectsRevision = revision;
    this.schedule();
  }

  private bindingChanged(change: BindingChange): void {
    this.bindingQueue.push(change);
    this.schedule();
  }

  // Sessions nobody runs in MAWS get a digest from what their transcript's tail says, so the sidebar can describe them;
  // a session MAWS runs (`self`) is C5's live fold.
  // C12: the seed leaves the memory budget's released mark out; main's read model keeps it against a seed with phase
  // `exited` and drops it against a `foreign` one (a terminal or background job took the session after its release).
  private digest(record: SessionRecord): void {
    if (!this.writer || record.holder.kind === 'self') return;
    const summary = this.index.sessions.summaryOf(record.appId);
    const text = summary?.lastAssistantText ?? null;
    this.writer.setDigest({
      appSessionId: record.appId,
      phase: record.holder.kind === 'terminal' || record.holder.kind === 'background_job' ? 'foreign' : 'exited',
      activity: null,
      lastAssistantLine: text === null ? null : text.split('\n', 1)[0].slice(0, LAST_LINE_CHARS),
      turnStartedAt: null,
      lastTurnEndedAt: summary?.lastRecordAt ?? null, // C5's rebase: the session's last activity (age, recency order)
      context: null,
      cost: null,
      childAgents: { active: 0, done: 0 },
      pendingRequests: 0,
    });
  }

  private schedule(): void {
    this.timer ??= setTimeout(() => this.flush(), this.tickMs);
  }

  // Every change waiting for the tick goes out once, carrying its own revision, in revision order (a project a new
  // record joins was committed, and stamped, before the record).
  private flush(): void {
    this.timer = null;
    const out: { revision: number; send: () => void }[] = [];
    for (const [appSessionId, change] of this.pending) {
      const { revision } = change;
      out.push({
        revision,
        send: () =>
          change.t === 'removed'
            ? this.options.emit('session.removed', { appSessionId, revision })
            : this.options.emit('session.changed', { record: change.record, cause: change.cause, revision }),
      });
    }
    this.pending.clear();
    if (this.projectsRevision !== null) {
      const revision = this.projectsRevision;
      this.projectsRevision = null;
      const projects = this.index.projects.listWithRemoved(); // W11 (I5): as `session.projects.list` answers
      out.push({ revision, send: () => this.options.emit('session.projects.changed', { projects, revision }) });
    }
    out.sort((a, b) => a.revision - b.revision);
    for (const { send } of out) send();
    this.flushBindings();
  }

  // Consecutive binds become one `fs.bind`; an unbind (cleared engine id, removed record) is its own `fs.unbind`, which
  // also stops whatever followed it.
  private flushBindings(): void {
    const queue = this.bindingQueue;
    this.bindingQueue = [];
    const batches: ({ t: 'bind'; bindings: { sessionId: SessionId; appSessionId: AppSessionId }[] } | { t: 'unbind'; appSessionId: AppSessionId })[] = [];
    for (const { appSessionId, sessionId } of queue) {
      const last = batches.at(-1);
      if (sessionId === null) batches.push({ t: 'unbind', appSessionId });
      else if (last?.t === 'bind') last.bindings.push({ sessionId, appSessionId });
      else batches.push({ t: 'bind', bindings: [{ sessionId, appSessionId }] });
    }
    for (const batch of batches) {
      this.hostWork = this.hostWork.then(() =>
        batch.t === 'bind' ? this.command('fs.bind', { bindings: batch.bindings }) : this.command('fs.unbind', { appSessionId: batch.appSessionId }),
      );
    }
    const unfollows = this.unfollows;
    this.unfollows = [];
    for (const appSessionId of unfollows) this.hostWork = this.hostWork.then(() => this.command('fs.unfollow', { appSessionId, agentId: null }));
  }

  private async command<N extends CommandName>(name: N, input: CommandInput<N>): Promise<CommandOutput<N> | null> {
    const result = await this.host.dispatch('engine-host', name, input);
    if (!result.ok) {
      console.error(`[index] ${name} failed:`, result.error.message);
      return null;
    }
    return result.value as CommandOutput<N>;
  }

  // Index writes from host events: a failed write is logged, never thrown into the supervisor's relay.
  private write(what: string, fn: () => unknown): void {
    if (this.index.unavailable !== null) {
      this.logUnavailable();
      return;
    }
    try {
      fn();
    } catch (error) {
      console.error(`[index] ${what} could not be applied:`, error instanceof Error ? error.message : error);
    }
  }

  private logUnavailable(): void {
    if (!this.unavailableLogged) console.error(`[index] index unavailable: ${this.index.unavailable}; session records will not follow the store this run`);
    this.unavailableLogged = true;
  }
}
