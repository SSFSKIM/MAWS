// A session tab's word on its machine's link (the UX wave, U9: the ticket on a pane kept through a link's loss and O-39; docs/doperpowers/plans/2026-11-12-ux-wave-
// U9-other-machines.md, M3). While the link is not up the tab says the phase's words (app/machine-mark.ts): in one thin
// status line above a pane that has something to keep, which stays mounted whatever the phase, or in the pane's middle
// for a tab that has never had such a pane in this run. The line takes the shape of the transcript's "older messages
// didn't load" bar (transcript/view/Transcript.tsx), in the flow above the pane rather than over it.
//
// A pane has something to keep once the window holds what it is drawn from: a record (of either lane), or a terminal
// session's listing on another machine, which has no record by design and is drawn from its remote state
// (`useRemoteLaneA`). Once a tab has had such a pane it keeps it for the life of its mount, whatever leaves the stores
// during an outage; the words in the middle are for a session MAWS runs whose record main has not read in this run.
import { useState } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import type { LinkPhase } from '@shared/ipc/remote-unavailable';
import { useSessions } from '../stores/sessions';

/** Whether the tab has a pane to keep: what it is drawn from is held now, or was at any point of this mount. */
export function usePaneToKeep(appSessionId: AppSessionId): boolean {
  const held = useSessions((s) => s.records.has(appSessionId) || s.listed.get(appSessionId)?.lane === 'A');
  const [kept, setKept] = useState<AppSessionId | null>(held ? appSessionId : null);
  if (held && kept !== appSessionId) setKept(appSessionId); // the first render that holds it; a render-phase update
  return held || kept === appSessionId;
}

/** The phase's words in one line above the kept pane. */
export function LinkStatusLine({ phase, words }: { phase: LinkPhase; words: string }) {
  return (
    <div role="status" data-link-phase={phase} data-link-words="line" className="flex shrink-0 items-center gap-2 border-b border-border bg-bg px-4 py-1.5 text-ui-sm text-fg-muted">
      <span className="min-w-0 flex-1">{words}</span>
    </div>
  );
}

/** The phase's words in the middle of a tab that has never had a pane to keep. */
export function LinkMiddleWords({ phase, words }: { phase: LinkPhase; words: string }) {
  return (
    <p role="status" data-link-phase={phase} data-link-words="middle" className="m-0 flex h-full items-center justify-center p-6 text-ui text-fg-muted">
      {words}
    </p>
  );
}
