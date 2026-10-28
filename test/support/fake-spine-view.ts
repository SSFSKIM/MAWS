// A settable `SpineView` for the tests of every staying reader (P5 O3-C, Interfaces §G and the reader map §C): the
// records, both project sets, digests, attention, engine statuses, intents and the visible set a test puts in it, with a
// setter per member that fires the view's own event as the in-process backing would. `acquire` and `fileLinkedPaths`
// answer what the test sets (`acquireWith`, `linked`), and `acquired` lists what was asked.
import type { AttentionItem } from '../../src/shared/graph/attention';
import type { AppSessionId, AttentionId, ProjectId } from '../../src/shared/graph/ids';
import type { SessionRecord } from '../../src/shared/graph/session';
import type { EngineSessionStatus } from '../../src/shared/engine/status';
import type { ProjectRecord, SessionDigest } from '../../src/shared/ipc/schema';
import type { AcquireReason } from '../../src/shared/ipc/schema/session';
import type { SetupIntent } from '../../src/shared/sessions/intent';
import type { AcquireOutcome } from '../../src/shared/sessions/setup';
import type { SpineView, SpineViewEvents } from '../../src/shared/spine/view';
import { midTurnCountOf } from '../../src/shared/engine/status';

export interface FakeSpineView extends SpineView {
  setUnavailable(reason: string | null): void; // fires `availability`
  putRecord(record: SessionRecord): void; // fires `record`
  removeRecord(appSessionId: AppSessionId): void; // fires `record` with null
  // Both sets at once unless `rows` is given (every row the index holds); fires `projects`
  setProjects(projects: readonly ProjectRecord[], rows?: readonly ProjectRecord[]): void;
  putDigest(digest: SessionDigest): void; // fires `digest`
  setAttention(appSessionId: AppSessionId, items: readonly AttentionItem[], silent?: Iterable<AttentionId>): void; // fires `attention`
  setStatus(status: EngineSessionStatus): void; // fires `engine`
  forgetStatus(appSessionId: AppSessionId): void; // fires `engine` with null
  putIntent(intent: SetupIntent): void; // fires `intent`
  removeIntent(appSessionId: AppSessionId): void; // fires `intent` with null
  setVisible(appSessionId: AppSessionId, visible: boolean): void; // fires `visible`
  acquireWith(answer: (appSessionId: AppSessionId, reason: AcquireReason) => Promise<AcquireOutcome>): void;
  readonly acquired: [AppSessionId, AcquireReason][];
  readonly linked: Map<AppSessionId, string[]>; // fileLinkedPaths' answers
  listeners(): number; // how many listeners are subscribed, every event together
}

export interface FakeSpineViewSeed {
  unavailable?: string | null;
  records?: readonly SessionRecord[];
  projects?: readonly ProjectRecord[];
  projectRows?: readonly ProjectRecord[]; // the listed projects when absent
  digests?: readonly SessionDigest[];
  attention?: Iterable<[AppSessionId, readonly AttentionItem[]]>;
  statuses?: readonly EngineSessionStatus[];
  intents?: readonly SetupIntent[];
  visible?: readonly AppSessionId[];
}

export function fakeSpineView(seed: FakeSpineViewSeed = {}): FakeSpineView {
  let unavailable = seed.unavailable ?? null;
  const records = new Map((seed.records ?? []).map((r) => [r.appId, r]));
  let projects = [...(seed.projects ?? [])];
  let rows = [...(seed.projectRows ?? seed.projects ?? [])];
  const digests = new Map((seed.digests ?? []).map((d) => [d.appSessionId, d]));
  const attention = new Map<AppSessionId, readonly AttentionItem[]>(seed.attention ?? []);
  const statuses = new Map((seed.statuses ?? []).map((s) => [s.appSessionId, s]));
  const intents = new Map((seed.intents ?? []).map((i) => [i.appSessionId, i]));
  const visible = new Set(seed.visible ?? []);
  const subscribed: { [E in keyof SpineViewEvents]: Set<SpineViewEvents[E]> } = {
    availability: new Set(), record: new Set(), projects: new Set(), digest: new Set(), attention: new Set(), engine: new Set(), intent: new Set(), visible: new Set(),
  };
  const fire = <E extends keyof SpineViewEvents>(event: E, ...args: Parameters<SpineViewEvents[E]>) => {
    for (const listener of [...subscribed[event]]) (listener as (...a: Parameters<SpineViewEvents[E]>) => void)(...args);
  };
  let answer: (appSessionId: AppSessionId, reason: AcquireReason) => Promise<AcquireOutcome> = async () => ({ status: 'ready' }) as AcquireOutcome;
  const acquired: [AppSessionId, AcquireReason][] = [];
  const linked = new Map<AppSessionId, string[]>();

  return {
    unavailable: () => unavailable,
    record: (id) => records.get(id) ?? null,
    records: () => [...records.values()],
    projects: () => projects,
    projectRows: () => rows,
    project: (id: ProjectId) => rows.find((p) => p.id === id) ?? null,
    digest: (id) => digests.get(id) ?? null,
    digests: () => [...digests.values()],
    attention: (id) => attention.get(id) ?? [],
    allAttention: () => attention,
    engineStatuses: () => [...statuses.values()],
    midTurnCount: () => midTurnCountOf(statuses.values()),
    intent: (id) => intents.get(id) ?? null,
    intents: () => [...intents.values()],
    known: (id) => records.has(id) || intents.has(id),
    visibleSessions: () => [...visible],
    on(event, listener) {
      subscribed[event].add(listener);
      return () => void subscribed[event].delete(listener);
    },
    acquire(id, reason) {
      acquired.push([id, reason]);
      return answer(id, reason);
    },
    fileLinkedPaths: async (id) => (unavailable === null ? [...(linked.get(id) ?? [])] : []),

    setUnavailable(reason) {
      unavailable = reason;
      fire('availability', reason);
    },
    putRecord(record) {
      records.set(record.appId, record);
      fire('record', record.appId, record);
    },
    removeRecord(id) {
      records.delete(id);
      fire('record', id, null);
    },
    setProjects(listed, all) {
      projects = [...listed];
      rows = [...(all ?? listed)];
      fire('projects');
    },
    putDigest(digest) {
      digests.set(digest.appSessionId, digest);
      fire('digest', digest);
    },
    setAttention(id, items, silent = []) {
      attention.set(id, items);
      fire('attention', id, items, new Set(silent));
    },
    setStatus(status) {
      statuses.set(status.appSessionId, status);
      fire('engine', status.appSessionId, status);
    },
    forgetStatus(id) {
      statuses.delete(id);
      fire('engine', id, null);
    },
    putIntent(intent) {
      intents.set(intent.appSessionId, intent);
      fire('intent', intent.appSessionId, intent);
    },
    removeIntent(id) {
      intents.delete(id);
      fire('intent', id, null);
    },
    setVisible(id, shown) {
      if (shown) visible.add(id);
      else visible.delete(id);
      fire('visible', id, shown);
    },
    acquireWith(next) {
      answer = next;
    },
    acquired,
    linked,
    listeners: () => Object.values(subscribed).reduce((sum, set) => sum + set.size, 0),
  };
}
