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
import { applyStatusToDigest, emptyDigest, foldEvents } from './digest';
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
  observeAttention(appSessionId: AppSessionId, items: AttentionItem[]): void; // attention.changed
}

interface ReadModelEvents {
  record: (appSessionId: AppSessionId, record: SessionRecord | null) => void;
  digest: (digest: SessionDigest) => void;
  engine: (appSessionId: AppSessionId, status: EngineSessionStatus | null) => void;
  attention: (appSessionId: AppSessionId, items: AttentionItem[]) => void;
}

const LIVE = new Set<EngineSessionStatus['process']>(['starting', 'initializing', 'ready']);
const LAUNCHING = new Set<EngineSessionStatus['process']>(['starting', 'initializing']);

export class SessionReadModel {
  private readonly records = new Map<AppSessionId, SessionRecord>();
  private readonly projects = new Map<ProjectId, ProjectRecord>();
  private readonly digestsById = new Map<AppSessionId, SessionDigest>();
  private readonly seen = new Map<AppSessionId, Set<string>>();
  private readonly costAtSeen = new Map<AppSessionId, number>();
  private readonly statuses = new Map<AppSessionId, EngineSessionStatus>();
  private readonly attentionById = new Map<AppSessionId, AttentionItem[]>();
  private readonly visible = new Set<AppSessionId>();
  private readonly sources = new Set<SessionSource>();
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

  attention(appSessionId: AppSessionId): AttentionItem[] {
    return this.attentionById.get(appSessionId) ?? [];
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
    const committed = { ...candidate, revision: (prev?.revision ?? 0) + 1 };
    this.digestsById.set(next.appSessionId, committed);
    this.fire('digest', committed);
  }

  private current(appSessionId: AppSessionId): SessionDigest {
    return this.digestsById.get(appSessionId) ?? emptyDigest(appSessionId);
  }

  private readonly writer: ReadModelWriter = {
    observeRecord: (r) => {
      this.records.set(r.appId, r);
      this.fire('record', r.appId, r);
    },
    observeRemoved: (appSessionId) => {
      this.records.delete(appSessionId);
      this.digestsById.delete(appSessionId);
      this.seen.delete(appSessionId);
      this.costAtSeen.delete(appSessionId);
      this.statuses.delete(appSessionId);
      this.attentionById.delete(appSessionId);
      this.visible.delete(appSessionId);
      this.fire('record', appSessionId, null);
    },
    observeProject: (p) => {
      this.projects.set(p.id, p);
    },
    observeProjectRemoved: (id) => {
      this.projects.delete(id);
    },
    setDigest: (d) => {
      // A given `sinceSeenUsd` fixes the cost at which the session was last seen, so later samples stay consistent.
      if (d.cost) this.costAtSeen.set(d.appSessionId, d.cost.totalUsd - d.cost.sinceSeenUsd);
      this.commit({ ...d, revision: 0 });
    },
    // A status or batch for a session with no observed record is dropped (C10's trust bootstrap launches under the
    // session's id before the record exists): the model describes only sessions a source has listed.
    fold: (appSessionId, events) => {
      if (!this.records.has(appSessionId)) return;
      let seen = this.seen.get(appSessionId);
      if (!seen) this.seen.set(appSessionId, (seen = new Set()));
      this.commit(foldEvents(this.current(appSessionId), seen, events));
    },
    applyEngineStatus: (s) => {
      if (!this.records.has(s.appSessionId)) return;
      this.statuses.set(s.appSessionId, s);
      this.fire('engine', s.appSessionId, s);
      this.commit(applyStatusToDigest(this.current(s.appSessionId), s));
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
