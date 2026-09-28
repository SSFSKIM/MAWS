// What every row component of one mounted transcript shares (C6 execution document, Public surface): the store key,
// the callbacks C5, C7 and C8 supply (TranscriptActions; any the caller omits is a no-op), the rewind interface, the
// request-card renderer, and view-only disclosure state (bubbles, pasted blocks, thinking) that must survive a row
// scrolling out of the virtualised list and back.
import { createContext, useContext, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { Cell, Row, Spill, SubagentRef, TurnId } from '../model/rows';

export interface TranscriptActions {
  openSubagent(ref: SubagentRef): void; // C8: Subagents tool with that agent selected
  openFullLog(cell: Cell): void; // C8: destination of "Open full log"
  reviewChanges(turnId: TurnId, path?: string): void; // C8: Review tool
  openFile(path: string, line?: number): void; // C5: the layout store action openTab({ kind: 'file', path, line })
  openExternal(url: string): void; // C5: layout.openExternal
  editAndResubmit(row: Extract<Row, { kind: 'user' }>): void; // C7: prefill the composer; forks history (§4.2)
  loadSpill(spill: Spill): Promise<string>; // C4: fs.readSpill (the default adapter lands with the IPC source, M5)
}

export interface RewindInterface {
  canUndo(turnId: TurnId): Promise<{ ok: boolean; reason: string | null }>; // dry run; disables the button with the reason as tooltip
  undo(turnId: TurnId): Promise<void>;
  reapply: ((turnId: TurnId) => Promise<void>) | null; // null hides Reapply
}

const noop = () => {};
export const NO_ACTIONS: TranscriptActions = {
  openSubagent: noop, openFullLog: noop, reviewChanges: noop, openFile: noop, openExternal: noop, editAndResubmit: noop,
  loadSpill: () => Promise.reject(new Error('loadSpill: no adapter supplied')),
};

// Open/closed flags by id, kept per mounted transcript rather than in a row's own state.
export class Disclosures {
  private open = new Set<string>();
  private listeners = new Set<() => void>();
  isOpen = (id: string) => this.open.has(id);
  toggle = (id: string) => {
    if (!this.open.delete(id)) this.open.add(id);
    for (const listener of this.listeners) listener();
  };
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}

export interface TranscriptContextValue {
  storeKey: string;
  variant: 'session' | 'child';
  actions: TranscriptActions;
  rewind: RewindInterface | null;
  renderRequest: ((slot: Extract<Row, { kind: 'request_slot' }>) => ReactNode) | null;
  disclosures: Disclosures;
  idPrefix: string; // unique per mounted transcript: row element ids are `<idPrefix>-<rowId>`
}

const TranscriptContext = createContext<TranscriptContextValue>({
  storeKey: '', variant: 'session', actions: NO_ACTIONS, rewind: null, renderRequest: null, disclosures: new Disclosures(), idPrefix: 'transcript',
});

export const TranscriptProvider = TranscriptContext.Provider;
export const useTranscriptContext = () => useContext(TranscriptContext);
export const useActions = () => useContext(TranscriptContext).actions;
export const rowElementId = (idPrefix: string, rowId: string) => `${idPrefix}-${rowId}`;
// The list's scroll container: the one mounted element a divider's aria-controls can name (its rows are virtual).
export const listElementId = (idPrefix: string) => `${idPrefix}-list`;

// One disclosure of this transcript: [open, toggle].
export function useDisclosure(id: string): [boolean, () => void] {
  const { disclosures } = useContext(TranscriptContext);
  const open = useSyncExternalStore(disclosures.subscribe, () => disclosures.isOpen(id));
  return [open, () => disclosures.toggle(id)];
}

// A fresh Disclosures per mounted transcript.
export const useDisclosures = () => useState(() => new Disclosures())[0];
