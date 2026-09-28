// applyEvents: X1 events → TranscriptState, incrementally (C6 execution document, Derivation; residue *Derivation
// architecture*). One TurnState per turn, copy-on-write per batch so untouched turns are shared between states; a
// turn's `version` bumps on every structural change and derive.ts memoises rows on it. Only events that change what
// the transcript shows are retained on a turn (the journal keeps the rest, reachable by `seq`); every applied event
// id lands in `seen`, which is the hydration deduplication and the retraction index.
import type { SessionEvent } from '@shared/graph/events';
import type { AgentId, ApiMessageId, EventId, MessageUuid, RequestId, SessionId, TaskId, ToolUseId } from '@shared/graph/ids';
import { toolUseOf } from '@shared/graph/ids';
import { rowId, turnId as turnIdOf } from './keys';
import type { Row, RowId, Spill, TurnId } from './rows';
import { isInterruptionMarker, isLocalCommand } from './user-text';

type Event<K extends SessionEvent['kind']> = Extract<SessionEvent, { kind: K }>;

export interface LiveBlock {
  apiMessageId: ApiMessageId | null;
  blockIndex: number;
  blockType: 'text' | 'thinking' | 'tool_use';
  buffer: string;
  rowId: RowId;
  completed: boolean;
  // Additive to the X3 definition: how derive.ts places the row and fills its static fields once the block completes.
  markerEventId: EventId | null; // the first delta's event, kept in `events` as the row's position; null when the block never streamed
  completeEventId: EventId | null;
  completedAt: string | null;
  messageUuid: MessageUuid | null;
  model: string | null;
}

export interface TurnState {
  id: TurnId;
  origin: 'human' | 'engine';
  state: 'open' | 'closed';
  startedAt: string;
  endedAt: string | null;
  events: SessionEvent[]; // top-level events of this turn in arrival order (child events are indexed, not listed)
  children: Map<ToolUseId, SessionEvent[]>; // child-agent events by parent tool use, for subagent row updates and drill-in seeding
  live: Map<string, LiveBlock>; // keyed by block identity `<apiMessageId>:<blockIndex>`
  ended: Event<'turn.ended'> | null;
  version: number; // bumps on every structural change; derive.ts memoises rows per (id, version, uiVersion)
  lastApiMessageId: ApiMessageId | null; // additive: the identity a delta with a null api message id takes
}

export interface TranscriptUi {
  expandedTurns: Set<TurnId>;
  collapsedTurns: Set<TurnId>;
  expandedGroups: Set<RowId>;
  expandedCells: Set<string>;
  revealedBoundaries: Set<RowId>;
  // Additive (M5): what the reader did that X3 rows report, so consumers of `rowsOf` read the truth. By receipt row id,
  // the undo state (the receipt's `state`, `canUndo`, `canReapply`); by spill path, the loaded result (`Spill.state`,
  // `content`).
  receipts: Map<RowId, ReceiptUndo>;
  spills: Map<string, SpillLoad>;
  version: number;
}

// A receipt's undo state, driven by the view through the RewindInterface: the dry run's answer (asked once per
// receipt), whether the interface offers Reapply, and the last failure.
export interface ReceiptUndo {
  state: 'applied' | 'undoing' | 'undone' | 'reapplying';
  check: { ok: boolean; reason: string | null } | 'pending' | null; // null: not asked yet
  reapply: boolean;
  error: string | null;
}
export const RECEIPT_APPLIED: ReceiptUndo = { state: 'applied', check: null, reapply: false, error: null };

// A spilled result the reader asked for: its load state, the content once loaded, and why a load failed.
export interface SpillLoad {
  state: Spill['state'];
  content: string | null;
  error: string | null;
}

export interface MemoEntry {
  version: number;
  uiVersion: number;
  rows: Row[];
  overlay?: { receipts: TranscriptUi['receipts']; spills: TranscriptUi['spills']; rows: Row[] }; // the reader state laid over `rows` (derive.ts)
}

export interface TranscriptState {
  sessionId: SessionId | null;
  agentId: AgentId | null; // set for a child transcript
  turns: Map<TurnId, TurnState>;
  order: TurnId[];
  loose: SessionEvent[]; // events outside any turn (boundaries between turns, process exit, reconnects)
  hidden: { fromTurn: TurnId; rows: number; turns: TurnId[] } | null; // the branch a rewind hid (`turns` additive: the hidden ids in order)
  pending: Map<RequestId, SessionEvent>; // unresolved requests → request_slot rows
  seen: Set<EventId>; // every applied event id
  echoUuids: Set<MessageUuid>; // uuids of bash_echo messages, so a turn.started naming one is dropped
  ui: TranscriptUi;
  // Additive internals. `current` is the open turn receiving unrouted events. `placement` puts each loose event after
  // a turn. The registries below are append-only and shared along the lineage, like `seen`: states form one lineage
  // (every returned state stays a valid, readable snapshot; applying events to a state that is not the lineage's
  // latest throws, since a fork would read registries its predecessor never filled; M2 review ruling).
  current: TurnId | null;
  placement: Map<EventId, TurnId | null>;
  index: { toolUses: Map<ToolUseId, TurnId>; tasks: Map<TaskId, TurnId>; requests: Map<RequestId, TurnId>; hooks: Map<string, TurnId>; messages: Map<MessageUuid, TurnId> };
  memo: Map<TurnId, MemoEntry>;
  lineage: { latest: TranscriptState | null };
}

export function createState(sessionId: SessionId | null, agentId: AgentId | null): TranscriptState {
  return {
    sessionId, agentId, turns: new Map(), order: [], loose: [], hidden: null, pending: new Map(), seen: new Set(), echoUuids: new Set(),
    ui: { expandedTurns: new Set(), collapsedTurns: new Set(), expandedGroups: new Set(), expandedCells: new Set(), revealedBoundaries: new Set(), receipts: new Map(), spills: new Map(), version: 0 },
    current: null, placement: new Map(),
    index: { toolUses: new Map(), tasks: new Map(), requests: new Map(), hooks: new Map(), messages: new Map() },
    memo: new Map(),
    lineage: { latest: null },
  };
}

// A new state with the reader's expansion state replaced (the store's toggles). It joins the lineage as its latest, so
// later batches apply to it; `ui.version` must only grow, since derive.ts memoises rows on it.
export function withUi(state: TranscriptState, ui: TranscriptUi): TranscriptState {
  if (state.lineage.latest !== null && state.lineage.latest !== state) throw new Error('withUi: this state is not its lineage’s latest');
  if (ui.version <= state.ui.version) throw new Error('withUi: ui.version must grow');
  const next = { ...state, ui };
  state.lineage.latest = next;
  return next;
}

// A new state with the reader's receipt undo state or spill loads replaced. They are laid over the derived rows rather
// than derived with them, so the ui version stays and only the turn they touch is rebuilt (derive.ts, rowsOfTurn); the
// maps must be new objects, since the overlay memo compares them by reference. Joins the lineage like `withUi`.
export function withReaderState(state: TranscriptState, patch: Partial<Pick<TranscriptUi, 'receipts' | 'spills'>>): TranscriptState {
  if (state.lineage.latest !== null && state.lineage.latest !== state) throw new Error('withReaderState: this state is not its lineage’s latest');
  const next = { ...state, ui: { ...state.ui, ...patch } };
  state.lineage.latest = next;
  return next;
}

export const blockIdentityOf = (apiMessageId: ApiMessageId, blockIndex: number) => `${apiMessageId}:${blockIndex}`;
export const isEngineOrigin = (origin: string | null) => origin !== null && origin !== 'human';

const BLOCK_TYPES = new Set(['text', 'thinking', 'tool_use']);
const blockTypeOf = (type: string): LiveBlock['blockType'] | null => (BLOCK_TYPES.has(type) ? (type as LiveBlock['blockType']) : null);
const blockContent = (block: { type: string; text?: unknown; thinking?: unknown }) => String(block.type === 'text' ? (block.text ?? '') : (block.thinking ?? ''));
const liveRowId = (type: LiveBlock['blockType'], api: ApiMessageId, index: number): RowId =>
  type === 'text' ? rowId.text(api, index) : type === 'thinking' ? rowId.think(api, index) : (`tooluse:${blockIdentityOf(api, index)}` as RowId);

// The reduction over one batch: a shallow copy of the state whose turns are cloned on first touch and whose order,
// loose list and pending map are copied on first write, so a batch of deltas leaves every other reference intact and
// derive.ts can hand back the same flat row array.
class Batch {
  readonly state: TranscriptState;
  private touched = new Set<TurnId>();
  private owned = { order: false, loose: false, pending: false };

  constructor(previous: TranscriptState) {
    if (previous.lineage.latest !== null && previous.lineage.latest !== previous) {
      throw new Error('applyEvents: this state is not its lineage’s latest; states form one lineage and forking is unsupported');
    }
    this.state = { ...previous, turns: new Map(previous.turns) };
    previous.lineage.latest = this.state;
  }

  order(): TurnId[] {
    if (!this.owned.order) {
      this.state.order = [...this.state.order];
      this.owned.order = true;
    }
    return this.state.order;
  }

  pending(): Map<RequestId, SessionEvent> {
    if (!this.owned.pending) {
      this.state.pending = new Map(this.state.pending);
      this.owned.pending = true;
    }
    return this.state.pending;
  }

  touch(id: TurnId): TurnState {
    const turn = this.state.turns.get(id)!;
    if (this.touched.has(id)) return turn;
    const clone: TurnState = { ...turn, events: [...turn.events], children: new Map(turn.children), live: new Map(turn.live) };
    this.state.turns.set(id, clone);
    this.touched.add(id);
    return clone;
  }

  current(): TurnState | null {
    return this.state.current === null ? null : this.touch(this.state.current);
  }

  open(id: TurnId, origin: 'human' | 'engine', at: string): TurnState {
    const turn: TurnState = { id, origin, state: 'open', startedAt: at, endedAt: null, events: [], children: new Map(), live: new Map(), ended: null, version: 0, lastApiMessageId: null };
    this.state.turns.set(id, turn);
    this.order().push(id);
    this.touched.add(id);
    if (this.state.current === null) this.state.current = id;
    return turn;
  }

  // Append a retained event to a turn and mark the turn structurally changed.
  push(turn: TurnState, event: SessionEvent, bump = true): void {
    turn.events.push(event);
    if (bump) turn.version += 1;
  }

  loose(event: SessionEvent, placed = true): void {
    if (!this.owned.loose) {
      this.state.loose = [...this.state.loose];
      this.owned.loose = true;
    }
    this.state.loose.push(event);
    if (placed) this.state.placement.set(event.id, this.state.order.at(-1) ?? null);
  }

  // The turn receiving an event that names nothing routable: the current turn, else a turn opened for it.
  currentOrOpen(event: SessionEvent): TurnState {
    return this.current() ?? this.open(turnIdOf.ofEvent(event.id), 'human', event.at);
  }

  close(turn: TurnState, ended: Event<'turn.ended'>): void {
    turn.state = 'closed';
    turn.ended = ended;
    turn.endedAt = ended.at;
    if (isEngineOrigin(ended.origin)) turn.origin = 'engine';
    this.push(turn, ended);
    this.advance(turn.id);
  }

  // After a turn closes, the next open turn in order (a queued prompt) becomes current.
  advance(closed: TurnId): void {
    if (this.state.current !== closed) return;
    const from = this.state.order.indexOf(closed) + 1;
    const next = this.state.order.slice(from).find((id) => this.state.turns.get(id)!.state === 'open');
    this.state.current = next ?? null;
  }
}

export function applyEvents(previous: TranscriptState, events: SessionEvent[]): TranscriptState {
  const batch = new Batch(previous);
  const { state } = batch;
  for (const event of events) {
    if (state.seen.has(event.id)) continue;
    state.seen.add(event.id);
    if (event.parentToolUseId !== null && state.agentId === null) applyChild(batch, event);
    else apply(batch, event);
  }
  return state;
}

function applyChild(batch: Batch, event: SessionEvent): void {
  const parent = toolUseOf(event.parentToolUseId!);
  const owner = batch.state.index.toolUses.get(parent) ?? batch.state.current;
  if (owner === null || owner === undefined) return batch.loose(event, false);
  const turn = batch.touch(owner);
  const list = turn.children.get(parent) ?? [];
  turn.children.set(parent, [...list, event]);
  turn.version += 1;
}

function apply(batch: Batch, event: SessionEvent): void {
  const { state } = batch;
  const { index } = state;
  const routed = (id: TurnId | undefined | null): TurnState | null => (id === undefined || id === null ? batch.current() : batch.touch(id));
  const pushRouted = (id: TurnId | undefined | null, bump = true): boolean => {
    const turn = routed(id);
    if (!turn) return false;
    batch.push(turn, event, bump);
    return true;
  };

  switch (event.kind) {
    case 'turn.started': {
      if (event.userMessageUuid !== null && state.echoUuids.has(event.userMessageUuid)) return;
      const id = event.userMessageUuid === null ? turnIdOf.ofEvent(event.id) : turnIdOf.ofMessage(event.userMessageUuid);
      if (state.turns.has(id)) return;
      const turn = batch.open(id, isEngineOrigin(event.origin) ? 'engine' : 'human', event.at);
      batch.push(turn, event);
      return;
    }
    case 'turn.ended': {
      if (event.isEchoReceipt) return batch.loose(event, false);
      const turnOf = (uuid: MessageUuid) => state.turns.get(turnIdOf.ofMessage(uuid)) ?? (index.messages.has(uuid) ? state.turns.get(index.messages.get(uuid)!) : undefined);
      const named = event.userMessageUuids.map(turnOf).find((turn) => turn?.state === 'open');
      const turn = named ? batch.touch(named.id) : batch.current();
      if (!turn) return batch.loose(event, false);
      batch.close(turn, event);
      return;
    }
    case 'command.lifecycle': {
      // *Steers and dropped prompts*: a cancel naming a steer marks that steer's row dropped and nothing else, before or
      // after the turn's result (derive.ts skips a steer the closing `turn.ended.userMessageUuids` named: consumed). One
      // naming a turn's opening prompt is a no-op here (an idle drop arrives as `turn.ended { terminalReason:
      // 'cancelled' }` from the wire; after a result it changes nothing). The reducer never closes a turn on a lifecycle.
      if (event.state !== 'cancelled' && event.state !== 'discarded' && event.state !== 'refused') return;
      const owner = index.messages.get(event.commandUuid);
      if (owner === undefined || turnIdOf.ofMessage(event.commandUuid) === owner) return;
      pushRouted(owner);
      return;
    }
    case 'user.message': {
      if (event.origin === 'bash_echo') {
        if (event.messageUuid !== null) state.echoUuids.add(event.messageUuid);
        return;
      }
      if (event.bash !== null || isLocalCommand(event.origin, event.content)) {
        if (!pushRouted(null)) batch.loose(event); // a bash or local_command row; never a turn
        return;
      }
      if (event.isSynthetic || isInterruptionMarker(event.origin, event.content)) {
        pushRouted(null, false); // retained on the turn, no row of its own
        return;
      }
      const own = event.messageUuid === null ? undefined : state.turns.get(turnIdOf.ofMessage(event.messageUuid));
      if (own) {
        const turn = batch.touch(own.id);
        if (event.messageUuid !== null) index.messages.set(event.messageUuid, turn.id);
        batch.push(turn, event);
        return;
      }
      const current = batch.current();
      if (current) {
        // A steer: a prompt sent while this turn runs joins it (its uuid belongs to the turn; no turn of its own).
        if (event.messageUuid !== null) index.messages.set(event.messageUuid, current.id);
        return batch.push(current, event);
      }
      const id = event.messageUuid === null ? turnIdOf.ofEvent(event.id) : turnIdOf.ofMessage(event.messageUuid);
      const turn = batch.open(id, 'human', event.at);
      if (event.messageUuid !== null) index.messages.set(event.messageUuid, id);
      batch.push(turn, event);
      return;
    }
    case 'assistant.block.delta': {
      const type = blockTypeOf(event.blockType);
      const turn = batch.currentOrOpen(event);
      const apiMessageId = event.apiMessageId ?? turn.lastApiMessageId;
      if (type === null || apiMessageId === null) return;
      turn.lastApiMessageId = apiMessageId;
      const piece = event.textDelta ?? event.thinkingDelta ?? event.inputJsonDelta ?? '';
      const identity = blockIdentityOf(apiMessageId, event.blockIndex);
      const entry = turn.live.get(identity);
      if (entry) {
        if (!entry.completed) turn.live.set(identity, { ...entry, buffer: entry.buffer + piece });
        return;
      }
      turn.live.set(identity, {
        apiMessageId, blockIndex: event.blockIndex, blockType: type, buffer: piece, rowId: liveRowId(type, apiMessageId, event.blockIndex), completed: false,
        markerEventId: type === 'tool_use' ? null : event.id, completeEventId: null, completedAt: null, messageUuid: null, model: null,
      });
      if (type !== 'tool_use') batch.push(turn, event); // the row appears now: a structural change
      return;
    }
    case 'assistant.block.complete': {
      const turn = batch.currentOrOpen(event);
      turn.lastApiMessageId = event.apiMessageId;
      index.messages.set(event.messageUuid, turn.id);
      const type = blockTypeOf(event.block.type);
      if (type !== null) completeBlock(turn, event, type);
      batch.push(turn, event);
      return;
    }
    case 'tool.use': {
      const turn = batch.currentOrOpen(event);
      index.toolUses.set(event.toolUseId, turn.id);
      batch.push(turn, event);
      return;
    }
    case 'tool.result':
    case 'tool.safeguard':
    case 'tool.progress': {
      if (event.kind === 'tool.result' && event.messageUuid !== null) {
        const owner = index.toolUses.get(event.toolUseId) ?? state.current;
        if (owner) index.messages.set(event.messageUuid, owner);
      }
      if (!pushRouted(index.toolUses.get(event.toolUseId))) batch.loose(event, false);
      return;
    }
    case 'subagent.started':
    case 'task.started': {
      const owner = (event.toolUseId === null ? undefined : index.toolUses.get(event.toolUseId)) ?? state.current;
      if (!owner) return batch.loose(event, false);
      index.tasks.set(event.taskId, owner);
      pushRouted(owner);
      return;
    }
    case 'subagent.progress':
    case 'subagent.finished':
    case 'task.updated':
    case 'task.notification':
    case 'workflow.progress': {
      if (!pushRouted(index.tasks.get(event.taskId))) batch.loose(event, false);
      return;
    }
    case 'subagent.message':
    case 'api.retry':
    case 'boundary.compaction':
    case 'boundary.reset': {
      if (!pushRouted(null)) batch.loose(event);
      return;
    }
    case 'hook.started': {
      const turn = batch.current();
      if (!turn) return; // hooks outside any turn are not rendered
      index.hooks.set(event.hookId, turn.id);
      batch.push(turn, event);
      return;
    }
    case 'hook.finished': {
      pushRouted(index.hooks.get(event.hookId));
      return;
    }
    case 'permission.requested':
    case 'question.requested':
    case 'plan.requested':
    case 'dialog.requested':
    case 'elicitation.requested': {
      const toolUseId = 'toolUseId' in event ? event.toolUseId : null;
      const turn = routed(toolUseId === null ? undefined : index.toolUses.get(toolUseId));
      if (!turn) return batch.loose(event);
      batch.pending().set(event.requestId, event);
      index.requests.set(event.requestId, turn.id);
      batch.push(turn, event);
      return;
    }
    case 'permission.resolved':
    case 'question.answered':
    case 'plan.resolved':
    case 'dialog.resolved':
    case 'elicitation.resolved': {
      if (state.pending.has(event.requestId)) batch.pending().delete(event.requestId);
      if (!pushRouted(index.requests.get(event.requestId))) batch.loose(event, false);
      return;
    }
    case 'hook.callback_requested':
    case 'hook.callback_resolved':
      return; // requests to the host, C7's; nothing in the transcript
    case 'boundary.retraction': {
      const owner = event.retractedMessageUuids.map((uuid) => index.messages.get(uuid)).find((id) => id !== undefined);
      if (!pushRouted(owner)) batch.loose(event);
      return;
    }
    case 'boundary.rewind':
      return rewind(batch, event);
    case 'error.raised': {
      const owner = (event.toolUseId && index.toolUses.get(event.toolUseId)) || (event.taskId && index.tasks.get(event.taskId)) || (event.requestId && index.requests.get(event.requestId)) || undefined;
      if (!pushRouted(owner)) batch.loose(event);
      return;
    }
    case 'notice.posted': {
      if (!pushRouted(null)) batch.loose(event);
      return;
    }
    case 'session.reconnect':
    case 'process.exited':
      return batch.loose(event);
    default:
      return; // session lifecycle, accounting, snapshots and unknown frames: nothing the transcript shows
  }
}

// *Streaming*: a complete pairs with the live entry of its identity when that entry is compatible and uncompleted,
// else with the earliest uncompleted entry of the same message and block type (the split-envelope case, where each
// assistant envelope carries a single locally indexed block); the entry's identity stays the row's. A block that never
// streamed registers a completed entry under its own identity, taking the next free index if that one is used.
function completeBlock(turn: TurnState, event: Event<'assistant.block.complete'>, type: LiveBlock['blockType']): void {
  const identity = blockIdentityOf(event.apiMessageId, event.blockIndex);
  let entry = turn.live.get(identity);
  if (!entry || entry.blockType !== type || entry.completed) {
    entry = [...turn.live.values()]
      .filter((candidate) => candidate.apiMessageId === event.apiMessageId && candidate.blockType === type && !candidate.completed)
      .sort((a, b) => a.blockIndex - b.blockIndex)[0];
  }
  if (entry) {
    const key = blockIdentityOf(entry.apiMessageId!, entry.blockIndex);
    turn.live.set(key, { ...entry, buffer: type === 'tool_use' ? entry.buffer : blockContent(event.block), completed: true, completeEventId: event.id, completedAt: event.at, messageUuid: event.messageUuid, model: event.model });
    return;
  }
  if (type === 'tool_use') return;
  let blockIndex = event.blockIndex;
  while (turn.live.has(blockIdentityOf(event.apiMessageId, blockIndex))) blockIndex += 1;
  turn.live.set(blockIdentityOf(event.apiMessageId, blockIndex), {
    apiMessageId: event.apiMessageId, blockIndex, blockType: type, buffer: blockContent(event.block), rowId: liveRowId(type, event.apiMessageId, blockIndex),
    completed: true, markerEventId: null, completeEventId: event.id, completedAt: event.at, messageUuid: event.messageUuid, model: event.model,
  });
}

// *Revisable log*, rewind: every turn from the target's onward leaves `order` (kept in `turns`), the boundary row sits
// after the last visible turn, and `hidden.rows` counts the messages the reader can reveal.
function rewind(batch: Batch, event: Event<'boundary.rewind'>): void {
  const { state } = batch;
  const target = turnIdOf.ofMessage(event.targetMessageUuid);
  const at = state.order.indexOf(target);
  if (at < 0) return batch.loose(event);
  const hiddenTurns = batch.order().splice(at);
  const rows = hiddenTurns.reduce((n, id) => {
    const turn = state.turns.get(id)!;
    return n + turn.events.filter((e) => (e.kind === 'user.message' && e.bash === null) || (e.kind === 'assistant.block.complete' && e.block.type === 'text')).length;
  }, 0);
  state.hidden = { fromTurn: target, rows, turns: hiddenTurns };
  if (state.current !== null && hiddenTurns.includes(state.current)) state.current = null;
  batch.loose(event);
}
