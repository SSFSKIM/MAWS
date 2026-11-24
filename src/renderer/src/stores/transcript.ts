// The transcript store (C6 execution document, Public surface): one TranscriptState per key (`appSessionId`, or
// `appSessionId:agentId` for a child), attached to a TranscriptSource through the hydration protocol
// (source/hydrate.ts), with the reader's expansion state, follow mode and jump requests. Rows are derived once per
// change with `rowsOf`, whose per-turn memo keeps unchanged rows by reference; a streaming block's later deltas change
// no row, and the live row reads its buffer through `liveBuffer`, so a token re-renders one component.
import { create } from 'zustand';
import type { SessionEvent } from '@shared/graph/events';
import type { AgentId, MessageUuid, ToolUseId } from '@shared/graph/ids';
import { turnActivity, type TurnActivity } from '../transcript/model/activity';
import { expandedTurnRows, rowsOf, turnRows } from '../transcript/model/derive';
import { drawsAsRun, runOfOneId } from '../transcript/model/groups'; // board ticket 852
import { marksOfText } from '../transcript/model/owner-marks';
import { carriedKeys, holdsMessage, keysOfStretch, lostKey, liveMarkedRowIds, mirrorsView, movingKeysOfStretch, openKeysOf, stretchHolding } from '../owner/view/mirror'; // UX wave U2b
import { applyEvents, createState, RECEIPT_APPLIED, withAgents, withReaderState, withUi, type AgentLookup, type ReceiptUndo, type SpillLoad, type TranscriptState, type TranscriptUi } from '../transcript/model/reduce';
import type { CellId, Row, RowId, TurnId } from '../transcript/model/rows';
import { attachSource, type Attachment } from '../transcript/source/hydrate';
import type { TranscriptSource } from '../transcript/source/types';

export interface JumpRequest {
  rowId: RowId; // the list row to scroll to (the group holding a cell, or the row itself)
  focus: RowId | CellId; // the id to focus: the row, or a cell inside it
  align: 'start' | 'center' | 'end';
  nonce: number;
  // Additive: the jump re-resolved when a staged restart installed its state (the reader asked for it before). The view
  // moves the reader to it only if they have not moved on since.
  reissued?: boolean;
}

export interface TranscriptEntry {
  state: TranscriptState;
  rows: Row[];
  // The latest writer owns each promotion: surface cleanup must not erase detached local drawing.
  localAssistantInk?: ReadonlySet<RowId>;
  phase: 'hydrating' | 'live' | 'failed'; // failed: the snapshot rejected; the key is detached and `attach` may be called again
  error: string | null; // why the last attach failed
  following: boolean;
  sendFollowRequest: number; // explicit accepted-send requests; reader movement reports only `following`
  working: boolean; // a turn is open
  clock: { at: number; wall: number } | null; // the latest event time applied, and the wall time it arrived: a working divider ticks from it
  jump: JumpRequest | null;
  // Additive (the long-transcript window's jumps into history): a jump to a message older than what is loaded, on its way
  // or ended without landing; absent when none
  reach?: Reach;
  // Additive (the long-transcript window): the cron calls the key's older history holds, as its source's newest window
  // carried them (`cronHistory`), for the Scheduled section; absent for a source that answers its whole history
  cronHistory?: readonly SessionEvent[];
}

// What a mounted view draws the key's rows as before the mirror runs over them (`mountView`).
export type ComposeView = (entry: TranscriptEntry) => { rows: readonly Row[]; liveMarked: string };

export interface MessageAnchor {
  messageUuid: MessageUuid;
  blockIndex: number;
}

// A jump into history the transcript says something about: the pages back to the message on their way (`progress`,
// the share walked once the host has said how far; null until then), the message in none of the history (`missing`:
// a rewritten transcript, a cleared session, a rewound branch), or a page that did not load (`failed`).
export type Reach = { anchor: ReachTarget; phase: 'loading'; progress: number | null } | { anchor: ReachTarget; phase: 'missing' } | { anchor: ReachTarget; phase: 'failed'; error: string };

// What a jump into history lands on: an assistant text (a mark's anchor), or a cell of the message `messageUuid` (a
// Scheduled row's creating call), its turn named when the caller knows it.
export type ReachTarget = MessageAnchor | { messageUuid: MessageUuid; cell: CellId; turnId?: TurnId };

// How `reachMessage` ended. The store has said so on the key (`reach`) for `missing` and `failed`.
export type ReachOutcome = 'landed' | 'missing' | 'failed' | 'stopped';

// How long a message the host places at or after what is loaded may take to arrive (a batch on its way) before the
// jump says it is missing.
export const REACH_ARRIVAL_MS = 2_000;

// A receipt's undo state and a spill's load live in the state's `ui` (reduce.ts), so `rowsOf` reports them in the rows.
export { RECEIPT_APPLIED, type ReceiptUndo, type SpillLoad };

export interface TranscriptStore {
  entries: Record<string, TranscriptEntry>;
  // Whether the process producing a key's events is live, as the shell knows it (C5's digest, under its read model's
  // liveness rule); absent when nobody said (the harness, a replay source), where a working turn ticks as before.
  live: Record<string, boolean>;
  setLive(key: string, live: boolean | null): void; // null forgets what was said
  // Resolves when hydrated, or when hydration failed (phase 'failed'). Attachments are counted: the same source attached
  // again (a second surface over one ipcSource, or the view over the source its owner attached) shares the attachment,
  // and each `detach` releases one; the last unsubscribes. A source's reset clears the key and hydrates it again.
  attach(key: string, source: TranscriptSource, options?: { agentId?: AgentId | null }): Promise<void>;
  retry(key: string): Promise<void>; // hydrate a failed key again from its source, keeping its attachments
  detach(key: string): void;
  // UX wave U1c (M3's review, finding 3): keeps the key's attachment, whatever its source, as one more holder, so what
  // follows it lives on when its last view detaches; nothing when no source is attached. The returned function lets go
  // once, and lets go of nothing when another source has replaced that attachment since.
  hold(key: string): () => void;
  drop(key: string): void; // release every attachment and forget the state, and the key's agent lookup
  // L197: the agents the host knows beyond the key's loaded turns (MAWS: the session's task graph, transcript/view/
  // agent-lookup.ts; the desk: its tree), naming a message to or from one no loaded turn launched. Kept for the key
  // across its restarts and resets, until set again; undefined clears it.
  setAgents(key: string, agents: AgentLookup | undefined): void;
  rows(key: string): Row[];
  lastAssistantLine(key: string): string | null;
  activity(key: string): TurnActivity[]; // what each turn did whatever the reader disclosed (C8's summary); stable while no turn changes
  jumpTo(key: string, id: RowId | CellId, options?: { align?: JumpRequest['align']; turnId?: TurnId }): void; // expands what holds the row, then the view scrolls and focuses; `turnId` names the owning turn when the caller knows it (the search then derives that turn alone)
  jumpHandled(key: string, nonce: number): void;
  setFollowing(key: string, following: boolean): void; // a list's report, never a command to another mounted list
  requestSendFollow(key: string): void; // an accepted prompt explicitly returns mounted views to the live end
  setAssistantInk(key: string, row: RowId, turn: TurnId, ink: boolean, source?: 'surface' | 'local'): void;
  clearAssistantInk(key: string, source?: 'surface', retain?: (row: RowId) => boolean): void;
  toggleTurn(key: string, turn: TurnId): void;
  toggleGroup(key: string, group: RowId): void;
  toggleCell(key: string, cell: CellId): void;
  expandAll(key: string, options?: { cells?: boolean }): void; // every turn and group (the harness's "expand all old work"), and with `cells` every cell
  setReceipt(key: string, receipt: RowId, patch: Partial<ReceiptUndo>): void; // the receipt row's state, canUndo and canReapply follow
  setSpill(key: string, path: string, patch: Partial<SpillLoad>): void; // the spill's state and content in its cell detail follow
  toggleBoundary(key: string, boundary: RowId): void; // a rewind boundary reveals or hides the branch it hid
  // P2-C start (2026-10-09; the P2-C document, Design §7): the view the reader chose for the tab.
  // UX wave U2b (the execution document, Interfaces §C): the session's owner-channel lane as the mount knows it (a
  // marked commentary then stays in view when its turn folds) and whether the rows the mount hands the transcript from
  // outside the store hold a message, with `noTurnFold` recomputed in the same update; and a stretch of the to-human
  // view opened or closed again
  // M5: whether the mod draws the view in this window (`modDraws`, §E): it joins the flag's first term, and a change of
  // it closes every stretch the mirror held open (fold states are not carried between the mod and the mirror)
  setToHumanView(key: string, view: { lane: boolean; tailMessage: boolean; modDraws?: boolean }): void;
  // UX wave U2b (M5, R6): the reveal of a jump ends, if `id` is still the tab's revealed row: its rows ask their sites again
  clearRevealed(key: string, id: RowId | CellId): void;
  // UX wave U2b (M1's fix wave): a mounted view of the key and the rows it composes from the key's before the mirror
  // runs over them (its placed rows, browser activity and tail), with the live marks it reads, so a jump opens the
  // stretch each mounted view draws its target in; the returned function releases it (the view unmounts)
  mountView(key: string, compose: ComposeView): () => void;
  setView(key: string, view: 'report' | 'transcript'): void;
  toggleStretch(key: string, stretch: string): readonly string[]; // the keys the stretch's other record line can carry
  // board ticket 850: in each mounted view of the key (the key's own rows when none is mounted), every key the stretch
  // `stretch` names answers to (`keys`, its record lines') and the keys of its folding rows alone (`moving`, its head's
  // not among them): the rows its record line's motion moves
  stretchKeys(key: string, stretch: string): { keys: readonly string[]; moving: readonly string[] };
  // UX wave U1b (the U1b document, Interfaces §B): the calls whose row holds a waiting form, as the session's list says
  // them. An equal set changes nothing; else the turns holding a call that entered or left it derive again, every other
  // turn keeping its rows. A key whose state starts over is told again by its transcript.
  setWaitingForms(key: string, calls: ReadonlySet<ToolUseId>): void;
  // M6 (2026-10-10): a jump to the assistant text with this message uuid and block index (a mark's anchor), wherever its
  // turn has it; false when the key has no such text (not attached, not hydrated yet, or another session's)
  jumpToMessage(key: string, anchor: MessageAnchor): boolean;
  // P2-C end
  // The long-transcript window's jumps into history: whether a source is attached to the key (its history is the
  // source's, not one kept from an earlier mount); a jump to the text wherever it is in the history, the pages back to
  // it loaded first when it is older than what is loaded (`reach` says how that goes, and how it ended when it did not
  // land); and the reader giving up on one, or dismissing how it ended.
  // UX wave U5a (Decision Log 52): read in a selector, it is current: attaching a key and its last detach both notify.
  attached(key: string): boolean;
  reachMessage(key: string, target: ReachTarget): Promise<ReachOutcome>;
  stopReach(key: string): void;
}

const NO_ROWS: Row[] = [];
const NO_CALLS: ReadonlySet<ToolUseId> = new Set(); // UX wave U1b
const NO_ACTIVITY: TurnActivity[] = [];

// The buffer of a live text or thinking row: its block identity is the row id after the kind prefix (keys.ts).
export function liveBuffer(entry: TranscriptEntry | undefined, row: Row): string | null {
  if (row.turnId === null || (row.kind !== 'assistant_text' && row.kind !== 'thinking') || !row.live) return null;
  return liveBlockBuffer(entry, row.turnId, row.id.slice(row.id.indexOf(':') + 1));
}

// The buffer of a streaming block by its identity `<apiMessageId>:<blockIndex>` (a thinking cell inside a group is
// `cell:think:<identity>`).
export function liveBlockBuffer(entry: TranscriptEntry | undefined, turnId: TurnId, identity: string): string | null {
  return entry?.state.turns.get(turnId)?.live.get(identity)?.buffer ?? null;
}

// How long a working turn has run: event time up to the latest event, then wall time since it arrived, so a live
// session and a replay (whose events are old) both tick from what the transcript last heard. With no live process
// (`live` false: a disk-backed session nobody here runs, C5's liveness rule) the events are history and the duration
// stays at the latest event's time: nothing ticks from the wall clock.
export function workingDurationMs(entry: TranscriptEntry | undefined, startedAt: string, now: number, live = true): number {
  const started = Date.parse(startedAt);
  if (!live) return Math.max(0, (entry?.clock?.at ?? started) - started);
  if (!entry?.clock) return Math.max(0, now - started);
  return Math.max(0, entry.clock.at - started + (now - entry.clock.wall));
}

// Whether a key's working turn may tick from the wall clock: unless the shell said its process is not live.
export const ticks = (store: TranscriptStore, key: string) => store.live[key] !== false;

const isExpanded = (state: TranscriptState, id: TurnId) =>
  state.ui.noTurnFold === true /* UX wave U2b: no turn folds while the view is in force */ || state.ui.expandedTurns.has(id) || (state.turns.get(id)?.state === 'open' && !state.ui.collapsedTurns.has(id));

// A copy of the ui for one change. `turns` names the turns whose rows the change touches (their stamps bump, so only
// they re-derive); `'all'` is a whole-transcript change.
function copyUi(ui: TranscriptUi, turns: Iterable<TurnId> | 'all'): TranscriptUi {
  const stamps = new Map(ui.stamps);
  if (turns !== 'all') for (const id of turns) stamps.set(id, (stamps.get(id) ?? 0) + 1);
  return {
    assistantInk: new Set(ui.assistantInk),
    expandedTurns: new Set(ui.expandedTurns), collapsedTurns: new Set(ui.collapsedTurns), expandedGroups: new Set(ui.expandedGroups),
    expandedCells: new Set(ui.expandedCells), revealedBoundaries: new Set(ui.revealedBoundaries), receipts: new Map(ui.receipts), spills: new Map(ui.spills),
    global: turns === 'all' ? ui.global + 1 : ui.global, stamps, version: ui.version + 1,
    ...(ui.ownerLane !== undefined && { ownerLane: ui.ownerLane }), ...(ui.view !== undefined && { view: ui.view }), // P2-C
    openStretches: new Set(ui.openStretches), ...(ui.tailMessage !== undefined && { tailMessage: ui.tailMessage }), ...(ui.noTurnFold !== undefined && { noTurnFold: ui.noTurnFold }), ...(ui.modDraws !== undefined && { modDraws: ui.modDraws }), // UX wave U2b
    ...(ui.revealed !== undefined && { revealed: ui.revealed }), // UX wave U3
    ...(ui.waitingForms !== undefined && { waitingForms: ui.waitingForms }), // UX wave U1b
  };
}

// UX wave U2b (decision 8, R5): whether the session's stored events hold a message, read over each turn's rows as
// derived (kept per rows array, so an unchanged turn is read once). Under the lane a message of a folded turn stays in
// view (`forHuman`, a message tool's call), so the folded rows hold it too; a streaming block is read by its buffer
// (`liveMarkedRowIds`), not by its row's first delta.
const turnMessages = new WeakMap<Row[], boolean>();
function holdsStoredMessage(state: TranscriptState): boolean {
  for (const id of state.order) {
    const rows = turnRows(state, id);
    if (rows === undefined) continue;
    let holds = turnMessages.get(rows);
    if (holds === undefined) turnMessages.set(rows, (holds = holdsMessage(rows, '')));
    if (holds) return true;
  }
  return false;
}

// The guess at a lane turned on, without deriving a turn: a turn whose own events complete a text with a mark, kept per
// turn state. The rows a lane off derives fold a marked commentary away, so they alone would miss it; a guess that is
// wrong either way is settled by `put` (`withViewFlag`) against the rows the lane derives.
const turnMarks = new WeakMap<object, boolean>();
function eventsHoldMark(state: TranscriptState): boolean {
  for (const id of state.order) {
    const turn = state.turns.get(id);
    if (turn === undefined) continue;
    let marked = turnMarks.get(turn);
    if (marked === undefined) {
      marked = turn.events.some((event) => event.kind === 'assistant.block.complete' && event.agentId === turn.agentId && event.block.type === 'text' && typeof event.block.text === 'string' && marksOfText(event.block.text).marked);
      turnMarks.set(turn, marked);
    }
    if (marked) return true;
  }
  return false;
}

// `noTurnFold`: the lane is on or the mod draws the view (M5; decision 8), and the session holds a message, in its
// stored events, in a streaming block of the store, or in the rows the mount hands in from outside (`tailMessage`, which
// `Transcript` writes before paint). Not sticky: when none holds one any more (a reset, a reply an interrupt cut), the
// turn fold returns.
const inForce = (state: TranscriptState): boolean =>
  (state.ui.ownerLane === true || state.ui.modDraws === true) && (state.ui.tailMessage === true || holdsStoredMessage(state) || liveMarkedRowIds(state) !== '');

// The state with `noTurnFold` as its events, its streaming blocks, its lane and its outside rows make it: a change of
// it re-derives every turn once (no turn folds while it is set).
function withViewFlag(state: TranscriptState): TranscriptState {
  const flag = inForce(state);
  if (flag === (state.ui.noTurnFold === true)) return state;
  const ui = copyUi(state.ui, 'all');
  ui.noTurnFold = flag;
  return withUi(state, ui);
}

// The turn a visible row or cell belongs to (a toggle acts on what the reader sees), or null when it is not shown.
function turnOfShown(rows: Row[], id: string): TurnId | null {
  return locate(rows, id)?.row.turnId ?? null;
}

const expandTurn = (ui: TranscriptUi, id: TurnId) => {
  ui.expandedTurns.add(id);
  ui.collapsedTurns.delete(id);
};

// The rows with every turn expanded, derived on a private memo so the store's own memo is untouched (the version -1
// never equals a real ui version). For locating rows that a collapsed turn hides.
function allExpandedRows(state: TranscriptState): Row[] {
  const turns = [...state.order, ...(state.hidden?.turns ?? [])];
  return rowsOf({ ...state, memo: new Map(), ui: { ...state.ui, expandedTurns: new Set(turns), collapsedTurns: new Set(), version: -1 } });
}

// Where a row or cell lives: the list row that shows it, and the turn and group that must be open.
function locate(rows: Row[], id: string): { row: Row; group: Row | null } | null {
  for (const row of rows) {
    if (row.id === id) return { row, group: null };
    if (row.kind === 'group' && row.cells.some((cell) => cell.id === id)) return { row, group: row };
  }
  // board ticket 852: a run of one by its run's id, only where no row is that run itself (a later copy of the same call,
  // as a replay's echo of a seeded history draws one, is a run of the same id)
  for (const row of rows) if (row.kind === 'cell' && drawsAsRun(row) && runOfOneId(row) === id) return { row, group: null };
  return null;
}

// *Virtualisation and anchoring*: a turn that finished while the reader was elsewhere stays open until they close it;
// one that finished under a following reader collapses (the default for a closed turn).
function keepFinishedTurnsOpen(previous: TranscriptState, next: TranscriptState, following: boolean): TranscriptState {
  if (following) return next;
  const keep: TurnId[] = [];
  for (const [id, turn] of next.turns) {
    const before = previous.turns.get(id);
    if (turn === before || turn.state !== 'closed' || before?.state !== 'open') continue;
    if (!next.ui.collapsedTurns.has(id) && !next.ui.expandedTurns.has(id)) keep.push(id);
  }
  if (keep.length === 0) return next;
  const ui = copyUi(next.ui, keep);
  for (const id of keep) ui.expandedTurns.add(id);
  return withUi(next, ui);
}

// Per key: the source it follows, how many holders attached it, the current hydration (null once it failed) and its
// settlement (what `attach` resolves), and the source's reset subscription.
interface Attached {
  source: TranscriptSource;
  agentId: AgentId | null;
  count: number;
  attachment: Attachment | null;
  settled: Promise<void>;
  offReset: (() => void) | null;
  offRebuild: (() => void) | null; // the long-transcript window: the source's rebuild subscription
  // Set while the key is being started over: each hydration builds a fresh state (with this ui, what the reader had
  // opened) and installs it only once its snapshot has applied, so the old rows stay on screen until then, and stay if
  // the snapshot fails (a retry stages afresh).
  restartUi: TranscriptUi | null;
  // The last jump asked for while staging: it opened rows of the old state only, so it is resolved again on the
  // installed one, whether or not the view has handled it meanwhile.
  stagedJump: Pick<JumpRequest, 'focus' | 'align'> | null;
}

export function createTranscriptStore() {
  const attachments = new Map<string, Attached>();
  const lookups = new Map<string, AgentLookup>(); // L197: each key's host agent lookup, applied to every state it starts
  const fresh = (key: string, agentId: AgentId | null, ui?: TranscriptUi): TranscriptState => {
    const state = createState(null, agentId);
    return withAgents(ui === undefined ? state : { ...state, ui }, lookups.get(key));
  };
  let nonce = 0;
  const reaching = new Map<string, number>(); // each key's jump into history in progress, by its run
  const views = new Map<string, Set<ComposeView>>(); // UX wave U2b: each key's mounted views (`mountView`)
  let reachRun = 0;
  return create<TranscriptStore>()((set, get, api) => {
    const entry = (key: string) => get().entries[key] as TranscriptEntry | undefined;
    const release = (attached: Attached) => {
      attached.source.older?.stopSeek?.();
      attached.attachment?.detach();
      attached.attachment = null;
      attached.offRebuild?.();
      attached.offRebuild = null;
      attached.offReset?.();
    };
    // The hydration protocol (source/hydrate.ts) over the key's current state. Resolves either way; a failure is
    // recorded on the key (hydrate.ts has already unsubscribed and cleared its buffer) and `retry` starts over.
    const hydrate = (key: string, attached: Attached): Promise<void> => {
      attached.attachment?.detach();
      let staged: TranscriptState | null = attached.restartUi === null ? null : fresh(key, attached.agentId, attached.restartUi);
      let stagedAt = 0;
      const attachment = attachSource(attached.source, {
        apply(events) {
          if (staged !== null) {
            staged = applyEvents(staged, events);
            stagedAt = Math.max(stagedAt, ...events.slice(-1).map((event) => Date.parse(event.at)));
            return;
          }
          const current = entry(key)!;
          const next = applyEvents(current.state, events);
          const at = Math.max(current.clock?.at ?? 0, ...events.slice(-1).map((event) => Date.parse(event.at)));
          put(key, { state: keepFinishedTurnsOpen(current.state, next, current.following), clock: { at, wall: Date.now() } });
        },
        has: (id) => (staged !== null ? staged.seen.has(id) : (entry(key)?.state.seen.has(id) ?? false)),
      });
      attached.attachment = attachment;
      const current = () => attachments.get(key) === attached && attached.attachment === attachment;
      attached.settled = attachment.hydrated.then(
        () => {
          if (!current()) return;
          if (staged !== null) {
            const state = withAgents(staged, lookups.get(key)); // a lookup set while staging applies too
            staged = null; // later batches apply to the installed state
            attached.restartUi = null;
            // A jump asked for during the round trip (C5 remounting a kept session at an attention item's row) was
            // resolved against the old state, and the view may already have handled it there; it is resolved again, by
            // the id it targets, on the installed one, so installing never closes what the jump opened. So is a jump
            // asked for before the restart that the view has not handled yet.
            const pending = attached.stagedJump ?? entry(key)?.jump ?? null;
            attached.stagedJump = null;
            put(key, { state, phase: 'live', clock: stagedAt > 0 ? { at: stagedAt, wall: Date.now() } : null, jump: null, cronHistory: cronHistoryOf(attached) });
            if (pending) jump(key, pending.focus, { align: pending.align }, true);
          } else put(key, { phase: 'live', cronHistory: cronHistoryOf(attached) });
        },
        (reason: unknown) => {
          if (!current()) return;
          attached.attachment = null;
          put(key, { phase: 'failed', error: reason instanceof Error ? reason.message : String(reason) });
        },
      );
      return attached.settled;
    };
    // What the source's newest window carried of its older history's cron calls, taken with the history it answered:
    // installed with it, so a staged restart that fails keeps the carry of the history it keeps.
    const cronHistoryOf = (attached: Attached) => attached.source.older?.state.getState().cronHistory;
    const put = (key: string, patch: Partial<TranscriptEntry>) => {
      const current = entry(key);
      if (!current) return;
      const next = { ...current, ...patch };
      if (patch.state) {
        next.state = withViewFlag(patch.state); // UX wave U2b: in the same update as the events, the lane, the outside rows
        next.rows = rowsOf(next.state);
        next.working = next.state.current !== null;
        // UX wave U2b: an opening whose row the update took away passes to a surviving identity (`carriedKeys`), read over
        // the rows each mounted view composes before and after the update, as the list draws them (a standalone browser
        // activity splits a stretch there); over the key's own rows when none is mounted. Composed only when the key's
        // own rows lost a row an open key named, since a view's rows are the key's rows with its own placed among them.
        const open = next.state.ui.openStretches;
        let carried: string[] = [];
        if (open !== undefined && lostKey(current.rows, next.rows, open)) {
          const after = composedViews(key, next);
          carried = [...new Set(composedViews(key, current).flatMap((view, i) => carriedKeys(view.rows, after[i].rows, open, view.liveMarked)))];
        }
        if (carried.length > 0) {
          const ui = copyUi(next.state.ui, []);
          for (const name of carried) ui.openStretches!.add(name);
          next.state = withUi(next.state, ui);
          next.rows = rowsOf(next.state); // no turn rebuilt: the same rows, read from the state they now belong to
        }
      }
      set({ entries: { ...get().entries, [key]: next } });
    };
    const changeUi = (key: string, turns: (current: TranscriptEntry) => Iterable<TurnId> | 'all', change: (ui: TranscriptUi, state: TranscriptState) => void) => {
      const current = entry(key);
      if (!current) return;
      const ui = copyUi(current.state.ui, turns(current));
      change(ui, current.state);
      put(key, { state: withUi(current.state, ui) });
    };
    const toggle = <T>(values: Set<T>, value: T) => (values.has(value) ? values.delete(value) : values.add(value));
    // `jumpTo`, and the re-resolution of a staged jump at install (`reissued`).
    const jump = (key: string, id: RowId | CellId, options: { align?: JumpRequest['align']; turnId?: TurnId }, reissued: boolean) => {
      const current = entry(key);
      if (!current) return;
      const request = (rowId: RowId): JumpRequest => ({ rowId, focus: id, align: options.align ?? 'center', nonce: ++nonce, ...(reissued ? { reissued } : {}) });
      const attached = attachments.get(key);
      if (attached?.restartUi) attached.stagedJump = { focus: id, align: options.align ?? 'center' }; // staging: resolved again at install
      const visible = locate(current.rows, id);
      // UX wave U3 (the U3a document, Interfaces F): the jump's target is the tab's revealed row, replacing the last; what
      // a turn's rows depend on bumps for the turns of the old target and the new (the old one's as it is shown)
      const before = current.state.ui.revealed;
      const left = before === undefined || before === id ? [] : [turnOfShown(current.rows, before)].filter((turn): turn is TurnId => turn !== null);
      const touched = (turn: TurnId | null): TurnId[] => [...new Set([...(turn === null ? [] : [turn]), ...left])];
      // UX wave U2b (Interfaces §C): in the to-human view MAWS draws, a row inside a closed stretch is out of sight: the
      // jump opens the stretch that holds it
      const closed = closedStretchesHolding(key, current, id);
      // board ticket 852: a run of one drawn folded holds its call out of sight, as a folded run does
      const foldedRunOfOne = (row: Row) => row.kind === 'cell' && row.id === id && drawsAsRun(row) && !current.state.ui.expandedGroups.has(runOfOneId(row));
      if (visible && (!visible.group || (visible.group.kind === 'group' && visible.group.expanded)) && !foldedRunOfOne(visible.row) && closed.length === 0) {
        const ui = copyUi(current.state.ui, touched(visible.row.turnId));
        ui.revealed = id;
        put(key, { state: withUi(current.state, ui), jump: request(visible.row.id) });
        return;
      }
      const found = visible ?? (options.turnId ? locate(expandedTurnRows(current.state, options.turnId), id) : null) ?? locate(allExpandedRows(current.state), id);
      if (!found) return;
      const ui = copyUi(current.state.ui, found.row.turnId === null ? 'all' : touched(found.row.turnId));
      ui.revealed = id; // UX wave U3
      for (const stretch of closed) ui.openStretches!.add(stretch); // UX wave U2b
      if (found.row.turnId !== null && !isExpanded(current.state, found.row.turnId)) expandTurn(ui, found.row.turnId);
      if (found.group) ui.expandedGroups.add(found.group.id);
      if (foldedRunOfOne(found.row)) ui.expandedGroups.add(runOfOneId(found.row as Extract<Row, { kind: 'cell' }>)); // board ticket 852
      put(key, { state: withUi(current.state, ui), jump: request(found.row.id) });
    };
    // The keys of the closed stretches whose records hold the row or cell out of sight, while the view is the report, is
    // in force and MAWS draws it; none otherwise. Read over the rows each mounted view composes, since what a view places
    // among the key's rows (a standalone browser activity, which stays in sight) can split a stretch; over the key's own
    // rows when no view is mounted. Mounted views that compose alike name one stretch.
    const closedStretchesHolding = (key: string, current: TranscriptEntry, id: RowId | CellId): string[] => {
      if (!mirrorsView(current.state.ui)) return [];
      const open = current.state.ui.openStretches;
      const holding = composedViews(key, current).map(({ rows, liveMarked }) => stretchHolding(rows, id, liveMarked, open));
      return [...new Set(holding.filter((stretch): stretch is string => stretch !== null && !(open?.has(stretch) ?? false)))];
    };
    // The rows each mounted view of the key composes before the mirror; the key's own rows when none is mounted.
    const composedViews = (key: string, current: TranscriptEntry): ReturnType<ComposeView>[] => {
      const mounted = views.get(key);
      return mounted?.size ? [...mounted].map((compose) => compose(current)) : [{ rows: current.rows, liveMarked: liveMarkedRowIds(current.state) }];
    };
    const scoped = (turn: TurnId | null): TurnId[] | 'all' => (turn === null ? 'all' : [turn]);
    // A jump to a cell wherever its turn has it (`jumpTo`'s search); false when the key holds no such cell.
    const jumpToCell = (key: string, cell: CellId, turnId?: TurnId): boolean => {
      const current = entry(key);
      if (!current) return false;
      const found = locate(current.rows, cell) ?? (turnId ? locate(expandedTurnRows(current.state, turnId), cell) : null) ?? locate(allExpandedRows(current.state), cell);
      if (!found) return false;
      jump(key, cell, { align: 'center', ...(turnId && { turnId }) }, false);
      return true;
    };

    return {
      entries: {},
      live: {},

      setLive(key, live) {
        if ((get().live[key] ?? null) === live) return;
        const next = { ...get().live };
        if (live === null) delete next[key];
        else next[key] = live;
        set({ live: next });
      },

      attach(key, source, options = {}) {
        // The same source attached again keeps the attachment: detaching would drop the batches it buffered while
        // hydrating, which the source never resends.
        const existing = attachments.get(key);
        if (existing?.source === source) {
          existing.count += 1;
          return existing.settled;
        }
        if (existing) release(existing);
        const kept = entry(key);
        if (!kept) {
          const state = fresh(key, options.agentId ?? null);
          set({ entries: { ...get().entries, [key]: { state, rows: rowsOf(state), phase: 'hydrating', error: null, following: true, sendFollowRequest: 0, working: false, clock: null, jump: null } } });
        } else put(key, { phase: 'hydrating', error: null });
        // Starting a kept key over (no holder left): the snapshot is the whole history, and after an exit or a child's
        // finish nobody observed it may carry the other id form (disk uuids for live ids), which id deduplication
        // cannot recognise. The reducer state starts over in a staged state installed once the snapshot has applied;
        // what the reader opened is kept, keyed by ids that resolve again when the history is in the same form.
        const attached: Attached = { source, agentId: options.agentId ?? null, count: 1, attachment: null, settled: Promise.resolve(), offReset: null, offRebuild: null, restartUi: kept ? kept.state.ui : null, stagedJump: null };
        attachments.set(key, attached);
        // A reset (a child source switching from its live stream to its disk transcript): the key starts over.
        attached.offReset = source.onReset?.(() => {
          if (attachments.get(key) !== attached) return;
          attached.restartUi = null; // an explicit reset empties the key at once
          attached.stagedJump = null;
          const state = fresh(key, attached.agentId);
          put(key, { state, localAssistantInk: undefined, phase: 'hydrating', error: null, clock: null, jump: null });
          hydrate(key, attached);
        }) ?? null;
        // A rebuild (an older page joined the source's history): the key hydrates again from the source's snapshot,
        // staged under what the reader had opened, so the drawn rows stay until the rebuilt state is whole.
        attached.offRebuild = source.onRebuild?.(() => {
          if (attachments.get(key) !== attached) return;
          attached.restartUi = entry(key)?.state.ui ?? null;
          put(key, { phase: 'hydrating', error: null });
          hydrate(key, attached);
        }) ?? null;
        return hydrate(key, attached);
      },

      retry(key) {
        const attached = attachments.get(key);
        if (!attached || attached.attachment) return attached?.settled ?? Promise.resolve();
        put(key, { phase: 'hydrating', error: null });
        return hydrate(key, attached);
      },

      detach(key) {
        const attached = attachments.get(key);
        if (!attached || --attached.count > 0) return;
        release(attached);
        attachments.delete(key);
        set({}); // UX wave U5a (Decision Log 52): `attached(key)` changed, so a selector that reads it is asked again
      },

      hold(key) {
        const attached = attachments.get(key);
        if (!attached) return () => {};
        attached.count += 1;
        let held = true;
        return () => {
          if (!held) return;
          held = false;
          if (attachments.get(key) === attached) get().detach(key);
        };
      },

      drop(key) {
        const attached = attachments.get(key);
        if (attached) release(attached);
        attachments.delete(key);
        lookups.delete(key);
        const entries = { ...get().entries };
        delete entries[key];
        set({ entries });
      },

      setAgents(key, agents) {
        if (agents === undefined) lookups.delete(key);
        else lookups.set(key, agents);
        const current = entry(key);
        if (current && current.state.agents !== agents) put(key, { state: withAgents(current.state, agents) });
      },

      rows: (key) => entry(key)?.rows ?? NO_ROWS,
      activity: (key) => {
        const current = entry(key);
        return current ? turnActivity(current.state) : NO_ACTIVITY;
      },

      lastAssistantLine(key) {
        const current = entry(key);
        const row = current?.rows.findLast((candidate) => candidate.kind === 'assistant_text');
        if (!current || row?.kind !== 'assistant_text') return null;
        const text = liveBuffer(current, row) ?? row.markdown;
        return text.split('\n').map((line) => line.trim()).findLast((line) => line.length > 0) ?? null;
      },

      jumpTo: (key, id, options = {}) => jump(key, id, options, false),

      jumpHandled(key, handled) {
        if (entry(key)?.jump?.nonce === handled) put(key, { jump: null });
      },

      setFollowing(key, following) {
        if (entry(key) && entry(key)!.following !== following) put(key, { following });
      },

      requestSendFollow(key) {
        const current = entry(key);
        if (current) put(key, { following: true, sendFollowRequest: current.sendFollowRequest + 1 });
      },

      setAssistantInk(key, row, turn, ink, source = 'surface') {
        const current = entry(key);
        if (!current) return;
        const local = ink && source === 'local';
        const changedInk = current.state.ui.assistantInk.has(row) !== ink;
        if (!changedInk && (current.localAssistantInk?.has(row) ?? false) === local) return;
        const localAssistantInk = new Set(current.localAssistantInk);
        if (local) localAssistantInk.add(row); else localAssistantInk.delete(row);
        const patch: Partial<TranscriptEntry> = { localAssistantInk };
        if (changedInk) {
          const ui = copyUi(current.state.ui, [turn]);
          if (ink) ui.assistantInk.add(row); else ui.assistantInk.delete(row);
          patch.state = withUi(current.state, ui);
        }
        put(key, patch);
      },
      clearAssistantInk(key, source, retain) {
        const current = entry(key);
        if (!current?.state.ui.assistantInk.size) return;
        const remove = [...current.state.ui.assistantInk].filter((row) => !retain?.(row) && (source !== 'surface' || !current.localAssistantInk?.has(row)));
        if (!remove.length) return;
        const ui = copyUi(current.state.ui, 'all');
        for (const row of remove) ui.assistantInk.delete(row);
        put(key, { state: withUi(current.state, ui), ...(source ? {} : { localAssistantInk: undefined }) });
      },
      toggleTurn(key, turn) {
        changeUi(key, () => [turn], (ui, state) => {
          if (isExpanded(state, turn)) {
            ui.expandedTurns.delete(turn);
            ui.collapsedTurns.add(turn);
          } else expandTurn(ui, turn);
        });
      },

      toggleGroup: (key, group) => changeUi(key, (current) => scoped(turnOfShown(current.rows, group)), (ui) => toggle(ui.expandedGroups, group)),
      toggleCell: (key, cell) => changeUi(key, (current) => scoped(turnOfShown(current.rows, cell)), (ui) => toggle(ui.expandedCells, cell)),

      setReceipt(key, receipt, patch) {
        const current = entry(key);
        if (!current) return;
        const receipts = new Map(current.state.ui.receipts).set(receipt, { ...(current.state.ui.receipts.get(receipt) ?? RECEIPT_APPLIED), ...patch });
        put(key, { state: withReaderState(current.state, { receipts }) });
      },
      setSpill(key, path, patch) {
        const current = entry(key);
        if (!current) return;
        const spills = new Map(current.state.ui.spills).set(path, { state: 'not_loaded', content: null, error: null, ...current.state.ui.spills.get(path), ...patch });
        put(key, { state: withReaderState(current.state, { spills }) });
      },
      toggleBoundary: (key, boundary) => changeUi(key, () => 'all', (ui) => toggle(ui.revealedBoundaries, boundary)),

      // P2-C start (2026-10-09)
      // UX wave U2b (R5): the flag is guessed with the lane as it will be, from the turns as they are (no turn derived
      // for it), so a lane turned on over a history that holds a message derives every turn once; `put` settles it
      // M5: the mod drawing joins the guess as the lane does (with the lane off a folded turn's rows hold no marked
      // commentary), and a change of who draws closes every stretch the mirror held open
      setToHumanView(key, { lane, tailMessage, modDraws }) {
        const current = entry(key);
        if (!current) return;
        const was = current.state.ui;
        const draws = modDraws ?? was.modDraws ?? false;
        const laneChanged = (was.ownerLane ?? false) !== lane;
        const drawsChanged = (was.modDraws ?? false) !== draws;
        if (!laneChanged && (was.tailMessage ?? false) === tailMessage && !drawsChanged) return;
        const flag = inForce({ ...current.state, ui: { ...was, ownerLane: lane, tailMessage, modDraws: draws } }) || ((lane || draws) && (laneChanged || drawsChanged) && eventsHoldMark(current.state));
        const flagChanged = flag !== (was.noTurnFold === true);
        changeUi(key, () => (laneChanged || drawsChanged || flagChanged ? 'all' : []), (ui) => {
          ui.ownerLane = lane;
          ui.tailMessage = tailMessage;
          ui.noTurnFold = flag;
          if (modDraws !== undefined) ui.modDraws = modDraws;
          if (drawsChanged) ui.openStretches = new Set();
        });
      },
      clearRevealed(key, id) {
        const current = entry(key);
        if (current?.state.ui.revealed !== id) return;
        const turn = turnOfShown(current.rows, id);
        changeUi(key, () => (turn === null ? 'all' : [turn]), (ui) => void delete ui.revealed);
      },
      setView(key, view) {
        if (entry(key)?.state.ui.view === view) return;
        changeUi(key, () => [], (ui) => void (ui.view = view));
      },
      // UX wave U2b: a press on a closed record line opens its stretch by the key the line carries; one on an open
      // stretch's `‹ fold to report` folds it, taking every open key it holds (two opened stretches can since have met)
      toggleStretch(key, stretch) {
        const current = entry(key);
        if (!current) return [stretch];
        const open = current.state.ui.openStretches ?? new Set<string>();
        const views = composedViews(key, current);
        const held = open.has(stretch) ? new Set([stretch, ...views.flatMap(({ rows, liveMarked }) => openKeysOf(rows, stretch, open, liveMarked))]) : null;
        changeUi(key, () => [], (ui) => {
          if (held === null) ui.openStretches!.add(stretch);
          else for (const name of held) ui.openStretches!.delete(name);
        });
        // opened, its open line carries the key just written; folded, its closed line carries its first row's key, one of
        // the keys its rows answer to
        return held === null ? [stretch] : [...new Set([stretch, ...views.flatMap(({ rows, liveMarked }) => keysOfStretch(rows, stretch, liveMarked))])];
      },
      stretchKeys(key, stretch) {
        const current = entry(key);
        const views = current ? composedViews(key, current) : [];
        return {
          keys: [...new Set([stretch, ...views.flatMap(({ rows, liveMarked }) => keysOfStretch(rows, stretch, liveMarked))])],
          moving: [...new Set(views.flatMap(({ rows, liveMarked }) => movingKeysOfStretch(rows, stretch, liveMarked)))],
        };
      },
      mountView(key, compose) {
        let mounted = views.get(key);
        if (!mounted) views.set(key, (mounted = new Set()));
        mounted.add(compose);
        return () => {
          mounted.delete(compose);
          if (mounted.size === 0 && views.get(key) === mounted) views.delete(key);
        };
      },
      // UX wave U1b
      setWaitingForms(key, calls) {
        const current = entry(key);
        if (!current) return;
        const held = current.state.ui.waitingForms ?? NO_CALLS;
        const changed = [...calls].filter((call) => !held.has(call)).concat([...held].filter((call) => !calls.has(call)));
        if (changed.length === 0) return;
        const turns = new Set(changed.flatMap((call) => current.state.index.toolUses.get(call) ?? []));
        changeUi(key, () => turns, (ui) => void (ui.waitingForms = new Set(calls)));
      },
      attached: (key) => attachments.has(key),

      async reachMessage(key, target) {
        const anchor = target;
        const land = () => ('cell' in target ? jumpToCell(key, target.cell, target.turnId) : get().jumpToMessage(key, target));
        const run = ++reachRun;
        const previous = reaching.get(key);
        reaching.set(key, run);
        if (previous !== undefined) attachments.get(key)?.source.older?.stopSeek?.();
        const mine = () => reaching.get(key) === run;
        const end = (outcome: ReachOutcome, reach?: Reach): ReachOutcome => {
          if (!mine()) return 'stopped';
          reaching.delete(key);
          if (entry(key) && entry(key)!.reach !== reach) put(key, { reach });
          return outcome;
        };
        if (land()) return end('landed');
        const attached = attachments.get(key);
        const pages = attached?.source.older;
        put(key, { reach: { anchor, phase: 'loading', progress: null } });
        if (attached && pages?.seek) {
          const result = await pages.seek(anchor.messageUuid, (progress) => {
            if (mine()) put(key, { reach: { anchor, phase: 'loading', progress } });
          });
          if (!mine()) return 'stopped';
          if (result.outcome === 'stopped') return end('stopped');
          if (result.outcome === 'failed') return end('failed', { anchor, phase: 'failed', error: result.error });
          if (result.outcome === 'absent') return end('missing', { anchor, phase: 'missing' });
          if (result.outcome === 'found') {
            await (attachments.get(key) ?? attached).settled; // the rebuild the page started
            if (!mine()) return 'stopped';
            return land() ? end('landed') : end('missing', { anchor, phase: 'missing' });
          }
        }
        // The text is not older than what is loaded: it is on its way, or in none of the history.
        const landed = await new Promise<boolean>((resolve) => {
          let done = false;
          const finish = (value: boolean) => {
            done = true;
            clearTimeout(timer);
            off();
            resolve(value);
          };
          const timer = setTimeout(() => finish(false), REACH_ARRIVAL_MS);
          let searched: TranscriptEntry | undefined; // searched without the text: unchanged, it is not searched again
          const check = () => {
            if (done) return;
            if (!mine()) return finish(false);
            const current = entry(key);
            if (current?.phase !== 'live' || current === searched) return;
            done = true; // the jump's own change re-enters here
            if (land()) return finish(true);
            done = false;
            searched = entry(key);
          };
          const off = api.subscribe(check);
          check(); // what is loaded now: a page the reader asked for may have brought the text while the seek waited for it
        });
        return landed ? end('landed') : end('missing', { anchor, phase: 'missing' });
      },

      stopReach(key) {
        if (reaching.delete(key)) attachments.get(key)?.source.older?.stopSeek?.();
        if (entry(key)?.reach) put(key, { reach: undefined });
      },

      jumpToMessage(key, { messageUuid, blockIndex }) {
        const current = entry(key);
        if (!current) return false;
        const text = (row: Row) => row.kind === 'assistant_text' && row.messageUuid === messageUuid && row.blockIndex === blockIndex;
        const row = current.rows.find(text) ?? allExpandedRows(current.state).find(text);
        if (!row) return false;
        jump(key, row.id, { ...(row.turnId !== null && { turnId: row.turnId }) }, false);
        return true;
      },
      // P2-C end

      expandAll(key, options = {}) {
        changeUi(key, () => 'all', (ui, state) => {
          for (const id of state.order) expandTurn(ui, id);
          for (const row of allExpandedRows(state)) {
            if (row.kind === 'group') ui.expandedGroups.add(row.id);
            if (row.kind === 'cell' && drawsAsRun(row)) ui.expandedGroups.add(runOfOneId(row)); // board ticket 852: a run of one opens as a run does
            if (!options.cells) continue;
            if (row.kind === 'group') for (const cell of row.cells) ui.expandedCells.add(cell.id);
            else if (row.kind === 'cell') ui.expandedCells.add(row.id);
          }
        });
      },
    };
  });
}

export const useTranscriptStore = createTranscriptStore();

// Development only: a hot update of this module, or of one it imports (transcript/model/ propagates here), would make a
// second store that the mounted transcript never reads, so the page reloads instead (main's window guard lets the dev
// server's page reload itself: `guardWindowNavigation`). Keeping the store through `import.meta.hot.data` would not do:
// the kept store's closures read the old module's imports. Builds drop this line.
import.meta.hot?.accept(() => location.reload());
