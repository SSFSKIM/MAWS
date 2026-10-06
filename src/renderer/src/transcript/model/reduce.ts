// applyEvents: X1 events → TranscriptState, incrementally (C6 execution document, Derivation; residue *Derivation
// architecture*). One TurnState per turn, copy-on-write per batch so untouched turns are shared between states; a
// turn's `version` bumps on every structural change and derive.ts memoises rows on it. Only events that change what
// the transcript shows are retained on a turn (the journal keeps the rest, reachable by `seq`); every applied event
// id lands in `seen`, which is the hydration deduplication and the retraction index.
import type { SessionEvent } from '@shared/graph/events';
import type { AgentId, ApiMessageId, EventId, MessageUuid, RequestId, SessionId, TaskId, ToolUseId } from '@shared/graph/ids';
import { toolUseOf } from '@shared/graph/ids';
import { rowId, turnId as turnIdOf } from './keys';
import type { CellDetail, Row, RowId, Spill, SubagentRef, SubagentStatus, ToolCategory, TurnId } from './rows';
import { appendStripped, stripAnsi } from '@shared/wire/ansi';
import { parseAskSteer } from '@shared/maws/ask'; // E1
import type { AskAnswer } from '@shared/maws/tools'; // E1
import { isInterruptionMarker, isLocalCommand } from './user-text';

type Event<K extends SessionEvent['kind']> = Extract<SessionEvent, { kind: K }>;

export interface LiveBlock {
  apiMessageId: ApiMessageId | null;
  blockIndex: number;
  blockType: 'text' | 'thinking' | 'tool_use';
  buffer: string;
  isApiErrorMessage?: boolean;
  sourceText?: string; // assistant text as delivered, before native ANSI stripping; mod render input
  rowId: RowId;
  completed: boolean;
  // Additive to the X3 definition: how derive.ts places the row and fills its static fields once the block completes.
  markerEventId: EventId | null; // the first delta's event, kept in `events` as the row's position; null when the block never streamed
  completeEventId: EventId | null;
  completedAt: string | null;
  messageUuid: MessageUuid | null;
  model: string | null;
}

export type TurnOrigin = 'human' | 'engine' | 'peer';

export interface TurnState {
  id: TurnId;
  origin: TurnOrigin; // peer (C3, 2026-09-28): a turn a peer session's message started, its own value
  state: 'open' | 'closed';
  startedAt: string;
  endedAt: string | null;
  events: SessionEvent[]; // top-level events of this turn in arrival order (child events are indexed, not listed)
  children: Map<ToolUseId, SessionEvent[]>; // child-agent events by parent tool use, for subagent row updates and drill-in seeding
  live: Map<string, LiveBlock>; // keyed by block identity `<apiMessageId>:<blockIndex>`
  ended: Event<'turn.ended'> | null;
  version: number; // bumps on every structural change; derive.ts memoises rows per (id, version, uiVersion)
  lastApiMessageId: ApiMessageId | null; // additive: the identity a delta with a null api message id takes
  // Additive (M5): how a child transcript's turn ended. A child's own slice carries no turn.ended; the parent's
  // `subagent.finished` or `task.notification` naming the child, which the child source delivers into the slice, closes
  // its open turn with that outcome, and the parent's `process.exited` closes it as stopped.
  closedBy: 'completed' | 'failed' | 'stopped' | null;
  // Additive (M6, *Turn boundaries on this engine*): the engine accepted the turn (its `turn.started` arrived, or it
  // was opened by the engine's own output). A prompt's `user.message` arrives at the write and opens its turn pending
  // (`false`): its bubble shows, it has no divider, and it never receives another turn's events until it starts.
  accepted: boolean;
  // Additive (E1, residue 13): the answers an async ask's steer carried, by askId, on the turn that holds the ask's call
  // (the steer usually runs as a turn of its own). Replaced, never mutated, so an earlier snapshot keeps its own map.
  askSteers?: ReadonlyMap<string, AskAnswer[]>;
}

export interface TranscriptUi {
  assistantInk: Set<RowId>; // accepted mod drawings addressed to the human; session-local, never persisted
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
  // Every ui change bumps `version` (the flat list's memo and `withUi`'s order read it). What a turn's rows depend on is
  // narrower (whole-branch review: one click re-derived all 500 turns): `global` bumps for whole-transcript changes
  // (expand all, the snapshot view, a boundary's reveal), and `stamps` holds a per-turn stamp bumped by the toggles,
  // jumps and completions that name that turn. derive.ts memoises a turn's rows on (version, global, its stamp).
  global: number;
  stamps: Map<TurnId, number>;
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

// What a turn did whatever the reader disclosed (the activity projection's per-turn part, model/activity.ts), computed
// by the same per-turn derivation as its rows and memoised beside them.
export interface TurnWork {
  files: { path: string; use: 'read' | 'edited'; at: string; edit: Extract<CellDetail, { kind: 'edit' }> | null }[]; // one entry per completed use, first-seen order: Read and NotebookRead calls read (a search scope is no file), files calls edited (with the edit cell's own detail)
  tools: { name: string; category: ToolCategory; at: string; url: string | null; mcp: { server: string; tool: string } | null }[]; // one entry per tool use, each under its own name
  subagents: (SubagentRef & { status: SubagentStatus })[]; // one per child, with its own status
}

export interface MemoEntry {
  version: number;
  uiVersion: number; // the ui's `global` when derived
  uiStamp: number; // the turn's own ui stamp when derived
  rows: Row[];
  work: TurnWork;
  overlay?: { receipts: TranscriptUi['receipts']; spills: TranscriptUi['spills']; rows: Row[] }; // the reader state laid over `rows` (derive.ts)
}

export interface HiddenBranch {
  fromTurn: TurnId;
  rows: number;
  turns: TurnId[];
}

export interface TranscriptState {
  sessionId: SessionId | null;
  agentId: AgentId | null; // set for a child transcript
  turns: Map<TurnId, TurnState>;
  order: TurnId[];
  loose: SessionEvent[]; // events outside any turn (boundaries between turns, process exit, reconnects)
  hidden: (HiddenBranch & { branches: Map<RowId, HiddenBranch> }) | null; // all hidden turns (for row muting), with each rewind boundary’s own branch; fromTurn is the latest target
  pending: Map<RequestId, SessionEvent>; // unresolved requests → request_slot rows
  seen: Set<EventId>; // every applied event id
  echoUuids: Set<MessageUuid>; // uuids of bash_echo messages, so a turn.started naming one is dropped
  ui: TranscriptUi;
  // Additive internals. `current` is the open turn receiving unrouted events. `placement` puts each loose event after
  // a turn. The registries below are append-only and shared along the lineage, like `seen`: states form one lineage
  // (every returned state stays a valid, readable snapshot; applying events to a state that is not the lineage's
  // latest throws, since a fork would read registries its predecessor never filled; M2 review ruling).
  current: TurnId | null;
  cwd: string | null; // additive (debt wave 4): the session's working directory, from its latest session.started or session.init
  // Additive (R1): each plugin's pinned status line (`plugin.status`), the most recently set last; '' removes a plugin's
  // line, and the session's process exiting removes them all (the plugins ran in it). A new map on every change.
  pluginStatus: ReadonlyMap<string, PluginStatus>;
  placement: Map<EventId, TurnId | null>;
  // `pluginIssues` (R1): the load issues already retained, by plugin, level and message, so an issue every init repeats
  // makes one notice per session.
  index: { toolUses: Map<ToolUseId, TurnId>; tasks: Map<TaskId, TurnId>; requests: Map<RequestId, TurnId>; hooks: Map<string, TurnId>; messages: Map<MessageUuid, TurnId>; pluginIssues: Set<string> };
  memo: Map<TurnId, MemoEntry>;
  lineage: { latest: TranscriptState | null };
}

// R1: a plugin's pinned line and when it was set.
export interface PluginStatus {
  text: string;
  at: string;
}

export function createState(sessionId: SessionId | null, agentId: AgentId | null): TranscriptState {
  return {
    sessionId, agentId, turns: new Map(), order: [], loose: [], hidden: null, pending: new Map(), seen: new Set(), echoUuids: new Set(),
    ui: { assistantInk: new Set(), expandedTurns: new Set(), collapsedTurns: new Set(), expandedGroups: new Set(), expandedCells: new Set(), revealedBoundaries: new Set(), receipts: new Map(), spills: new Map(), global: 0, stamps: new Map(), version: 0 },
    current: null, cwd: null, pluginStatus: new Map(), placement: new Map(),
    index: { toolUses: new Map(), tasks: new Map(), requests: new Map(), hooks: new Map(), messages: new Map(), pluginIssues: new Set() },
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
// *Turn origin*: positive evidence only; `peer` is its own value, any other non-human origin is the engine's.
export const originOf = (origin: string | null): TurnOrigin => (origin === 'peer' ? 'peer' : isEngineOrigin(origin) ? 'engine' : 'human');

const BLOCK_TYPES = new Set(['text', 'thinking', 'tool_use']);
const blockTypeOf = (type: string): LiveBlock['blockType'] | null => (BLOCK_TYPES.has(type) ? (type as LiveBlock['blockType']) : null);
const blockContent = (block: { type: string; text?: unknown; thinking?: unknown }) => stripAnsi(String(block.type === 'text' ? (block.text ?? '') : (block.thinking ?? '')));
const liveRowId = (type: LiveBlock['blockType'], api: ApiMessageId, index: number): RowId =>
  type === 'text' ? rowId.text(api, index) : type === 'thinking' ? rowId.think(api, index) : (`tooluse:${blockIdentityOf(api, index)}` as RowId);

// The reduction over one batch: a shallow copy of the state whose turns are cloned on first touch and whose order,
// loose list and pending map are copied on first write, so a batch of deltas leaves every other reference intact and
// derive.ts can hand back the same flat row array.
class Batch {
  readonly state: TranscriptState;
  private touched = new Set<TurnId>();
  private childLists = new Set<SessionEvent[]>();
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

  // Clone a child's list on its first append in this batch, then append behind that immutable boundary.
  pushChild(turn: TurnState, parent: ToolUseId, event: SessionEvent): void {
    let list = turn.children.get(parent);
    if (!list || !this.childLists.has(list)) {
      list = list ? [...list] : [];
      turn.children.set(parent, list);
      this.childLists.add(list);
    }
    list.push(event);
    turn.version += 1;
  }

  current(): TurnState | null {
    return this.state.current === null ? null : this.touch(this.state.current);
  }

  open(id: TurnId, origin: TurnOrigin, at: string, accepted = true): TurnState {
    const turn: TurnState = { id, origin, state: 'open', startedAt: at, endedAt: null, events: [], children: new Map(), live: new Map(), ended: null, version: 0, lastApiMessageId: null, closedBy: null, accepted };
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
    this.closeBlocks(turn, ended.at);
    if (originOf(ended.origin) !== 'human') turn.origin = originOf(ended.origin);
    this.push(turn, ended);
    this.advance(turn.id);
  }

  // A pending prompt the engine took into the running turn (`priority: 'next'`): the pending turn leaves `order` and
  // `turns`, its retained events (the prompt's message) join the running turn at this point, so its bubble renders
  // there in event order as a steer, and its uuid names the running turn, so the result naming both closes it.
  fold(pending: TurnState, into: TurnId): void {
    if (!this.state.order.includes(pending.id)) return; // hidden by a rewind: it stays in its hidden branch, unfolded
    const target = this.touch(into);
    for (const event of pending.events) {
      this.push(target, event);
      if (event.kind === 'user.message' && event.messageUuid !== null) this.state.index.messages.set(event.messageUuid, into);
    }
    const order = this.order();
    order.splice(order.indexOf(pending.id), 1);
    this.state.turns.delete(pending.id);
    for (const [eventId, placed] of this.state.placement) if (placed === pending.id) this.state.placement.set(eventId, into);
  }

  // *Local-command and interrupt-marker messages*, on disk: C4's backfill gives the marker (an ordinary user record) a
  // turn.started of its own before its message, which closed the interrupted turn as completed and opened a turn for
  // the marker. When the marker's message arrives and that turn holds nothing but its start, the marker turn goes (out
  // of `order` and `turns`, loose placements re-pointed), the marker is retained on the turn before it, and that turn,
  // closed without a turn.ended of its own, reads stopped. Returns whether it folded.
  foldMarkerBack(marker: Event<'user.message'>): boolean {
    if (marker.messageUuid === null) return false;
    const id = turnIdOf.ofMessage(marker.messageUuid);
    const own = this.state.turns.get(id);
    const at = this.state.order.indexOf(id);
    if (!own || own.state !== 'open' || at < 1 || own.events.some((event) => event.kind !== 'turn.started')) return false;
    const before = this.state.order[at - 1];
    if (this.state.turns.get(before)!.state !== 'closed') return false;
    this.order().splice(at, 1);
    this.state.turns.delete(id);
    for (const [eventId, placed] of this.state.placement) if (placed === id) this.state.placement.set(eventId, before);
    if (this.state.current === id) this.state.current = null;
    const interrupted = this.touch(before);
    this.push(interrupted, marker);
    if (interrupted.ended === null) interrupted.closedBy = 'stopped';
    return true;
  }

  // A pending prompt the engine dropped before it started: its turn closes without work, the lifecycle event retained
  // (derive.ts reads it to mark the bubble dropped).
  drop(turn: TurnState, lifecycle: Event<'command.lifecycle'>): void {
    turn.state = 'closed';
    turn.endedAt = lifecycle.at;
    this.push(turn, lifecycle);
    this.advance(turn.id);
  }

  // A turn closed without a turn.ended of its own (not retained: no row of its own): a child transcript's turn at the
  // parent's report that the child ended, and a session's turn the engine never ended (its process exited, or C4's
  // backfill shows the next prompt starting with no turn_duration for this one).
  closeUnended(turn: TurnState, outcome: 'completed' | 'failed' | 'stopped', at: string): void {
    turn.state = 'closed';
    turn.closedBy = outcome;
    turn.endedAt = at;
    this.closeBlocks(turn, at);
    turn.version += 1;
    this.advance(turn.id);
  }

  private closeBlocks(turn: TurnState, at: string): void {
    for (const [id, block] of turn.live) {
      if (!block.completed) turn.live.set(id, { ...block, completed: true, completedAt: at });
    }
  }

  // After a turn closes, the next accepted open turn in order becomes current; a pending prompt waits for its own
  // `turn.started`, so the events in between (an engine-initiated turn among them) never land in it.
  advance(closed: TurnId): void {
    if (this.state.current !== closed) return;
    const from = this.state.order.indexOf(closed) + 1;
    const next = this.state.order.slice(from).find((id) => this.state.turns.get(id)!.state === 'open' && this.state.turns.get(id)!.accepted);
    this.state.current = next ?? null;
  }

  // W1: every prompt waiting for its turn (open and not accepted, a hidden one too: rowsOf derives it) is derived again.
  rederiveWaiting(): void {
    for (const [id, turn] of [...this.state.turns]) if (turn.state === 'open' && !turn.accepted) this.touch(id).version += 1;
  }
}

// W1: the turn the engine is running: the current turn while it is open and accepted. A prompt waiting for its turn
// reads as waiting at the next step only while one runs (derive.ts), so a batch that changes it (a turn starting or
// closing) re-derives every waiting turn.
export function runningTurn(state: TranscriptState): TurnId | null {
  const turn = state.current === null ? undefined : state.turns.get(state.current);
  return turn !== undefined && turn.state === 'open' && turn.accepted ? turn.id : null;
}

export function applyEvents(previous: TranscriptState, events: SessionEvent[]): TranscriptState {
  const batch = new Batch(previous);
  const { state } = batch;
  const running = runningTurn(state);
  for (const event of events) {
    if (state.seen.has(event.id)) continue;
    state.seen.add(event.id);
    if (event.parentToolUseId !== null && state.agentId === null) applyChild(batch, event);
    else apply(batch, event);
  }
  if (runningTurn(state) !== running) batch.rederiveWaiting();
  return state;
}

function applyChild(batch: Batch, event: SessionEvent): void {
  const parent = toolUseOf(event.parentToolUseId!);
  const owner = batch.state.index.toolUses.get(parent) ?? batch.state.current;
  if (owner === null || owner === undefined) return batch.loose(event, false);
  const turn = batch.touch(owner);
  batch.pushChild(turn, parent, event);
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
      const existing = state.turns.get(id);
      if (existing) {
        // *Turn boundaries on this engine*: the started of a pending prompt opens its turn in place when no turn is
        // open (no second turn, no second user row; it gains its divider and receives the engine's output), and folds
        // the prompt into the open turn when one is (`priority: 'next'`: taken at the next tool boundary).
        if (existing.accepted || existing.state !== 'open') return;
        const running = state.current === null ? null : state.turns.get(state.current)!;
        if (running !== null && running.id !== id && running.state === 'open' && running.accepted) return batch.fold(existing, running.id);
        // Run order over write position: if a turn opened after this prompt was written and has run since, the
        // prompt's turn moves to the end of `order` as it starts (with nothing in between it stays where written).
        const order = state.order.indexOf(id);
        if (order >= 0 && state.order.slice(order + 1).some((later) => state.turns.get(later)!.accepted)) {
          const moved = batch.order();
          moved.splice(order, 1);
          moved.push(id);
        }
        const turn = batch.touch(id);
        turn.accepted = true;
        turn.startedAt = event.at;
        if (originOf(event.origin) !== 'human') turn.origin = originOf(event.origin);
        batch.push(turn, event);
        const current = state.current === null ? null : state.turns.get(state.current)!;
        if (current === null || !current.accepted) state.current = id;
        return;
      }
      // A turn.started for a prompt with no pending turn: the engine runs this turn now, so a turn it left open ends
      // here (C4's backfill writes turn.ended only from system/turn_duration, which SDK-entrypoint sessions never
      // write and an interrupted turn lacks). It reads stopped only on interrupt evidence the turn retains, else
      // completed; a waiting prompt stays pending.
      const previous = state.current === null ? null : state.turns.get(state.current)!;
      if (previous !== null && previous.state === 'open' && previous.accepted) {
        batch.closeUnended(batch.touch(previous.id), wasInterrupted(previous) ? 'stopped' : 'completed', event.at);
      }
      const turn = batch.open(id, originOf(event.origin), event.at);
      const current = state.current === null ? null : state.turns.get(state.current)!;
      if (current === null || !current.accepted) state.current = id;
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
      // *Turn boundaries on this engine*: a cancel naming a pending prompt drops it (its bubble reads Not sent) and
      // closes its turn without work. Naming a turn the engine accepted, or one already closed, it changes nothing.
      // A `started` naming a pending prompt while an accepted turn runs folds it into that turn (`priority: 'next'`):
      // C3 adds the uuid to the open turn and emits no turn.started for it. With no turn running, the turn.started
      // that follows opens it.
      const pending = state.turns.get(turnIdOf.ofMessage(event.commandUuid));
      if (!pending || pending.accepted || pending.state !== 'open') return;
      if (event.state === 'started') {
        const running = state.current === null ? null : state.turns.get(state.current)!;
        if (running !== null && running.id !== pending.id && running.state === 'open' && running.accepted) batch.fold(pending, running.id);
        return;
      }
      if (event.state !== 'cancelled' && event.state !== 'discarded' && event.state !== 'refused') return;
      batch.drop(batch.touch(pending.id), event);
      return;
    }
    case 'user.message': {
      if (event.origin === 'bash_echo') {
        if (event.messageUuid !== null) state.echoUuids.add(event.messageUuid);
        return;
      }
      // W1 (A5): a synthetic one is the engine's `<local-command-caveat>` for the model (a meta record on disk, never on
      // the wire), which falls through to the synthetic rule below: retained, no row
      if (event.bash !== null || (isLocalCommand(event.origin, event.content) && !event.isSynthetic)) {
        if (!pushRouted(null)) batch.loose(event); // a bash or local_command row; never a turn
        return;
      }
      if (event.isSynthetic || isInterruptionMarker(event.origin, event.content)) {
        if (!event.isSynthetic && batch.foldMarkerBack(event)) return;
        pushRouted(null, false); // retained on the turn, no row of its own
        return;
      }
      recordAskSteer(batch, event); // E1
      // A prompt already placed (an inbound replay of it, or of one folded into another turn) adds nothing.
      if (event.messageUuid !== null && index.messages.has(event.messageUuid)) return;
      const own = event.messageUuid === null ? undefined : state.turns.get(turnIdOf.ofMessage(event.messageUuid));
      if (own) {
        const turn = batch.touch(own.id);
        if (event.messageUuid !== null) index.messages.set(event.messageUuid, turn.id);
        batch.push(turn, event);
        return;
      }
      // *Turn boundaries on this engine*: a prompt with no turn yet is a pending turn of its own, after the running one
      // (a `now` prompt never folds; a `next` prompt folds at its `started`); with no turn running it is current, so a
      // disk turn that never carries a `turn.started` still gathers its answer.
      const id = event.messageUuid === null ? turnIdOf.ofEvent(event.id) : turnIdOf.ofMessage(event.messageUuid);
      const turn = batch.open(id, 'human', event.at, false);
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
        if (!entry.completed) turn.live.set(identity, { ...entry, buffer: type === 'tool_use' ? entry.buffer + piece : appendStripped(entry.buffer, piece), ...(type === 'text' && { sourceText: (entry.sourceText ?? '') + piece }) });
        return;
      }
      turn.live.set(identity, {
        apiMessageId, blockIndex: event.blockIndex, blockType: type, buffer: type === 'tool_use' ? piece : appendStripped('', piece), ...(type === 'text' && { sourceText: piece }), rowId: liveRowId(type, apiMessageId, event.blockIndex), completed: false,
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
    case 'subagent.finished':
    case 'task.notification': {
      // In a child transcript, the parent's report that this child ended closes its open turn. For local agents the
      // task id and the agent id carry the same string (C1 Interfaces).
      if (state.agentId !== null && (event.taskId as string) === (state.agentId as string)) {
        const turn = batch.current();
        if (turn) batch.closeUnended(turn, event.status, event.at);
        return;
      }
      const owner = index.tasks.get(event.taskId) ?? (event.kind === 'task.notification' && event.toolUseId !== null ? index.toolUses.get(event.toolUseId) : undefined);
      if (!pushRouted(owner)) batch.loose(event, false);
      return;
    }
    case 'subagent.progress':
    case 'task.updated':
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
      const owners = new Set(event.retractedMessageUuids.map((uuid) => index.messages.get(uuid)).filter((id): id is TurnId => id !== undefined));
      if (owners.size === 0) {
        if (!pushRouted(null)) batch.loose(event);
      } else {
        // Retain the revision on every affected turn; flatten deduplicates its one boundary row by event id.
        for (const owner of owners) pushRouted(owner);
      }
      return;
    }
    case 'boundary.rewind':
      return rewind(batch, event);
    case 'error.raised': {
      const owner = (event.toolUseId && index.toolUses.get(event.toolUseId)) || (event.taskId && index.tasks.get(event.taskId)) || (event.requestId && index.requests.get(event.requestId)) || undefined;
      if (!pushRouted(owner)) batch.loose(event);
      return;
    }
    case 'notice.posted':
    case 'plugin.log': { // R1: a plugin's log line, a notice at its arrival position
      if (!pushRouted(null)) batch.loose(event);
      return;
    }
    case 'plugin.load_issue': { // R1: every init repeats its plugins' issues; one notice each per session
      const key = `${event.plugin}\u0000${event.level}\u0000${event.message}`;
      if (index.pluginIssues.has(key)) return;
      index.pluginIssues.add(key);
      if (!pushRouted(null)) batch.loose(event);
      return;
    }
    case 'plugin.status': { // R1: the plugin's one pinned line, moved to the end as the most recent; '' removes it
      const next = new Map(state.pluginStatus);
      next.delete(event.plugin);
      if (event.text !== '') next.set(event.plugin, { text: event.text, at: event.at });
      state.pluginStatus = next;
      return;
    }
    case 'session.reconnect':
    case 'process.exited': {
      // In a child transcript, the parent's process exiting ends the child with no finish to come: its open turn closes
      // as stopped, and the exit is the parent's row, not the child's.
      if (state.agentId !== null) {
        const turn = batch.current();
        if (turn) batch.closeUnended(turn, 'stopped', event.at);
        return;
      }
      // A session's process exiting ends every turn the engine was running (no turn.ended will come for them); a
      // prompt still waiting for its turn.started stays pending, and the exit is a loose row. An exit whose reason is
      // unknown (C4's synthesised end of a holder-less transcript whose last turn never ended on disk: the process was
      // not seen to go) is no evidence of a stop, so such a turn closes by the superseding start's rule.
      if (event.kind === 'process.exited') {
        if (state.pluginStatus.size > 0) state.pluginStatus = new Map(); // R1: the plugins' lines went with the process
        for (const id of state.order) {
          const turn = state.turns.get(id)!;
          if (turn.state !== 'open' || !turn.accepted) continue;
          batch.closeUnended(batch.touch(id), event.reason !== 'unknown' || wasInterrupted(turn) ? 'stopped' : 'completed', event.at);
        }
      }
      return batch.loose(event);
    }
    case 'session.started':
    case 'session.init':
      state.cwd = event.cwd; // what the engine's cwd-relative tool output is relative to (derive.ts, grepFileScope)
      return;
    // E1 start: the `maws` server's events go to the turn of the call they name (as its tool result does), else the
    // current turn, and bump it, so an async ask's answer or a cancellation that arrives after the capsule's turn closed
    // and others ran still re-derives the capsule (E1 execution document, M3's first decision)
    case 'maws.ask.opened':
    case 'maws.ask.answered':
    case 'maws.ask.cancelled':
    case 'maws.delivery.file':
    case 'maws.pane.shown': {
      if (!pushRouted(event.toolUseId === null ? undefined : index.toolUses.get(event.toolUseId))) batch.loose(event, false);
      return;
    }
    // E1 end
    // E7 start: a message from another session, parsed beside the user.message that carried it, at its arrival position
    // in the turn it arrived in, as subagent.message is (E7 execution document, Design §4)
    case 'peer.message': {
      if (!pushRouted(null)) batch.loose(event);
      return;
    }
    // E7 end
    default:
      return; // session lifecycle, accounting, snapshots and unknown frames: nothing the transcript shows
  }
}

// E1 start (residue 13): a user message that is an async ask's steer (`[MAWS ask <askId>]` and the answered result's
// fenced block) carries that ask's answers. They go on the turn holding the ask's call (copy-on-write: that turn is
// cloned for this batch and given a new map, so a snapshot taken before the steer still reads `asked`), and that turn
// re-derives, since the steer usually runs as a turn of its own (pass3/p1-maws-ask-async) and on the disk path it is
// the only record of the answers. A steer naming no call this state holds answers nothing (the call always precedes
// its steer). The first steer naming an ask wins. The message itself is placed as any other prompt: its bubble stays a
// user row.
function recordAskSteer(batch: Batch, event: Event<'user.message'>): void {
  const text = typeof event.content === 'string' ? event.content : event.content.filter((block) => block.type === 'text').map((block) => String(block.text ?? '')).join('\n');
  const steer = parseAskSteer(text);
  if (steer === null) return;
  const owner = batch.state.index.toolUses.get(steer.askId as ToolUseId); // the askId is the call's tool use id (residue 2)
  if (owner === undefined || batch.state.turns.get(owner)?.askSteers?.has(steer.askId)) return;
  const turn = batch.touch(owner);
  turn.askSteers = new Map(turn.askSteers).set(steer.askId, steer.result.answers);
  turn.version += 1;
}
// E1 end

// Interrupt evidence a turn retains: the engine's interrupt marker, or a call the human rejected.
const wasInterrupted = (turn: TurnState) =>
  turn.events.some((event) => (event.kind === 'user.message' && isInterruptionMarker(event.origin, event.content)) || (event.kind === 'tool.result' && event.denial === 'user-rejected'));

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
    turn.live.set(key, { ...entry, buffer: type === 'tool_use' ? entry.buffer : blockContent(event.block), ...(type === 'text' && { sourceText: String(event.block.text ?? '') }), completed: true, isApiErrorMessage: event.isApiErrorMessage, completeEventId: event.id, completedAt: event.at, messageUuid: event.messageUuid, model: event.model });
    return;
  }
  if (type === 'tool_use') return;
  let blockIndex = event.blockIndex;
  while (turn.live.has(blockIdentityOf(event.apiMessageId, blockIndex))) blockIndex += 1;
  turn.live.set(blockIdentityOf(event.apiMessageId, blockIndex), {
    apiMessageId: event.apiMessageId, blockIndex, blockType: type, buffer: blockContent(event.block), ...(type === 'text' && { sourceText: String(event.block.text ?? '') }), rowId: liveRowId(type, event.apiMessageId, blockIndex),
    completed: true, isApiErrorMessage: event.isApiErrorMessage, markerEventId: null, completeEventId: event.id, completedAt: event.at, messageUuid: event.messageUuid, model: event.model,
  });
}

// *Revisable log*, rewind: every turn from the target's onward leaves `order` (kept in `turns`), the boundary row sits
// after the last visible turn, and `hidden.rows` counts the messages the reader can reveal.
function rewind(batch: Batch, event: Event<'boundary.rewind'>): void {
  const { state } = batch;
  const target = state.index.messages.get(event.targetMessageUuid) ?? turnIdOf.ofMessage(event.targetMessageUuid);
  const at = state.order.indexOf(target);
  if (at < 0) return batch.loose(event);
  const hiddenTurns = batch.order().splice(at);
  const rows = hiddenTurns.reduce((n, id) => {
    const turn = state.turns.get(id)!;
    return n + turn.events.filter((e) => (e.kind === 'user.message' && e.bash === null) || (e.kind === 'assistant.block.complete' && e.block.type === 'text')).length;
  }, 0);
  const branch = { fromTurn: target, rows, turns: hiddenTurns };
  const branches = new Map(state.hidden?.branches);
  branches.set(rowId.boundary(event.id), branch);
  state.hidden = { fromTurn: target, rows: (state.hidden?.rows ?? 0) + rows, turns: [...(state.hidden?.turns ?? []), ...hiddenTurns], branches };
  if (state.current !== null && hiddenTurns.includes(state.current)) state.current = null;
  batch.loose(event);
}
