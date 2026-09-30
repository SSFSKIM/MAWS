// The stub session source (C5 execution document, Main modules; residue *Read model and stub source*), enabled by
// `MAWS_SESSION_SOURCE=stub:<scenario>` in launch mode `scenario`. It loads a scenario (validated by the X1/X2 schemas
// and C3's status schema), fills the stub store and the read model, answers through `interceptCommand` the commands
// the shell calls that C4 (record side) and C3 (`attention.list`, `attention.request`, `session.answer`) answer in
// production, emits the events those siblings would emit, and plays the scenario's timeline on the wall clock or, for
// the smoke, on a manual clock driven through `globalThis.__maws_scenario` in main (no test-only IPC command exists).
import type { AttentionItem } from '@shared/graph/attention';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { BudgetState } from '@shared/ipc/schema/engine'; // C12
import type { EventName, EventPayload } from '@shared/ipc/schema';
import { loadScenario, type Scenario, type ScenarioDigest, type ScenarioOp } from '../../../test/support/scenario';
import type { interceptCommand } from '../ipc/router';
import type { ReadModelWriter, SessionSource } from './read-model';
import type { ScenarioClock } from './select-source';
import { StubStore } from './stub-store';
import type { SessionPatch } from '@shared/ipc/schema/session';

export interface StubSourceDeps {
  emit: <N extends EventName>(name: N, payload: EventPayload<N>) => boolean;
  intercept: typeof interceptCommand;
  now?: () => number; // wall-clock ms, for record timestamps and the wall clock's offsets
}

export interface ScenarioControl {
  now(): number; // ms of scenario time played so far
  advanceTo(ms: number): void; // plays every entry with at <= ms, in order, synchronously
}

declare global {
  var __maws_scenario: ScenarioControl | undefined;
}

export type StubSource = SessionSource & ScenarioControl;

const OPEN = new Set<AttentionItem['state']>(['pending', 'delivered']);

export function stubSource(scenario: string | Scenario, clock: ScenarioClock, deps: StubSourceDeps): StubSource {
  const wallNow = deps.now ?? Date.now;
  const iso = () => new Date(wallNow()).toISOString();

  let writer: ReadModelWriter | null = null;
  let store: StubStore | null = null;
  let timeline: ScenarioOp[] = [];
  let played = 0; // index of the next timeline entry
  let elapsed = 0; // manual clock position
  let startedAt = 0; // wall clock start
  const attention = new Map<AppSessionId, AttentionItem[]>();
  const requests = new Map<string, SessionEvent>(); // `${appSessionId}\u0000${requestId}`
  const digests = new Map<AppSessionId, ScenarioDigest>();
  const statuses = new Map<AppSessionId, EngineSessionStatus>();
  const costAtSeen = new Map<AppSessionId, number>();
  let budget: BudgetState | null = null; // C12: the last budget the timeline played

  // While the scenario loads nothing is emitted but attention: the renderer reads the snapshots, as it would from C3 and
  // C4, and the read model learns attention only from `attention.changed` as emitted (the tap in sessions/index.ts),
  // as it does in launch mode `index`. No window exists yet at load, so that emit reaches main-side taps alone.
  let loading = false;
  const emit: StubSourceDeps['emit'] = (name, payload) => (!loading || name === 'attention.changed') && deps.emit(name, payload);

  const requestKey = (appSessionId: string, requestId: string) => `${appSessionId}\u0000${requestId}`;

  function setAttention(appSessionId: AppSessionId, items: AttentionItem[], newRequests: Record<string, SessionEvent>): void {
    for (const [requestId, event] of Object.entries(newRequests)) requests.set(requestKey(appSessionId, requestId), event);
    attention.set(appSessionId, items);
    emit('attention.changed', { appSessionId, items }); // the read model hears it through the emit tap
  }

  function setDigest(d: ScenarioDigest): void {
    // The scenario's cost since seen stands until the session is seen here; from then on it is measured from that point.
    const seenAt = costAtSeen.get(d.appSessionId);
    const next = d.cost && seenAt !== undefined ? { ...d, cost: { totalUsd: d.cost.totalUsd, sinceSeenUsd: d.cost.totalUsd - seenAt } } : d;
    const prev = digests.get(d.appSessionId);
    digests.set(d.appSessionId, next);
    writer?.setDigest(next);
    if (store && next.lastTurnEndedAt !== null && next.lastTurnEndedAt !== prev?.lastTurnEndedAt && prev !== undefined) store.turnEnded(d.appSessionId);
  }

  function setStatus(status: EngineSessionStatus): void {
    statuses.set(status.appSessionId, status);
    writer?.applyEngineStatus(status);
    emit('session.status', { appSessionId: status.appSessionId, status });
  }

  function apply(op: ScenarioOp): void {
    switch (op.op) {
      case 'attention':
        setAttention(op.appSessionId, op.items, op.requests);
        return;
      case 'digest':
        setDigest(op.digest);
        return;
      case 'engine':
        if (op.engine) setStatus(op.engine);
        else {
          statuses.delete(op.appSessionId);
          writer?.forgetEngineStatus(op.appSessionId);
        }
        return;
      case 'session':
        store?.put(op.record, 'discovered');
        writer?.observeRecord(op.record);
        return;
      // C12 start: the engine host's memory budget, as its engine.budget event would carry it
      case 'budget':
        budget = op.state;
        emit('engine.budget', op.state);
        return;
      // C12 end
      case 'removeSession':
        store?.remove(op.appSessionId);
        attention.delete(op.appSessionId);
        digests.delete(op.appSessionId);
        statuses.delete(op.appSessionId);
        writer?.observeRemoved(op.appSessionId);
        return;
    }
  }

  function advanceTo(ms: number): void {
    while (played < timeline.length && timeline[played].at <= ms) apply(timeline[played++]);
    elapsed = Math.max(elapsed, ms);
  }

  // `session.answer` for a scenario item: C3's broker would deliver it and the engine would carry on.
  function answer(appSessionId: AppSessionId, requestId: string): { outcome: 'delivered' | 'not_pending' } {
    const items = attention.get(appSessionId) ?? [];
    const target = items.find((i) => i.request.requestId === requestId && OPEN.has(i.state));
    if (!target) return { outcome: 'not_pending' };
    setAttention(appSessionId, items.filter((i) => i !== target), {});
    const digest = digests.get(appSessionId);
    if (digest) setDigest({ ...digest, phase: 'working', activity: 'Continuing', pendingRequests: Math.max(0, digest.pendingRequests - 1) });
    const status = statuses.get(appSessionId);
    if (status) setStatus({ ...status, engineState: 'running', pendingRequests: Math.max(0, status.pendingRequests - 1) });
    return { outcome: 'delivered' };
  }

  const control: ScenarioControl = {
    now: () => (clock.kind === 'manual' ? elapsed : Math.max(0, wallNow() - startedAt)),
    advanceTo,
  };

  return {
    ...control,
    start(w) {
      writer = w;
      const loaded = typeof scenario === 'string' ? loadScenario(scenario, wallNow()) : scenario;
      timeline = loaded.timeline;
      const s = (store = new StubStore(loaded.projects, loaded.sessions, iso));
      s.onChange((change) => {
        if (change.kind === 'removed') {
          emit('session.removed', { appSessionId: change.appSessionId, revision: change.revision });
          return;
        }
        w.observeRecord(change.record);
        emit('session.changed', { record: change.record, cause: change.cause, revision: change.revision });
      });

      loading = true;
      for (const p of loaded.projects) w.observeProject(p);
      for (const r of loaded.sessions) w.observeRecord(r);
      for (const d of loaded.digests) setDigest(d);
      for (const status of loaded.engine) setStatus(status);
      for (const a of loaded.attention) setAttention(a.appSessionId, a.items, a.requests);
      loading = false;

      const disposers = [
        deps.intercept('session.list', (input) => s.list(input)),
        deps.intercept('session.get', ({ appSessionId }) => s.get(appSessionId as AppSessionId)),
        deps.intercept('session.update', (input) => s.update(input.appSessionId as AppSessionId, input.patch as SessionPatch)),
        deps.intercept('session.projects.list', () => s.projectsList()),
        deps.intercept('attention.list', () => [...attention.values()].flat().filter((i) => OPEN.has(i.state))),
        deps.intercept('attention.request', ({ appSessionId, requestId }) => ({ event: requests.get(requestKey(appSessionId, requestId)) ?? null })),
        deps.intercept('session.answer', ({ appSessionId, requestId }) => answer(appSessionId as AppSessionId, requestId)),
        // C6: a stub session has no journal and no transcript, so its history is empty (the transcript hydrates to
        // nothing rather than to the load-failure banner); an id the stub does not hold is refused as C4 refuses it.
        deps.intercept('session.events', ({ appSessionId }) => {
          if (!s.get(appSessionId as AppSessionId)) throw new Error(`unknown app session: ${appSessionId}`);
          return { events: [], lastSeq: 0, complete: true };
        }),
        // end C6
      ];
      // C12: a scenario that scripts the memory budget answers engine.budget itself (the last state played, or its first
      // state before any has played); one that does not leaves the command to the engine host
      const firstBudget = timeline.find((op) => op.op === 'budget');
      if (firstBudget) disposers.push(deps.intercept('engine.budget', () => budget ?? firstBudget.state));

      const timers: ReturnType<typeof setTimeout>[] = [];
      if (clock.kind === 'manual') {
        globalThis.__maws_scenario = control;
      } else {
        startedAt = wallNow();
        const offsets = [...new Set(timeline.map((op) => op.at))];
        for (const at of offsets) timers.push(setTimeout(() => advanceTo(at), at));
      }

      return () => {
        for (const timer of timers) clearTimeout(timer);
        for (const dispose of disposers) dispose();
        if (globalThis.__maws_scenario === control) delete globalThis.__maws_scenario;
        writer = null;
      };
    },
    onSetVisible(appSessionId, visible) {
      if (visible) costAtSeen.set(appSessionId, digests.get(appSessionId)?.cost?.totalUsd ?? 0);
      store?.setVisible(appSessionId, visible);
    },
  };
}
