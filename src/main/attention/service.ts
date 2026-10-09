// Main's attention service (charter §4.6; C3 execution document, Interfaces "Broker", M5; ruling 1 of the wave-2
// ledger): the one Needs-you list per session. The engine host's broker sends its items whole (`session.brokerItems`);
// this service keeps the ones still waiting on the human (pending and delivered: a confirmed item is one the engine
// moved past) and derives the other kinds from what the host emits: `error` from a failed turn (an error result or a
// hard-failure terminal reason, SPEC 45.25.4's set) or a failed background task, `auto_mode_unavailable` from a tool
// result denied that way, `interrupted` from an exit that lost approvals (the summary string is the contract), and
// `held_peer_message` from the status's held messages. Error-like items retire when the session's next human turn
// starts (a prompt read back from disk included) or the session is stopped, each retiring what came before it; an archive (`session.forgotten`, or an
// archive exit) retires everything. E11 F2b: an error seen in its opened session or dismissed stays as the session's
// "ended with an error" fact, out of Needs you (`attention.acknowledge`). Each change
// is persisted through the AttentionStore (a failed write is owed and retried, never taken as saved)
// and emitted whole as `attention.changed`; `attention.list` and `attention.request` are answered here, the latter by
// asking the engine host for the item's originating request event (`session.pendingRequest`).
// P2-C (2026-10-09; the P2-C document, Design §5): a third list per session, the owner channel's `async_input` and
// `essential_unread` items (`setOwnerItems`), a projection of its marks table: never restored from this store (the owner
// channel re-projects at start), retired by no turn, and silent when the owner channel says so (`restoredIds`).
import type { AttentionItem } from '@shared/graph/attention';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId, AttentionId, RequestId, TaskId, ToolUseId } from '@shared/graph/ids';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { CommandInput, CommandName, CommandOutput, EventName, EventPayload } from '@shared/ipc/schema';
import { previewLine } from '@shared/owner/preview';
import type { AttentionStore } from './store';
import type { HostSupervisor } from '../hosts/supervisor';

// SPEC 45.25.4 `qpn`: the terminal reasons that are hard failures (an interrupt is not one).
export const HARD_FAILURE_REASONS: ReadonlySet<string> = new Set([
  'blocking_limit', 'rapid_refill_breaker', 'prompt_too_long', 'image_error', 'model_error', 'api_error',
  'malformed_tool_use_exhausted', 'budget_exhausted', 'structured_output_retry_exhausted', 'tool_deferred_unavailable', 'turn_setup_failed',
]);
const BROKER_KINDS: ReadonlySet<AttentionItem['kind']> = new Set(['permission', 'question', 'plan', 'dialog', 'elicitation']);
const RETIRED_BY_NEXT_TURN: ReadonlySet<AttentionItem['kind']> = new Set(['error', 'interrupted', 'auto_mode_unavailable']);
// P2-C (2026-10-09; the P2-C document, Design §5): the owner channel's kinds, a projection of its marks table, which it
// re-projects at start; never restored from this service's store, and retired by no turn
const OWNER_KINDS: ReadonlySet<AttentionItem['kind']> = new Set(['async_input', 'essential_unread']);

// E11 F2b (plan 2.4): a failed turn in words. The result's subtype and terminal reason are the engine's codes; the
// summary is what Needs you, the session's notice and a notification read. A limit says which limit stopped the turn;
// anything else ended with an error, with the engine's first error (or a plain reading of a self-explanatory reason)
// beside it.
const STOPPED_AT: Readonly<Record<string, string>> = {
  error_max_turns: 'Stopped at the turn limit',
  max_turns: 'Stopped at the turn limit',
  error_max_budget_usd: 'Stopped at the budget',
  budget_exhausted: 'Stopped at the budget',
};
const REASON_WORDS: Readonly<Record<string, string>> = {
  prompt_too_long: 'the conversation is too long for the model',
  image_error: 'an image could not be read',
};
export function failedTurnSummary(result: string, terminalReason: string | null, firstError: string | undefined): string {
  const stopped = STOPPED_AT[terminalReason ?? ''] ?? STOPPED_AT[result];
  if (stopped) return stopped;
  const detail = firstError ?? REASON_WORDS[terminalReason ?? ''];
  return `The turn ended with an error${detail ? ` (${detail})` : ''}`;
}
// An item persisted before the words: "Turn failed: <code>[ (<first error>)]".
const LEGACY_FAILED = /^Turn failed: (\S+)(?: \((.*)\))?$/;
const inWords = (item: AttentionItem): AttentionItem => {
  const legacy = item.kind === 'error' ? LEGACY_FAILED.exec(item.summary) : null;
  return legacy ? { ...item, summary: failedTurnSummary(legacy[1]!, legacy[1]!, legacy[2]) } : item;
};
// A turn a person started: the live stream's own ('human') and a prompt read back from the transcript on disk, which
// carries no origin (engine-host/fs/backfill.ts: meta records, interrupt markers and command output open no turn; peer
// and task-notification turns say so).
const humanTurn = (origin: string | null) => origin === 'human' || origin === null;

const SUMMARY_MAX = 200; // E11 F2b (plan 2.6): engine text in a summary is its owner-aware preview line

const count = (n: number, noun: string) => `${n} ${n === 1 ? noun : `${noun}s`}`;
// The contract (§4.6); E1: the blocking `maws` asks among the lost are named questions, the rest stay approvals.
export const interruptedSummary = (approvals: number, questions = 0) =>
  `Session interrupted, ${[approvals > 0 || questions === 0 ? count(approvals, 'approval') : null, questions > 0 ? count(questions, 'question') : null].filter((part) => part !== null).join(' and ')} lost`;

type Dispatch = (owner: 'engine-host', name: 'session.pendingRequest', input: CommandInput<'session.pendingRequest'>) => Promise<{ ok: true; value: unknown } | { ok: false; error: { message: string } }>;

export interface AttentionServiceDeps {
  onState: HostSupervisor['onState'];
  onEvent: <N extends EventName>(name: N, listener: (payload: EventPayload<N>) => void) => () => void; // HostSupervisor.onEvent
  dispatch: Dispatch; // HostSupervisor.dispatch
  store: AttentionStore;
  emit: <N extends EventName>(name: N, payload: EventPayload<N>) => unknown; // main's validated emit to the renderer
  register: <N extends CommandName>(name: N, handler: (input: CommandInput<N>) => CommandOutput<N> | Promise<CommandOutput<N>>) => void; // registerMainHandler
  log?: (message: string) => void;
}

export interface AttentionService {
  readonly restoredIds: ReadonlySet<AttentionId>; // accepted persisted items, marked before their change is emitted
  readonly ready: Promise<void>; // the persisted items are loaded (pending while every load attempt fails)
  list(): AttentionItem[];
  // P2-C (2026-10-09): the owner channel's items for a session, whole (replacing its last projection); `silent` ids join
  // `restoredIds` before the change is emitted, so the notifier announces none of them. Ignored for a session archived
  // in this run.
  setOwnerItems(appSessionId: AppSessionId, items: AttentionItem[], silent: readonly AttentionId[]): void;
  settled(): Promise<void>; // every change so far has reached the store
  stop(): void;
}

interface SessionState {
  broker: AttentionItem[];
  derived: Map<string, AttentionItem>;
  owner: AttentionItem[]; // P2-C: the owner channel's projection
  signature: string;
  // retired live since this run started, per kind: the moment (ms) before which a persisted item of the kind stays retired
  retiredBefore: Map<AttentionItem['kind'], number>;
}

export const PERSIST_RETRY_MS = 5_000;

const noRequest = { requestId: null, toolUseId: null, taskId: null, agentId: null };

export function startAttentionService(deps: AttentionServiceDeps): AttentionService {
  const log = deps.log ?? ((message: string) => console.warn(`[attention] ${message}`));
  const restoredIds = new Set<AttentionId>();
  const sessions = new Map<AppSessionId, SessionState>();
  const forgotten = new Set<AppSessionId>(); // archived during this run: nothing persisted may bring them back

  const stateOf = (id: AppSessionId): SessionState => {
    let state = sessions.get(id);
    if (!state) sessions.set(id, (state = { broker: [], derived: new Map(), owner: [], signature: '[]', retiredBefore: new Map() }));
    return state;
  };
  const merged = (state: SessionState): AttentionItem[] => [...state.broker, ...state.derived.values(), ...state.owner];

  // Persistence (M5 review): the sessions whose stored list is behind the in-memory one, written in order; a failed
  // write stays owed, is retried with the next change and after PERSIST_RETRY_MS, and makes settled() reject until a
  // write succeeds. The in-memory lists keep serving attention.list and attention.changed meanwhile.
  const owed = new Map<AppSessionId, 'replace' | 'retire'>();
  // No write before the persisted items were read: a live write would replace a session's stored list first.
  let loadFinished!: () => void;
  let writes: Promise<void> = new Promise((resolve) => (loadFinished = resolve));
  let failure: unknown = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  const writeOwed = () => {
    writes = writes.then(async () => {
      for (const [id, op] of [...owed]) {
        owed.delete(id);
        try {
          if (op === 'retire') await deps.store.retireForSession(id);
          else await deps.store.replaceForSession(id, merged(sessions.get(id) ?? stateOf(id)));
        } catch (error) {
          if (!owed.has(id)) owed.set(id, op);
          failure = error;
          log(`not persisted (retrying): ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (owed.size === 0) failure = null;
      else if (retryTimer === null) {
        retryTimer = setTimeout(() => {
          retryTimer = null;
          writeOwed();
        }, PERSIST_RETRY_MS);
        (retryTimer as { unref?: () => void }).unref?.();
      }
    });
  };

  // After any change: emit and persist the session's whole list when it differs from the last one.
  const changed = (id: AppSessionId, state: SessionState) => {
    const items = merged(state);
    const signature = JSON.stringify(items);
    if (signature === state.signature) return;
    state.signature = signature;
    deps.emit('attention.changed', { appSessionId: id, items });
    owed.set(id, 'replace');
    writeOwed();
  };

  // An archive (or a forget): nothing of the session needs anyone.
  const retireSession = (id: AppSessionId) => {
    sessions.delete(id);
    forgotten.add(id);
    deps.emit('attention.changed', { appSessionId: id, items: [] });
    owed.set(id, 'retire');
    writeOwed();
  };

  const derive = (id: AppSessionId, state: SessionState, key: string, fields: Pick<AttentionItem, 'kind' | 'summary' | 'sessionId' | 'createdAt'> & Partial<AttentionItem>) => {
    const itemId = `${id}:${fields.kind}:${key}` as AttentionId;
    if (state.derived.has(itemId)) return;
    state.derived.set(itemId, { id: itemId, appSessionId: id, request: noRequest, state: 'pending', stateChangedAt: fields.createdAt, expiresAt: null, ...fields });
  };
  // F2b review 1: a turn or a stop read back from the transcript (`seq: null`, a fresh follower's backfill replaying every
  // old prompt as a null-origin turn.started at its record's timestamp) retires only what was raised before its `at`, so
  // the failed turn's own replayed prompt does not retire, and so re-raise, the failure that turn ended with. A live one
  // comes after everything derived so far in stream order and retires it all: its `at` is its journal row's
  // millisecond, which a queued prompt right after a failed result can share (residue of the review).
  const cutoffOf = (event: SessionEvent): string | null => (event.seq === null ? event.at : null);
  const retireDerived = (state: SessionState, kinds: ReadonlySet<AttentionItem['kind']>, at: string | null = null) => {
    const before = at === null ? Infinity : Date.parse(at);
    for (const kind of kinds) state.retiredBefore.set(kind, Math.max(before, state.retiredBefore.get(kind) ?? -Infinity));
    for (const [itemId, item] of state.derived) if (kinds.has(item.kind) && Date.parse(item.createdAt) < before) state.derived.delete(itemId);
  };
  const retiredByThisRun = (state: SessionState, item: AttentionItem) => Date.parse(item.createdAt) < (state.retiredBefore.get(item.kind) ?? -Infinity);

  const onEvents = (id: AppSessionId, events: SessionEvent[]) => {
    const state = stateOf(id);
    for (const event of events) {
      if (event.parentToolUseId !== null && event.kind !== 'tool.result') continue; // turns are the main conversation's
      const base = { sessionId: event.sessionId, createdAt: event.at };
      switch (event.kind) {
        case 'turn.started':
          if (humanTurn(event.origin)) retireDerived(state, RETIRED_BY_NEXT_TURN, cutoffOf(event));
          break;
        case 'turn.ended':
          // a user abort is not a failure: the wire marks every abort is_error: true (M6 review; pass3/plan-outcomes seq 510)
          if (event.isEchoReceipt || event.terminalReason?.startsWith('aborted_') || !(event.isError || HARD_FAILURE_REASONS.has(event.terminalReason ?? ''))) break;
          derive(id, state, event.id, { ...base, kind: 'error', summary: failedTurnSummary(event.result, event.terminalReason, event.errors[0]) });
          break;
        case 'task.notification':
          if (event.status === 'failed') derive(id, state, event.id, { ...base, kind: 'error', summary: `Background task failed: ${previewLine(event.summary, SUMMARY_MAX) ?? ''}`.trimEnd(), request: { ...noRequest, taskId: event.taskId as TaskId } });
          break;
        case 'tool.result':
          if (event.denial === 'automode-unavailable') {
            derive(id, state, event.toolUseId, { ...base, kind: 'auto_mode_unavailable', summary: 'Auto mode unavailable: switch out of auto mode to continue', request: { ...noRequest, toolUseId: event.toolUseId as ToolUseId } });
          }
          break;
        case 'process.exited':
          if (event.reason === 'archive') {
            retireSession(id);
            return;
          }
          state.broker = []; // the broker retired its items at the exit; a held message cannot be released by a dead process
          retireDerived(state, new Set(['held_peer_message']));
          if (event.reason === 'stop') retireDerived(state, RETIRED_BY_NEXT_TURN, cutoffOf(event));
          if (event.lostAttentionCount > 0) {
            const questions = event.lostAskCount ?? 0; // E1: the blocking asks among them
            derive(id, state, event.id, { ...base, kind: 'interrupted', summary: interruptedSummary(event.lostAttentionCount - questions, questions) });
          }
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
    deps.onEvent('session.forgotten', ({ appSessionId }) => retireSession(appSessionId)),
    deps.onState('engine-host', (host) => {
      if (host.state === 'ready') return;
      // A dead host cannot retire its broker or release held messages. Durable errors stay.
      for (const [id, state] of sessions) {
        state.broker = [];
        retireDerived(state, new Set(['held_peer_message']));
        changed(id, state);
      }
    }),
  ];

  const list = () => [...sessions.values()].flatMap(merged);

  deps.register('attention.list', () => list());
  // E11 F2b (owner decision 1): seen in the opened session (confirmed: out of Needs you, its notice still shown there),
  // or dismissed (retired). An error only, and never back: a dismissed item is not made seen again.
  deps.register('attention.acknowledge', ({ appSessionId, attentionId, how }) => {
    const state = sessions.get(appSessionId as AppSessionId);
    const target = state?.derived.get(attentionId);
    if (!state || target?.kind !== 'error') return;
    const next = how === 'dismissed' ? 'retired' : 'confirmed';
    if (target.state === next || target.state === 'retired') return;
    state.derived.set(target.id, { ...target, state: next, stateChangedAt: new Date().toISOString() });
    changed(appSessionId as AppSessionId, state);
  });
  deps.register('attention.request', async ({ appSessionId, requestId }) => {
    const brokered = sessions.get(appSessionId as AppSessionId)?.broker.some((item) => item.request.requestId === (requestId as RequestId));
    if (!brokered) return { event: null };
    const answer = await deps.dispatch('engine-host', 'session.pendingRequest', { appSessionId, requestId });
    if (!answer.ok) throw new Error(answer.error.message);
    return answer.value as CommandOutput<'attention.request'>;
  });

  // The previous run's items, merged with what this run already knows (M5 review): its broker and held-message items
  // died with its processes (D-16); a derived item stays unless this run retired its kind after it was raised or the session was archived.
  const merge = (persisted: AttentionItem[]) => {
    const loaded = new Map<AppSessionId, AttentionItem[]>();
    for (const item of persisted) loaded.set(item.appSessionId, [...(loaded.get(item.appSessionId) ?? []), item]);
    for (const [id, items] of loaded) {
      if (forgotten.has(id)) continue;
      const state = stateOf(id);
      for (const stored of items) {
        const item = inWords(stored);
        if (BROKER_KINDS.has(item.kind) || OWNER_KINDS.has(item.kind) || item.kind === 'held_peer_message' || retiredByThisRun(state, item)) continue;
        // a failure the transcript replayed before the load is the same occurrence: the stored acknowledgement stands
        const live = state.derived.get(item.id);
        if (live && !(live.state === 'pending' && item.state !== 'pending')) continue;
        restoredIds.add(item.id);
        state.derived.set(item.id, item);
      }
      if (JSON.stringify(merged(state)) !== JSON.stringify(items)) owed.set(id, 'replace'); // the store holds what was dropped
      changed(id, state);
      writeOwed();
    }
  };

  // The load (M5 re-review): retried at once after a failure, then every PERSIST_RETRY_MS; until one succeeds no write
  // reaches the store (a live write would replace a list nobody read) and settled() rejects with the load's error.
  let loadedOk = false;
  let loadError: unknown = null;
  let loadTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let markReady!: () => void;
  const ready = new Promise<void>((resolve) => (markReady = resolve));
  let attempt: Promise<void> = Promise.resolve();
  const load = (retryNow: boolean) => {
    attempt = deps.store.list().then(
      (persisted) => {
        loadedOk = true;
        loadError = null;
        loadFinished(); // queued writes may go now, after the merge below queued its own
        merge(persisted);
        markReady();
      },
      (error: unknown) => {
        loadError = error;
        log(`persisted items not loaded (retrying): ${error instanceof Error ? error.message : String(error)}`);
        if (stopped) return;
        if (retryNow) return load(false);
        loadTimer = setTimeout(() => {
          loadTimer = null;
          load(false);
        }, PERSIST_RETRY_MS);
        (loadTimer as { unref?: () => void }).unref?.();
      },
    );
    return attempt;
  };
  void load(true);

  // P2-C start (2026-10-09)
  const setOwnerItems = (id: AppSessionId, items: AttentionItem[], silent: readonly AttentionId[]) => {
    if (forgotten.has(id)) return;
    for (const itemId of silent) restoredIds.add(itemId);
    const state = stateOf(id);
    state.owner = items;
    changed(id, state);
  };
  // P2-C end

  return {
    ready,
    restoredIds,
    list,
    setOwnerItems, // P2-C
    settled: async () => {
      await attempt;
      if (!loadedOk) throw loadError;
      await writes;
      if (failure !== null) throw failure;
    },
    stop: () => {
      stopped = true;
      if (loadTimer !== null) clearTimeout(loadTimer);
      loadTimer = null;
      unsubscribe.forEach((off) => off());
      if (retryTimer !== null) clearTimeout(retryTimer);
      retryTimer = null;
    },
  };
}
