// The session view's Report · Transcript toggle (DC9; the composite's §9.1): the desk's own, since MAWS's `ReportBar`
// draws nothing unless its owner-channel store, fed over IPC, has the lane on. It is MAWS's two-state control in
// MAWS's words and styles, calling the transcript store's `setView` as `ReportBar` does. MAWS keeps the choice per tab
// in the store's state, which the desk starts afresh whenever the transcript resets or the reader comes back to the
// session (its key dropped when the view went), so the desk keeps the choice per session itself and applies it again.
import { useEffect } from 'react';
import { create } from 'zustand';
import { REPORT } from '../../../../../src/renderer/src/owner/report/copy';
import '../../../../../src/renderer/src/owner/report/report.css';
import { useTranscriptStore } from '../../../../../src/renderer/src/stores/transcript';

type View = 'report' | 'transcript';

/** The reader's choice per transcript key, for this page's life (MAWS's lives as long as its tab). */
const useChosen = create<{ byKey: Record<string, View> }>()(() => ({ byKey: {} }));

export function ReportToggle({ storeKey }: { storeKey: string }) {
  // The reader's choice is the view; the store follows it.
  const chosen = useChosen((s) => s.byKey[storeKey] ?? null);
  const report = (chosen ?? 'report') === 'report';
  const stored = useTranscriptStore((s) => (s.entries[storeKey] ? (s.entries[storeKey].state.ui.view ?? null) : undefined));

  // The key's state started over (a reset, a return to the session): the choice is applied again.
  useEffect(() => {
    if (stored !== undefined && chosen !== null && stored !== chosen) useTranscriptStore.getState().setView(storeKey, chosen);
  }, [storeKey, stored, chosen]);

  const choose = (view: View) => {
    useChosen.setState((s) => ({ byKey: { ...s.byKey, [storeKey]: view } }));
    useTranscriptStore.getState().setView(storeKey, view);
  };
  return (
    <div className="owner-bar" data-owner-bar="" data-testid="session-view-bar">
      <div className="owner-bar-notes" />
      <div role="group" aria-label={REPORT.view} className="owner-view-toggle">
        {(['report', 'transcript'] as const).map((view) => (
          <button key={view} type="button" aria-pressed={(view === 'report') === report} onClick={() => choose(view)}>
            {view === 'report' ? REPORT.report : REPORT.transcript}
          </button>
        ))}
      </div>
    </div>
  );
}
