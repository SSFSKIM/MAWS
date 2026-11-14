// The open-file seam (C8c execution document, Interfaces *Tools, slots and the open-file seam*; K4): every surface opens
// a file through `openFile`, a file tab in C5's main area, and the tab's viewer is the only reader of its bytes. The
// session comes first because the allowlist is per session; `codeTranscriptActions.openFile` is the transcript's
// two-argument form, filling the session from the focused pane (C5's Pane focuses on pointerdown, so at click time it
// is the transcript's). UX wave U6c (decision 15): opening a file whose tab is already open reads it again when its last
// read failed or no watch keeps it current (`revisit`).
import type { AppSessionId } from '@shared/graph/ids';
import { normalizeLexically } from '@shared/files/named';
import { tabId, type TabTarget } from '@shared/ipc/schema/layout';
import { machineFor } from '../../ipc/machine';
import { panelHost, shownSession } from '../../panel/host';
import { useLayout } from '../../stores/layout';
import { useSessions } from '../../stores/sessions';
import { useTranscriptStore, type TranscriptActions, type TurnId } from '../../transcript';
import { useViewer } from './viewer/viewer-store';

// `normalizeLexically` lives in the rule of a file the transcript names (UX wave U6c, `src/shared/files/named.ts`), so the
// daemon's check reads a path as the click does; exported here as before.
export { normalizeLexically };

export function openFile(appSessionId: AppSessionId | null, path: string, line?: number | null): void {
  const target: TabTarget = { kind: 'file', path: normalizeLexically(path), line: line ?? null, appSessionId, machine: machineFor(appSessionId) };
  useLayout.getState().openTab(target);
  useViewer.getState().revisit(tabId(target), appSessionId);
}

// The session a turn belongs to, for a call outside a click: the transcript store key whose state holds the turn, the
// session's own (`<appSessionId>`) or a child agent's (`<appSessionId>:<agentId>`), when the session is known.
export function sessionOfTurn(turnId: TurnId): AppSessionId | null {
  const { entries } = useTranscriptStore.getState();
  const { records } = useSessions.getState();
  for (const key of Object.keys(entries)) {
    if (!entries[key].state.turns.has(turnId)) continue;
    const candidates = (key.includes(':') ? [key, key.slice(0, key.indexOf(':'))] : [key]) as AppSessionId[];
    const found = candidates.find((id) => records.has(id));
    if (found) return found;
  }
  return null;
}

// The transcript's callbacks C8c supplies (K3), registered through C6's `registerTranscriptActions` from App.tsx's C8c
// block: a receipt's "Review changes" (and a file row of it) opens Review on the turn, a path chip opens the viewer.
export const codeTranscriptActions: Pick<TranscriptActions, 'reviewChanges' | 'openFile'> = {
  reviewChanges(turnId, path) {
    const appSessionId = shownSession() ?? sessionOfTurn(turnId);
    if (appSessionId === null) return;
    panelHost.addTool('review', { appSessionId, params: { scope: 'turn', turnId, ...(path ? { path } : {}) } });
  },
  openFile: (path, line, appSessionId) => openFile(appSessionId ?? shownSession(), path, line),
};
