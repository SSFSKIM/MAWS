// Main's read model (C5 execution document, Terms and Interfaces "Main modules"; residue *Read model and stub source*).
// It folds the digest of every live session from the event stream, keeps C3's engine statuses, and observes records,
// projects and attention items on their way to the renderer, so the notifier, the dock badge and the quit guard have
// a view without a renderer. It stores nothing durable: the store of record is C4's index.
//
// Sources write into it through `ReadModelWriter`, obtained only by registering: C4's `IndexSessionSource` in launch
// mode `index`, the stub source in launch mode `scenario`, where every other source is refused unstarted so C4's
// index never scans and discovery never runs.
import type { AttentionItem } from '@shared/graph/attention';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { ProjectRecord, SessionDigest } from '@shared/ipc/schema';
import { applyStatusToDigest, costLedger, costOf, emptyDigest, foldEvents, withoutReleased, type CostLedger } from './digest'; // C12: withoutReleased
import type { LaunchMode } from './select-source';

export interface SessionSource {
  start(writer: ReadModelWriter): () => void;
  onSetVisible?(appSessionId: AppSessionId, visible: boolean): void; // C4's IndexSessionSource applies the unread rule here; the stub source does too
}

export interface ReadModelWriter {
  observeRecord(r: SessionRecord): void;
  observeRemoved(appSessionId: AppSessionId): void;
  observeProject(p: ProjectRecord): void;
  observeProjectRemoved(id: ProjectId): void;
  setDigest(d: Omit<SessionDigest, 'revision'>): void; // stub and tests; C4's seed for sessions with no live fold; production digests come from fold()
  fold(appSessionId: AppSessionId, events: SessionEvent[]): void; // the digest reducer over a `session.eventBatch`
  applyEngineStatus(s: EngineSessionStatus): void; // C3's session.status: phase facts, and the process and turn state the quit guard reads
  forgetEngineStatus(appSessionId: AppSessionId): void; // no process is owned any more (the scenario's `engine: null`)
  observeReplay(appSessionId: AppSessionId): void; // C4's `session.replay.progress`: the host plays this session's events live
  observeAttention(appSessionId: AppSessionId, items: AttentionItem[]): void; // attention.changed
}

interface ReadModelEvents {
  record: (appSessionId: AppSessionId, record: SessionRecord | null) => void;
  digest: (digest: SessionDigest) => void;
  engine: (appSessionId: AppSessionId, status: EngineSessionStatus | null) => void;
  attention: (appSessionId: AppSessionId, items: AttentionItem[]) => void;
}

const LIVE = new Set<EngineSessionStatus['process']>(['starting', 'initializing', 'ready']);
const FOLD_LIVE = new Set<EngineSessionStatus['process']>([...LIVE, 'exiting']);
const LAUNCHING = new Set<EngineSessionStatus['process']>(['starting', 'initializing']);

export class SessionReadModel {
  private readonly records = new Map<AppSessionId, SessionRecord>();
  private readonly projects = new Map<ProjectId, ProjectRecord>();
  private readonly digestsById = new Map<AppSessionId, SessionDigest>();
  // The last digest revision each app id emitted, kept for the process lifetime: a removed and recreated session
  // continues from it, so a consumer that still holds the old digest takes the new ones (a revision never repeats).
  private readonly lastRevision = new Map<AppSessionId, number>();
  private readonly seen = new Map<AppSessionId, Set<string>>();
  private readonly ledgers = new Map<AppSessionId, CostLedger>(); // cost across the session's processes (digest.ts)
  // C4 replay runs seen this app run: the host plays their events as a live session's, with no engine status. A run
  // stays live once seen, so its last batch (which may trail its `done` progress) still ends its turn.
  private readonly replays = new Set<AppSessionId>();
  private readonly costAtSeen = new Map<AppSessionId, number>();
  private readonly statuses = new Map<AppSessionId, EngineSessionStatus>();
  private readonly attentionById = new Map<AppSessionId, AttentionItem[]>();
  private readonly visible = new Set<AppSessionId>();
  private readonly sources = new Set<SessionSource>();
  // C12: the launch whose released mark a terminal or background job holder, or an archive, cleared (null when no status
  // named one); the mark applies once per release, so nothing of that launch restores it, and the next launch forgets it
  private readonly clearedRelease = new Map<AppSessionId, string | null>();
  private readonly listeners: { [K in keyof ReadModelEvents]: Set<ReadModelEvents[K]> } = {
    record: new Set(), digest: new Set(), engine: new Set(), attention: new Set(),
  };

  constructor(private readonly mode: LaunchMode) {}

  register(source: SessionSource): () => void {
    if (this.mode === 'scenario') {
      console.log('read-model: scenario mode, source ignored');
      return () => {};
    }
    return this.attach(source);
  }

  registerScenario(source: SessionSource): () => void {
    if (this.mode !== 'scenario') throw new Error('read-model: a scenario source needs launch mode scenario');
    return this.attach(source);
  }

  private attach(source: SessionSource): () => void {
    this.sources.add(source);
    const stop = source.start(this.writer);
    return () => {
      this.sources.delete(source);
      stop();
    };
  }

  digests(): SessionDigest[] {
    return [...this.digestsById.values()];
  }

  engineStatus(appSessionId: AppSessionId): EngineSessionStatus | null {
    return this.statuses.get(appSessionId) ?? null;
  }

  // Sessions whose process C3's host owns and that hold a turn, or are still launching (a first message on its way).
  // The engine status is the process table's truth; the digest is folded from events a stale batch can skew.
  midTurnCount(): number {
    let count = 0;
    for (const s of this.statuses.values()) if (LIVE.has(s.process) && (s.turn !== null || LAUNCHING.has(s.process))) count += 1;
    return count;
  }

  record(appSessionId: AppSessionId): SessionRecord | null {
    return this.records.get(appSessionId) ?? null;
  }

  project(id: ProjectId): ProjectRecord | null {
    return this.projects.get(id) ?? null;
  }

  // C7 start: every record held, whichever source observed it (C7's git.lsFiles roots in main, scenario sessions included)
  allRecords(): SessionRecord[] {
    return [...this.records.values()];
  }
  // C7 end

  attention(appSessionId: AppSessionId): AttentionItem[] {
    return this.attentionById.get(appSessionId) ?? [];
  }

  // Every session's list, for the consumers that read across sessions (the notifier's start, the dock badge).
  allAttention(): ReadonlyMap<AppSessionId, AttentionItem[]> {
    return this.attentionById;
  }

  setVisible(appSessionId: AppSessionId, visible: boolean): void {
    if (this.visible.has(appSessionId) === visible) return;
    if (visible) {
      this.visible.add(appSessionId);
      const current = this.digestsById.get(appSessionId);
      this.costAtSeen.set(appSessionId, current?.cost?.totalUsd ?? 0);
      if (current) this.commit(current);
    } else {
      this.visible.delete(appSessionId);
    }
    for (const source of this.sources) source.onSetVisible?.(appSessionId, visible);
  }

  on<K extends keyof ReadModelEvents>(event: K, listener: ReadModelEvents[K]): () => void {
    this.listeners[event].add(listener);
    return () => this.listeners[event].delete(listener);
  }

  private fire<K extends keyof ReadModelEvents>(event: K, ...args: Parameters<ReadModelEvents[K]>): void {
    for (const listener of this.listeners[event]) (listener as (...a: Parameters<ReadModelEvents[K]>) => void)(...args);
  }

  // Recomputes cost since seen, bumps the session's revision and emits, unless nothing changed.
  private commit(next: SessionDigest): void {
    const prev = this.digestsById.get(next.appSessionId);
    const cost = next.cost && { totalUsd: next.cost.totalUsd, sinceSeenUsd: next.cost.totalUsd - (this.costAtSeen.get(next.appSessionId) ?? 0) };
    const candidate = { ...next, cost, revision: prev?.revision ?? 0 };
    if (prev && JSON.stringify(prev) === JSON.stringify(candidate)) return;
    const revision = (this.lastRevision.get(next.appSessionId) ?? 0) + 1;
    const committed = { ...candidate, revision };
    this.lastRevision.set(next.appSessionId, revision);
    this.digestsById.set(next.appSessionId, committed);
    this.fire('digest', committed);
  }

  // Liveness (digest.ts `foldEvents`): the process table's truth. Unlike the quit guard's set it includes `exiting`: C3's
  // stop ladder sets it before the process dies, and the final turn end and the exit are journalled after it.
  private live(appSessionId: AppSessionId): boolean {
    const status = this.statuses.get(appSessionId);
    return (status !== undefined && FOLD_LIVE.has(status.process)) || this.replays.has(appSessionId);
  }

  private current(appSessionId: AppSessionId): SessionDigest {
    return this.digestsById.get(appSessionId) ?? emptyDigest(appSessionId);
  }

  // C12 start: the released mark once per release. `clearRelease` remembers the launch whose mark goes; `onceReleased`
  // leaves the digest as it was (its phase, no mark) when a status or event of that launch would mark it again.
  private launchOf(appSessionId: AppSessionId): string | null {
    return this.statuses.get(appSessionId)?.launchId ?? null;
  }

  private clearRelease(appSessionId: AppSessionId): void {
    this.clearedRelease.set(appSessionId, this.launchOf(appSessionId));
  }

  private onceReleased(prev: SessionDigest, next: SessionDigest): SessionDigest {
    const cleared = this.clearedRelease.get(next.appSessionId);
    if (next.released === undefined || prev.released !== undefined || cleared === undefined || cleared !== this.launchOf(next.appSessionId)) return next;
    return { ...withoutReleased(next), phase: prev.phase, activity: prev.activity };
  }
  // C12 end

  private readonly writer: ReadModelWriter = {
    observeRecord: (r) => {
      this.records.set(r.appId, r);
      this.fire('record', r.appId, r);
      // C12 start: an archive is not a cause C4 re-seeds the digest on, so an archived released session reads exited here
      // (an unarchived one then starts fresh)
      const digest = this.digestsById.get(r.appId);
      if (r.archived && digest?.released !== undefined) {
        this.clearRelease(r.appId);
        this.commit({ ...withoutReleased(digest), phase: 'exited', activity: null });
      }
      // C12 end
    },
    observeRemoved: (appSessionId) => {
      this.records.delete(appSessionId);
      this.digestsById.delete(appSessionId);
      this.seen.delete(appSessionId);
      this.ledgers.delete(appSessionId);
      this.replays.delete(appSessionId);
      this.costAtSeen.delete(appSessionId);
      this.statuses.delete(appSessionId);
      this.attentionById.delete(appSessionId);
      this.visible.delete(appSessionId);
      this.clearedRelease.delete(appSessionId); // C12
      this.fire('record', appSessionId, null);
    },
    observeProject: (p) => {
      this.projects.set(p.id, p);
    },
    observeProjectRemoved: (id) => {
      this.projects.delete(id);
    },
    setDigest: (d) => {
      // A null cost, context or last line means the writer does not know it (C4's seed for a session with no live
      // process knows neither cost nor context), so the folded value stands. A given cost becomes the live process's
      // running total, unless it is below what the session's processes already cost (a seed after an exit).
      const prev = this.digestsById.get(d.appSessionId);
      const ledger = this.ledgers.get(d.appSessionId);
      const keepCost = d.cost === null || (ledger !== undefined && d.cost.totalUsd < costOf(ledger));
      if (!keepCost && d.cost) {
        // A given `sinceSeenUsd` fixes the cost at which the session was last seen, so later samples stay consistent.
        this.costAtSeen.set(d.appSessionId, d.cost.totalUsd - d.cost.sinceSeenUsd);
        this.ledgers.delete(d.appSessionId);
      }
      // C12: C4's holder-change seed after a release (phase `exited`) keeps the released mark and its idle phase; any
      // other phase (a terminal or background job holding it: `foreign`) drops the mark and takes the incoming phase.
      const keepReleased = prev?.released !== undefined && d.released === undefined && d.phase === 'exited';
      if (prev?.released !== undefined && d.released === undefined && !keepReleased) this.clearRelease(d.appSessionId); // C12
      this.commit({
        ...d,
        cost: keepCost ? (prev?.cost ?? null) : d.cost,
        context: d.context ?? prev?.context ?? null,
        lastAssistantLine: d.lastAssistantLine ?? prev?.lastAssistantLine ?? null,
        ...(keepReleased && { phase: prev.phase, released: prev.released }), // C12
        revision: 0,
      });
    },
    // A status or batch for a session with no observed record is dropped (C10's trust bootstrap launches under the
    // session's id before the record exists): the model describes only sessions a source has listed.
    fold: (appSessionId, events) => {
      if (!this.records.has(appSessionId)) return;
      let seen = this.seen.get(appSessionId);
      if (!seen) this.seen.set(appSessionId, (seen = new Set()));
      let ledger = this.ledgers.get(appSessionId);
      if (!ledger) this.ledgers.set(appSessionId, (ledger = costLedger(this.current(appSessionId))));
      const current = this.current(appSessionId);
      this.commit(this.onceReleased(current, foldEvents(current, seen, events, ledger, this.live(appSessionId)))); // C12: onceReleased
    },
    applyEngineStatus: (s) => {
      if (!this.records.has(s.appSessionId)) return;
      this.statuses.set(s.appSessionId, s);
      this.fire('engine', s.appSessionId, s);
      const current = this.current(s.appSessionId);
      this.commit(this.onceReleased(current, applyStatusToDigest(current, s))); // C12: onceReleased
    },
    observeReplay: (appSessionId) => {
      if (this.records.has(appSessionId)) this.replays.add(appSessionId);
    },
    forgetEngineStatus: (appSessionId) => {
      if (!this.statuses.delete(appSessionId)) return;
      this.fire('engine', appSessionId, null);
    },
    observeAttention: (appSessionId, items) => {
      this.attentionById.set(appSessionId, items);
      this.fire('attention', appSessionId, items);
    },
  };
}
