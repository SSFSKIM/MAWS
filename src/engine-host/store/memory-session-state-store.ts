// An in-memory SessionStateStore: the default for an EngineSession constructed without a store (the conformance
// suites and unit tests), and a test double for the file adapter. Values are cloned in and out so a caller mutating
// what it saved or loaded never changes what is stored.
import { assertSafeAppSessionId } from '@shared/engine/app-session-id';
import type { AppSessionId } from '@shared/graph/ids';
import type { LaunchSpec } from '@shared/engine/launch-spec';
import type { CronRecord, GrantSnapshot, QueueState, SessionStateStore, StoredQueue } from '@shared/engine/session-state-store';

export class MemorySessionStateStore implements SessionStateStore {
  readonly queues = new Map<AppSessionId, QueueState>();
  readonly grants = new Map<AppSessionId, GrantSnapshot>();
  readonly specs = new Map<AppSessionId, LaunchSpec>();
  readonly keeps = new Map<AppSessionId, boolean>(); // P5 O2 M2
  readonly engineSessionIds = new Map<AppSessionId, string[]>(); // P5 O2 M2
  readonly cronRecords = new Map<AppSessionId, CronRecord>(); // P5 O2 M2
  readonly observerSeen = new Map<AppSessionId, string>(); // O16 M5
  readonly owedInterrupts = new Map<AppSessionId, boolean>(); // P5 O16 M2

  async exists(id: AppSessionId): Promise<boolean> {
    return this.queues.has(id) || this.grants.has(id) || this.specs.has(id) || this.keeps.has(id) || this.engineSessionIds.has(id) || this.cronRecords.has(id) || this.observerSeen.has(id);
  }
  async loadQueue(id: AppSessionId): Promise<StoredQueue> {
    return { ...structuredClone(this.queues.get(id) ?? { entries: [], paused: false }), corrupt: null };
  }
  async saveQueue(id: AppSessionId, queue: QueueState): Promise<void> {
    this.queues.set(id, structuredClone(queue));
  }
  async loadGrants(id: AppSessionId): Promise<GrantSnapshot> {
    return structuredClone(this.grants.get(id) ?? { allow: [] });
  }
  async saveGrants(id: AppSessionId, grants: GrantSnapshot): Promise<void> {
    this.grants.set(id, structuredClone(grants));
  }
  async loadLaunchSpec(id: AppSessionId): Promise<LaunchSpec | null> {
    return structuredClone(this.specs.get(id) ?? null);
  }
  async saveLaunchSpec(id: AppSessionId, spec: LaunchSpec): Promise<void> {
    this.specs.set(id, structuredClone(spec));
  }
  async loadKeep(id: AppSessionId): Promise<boolean> {
    return this.keeps.get(id) ?? false;
  }
  async saveKeep(id: AppSessionId, keep: boolean): Promise<void> {
    this.keeps.set(id, keep);
  }
  async loadOwedInterrupt(id: AppSessionId): Promise<boolean> {
    return this.owedInterrupts.get(id) ?? false;
  }
  async saveOwedInterrupt(id: AppSessionId, owed: boolean): Promise<void> {
    this.owedInterrupts.set(id, owed);
  }
  async loadEngineSessionIds(id: AppSessionId): Promise<string[]> {
    return [...(this.engineSessionIds.get(id) ?? [])];
  }
  async saveEngineSessionIds(id: AppSessionId, ids: string[]): Promise<void> {
    this.engineSessionIds.set(id, [...ids]);
  }
  // P5 O2 M2: as the file store, a failed save removes the record, so it reads as missing until a save succeeds;
  // `cronRecordWriteError`, while set, fails every save with it (a full disk, in tests)
  cronRecordWriteError: Error | null = null;
  async loadCronRecord(id: AppSessionId): Promise<CronRecord | null> {
    const record = this.cronRecords.get(id);
    return record === undefined ? null : structuredClone(record);
  }
  async saveCronRecord(id: AppSessionId, record: CronRecord): Promise<void> {
    if (this.cronRecordWriteError) {
      this.cronRecords.delete(id);
      throw this.cronRecordWriteError;
    }
    this.cronRecords.set(id, structuredClone(record));
  }
  async loadObserverSeen(id: AppSessionId): Promise<string | null> {
    return this.observerSeen.get(id) ?? null;
  }
  async saveObserverSeen(id: AppSessionId, launchId: string): Promise<void> {
    this.observerSeen.set(id, launchId);
  }
  // keeps no journal: nothing to delete, but the id is still checked as the file store checks it
  async forgetJournal(id: AppSessionId): Promise<void> {
    assertSafeAppSessionId(id);
  }
  async forget(id: AppSessionId): Promise<void> {
    this.queues.delete(id);
    this.grants.delete(id);
    this.specs.delete(id);
    this.keeps.delete(id);
    this.owedInterrupts.delete(id);
    this.engineSessionIds.delete(id);
    this.cronRecords.delete(id);
    this.observerSeen.delete(id);
  }
}
