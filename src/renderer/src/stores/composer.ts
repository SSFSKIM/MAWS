// Per-session composer state that outlives any one mounted composer (C7 execution document, Composer public surface,
// `useComposerStore`). M2 lands the seam the request card and the docked frame need before the composer exists:
// a pending prefill per session (the refusal dialog's Edit prompt, C6's edit-and-resubmit and C10's hand-back put the
// document here; M4's Composer takes it when mounted, so a prefill made from an Overview card waits for the pane),
// the requests a docked placement is showing (the transcript's request slot shows a pointer for those), and the focus
// targets a mounted composer registers (the docked frame gives focus back through them). M3 adds the `#` target each
// session remembers; M4 adds the composer's own state beside these: the synchronous `starting` gate of an unstarted
// session's first send, the edit mode a prefill with `editing` enters, and the resubmit state the edit-and-resubmit
// flow (M4b) drives, each per session so they outlive a tab switch.
import { create } from 'zustand';
import type { AppSessionId, MessageUuid, RequestId } from '@shared/graph/ids';

export interface Prefill {
  text: string; // the row's text with `[Pasted text #n +L lines]` placeholders in place
  pasted?: Array<{ name: string; text: string }>; // placeholder order; each becomes a Pasted atom; a placeholder with no entry becomes an unavailable atom
  images?: Array<{ name: string; mediaType: string; data: string }>; // base64, re-attached
  editing: { messageUuid: MessageUuid; seenCursor: MessageUuid | null } | null; // seenCursor: the transcript's newest user uuid when the edit flow started
}

export interface FocusTarget {
  focusEditor(): void;
  focusFrame(): void;
  insertText(text: string): void; // at the editor's caret, at the end when it is not focused (C11's insertComposerText)
}

// Edit mode: the message an edited prefill resubmits against, and the transcript's newest user uuid when the edit began.
export interface Editing {
  messageUuid: MessageUuid;
  seenCursor: MessageUuid | null;
}

// Where edit-and-resubmit stands (C7 execution document, "Edit-and-resubmit and the fork seam"); M4b drives it. Every
// state keeps the draft; only `sent` clears it.
export type ResubmitState = 'idle' | 'confirming' | 'rewinding' | 'rewind_uncertain' | 'rewind_unresolved' | 'rewound_awaiting_send' | 'sent';

// Where `#` appends (C3's `session.memoryAppend` target): the memory dialog's project or user file, or a listed path.
export interface MemoryTarget {
  kind: 'user' | 'project' | 'path';
  path: string | null;
}
export const DEFAULT_MEMORY_TARGET: MemoryTarget = Object.freeze({ kind: 'project', path: null }) as MemoryTarget;

export interface ComposerState {
  prefills: ReadonlyMap<AppSessionId, Prefill>;
  docked: ReadonlyMap<AppSessionId, ReadonlyMap<RequestId, number>>; // how many docked placements show each request
  focusTargets: ReadonlyMap<AppSessionId, FocusTarget>;
  memoryTargets: ReadonlyMap<AppSessionId, MemoryTarget>; // M3: the `#` target chosen per session
  starting: ReadonlySet<AppSessionId>; // M4: an unstarted session's first send is with C10's `start`
  editing: ReadonlyMap<AppSessionId, Editing>; // M4: edit mode, entered by a prefill with `editing`
  resubmit: ReadonlyMap<AppSessionId, ResubmitState>; // M4b: absent is 'idle'
}

const initial = (): ComposerState => ({ prefills: new Map(), docked: new Map(), focusTargets: new Map(), memoryTargets: new Map(), starting: new Set(), editing: new Map(), resubmit: new Map() });

export const useComposerStore = create<ComposerState>()(initial);

export function resetComposerStore(): void {
  useComposerStore.setState(initial());
}

// Replaces the session's untaken prefill: the latest ask wins.
export function prefillComposer(appSessionId: AppSessionId, prefill: Prefill): void {
  useComposerStore.setState((s) => ({ prefills: new Map(s.prefills).set(appSessionId, prefill) }));
}

// The composer's side: the pending prefill, removed as it is taken.
export function takePrefill(appSessionId: AppSessionId): Prefill | null {
  const prefill = useComposerStore.getState().prefills.get(appSessionId) ?? null;
  if (prefill) {
    useComposerStore.setState((s) => {
      const prefills = new Map(s.prefills);
      prefills.delete(appSessionId);
      return { prefills };
    });
  }
  return prefill;
}

function countDocked(appSessionId: AppSessionId, requestId: RequestId, delta: 1 | -1): void {
  useComposerStore.setState((s) => {
    const counts = new Map(s.docked.get(appSessionId));
    const next = (counts.get(requestId) ?? 0) + delta;
    if (next > 0) counts.set(requestId, next);
    else counts.delete(requestId);
    const docked = new Map(s.docked);
    if (counts.size > 0) docked.set(appSessionId, counts);
    else docked.delete(appSessionId);
    return { docked };
  });
}

// A docked placement showing `requestId`, for as long as it is mounted; the disposer releases it once.
export function markDocked(appSessionId: AppSessionId, requestId: RequestId): () => void {
  countDocked(appSessionId, requestId, 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    countDocked(appSessionId, requestId, -1);
  };
}

export const isDocked = (state: ComposerState, appSessionId: AppSessionId, requestId: RequestId): boolean => (state.docked.get(appSessionId)?.get(requestId) ?? 0) > 0;

// A mounted composer's focus target; the latest registration for a session wins and a disposer removes only its own.
export function registerFocusTarget(appSessionId: AppSessionId, target: FocusTarget): () => void {
  useComposerStore.setState((s) => ({ focusTargets: new Map(s.focusTargets).set(appSessionId, target) }));
  return () => {
    if (useComposerStore.getState().focusTargets.get(appSessionId) !== target) return;
    useComposerStore.setState((s) => {
      const focusTargets = new Map(s.focusTargets);
      focusTargets.delete(appSessionId);
      return { focusTargets };
    });
  };
}

export const memoryTargetOf = (state: ComposerState, appSessionId: AppSessionId): MemoryTarget => state.memoryTargets.get(appSessionId) ?? DEFAULT_MEMORY_TARGET;

export function setMemoryTarget(appSessionId: AppSessionId, target: MemoryTarget): void {
  useComposerStore.setState((s) => ({ memoryTargets: new Map(s.memoryTargets).set(appSessionId, target) }));
}

// ---- M4: the composer's own per-session state ------------------------------------------------------------------------

export const isStarting = (state: ComposerState, appSessionId: AppSessionId): boolean => state.starting.has(appSessionId);

// Set synchronously before C10's `start` is awaited, cleared when it settles: a second submission in the same tick reads it.
export function setStarting(appSessionId: AppSessionId, on: boolean): void {
  if (useComposerStore.getState().starting.has(appSessionId) === on) return;
  useComposerStore.setState((s) => {
    const starting = new Set(s.starting);
    if (on) starting.add(appSessionId);
    else starting.delete(appSessionId);
    return { starting };
  });
}

export const editingOf = (state: ComposerState, appSessionId: AppSessionId): Editing | null => state.editing.get(appSessionId) ?? null;

export function setEditing(appSessionId: AppSessionId, editing: Editing | null): void {
  useComposerStore.setState((s) => {
    const next = new Map(s.editing);
    if (editing) next.set(appSessionId, editing);
    else next.delete(appSessionId);
    return { editing: next };
  });
}

export const resubmitOf = (state: ComposerState, appSessionId: AppSessionId): ResubmitState => state.resubmit.get(appSessionId) ?? 'idle';

export function setResubmit(appSessionId: AppSessionId, state: ResubmitState): void {
  useComposerStore.setState((s) => {
    const resubmit = new Map(s.resubmit);
    if (state === 'idle') resubmit.delete(appSessionId);
    else resubmit.set(appSessionId, state);
    return { resubmit };
  });
}

// C11's ask: text at the caret of the session's mounted composer (at the end when it is not focused), the document kept.
export function insertComposerText(appSessionId: AppSessionId, text: string): void {
  const target = useComposerStore.getState().focusTargets.get(appSessionId);
  if (target) target.insertText(text);
  else console.warn(`[composer] insertComposerText: no composer is mounted for ${appSessionId}`);
}
