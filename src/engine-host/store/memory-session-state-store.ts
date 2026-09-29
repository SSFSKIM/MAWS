// An in-memory SessionStateStore: the default for an EngineSession constructed without a store (the conformance
// suites and unit tests), and a test double for the file adapter. Values are cloned in and out so a caller mutating
// what it saved or loaded never changes what is stored.
import { assertSafeAppSessionId } from '@shared/engine/app-session-id';
import type { AppSessionId } from '@shared/graph/ids';
import type { LaunchSpec } from '@shared/engine/launch-spec';
import type { GrantSnapshot, QueueState, SessionStateStore, StoredQueue } from '@shared/engine/session-state-store';

export class MemorySessionStateStore implements SessionStateStore {
  readonly queues = new Map<AppSessionId, QueueState>();
  readonly grants = new Map<AppSessionId, GrantSnapshot>();
  readonly specs = new Map<AppSessionId, LaunchSpec>();

  async exists(id: AppSessionId): Promise<boolean> {
    return this.queues.has(id) || this.grants.has(id) || this.specs.has(id);
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
  // keeps no journal: nothing to delete, but the id is still checked as the file store checks it
  async forgetJournal(id: AppSessionId): Promise<void> {
    assertSafeAppSessionId(id);
  }
  async forget(id: AppSessionId): Promise<void> {
    this.queues.delete(id);
    this.grants.delete(id);
    this.specs.delete(id);
  }
}
