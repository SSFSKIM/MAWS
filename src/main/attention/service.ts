// Main's attention service (charter §4.6; C3 execution document, Interfaces "Broker", M5; ruling 1 of the wave-2
// ledger): the one Needs-you list per session. The engine host's broker sends its items whole (`session.brokerItems`);
// this service keeps the ones still waiting on the human (pending and delivered: a confirmed item is one the engine
// moved past) and derives the other kinds from what the host emits: `error` from a failed turn (an error result or a
// hard-failure terminal reason, SPEC 45.25.4's set) or a failed background task, `auto_mode_unavailable` from a tool
// result denied that way, `interrupted` from an exit that lost approvals (the summary string is the contract), and
// `held_peer_message` from the status's held messages. Error-like items retire when the session's next human turn
// starts or the session is stopped; an archive retires everything. Each change is persisted through the AttentionStore
// and emitted whole as `attention.changed`; `attention.list` and `attention.request` are answered here, the latter by
// asking the engine host for the item's originating request event (`session.pendingRequest`).
import type { AttentionItem } from '@shared/graph/attention';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId, AttentionId, RequestId, TaskId, ToolUseId } from '@shared/graph/ids';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { CommandInput, CommandName, CommandOutput, EventName, EventPayload } from '@shared/ipc/schema';
import type { AttentionStore } from './store';

// SPEC 45.25.4 `qpn`: the terminal reasons that are hard failures (an interrupt is not one).
export const HARD_FAILURE_REASONS: ReadonlySet<string> = new Set([
  'blocking_limit', 'rapid_refill_breaker', 'prompt_too_long', 'image_error', 'model_error', 'api_error',
  'malformed_tool_use_exhausted', 'budget_exhausted', 'structured_output_retry_exhausted', 'tool_deferred_unavailable', 'turn_setup_failed',
]);
const BROKER_KINDS: ReadonlySet<AttentionItem['kind']> = new Set(['permission', 'question', 'plan', 'dialog', 'elicitation']);
const RETIRED_BY_NEXT_TURN: ReadonlySet<AttentionItem['kind']> = new Set(['error', 'interrupted', 'auto_mode_unavailable']);

export const interruptedSummary = (n: number) => `Session interrupted, ${n} ${n === 1 ? 'approval' : 'approvals'} lost`; // the contract (§4.6)

type Dispatch = (owner: 'engine-host', name: 'session.pendingRequest', input: CommandInput<'session.pendingRequest'>) => Promise<{ ok: true; value: unknown } | { ok: false; error: { message: string } }>;

export interface AttentionServiceDeps {
  onEvent: <N extends EventName>(name: N, listener: (payload: EventPayload<N>) => void) => () => void; // HostSupervisor.onEvent
  dispatch: Dispatch; // HostSupervisor.dispatch
  store: AttentionStore;
  emit: <N extends EventName>(name: N, payload: EventPayload<N>) => unknown; // main's validated emit to the renderer
  register: <N extends CommandName>(name: N, handler: (input: CommandInput<N>) => CommandOutput<N> | Promise<CommandOutput<N>>) => void; // registerMainHandler
  log?: (message: string) => void;
}

export interface AttentionService {
  readonly ready: Promise<void>; // the persisted items are loaded
  list(): AttentionItem[];
  settled(): Promise<void>; // every change so far has reached the store
  stop(): void;
}

interface SessionState {
  broker: AttentionItem[];
  derived: Map<string, AttentionItem>;
  signature: string;
}

const noRequest = { requestId: null, toolUseId: null, taskId: null, agentId: null };

export function startAttentionService(deps: AttentionServiceDeps): AttentionService {
  const log = deps.log ?? ((message: string) => console.warn(`[attention] ${message}`));
  const sessions = new Map<AppSessionId, SessionState>();
  let writes: Promise<void> = Promise.resolve();

  const stateOf = (id: AppSessionId): SessionState => {
    let state = sessions.get(id);
    if (!state) sessions.set(id, (state = { broker: [], derived: new Map(), signature: '[]' }));
    return state;
  };
  const merged = (state: SessionState): AttentionItem[] => [...state.broker, ...state.derived.values()];
  const persist = (op: () => Promise<void>) => {
    writes = writes.then(op).catch((error: unknown) => log(`not persisted: ${error instanceof Error ? error.message : String(error)}`));
  };

  // After any change: emit and persist the session's whole list when it differs from the last one.
  const changed = (id: AppSessionId, state: SessionState) => {
    const items = merged(state);
    const signature = JSON.stringify(items);
    if (signature === state.signature) return;
    state.signature = signature;
    deps.emit('attention.changed', { appSessionId: id, items });
    persist(() => deps.store.replaceForSession(id, items));
  };

  const derive = (id: AppSessionId, state: SessionState, key: string, fields: Pick<AttentionItem, 'kind' | 'summary' | 'sessionId' | 'createdAt'> & Partial<AttentionItem>) => {
    const itemId = `${id}:${fields.kind}:${key}` as AttentionId;
    if (state.derived.has(itemId)) return;
    state.derived.set(itemId, { id: itemId, appSessionId: id, request: noRequest, state: 'pending', stateChangedAt: fields.createdAt, expiresAt: null, ...fields });
  };
  const retireDerived = (state: SessionState, kinds: ReadonlySet<AttentionItem['kind']>) => {
    for (const [itemId, item] of state.derived) if (kinds.has(item.kind)) state.derived.delete(itemId);
  };

  const onEvents = (id: AppSessionId, events: SessionEvent[]) => {
    const state = stateOf(id);
    for (const event of events) {
      if (event.parentToolUseId !== null && event.kind !== 'tool.result') continue; // turns are the main conversation's
      const base = { sessionId: event.sessionId, createdAt: event.at };
      switch (event.kind) {
        case 'turn.started':
          if (event.origin === 'human') retireDerived(state, RETIRED_BY_NEXT_TURN);
          break;
        case 'turn.ended':
          if (event.isEchoReceipt || !(event.isError || HARD_FAILURE_REASONS.has(event.terminalReason ?? ''))) break;
          derive(id, state, event.id, { ...base, kind: 'error', summary: `Turn failed: ${event.terminalReason ?? event.result}${event.errors[0] ? ` (${event.errors[0]})` : ''}` });
          break;
        case 'task.notification':
          if (event.status === 'failed') derive(id, state, event.id, { ...base, kind: 'error', summary: `Background task failed: ${event.summary}`, request: { ...noRequest, taskId: event.taskId as TaskId } });
          break;
        case 'tool.result':
          if (event.denial === 'automode-unavailable') {
            derive(id, state, event.toolUseId, { ...base, kind: 'auto_mode_unavailable', summary: 'Auto mode unavailable: switch out of auto mode to continue', request: { ...noRequest, toolUseId: event.toolUseId as ToolUseId } });
          }
          break;
        case 'process.exited':
          if (event.reason === 'archive') {
            sessions.delete(id);
            deps.emit('attention.changed', { appSessionId: id, items: [] });
            persist(() => deps.store.retireForSession(id));
            return;
          }
          state.broker = []; // the broker retired its items at the exit; a held message cannot be released by a dead process
          retireDerived(state, new Set(['held_peer_message']));
          if (event.reason === 'stop') retireDerived(state, RETIRED_BY_NEXT_TURN);
          if (event.lostAttentionCount > 0) derive(id, state, event.id, { ...base, kind: 'interrupted', summary: interruptedSummary(event.lostAttentionCount) });
          break;
      }
    }
    changed(id, state);
  };

  const onHeld = (id: AppSessionId, status: EngineSessionStatus) => {
    if (status.process === 'exited') return; // the exit retired them; a late exited status must not re-derive any (M5 review)
    const state = stateOf(id);
    const keep = new Set<string>();
    for (const held of status.heldPeerMessages) {
      const key = held.messageUuid ?? `${held.from}:${held.lane}`;
      keep.add(`${id}:held_peer_message:${key}`);
      derive(id, state, key, { kind: 'held_peer_message', summary: `Held message from ${held.fromName ?? held.from}`, sessionId: status.engineSessionId, createdAt: held.heldAt, expiresAt: held.expiresAt });
    }
    for (const [itemId, item] of state.derived) if (item.kind === 'held_peer_message' && !keep.has(itemId)) state.derived.delete(itemId);
    changed(id, state);
  };

  const unsubscribe = [
    deps.onEvent('session.brokerItems', ({ appSessionId, items }) => {
      const state = stateOf(appSessionId);
      state.broker = items.filter((item) => item.state === 'pending' || item.state === 'delivered');
      changed(appSessionId, state);
    }),
    deps.onEvent('session.eventBatch', ({ appSessionId, events }) => onEvents(appSessionId, events)),
    deps.onEvent('session.status', ({ appSessionId, status }) => onHeld(appSessionId, status)),
  ];

  const list = () => [...sessions.values()].flatMap(merged);

  deps.register('attention.list', () => list());
  deps.register('attention.request', async ({ appSessionId, requestId }) => {
    const brokered = sessions.get(appSessionId as AppSessionId)?.broker.some((item) => item.request.requestId === (requestId as RequestId));
    if (!brokered) return { event: null };
    const answer = await deps.dispatch('engine-host', 'session.pendingRequest', { appSessionId, requestId });
    if (!answer.ok) throw new Error(answer.error.message);
    return answer.value as CommandOutput<'attention.request'>;
  });

  // The previous run's items: its broker items died with its processes (D-16); what was derived stays until retired.
  const ready = deps.store
    .list()
    .then((persisted) => {
      const loaded = new Map<AppSessionId, AttentionItem[]>();
      for (const item of persisted) loaded.set(item.appSessionId, [...(loaded.get(item.appSessionId) ?? []), item]);
      for (const [id, items] of loaded) {
        if (sessions.has(id)) continue; // this run already spoke for it
        const state = stateOf(id);
        for (const item of items) if (!BROKER_KINDS.has(item.kind)) state.derived.set(item.id, item);
        state.signature = JSON.stringify(items);
        changed(id, state);
      }
    })
    .catch((error: unknown) => log(`persisted items not loaded: ${error instanceof Error ? error.message : String(error)}`));

  return {
    ready,
    list,
    settled: async () => {
      await ready;
      await writes;
    },
    stop: () => unsubscribe.forEach((off) => off()),
  };
}
