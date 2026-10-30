// Main's attention service (charter §4.6; C3 execution document, Interfaces "Broker", M5; ruling 1 of the wave-2
// ledger): the one Needs-you list per session. The engine host's broker sends its items whole (`session.brokerItems`);
// this service keeps the ones still waiting on the human (pending and delivered: a confirmed item is one the engine
// moved past) and derives the other kinds from what the host emits: `error` from a failed turn (an error result or a
// hard-failure terminal reason, SPEC 45.25.4's set) or a failed background task, `auto_mode_unavailable` from a tool
// result denied that way, `interrupted` from an exit that lost approvals (the summary string is the contract), and
// `held_peer_message` from the status's held messages. Error-like items retire when the session's next human turn
// starts (a prompt read back from disk included) or the session is stopped, each retiring what came before it; an archive (`session.forgotten`, or an
// archive exit) retires everything. The owner's ruling (2026-10-30; it replaces E11 F2b's "ended with an error" fact):
// an `error` is raised only when it is newer than the last time the session was seen (`seenAt`, the unread rule's
// last-seen mark), and it retires for good once the session is seen after it (`seen`) or the item is acknowledged
// (`attention.acknowledge`, seen in the composer or dismissed); a turn that failed on an API error reads in the engine's
// own words, the API error's text. Each change
// is persisted through the AttentionStore (a failed write is owed and retried, never taken as saved)
// and emitted whole as `attention.changed`; `attention.list` and `attention.request` are answered here, the latter by
// asking the engine host for the item's originating request event (`session.pendingRequest`).
// P2-C (2026-10-09; the P2-C document, Design §5): a third list per session, the owner channel's `async_input` and
// `essential_unread` items (`setOwnerItems`), a projection of its marks table: never restored from this store (the owner
// channel re-projects at start), retired by no turn, and silent when the owner channel says so (`restoredIds`).
// P5 O9 M6: a fourth list, a local terminal session's requests from the spine's lane A driver (`setLaneAItems`,
// src/services/lane-a/attention.ts), each with the request view `attention.request` answers for it; a live projection like
// the owner channel's, never restored (the bridge re-raises what is still pending), and untouched by the engine host,
// which holds none of them.
import type { AttentionItem } from '@shared/graph/attention';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId, AttentionId, RequestId, TaskId, ToolUseId } from '@shared/graph/ids';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { CommandInput, CommandName, CommandOutput, EventName, EventPayload } from '@shared/ipc/schema';
import { messageLine, previewLine } from '@shared/owner/preview';
import type { AttentionStore } from './store';
import type { Settling } from '../work'; // P5 O3-D M2
import type { HostSupervisor } from '@shared/host/host-supervisor';

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
// The ruling (2026-10-30): a turn that ended on an API error says what the engine said, the text of its API error
// envelope (`apiError`, the main conversation's last assistant message when it is one; on disk the only place the text
// is), else the result's text the engine sends live with `terminal_reason: 'api_error'`; any other failure keeps its words.
function turnErrorSummary(event: Extract<SessionEvent, { kind: 'turn.ended' }>, apiError: string | null): string {
  const engineWords = apiError ?? (event.terminalReason === 'api_error' && event.resultText !== null ? messageLine(event.resultText, SUMMARY_MAX) : null);
  return engineWords ?? failedTurnSummary(event.result, event.terminalReason, event.errors[0]);
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
  emit: <N extends EventName>(name: N, payload: EventPayload<N>) => unknown; // the services bus's validated emit to every client
  register: <N extends CommandName>(name: N, handler: (input: CommandInput<N>) => CommandOutput<N> | Promise<CommandOutput<N>>) => void; // the services bus's register
  log?: (message: string) => void;
  // The ruling (2026-10-30): the last time the session was seen, in ms; Infinity while a client shows it, null when MAWS
  // never has. An error raised at or before it was seen and is not raised. Absent: every error is unseen.
  seenAt?: (appSessionId: AppSessionId) => number | null;
}

export interface AttentionService {
  readonly restoredIds: ReadonlySet<AttentionId>; // accepted persisted items, marked before their change is emitted
  readonly ready: Promise<void>; // the persisted items are loaded (pending while every load attempt fails)
  list(): AttentionItem[];
  // P2-C (2026-10-09): the owner channel's items for a session, whole (replacing its last projection); `silent` ids join
  // `restoredIds` before the change is emitted, so the notifier announces none of them. Taken as given: the producer
  // supplies a live, archive-aware projection (empty while the session is archived, its items again once unarchived).
  setOwnerItems(appSessionId: AppSessionId, items: AttentionItem[], silent: readonly AttentionId[]): void;
  // P5 O9 M6: the session's lane A items whole (replacing the last), each with its request view.
  setLaneAItems(appSessionId: AppSessionId, entries: readonly { item: AttentionItem; request: SessionEvent }[]): void;
  // The session was seen up to `at` (ms; its last-seen mark moved): its errors raised at or before then retire for good.
  seen(appSessionId: AppSessionId, at: number): void;
  settled(): Promise<void>; // every change so far has reached the store
  // P5 O3-D M2 (Interfaces §A, D27): a write pass is queued or running once the persisted items are read (what the root's
  // `settled` waits for before a release; a pass owed before the load writes nothing until it, and `stop` writes nothing
  // then either), and its settling, which never rejects
  readonly writing: Settling;
  stop(): void;
}

interface SessionState {
  broker: AttentionItem[];
  derived: Map<string, AttentionItem>;
  owner: AttentionItem[]; // P2-C: the owner channel's projection
  laneA: { item: AttentionItem; request: SessionEvent }[]; // P5 O9 M6
  signature: string;
  // retired live since this run started, per kind: the moment (ms) before which a persisted item of the kind stays retired
  retiredBefore: Map<AttentionItem['kind'], number>;
  apiError: string | null; // the main conversation's last assistant message, when it is the engine's API error envelope: its text
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
    if (!state) sessions.set(id, (state = { broker: [], derived: new Map(), owner: [], laneA: [], signature: '[]', retiredBefore: new Map(), apiError: null }));
    return state;
  };
  const merged = (state: SessionState): AttentionItem[] => [...state.broker, ...state.derived.values(), ...state.owner, ...state.laneA.map((e) => e.item)];

  // Persistence (M5 review): the sessions whose stored list is behind the in-memory one, written in order; a failed
  // write stays owed, is retried with the next change and after PERSIST_RETRY_MS, and makes settled() reject until a
  // write succeeds. The in-memory lists keep serving attention.list and attention.changed meanwhile. P5 O3-C M5: a root
  // stops the service and then closes its store in one synchronous pass, so `stop` writes what is still owed itself and
  // nothing queued runs or is retried after it.
  const owed = new Map<AppSessionId, 'replace' | 'retire'>();
  let stopped = false;
  // No write before the persisted items were read: a live write would replace a session's stored list first.
  let loadFinished!: () => void;
  let writes: Promise<void> = new Promise((resolve) => (loadFinished = resolve));
  let failure: unknown = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  const write = (id: AppSessionId, op: 'replace' | 'retire') =>
    op === 'retire' ? deps.store.retireForSession(id) : deps.store.replaceForSession(id, merged(sessions.get(id) ?? stateOf(id)));
  let passes = 0; // P5 O3-D M2: write passes queued or running
  const writeOwed = () => {
    passes += 1;
    writes = writes.then(async () => {
      try {
        await writePass();
      } finally {
        passes -= 1;
      }
    });
  };
  const writePass = async () => {
    for (const [id, op] of [...owed]) {
      if (stopped) return; // the stop wrote what was owed
      owed.delete(id);
      try {
        await write(id, op);
      } catch (error) {
        if (!owed.has(id)) owed.set(id, op);
        failure = error;
        log(`not persisted (${stopped ? 'stopped' : 'retrying'}): ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (stopped) return;
    if (owed.size === 0) failure = null;
    else if (retryTimer === null) {
      retryTimer = setTimeout(() => {
        retryTimer = null;
        writeOwed();
      }, PERSIST_RETRY_MS);
      (retryTimer as { unref?: () => void }).unref?.();
    }
  };

  // P5 O3-D (D13): the restored ids among a change's items travel on it, so a reader in another process hears them in band
  const silentOf = (items: readonly AttentionItem[]): AttentionId[] => items.flatMap((item) => (restoredIds.has(item.id) ? [item.id] : []));

  // After any change: emit and persist the session's whole list when it differs from the last one.
  const changed = (id: AppSessionId, state: SessionState) => {
    const items = merged(state);
    const signature = JSON.stringify(items);
    if (signature === state.signature) return;
    state.signature = signature;
    deps.emit('attention.changed', { appSessionId: id, items, silent: silentOf(items) });
    owed.set(id, 'replace');
    writeOwed();
  };

  // An archive (or a forget): nothing of the session needs anyone.
  const retireSession = (id: AppSessionId) => {
    sessions.delete(id);
    forgotten.add(id);
    deps.emit('attention.changed', { appSessionId: id, items: [], silent: [] });
    owed.set(id, 'retire');
    writeOwed();
  };

  // The ruling (2026-10-30): an error at or before the session's last look was seen there.
  const seenThere = (id: AppSessionId, item: Pick<AttentionItem, 'kind' | 'createdAt'>) => {
    const at = item.kind === 'error' ? (deps.seenAt?.(id) ?? null) : null;
    return at !== null && Date.parse(item.createdAt) <= at;
  };
  const retired = (item: AttentionItem): AttentionItem => ({ ...item, state: 'retired', stateChangedAt: new Date().toISOString() });

  const derive = (id: AppSessionId, state: SessionState, key: string, fields: Pick<AttentionItem, 'kind' | 'summary' | 'sessionId' | 'createdAt'> & Partial<AttentionItem>) => {
    const itemId = `${id}:${fields.kind}:${key}` as AttentionId;
    if (state.derived.has(itemId) || seenThere(id, fields)) return;
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
          state.apiError = null;
          if (humanTurn(event.origin)) retireDerived(state, RETIRED_BY_NEXT_TURN, cutoffOf(event));
          break;
        case 'assistant.block.complete': {
          const text = event.isApiErrorMessage === true && typeof event.block.text === 'string' ? event.block.text : null;
          state.apiError = text === null ? null : messageLine(text, SUMMARY_MAX);
          break;
        }
        case 'turn.ended': {
          const apiError = state.apiError;
          if (!event.isEchoReceipt) state.apiError = null;
          // a user abort is not a failure: the wire marks every abort is_error: true (M6 review; pass3/plan-outcomes seq 510)
          if (event.isEchoReceipt || event.terminalReason?.startsWith('aborted_') || !(event.isError || HARD_FAILURE_REASONS.has(event.terminalReason ?? ''))) break;
          derive(id, state, event.id, { ...base, kind: 'error', summary: turnErrorSummary(event, apiError) });
          break;
        }
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
  // An error seen in its opened session (the composer's dwell, E11 F2b) or dismissed: retired either way (the ruling of
  // 2026-10-30: no "ended with an error" stays behind), and never back.
  deps.register('attention.acknowledge', ({ appSessionId, attentionId }) => {
    const state = sessions.get(appSessionId as AppSessionId);
    const target = state?.derived.get(attentionId);
    if (!state || target?.kind !== 'error' || target.state === 'retired') return;
    state.derived.set(target.id, retired(target));
    changed(appSessionId as AppSessionId, state);
  });
  // The session's last-seen mark moved to `at`: what it showed at or before then was seen.
  const seen = (id: AppSessionId, at: number) => {
    const state = sessions.get(id);
    if (!state) return;
    for (const item of state.derived.values()) if (item.kind === 'error' && item.state !== 'retired' && Date.parse(item.createdAt) <= at) state.derived.set(item.id, retired(item));
    changed(id, state);
  };
  deps.register('attention.request', async ({ appSessionId, requestId }) => {
    const laneA = sessions.get(appSessionId as AppSessionId)?.laneA.find((e) => e.item.request.requestId === (requestId as RequestId)); // P5 O9 M6
    if (laneA) return { event: laneA.request };
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
        let item = inWords(stored);
        if (BROKER_KINDS.has(item.kind) || OWNER_KINDS.has(item.kind) || item.kind === 'held_peer_message' || retiredByThisRun(state, item)) continue;
        // the ruling (2026-10-30): an error seen since (or confirmed, E11 F2b's seen, before the ruling) is retired
        if (item.kind === 'error' && item.state !== 'retired' && (item.state === 'confirmed' || seenThere(id, item))) item = retired(item);
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
  // Not held back for an archived session (F-AB): the items are a live projection, never restored from the store, and
  // the owner channel projects none while the record is archived, so a non-empty list means the session was unarchived.
  const setOwnerItems = (id: AppSessionId, items: AttentionItem[], silent: readonly AttentionId[]) => {
    for (const itemId of silent) restoredIds.add(itemId);
    const state = stateOf(id);
    state.owner = items;
    changed(id, state);
  };
  // P2-C end

  // P5 O9 M6: a live projection, as the owner channel's
  const setLaneAItems = (id: AppSessionId, entries: readonly { item: AttentionItem; request: SessionEvent }[]) => {
    const state = stateOf(id);
    state.laneA = [...entries];
    changed(id, state);
  };

  return {
    ready,
    restoredIds,
    list,
    setOwnerItems, // P2-C
    setLaneAItems, // P5 O9 M6
    seen,
    settled: async () => {
      await attempt;
      if (!loadedOk) throw loadError;
      await writes;
      if (failure !== null) throw failure;
    },
    writing: {
      busy: () => loadedOk && passes > 0,
      settled: () => (loadedOk ? writes.catch(() => {}) : Promise.resolve()),
    },
    stop: () => {
      stopped = true;
      if (loadTimer !== null) clearTimeout(loadTimer);
      loadTimer = null;
      unsubscribe.forEach((off) => off());
      if (retryTimer !== null) clearTimeout(retryTimer);
      retryTimer = null;
      // What is still owed, written now, in order, while the store is open (the index store writes synchronously);
      // nothing before the persisted items were read
      if (!loadedOk) return;
      for (const [id, op] of [...owed]) {
        owed.delete(id);
        write(id, op).catch((error: unknown) => log(`not persisted (stopped): ${error instanceof Error ? error.message : String(error)}`));
      }
    },
  };
}
