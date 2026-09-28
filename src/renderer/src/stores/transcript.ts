// The transcript store (C6 execution document, Public surface): one TranscriptState per key (`appSessionId`, or
// `appSessionId:agentId` for a child), attached to a TranscriptSource through the hydration protocol
// (source/hydrate.ts), with the reader's expansion state, follow mode and jump requests. Rows are derived once per
// change with `rowsOf`, whose per-turn memo keeps unchanged rows by reference; a streaming block's later deltas change
// no row, and the live row reads its buffer through `liveBuffer`, so a token re-renders one component.
import { create } from 'zustand';
import type { AgentId } from '@shared/graph/ids';
import { rowsOf } from '../transcript/model/derive';
import { applyEvents, createState, withUi, type TranscriptState, type TranscriptUi } from '../transcript/model/reduce';
import type { CellId, Row, RowId, TurnId } from '../transcript/model/rows';
import { attachSource, type Attachment } from '../transcript/source/hydrate';
import type { TranscriptSource } from '../transcript/source/types';

export interface JumpRequest {
  rowId: RowId; // the list row to scroll to (the group holding a cell, or the row itself)
  focus: string; // the id to focus: the row, or a cell inside it
  align: 'start' | 'center' | 'end';
  nonce: number;
}

export interface TranscriptEntry {
  state: TranscriptState;
  rows: Row[];
  phase: 'hydrating' | 'live';
  following: boolean;
  working: boolean; // a turn is open
  jump: JumpRequest | null;
}

export interface TranscriptStore {
  entries: Record<string, TranscriptEntry>;
  attach(key: string, source: TranscriptSource, options?: { agentId?: AgentId | null }): Promise<void>; // resolves when hydrated
  detach(key: string): void;
  rows(key: string): Row[];
  lastAssistantLine(key: string): string | null;
  jumpTo(key: string, id: RowId | CellId, options?: { align?: JumpRequest['align'] }): void; // expands what holds the row, then the view scrolls and focuses
  jumpHandled(key: string, nonce: number): void;
  setFollowing(key: string, following: boolean): void;
  toggleTurn(key: string, turn: TurnId): void;
  toggleGroup(key: string, group: RowId): void;
  toggleCell(key: string, cell: CellId): void;
  expandAll(key: string): void; // every turn and group (the harness's "expand all old work")
}

const NO_ROWS: Row[] = [];

// The buffer of a live text or thinking row: its block identity is the row id after the kind prefix (keys.ts).
export function liveBuffer(entry: TranscriptEntry | undefined, row: Row): string | null {
  if (!entry || row.turnId === null || (row.kind !== 'assistant_text' && row.kind !== 'thinking') || !row.live) return null;
  const identity = row.id.slice(row.id.indexOf(':') + 1);
  return entry.state.turns.get(row.turnId)?.live.get(identity)?.buffer ?? null;
}

// The time of the last event a turn retained: a working divider ticks from it.
export function lastEventAt(entry: TranscriptEntry | undefined, turn: TurnId | null): string | null {
  if (!entry || turn === null) return null;
  const state = entry.state.turns.get(turn);
  return state?.events.at(-1)?.at ?? state?.startedAt ?? null;
}

const isExpanded = (state: TranscriptState, id: TurnId) =>
  state.ui.expandedTurns.has(id) || (state.turns.get(id)?.state === 'open' && !state.ui.collapsedTurns.has(id));

function copyUi(ui: TranscriptUi): TranscriptUi {
  return {
    expandedTurns: new Set(ui.expandedTurns), collapsedTurns: new Set(ui.collapsedTurns), expandedGroups: new Set(ui.expandedGroups),
    expandedCells: new Set(ui.expandedCells), revealedBoundaries: new Set(ui.revealedBoundaries), version: ui.version + 1,
  };
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
  const ui = copyUi(next.ui);
  for (const id of keep) ui.expandedTurns.add(id);
  return withUi(next, ui);
}

export function createTranscriptStore() {
  const attachments = new Map<string, Attachment>();
  let nonce = 0;
  return create<TranscriptStore>()((set, get) => {
    const entry = (key: string) => get().entries[key] as TranscriptEntry | undefined;
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
    const changeUi = (key: string, change: (ui: TranscriptUi, state: TranscriptState) => void) => {
      const current = entry(key);
      if (!current) return;
      const ui = copyUi(current.state.ui);
      change(ui, current.state);
      put(key, { state: withUi(current.state, ui) });
    };
    const toggle = <T>(values: Set<T>, value: T) => (values.has(value) ? values.delete(value) : values.add(value));

    return {
      entries: {},

      attach(key, source, options = {}) {
        attachments.get(key)?.detach();
        if (!entry(key)) {
          const state = createState(null, options.agentId ?? null);
          set({ entries: { ...get().entries, [key]: { state, rows: rowsOf(state), phase: 'hydrating', following: true, working: false, jump: null } } });
        } else put(key, { phase: 'hydrating' });
        const attachment = attachSource(source, {
          apply(events) {
            const current = entry(key)!;
            const next = applyEvents(current.state, events);
            put(key, { state: keepFinishedTurnsOpen(current.state, next, current.following) });
          },
          has: (id) => entry(key)?.state.seen.has(id) ?? false,
        });
        attachments.set(key, attachment);
        return attachment.hydrated.then(() => {
          if (attachments.get(key) === attachment) put(key, { phase: 'live' });
        });
      },

      detach(key) {
        attachments.get(key)?.detach();
        attachments.delete(key);
      },

      rows: (key) => entry(key)?.rows ?? NO_ROWS,

      lastAssistantLine(key) {
        const current = entry(key);
        const row = current?.rows.findLast((candidate) => candidate.kind === 'assistant_text');
        if (!current || row?.kind !== 'assistant_text') return null;
        const text = liveBuffer(current, row) ?? row.markdown;
        return text.split('\n').map((line) => line.trim()).findLast((line) => line.length > 0) ?? null;
      },

      jumpTo(key, id, options = {}) {
        const current = entry(key);
        if (!current) return;
        const request = (rowId: RowId): JumpRequest => ({ rowId, focus: id, align: options.align ?? 'center', nonce: ++nonce });
        const visible = locate(current.rows, id);
        if (visible && (!visible.group || (visible.group.kind === 'group' && visible.group.expanded))) {
          put(key, { jump: request(visible.row.id) });
          return;
        }
        const found = visible ?? locate(allExpandedRows(current.state), id);
        if (!found) return;
        const ui = copyUi(current.state.ui);
        if (found.row.turnId !== null && !isExpanded(current.state, found.row.turnId)) expandTurn(ui, found.row.turnId);
        if (found.group) ui.expandedGroups.add(found.group.id);
        put(key, { state: withUi(current.state, ui), jump: request(found.row.id) });
      },

      jumpHandled(key, handled) {
        if (entry(key)?.jump?.nonce === handled) put(key, { jump: null });
      },

      setFollowing(key, following) {
        if (entry(key) && entry(key)!.following !== following) put(key, { following });
      },

      toggleTurn(key, turn) {
        changeUi(key, (ui, state) => {
          if (isExpanded(state, turn)) {
            ui.expandedTurns.delete(turn);
            ui.collapsedTurns.add(turn);
          } else expandTurn(ui, turn);
        });
      },

      toggleGroup: (key, group) => changeUi(key, (ui) => toggle(ui.expandedGroups, group)),
      toggleCell: (key, cell) => changeUi(key, (ui) => toggle(ui.expandedCells, cell)),

      expandAll(key) {
        changeUi(key, (ui, state) => {
          for (const id of state.order) expandTurn(ui, id);
          for (const row of allExpandedRows(state)) if (row.kind === 'group') ui.expandedGroups.add(row.id);
        });
      },
    };
  });
}

export const useTranscriptStore = createTranscriptStore();
