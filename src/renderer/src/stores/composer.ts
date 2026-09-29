// Per-session composer state that outlives any one mounted composer (C7 execution document, Composer public surface,
// `useComposerStore`). M2 lands the seam the request card and the docked frame need before the composer exists:
// a pending prefill per session (the refusal dialog's Edit prompt, C6's edit-and-resubmit and C10's hand-back put the
// document here; M4's Composer takes it when mounted, so a prefill made from an Overview card waits for the pane),
// the requests a docked placement is showing (the transcript's request slot shows a pointer for those), and the focus
// targets a mounted composer registers (the docked frame gives focus back through them). M3 and M4 add the editor's
// own state beside these.
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
}

export interface ComposerState {
  prefills: ReadonlyMap<AppSessionId, Prefill>;
  docked: ReadonlyMap<AppSessionId, ReadonlyMap<RequestId, number>>; // how many docked placements show each request
  focusTargets: ReadonlyMap<AppSessionId, FocusTarget>;
}

const initial = (): ComposerState => ({ prefills: new Map(), docked: new Map(), focusTargets: new Map() });

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
