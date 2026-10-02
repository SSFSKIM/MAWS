// What every row component of one mounted transcript shares (C6 execution document, Public surface): the store key,
// the callbacks C5, C7 and C8 supply (TranscriptActions; any the caller omits is a no-op), the rewind interface, the
// request-card renderer, and view-only disclosure state (bubbles, pasted blocks, thinking) that must survive a row
// scrolling out of the virtualised list and back.
import { createContext, useContext, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { Cell, Row, Spill, SubagentRef, TurnId } from '../model/rows';
import { ipcLoadSpill, ipcOpenExternal } from '../source/ipc';
import { WorkMotion } from './motion';

export interface TranscriptActions {
  openSubagent(ref: SubagentRef): void; // C8: Subagents tool with that agent selected
  openFullLog(cell: Cell): void; // C8: destination of "Open full log"
  reviewChanges(turnId: TurnId, path?: string): void; // C8: Review tool
  openFile(path: string, line?: number): void; // C5: the layout store action openTab({ kind: 'file', path, line })
  openExternal(url: string): void; // C5: layout.openExternal
  editAndResubmit(row: Extract<Row, { kind: 'user' }>): void; // C7: prefill the composer; forks history (§4.2)
  editPrompt(row: Extract<Row, { kind: 'user' }>): void; // C7 (W1): a prompt that never reached the model (a hook blocked it) back into the composer, as a new message
  loadSpill(spill: Spill): Promise<string>; // C4: fs.readSpill; default adapter provided (DEFAULT_ACTIONS)
}

export interface RewindInterface {
  canUndo(turnId: TurnId): Promise<{ ok: boolean; reason: string | null }>; // dry run; disables the button with the reason as tooltip
  undo(turnId: TurnId): Promise<void>;
  reapply: ((turnId: TurnId) => Promise<void>) | null; // null hides Reapply
}

const noop = () => {};
export const NO_ACTIONS: TranscriptActions = {
  openSubagent: noop, openFullLog: noop, reviewChanges: noop, openFile: noop, openExternal: noop, editAndResubmit: noop, editPrompt: noop,
  loadSpill: () => Promise.reject(new Error('loadSpill: no adapter supplied')),
};
// What a Transcript does for an action its caller did not supply: the two X2 commands C6 can call itself (a spilled
// result through fs.readSpill, a link through layout.openExternal); the rest belong to C5, C7 and C8 and do nothing.
export const DEFAULT_ACTIONS: TranscriptActions = { ...NO_ACTIONS, loadSpill: ipcLoadSpill, openExternal: ipcOpenExternal };

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
  sessionDirectory?: string | null; // additive: where the session runs (its record's), for a shell call that names no cwd
  effort?: string | null; // additive (W8): the effort the session runs at, which the live thinking label names; null when unknown
  motion?: WorkMotion; // additive (W8): the work area's fold as motion, one per mounted transcript
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

const NO_MOTION = new WorkMotion(); // a row rendered outside a Transcript (the row tests)
export const useWorkMotion = () => useContext(TranscriptContext).motion ?? NO_MOTION;

// One disclosure of this transcript: [open, toggle].
export function useDisclosure(id: string): [boolean, () => void] {
  const { disclosures } = useContext(TranscriptContext);
  const open = useSyncExternalStore(disclosures.subscribe, () => disclosures.isOpen(id));
  return [open, () => disclosures.toggle(id)];
}

// A fresh Disclosures per mounted transcript.
export const useDisclosures = () => useState(() => new Disclosures())[0];
