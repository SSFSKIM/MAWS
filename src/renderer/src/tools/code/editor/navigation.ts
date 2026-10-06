// What a shown code view tells its bar (E5 execution document, M3): how many chunks the merge view shows and how many
// conflict blocks the document holds, and the way to step through either. The counts are reactive, per tab; the
// stepper is the mounted view's, gone with it (the bar shows neither once the view is hidden). No CodeMirror here: the
// bar is in the main chunk, the view behind CodeView's lazy import.
import { create } from 'zustand';

export interface EditorCounts {
  changes: number | null; // the merge view's chunks; null while none is open
  conflicts: number;
}

export type Stepper = (kind: 'change' | 'conflict', direction: -1 | 1) => void;

export const useEditorNavigation = create<{ counts: Map<string, EditorCounts> }>()(() => ({ counts: new Map() }));

const steppers = new Map<string, Stepper>();

export function reportCounts(tabId: string, counts: EditorCounts): void {
  const known = useEditorNavigation.getState().counts.get(tabId);
  if (known?.changes === counts.changes && known.conflicts === counts.conflicts) return;
  useEditorNavigation.setState((s) => ({ counts: new Map(s.counts).set(tabId, counts) }));
}

// The view's stepper, while it is mounted; detaching forgets the counts too.
export function attachNavigation(tabId: string, stepper: Stepper): () => void {
  steppers.set(tabId, stepper);
  return () => {
    if (steppers.get(tabId) !== stepper) return;
    steppers.delete(tabId);
    useEditorNavigation.setState((s) => {
      const counts = new Map(s.counts);
      counts.delete(tabId);
      return { counts };
    });
  };
}

export const step = (tabId: string, kind: 'change' | 'conflict', direction: -1 | 1): void => steppers.get(tabId)?.(kind, direction);
