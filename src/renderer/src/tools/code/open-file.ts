// The open-file seam (C8c execution document, Interfaces *Tools, slots and the open-file seam*; K4): every surface opens
// a file through `openFile`, a file tab in C5's main area, and the tab's viewer is the only reader of its bytes. The
// session comes first because the allowlist is per session; `codeTranscriptActions.openFile` is the transcript's
// two-argument form, filling the session from the focused pane (C5's Pane focuses on pointerdown, so at click time it
// is the transcript's).
import type { AppSessionId } from '@shared/graph/ids';
import type { TranscriptActions } from '../../transcript';
import { useLayout } from '../../stores/layout';
import { activeTab, sessionOfTab } from '../../stores/layout-model';

// `.`, `..` and repeated separators collapsed without touching the disk (ruled 2026-09-29, O1): a receipt's path comes
// from the model's input and may carry `..`, which `files.*` refuses as not normal; the boundary then judges the
// normalised path as any other. A relative path stays relative (and is refused by the service as such).
export function normalizeLexically(path: string): string {
  const absolute = path.startsWith('/');
  const out: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (out.length > 0 && out[out.length - 1] !== '..') out.pop();
      else if (!absolute) out.push('..');
      continue;
    }
    out.push(segment);
  }
  const joined = out.join('/');
  return absolute ? `/${joined}` : joined || '.';
}

export function openFile(appSessionId: AppSessionId | null, path: string, line?: number | null): void {
  useLayout.getState().openTab({ kind: 'file', path: normalizeLexically(path), line: line ?? null, appSessionId });
}

// The session the panel follows: the focused pane's active tab's.
export const sessionOfFocusedPane = (): AppSessionId | null => sessionOfTab(activeTab(useLayout.getState().main));

// The transcript's callbacks C8c supplies (K3), registered through C6's `registerTranscriptActions` (the App.tsx line
// lands with Review, M3, together with `reviewChanges`).
export const codeTranscriptActions: Pick<TranscriptActions, 'openFile'> = {
  openFile: (path, line) => openFile(sessionOfFocusedPane(), path, line),
};
