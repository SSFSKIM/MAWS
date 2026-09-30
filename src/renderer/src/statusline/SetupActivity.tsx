// The status line's activity while an unstarted session's setup runs (C10 execution document, "The unstarted session":
// the setup phases are the composer's disabled-state reason and the status line's activity, not chrome of the empty
// state). The phase is C10's hook's, published by the session's composer (`setupPhaseOf`). A session with a record
// shows it as the first field of its status line; before the record exists the tab has no status line, so the
// composer shows this line alone under its frame while a phase runs, and nothing at rest.
import type { AppSessionId } from '@shared/graph/ids';
import { setupPhaseOf, useComposerStore } from '../stores/composer';

export const useSetupPhase = (appSessionId: AppSessionId): string | null => useComposerStore((s) => setupPhaseOf(s, appSessionId));

export function SetupActivity({ phase }: { phase: string }) {
  return (
    <span role="status" aria-label="Setup" className="text-fg">
      {phase}
    </span>
  );
}

// The line an unstarted tab shows while its setup runs, in the status line's type.
export function SetupStatusLine({ phase }: { phase: string }) {
  return (
    <div role="group" aria-label="Session status" className="flex items-center text-ui-sm text-fg-muted tabular-nums">
      <SetupActivity phase={phase} />
    </div>
  );
}
