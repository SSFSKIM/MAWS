// The transcript store (C6 execution document, Public surface): one TranscriptState per key (`appSessionId`, or
// `appSessionId:agentId` for a child), attached to a TranscriptSource through the hydration protocol
// (source/hydrate.ts), with the reader's expansion state, follow mode and jump requests. Rows are derived once per
// change with `rowsOf`, whose per-turn memo keeps unchanged rows by reference; a streaming block's later deltas change
// no row, and the live row reads its buffer through `liveBuffer`, so a token re-renders one component.
import { create } from 'zustand';
import type { AgentId } from '@shared/graph/ids';
import { turnActivity, type TurnActivity } from '../transcript/model/activity';
import { expandedTurnRows, rowsOf } from '../transcript/model/derive';
import { applyEvents, createState, RECEIPT_APPLIED, withReaderState, withUi, type ReceiptUndo, type SpillLoad, type TranscriptState, type TranscriptUi } from '../transcript/model/reduce';
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
  phase: 'hydrating' | 'live' | 'failed'; // failed: the snapshot rejected; the key is detached and `attach` may be called again
  error: string | null; // why the last attach failed
  following: boolean;
  working: boolean; // a turn is open
  clock: { at: number; wall: number } | null; // the latest event time applied, and the wall time it arrived: a working divider ticks from it
  jump: JumpRequest | null;
}

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
  drop(key: string): void; // release every attachment and forget the state
  rows(key: string): Row[];
  lastAssistantLine(key: string): string | null;
  activity(key: string): TurnActivity[]; // what each turn did whatever the reader disclosed (C8's summary); stable while no turn changes
  jumpTo(key: string, id: RowId | CellId, options?: { align?: JumpRequest['align']; turnId?: TurnId }): void; // expands what holds the row, then the view scrolls and focuses; `turnId` names the owning turn when the caller knows it (the search then derives that turn alone)
  jumpHandled(key: string, nonce: number): void;
  setFollowing(key: string, following: boolean): void;
  setAssistantInk(key: string, row: RowId, turn: TurnId, ink: boolean): void;
  clearAssistantInk(key: string): void;
  toggleTurn(key: string, turn: TurnId): void;
  toggleGroup(key: string, group: RowId): void;
  toggleCell(key: string, cell: CellId): void;
  expandAll(key: string, options?: { cells?: boolean }): void; // every turn and group (the harness's "expand all old work"), and with `cells` every cell
  setReceipt(key: string, receipt: RowId, patch: Partial<ReceiptUndo>): void; // the receipt row's state, canUndo and canReapply follow
  setSpill(key: string, path: string, patch: Partial<SpillLoad>): void; // the spill's state and content in its cell detail follow
  toggleBoundary(key: string, boundary: RowId): void; // a rewind boundary reveals or hides the branch it hid
}

const NO_ROWS: Row[] = [];
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
  state.ui.expandedTurns.has(id) || (state.turns.get(id)?.state === 'open' && !state.ui.collapsedTurns.has(id));

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
  };
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
  let nonce = 0;
  return create<TranscriptStore>()((set, get) => {
    const entry = (key: string) => get().entries[key] as TranscriptEntry | undefined;
    const release = (attached: Attached) => {
      attached.attachment?.detach();
      attached.attachment = null;
      attached.offReset?.();
    };
    // The hydration protocol (source/hydrate.ts) over the key's current state. Resolves either way; a failure is
    // recorded on the key (hydrate.ts has already unsubscribed and cleared its buffer) and `retry` starts over.
    const hydrate = (key: string, attached: Attached): Promise<void> => {
      attached.attachment?.detach();
      let staged: TranscriptState | null = attached.restartUi === null ? null : { ...createState(null, attached.agentId), ui: attached.restartUi };
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
            const state = staged;
            staged = null; // later batches apply to the installed state
            attached.restartUi = null;
            // A jump asked for during the round trip (C5 remounting a kept session at an attention item's row) was
            // resolved against the old state, and the view may already have handled it there; it is resolved again, by
            // the id it targets, on the installed one, so installing never closes what the jump opened. So is a jump
            // asked for before the restart that the view has not handled yet.
            const pending = attached.stagedJump ?? entry(key)?.jump ?? null;
            attached.stagedJump = null;
            put(key, { state, phase: 'live', clock: stagedAt > 0 ? { at: stagedAt, wall: Date.now() } : null, jump: null });
            if (pending) jump(key, pending.focus, { align: pending.align }, true);
          } else put(key, { phase: 'live' });
        },
        (reason: unknown) => {
          if (!current()) return;
          attached.attachment = null;
          put(key, { phase: 'failed', error: reason instanceof Error ? reason.message : String(reason) });
        },
      );
      return attached.settled;
    };
    const put = (key: string, patch: Partial<TranscriptEntry>) => {
      const current = entry(key);
      if (!current) return;
      const next = { ...current, ...patch };
      if (patch.state) {
        next.rows = rowsOf(patch.state);
        next.working = patch.state.current !== null;
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
      if (visible && (!visible.group || (visible.group.kind === 'group' && visible.group.expanded))) {
        put(key, { jump: request(visible.row.id) });
        return;
      }
      const found = visible ?? (options.turnId ? locate(expandedTurnRows(current.state, options.turnId), id) : null) ?? locate(allExpandedRows(current.state), id);
      if (!found) return;
      const ui = copyUi(current.state.ui, found.row.turnId === null ? 'all' : [found.row.turnId]);
      if (found.row.turnId !== null && !isExpanded(current.state, found.row.turnId)) expandTurn(ui, found.row.turnId);
      if (found.group) ui.expandedGroups.add(found.group.id);
      put(key, { state: withUi(current.state, ui), jump: request(found.row.id) });
    };
    const scoped = (turn: TurnId | null): TurnId[] | 'all' => (turn === null ? 'all' : [turn]);

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
          const state = createState(null, options.agentId ?? null);
          set({ entries: { ...get().entries, [key]: { state, rows: rowsOf(state), phase: 'hydrating', error: null, following: true, working: false, clock: null, jump: null } } });
        } else put(key, { phase: 'hydrating', error: null });
        // Starting a kept key over (no holder left): the snapshot is the whole history, and after an exit or a child's
        // finish nobody observed it may carry the other id form (disk uuids for live ids), which id deduplication
        // cannot recognise. The reducer state starts over in a staged state installed once the snapshot has applied;
        // what the reader opened is kept, keyed by ids that resolve again when the history is in the same form.
        const attached: Attached = { source, agentId: options.agentId ?? null, count: 1, attachment: null, settled: Promise.resolve(), offReset: null, restartUi: kept ? kept.state.ui : null, stagedJump: null };
        attachments.set(key, attached);
        // A reset (a child source switching from its live stream to its disk transcript): the key starts over.
        attached.offReset = source.onReset?.(() => {
          if (attachments.get(key) !== attached) return;
          attached.restartUi = null; // an explicit reset empties the key at once
          attached.stagedJump = null;
          const state = createState(null, attached.agentId);
          put(key, { state, phase: 'hydrating', error: null, clock: null, jump: null });
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
      },

      drop(key) {
        const attached = attachments.get(key);
        if (attached) release(attached);
        attachments.delete(key);
        const entries = { ...get().entries };
        delete entries[key];
        set({ entries });
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

      setAssistantInk(key, row, turn, ink) {
        if (!entry(key) || entry(key)!.state.ui.assistantInk.has(row) === ink) return;
        changeUi(key, () => [turn], (ui) => { if (ink) ui.assistantInk.add(row); else ui.assistantInk.delete(row); });
      },
      clearAssistantInk(key) {
        if (!entry(key)?.state.ui.assistantInk.size) return;
        changeUi(key, () => 'all', (ui) => ui.assistantInk.clear());
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

      expandAll(key, options = {}) {
        changeUi(key, () => 'all', (ui, state) => {
          for (const id of state.order) expandTurn(ui, id);
          for (const row of allExpandedRows(state)) {
            if (row.kind === 'group') ui.expandedGroups.add(row.id);
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
