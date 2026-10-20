// The document kind's editor registered into L's registry (M8 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md,
// D13; the ledger's §7 `registerArtifactEditor`): the panel's Artifacts tool mounts `DocumentPanel` in its record view
// and an `artifact` main tab `DocumentMain`, each with the state `createState` made for that tab (its replica, kept
// until `dispose`), so the X32 header's actions and close guard read the tab's state while its body is unmounted.
import { displayTitle } from '../../sessions/title';
import { artifactHost } from '../../artifacts';
import { registerArtifactEditor } from '../../artifacts/registry';
import { ipc } from '../../ipc/client';
import { useSessions } from '../../stores/sessions';
import type { AppSessionId } from '@shared/graph/ids';
import { DocumentMain } from './DocumentMain';
import { DocumentPanel } from './DocumentPanel';
import { DocumentTabState, type DocumentTabDeps } from './tab-state';
import { registerCommentsViewActions } from './comments-view'; // P4-B1
import { handCommentCardOver } from './comments'; // P4-B3

// P3-E (E2 M3; E's Decision Log 19): exported, so the dashboard's DocumentTabState is made with the same window's deps
export const documentWindowDeps = (): DocumentTabDeps => ({
  host: artifactHost(),
  ipc,
  log: (line) => console.warn(`[document] ${line}`),
  confirm: (message) => window.confirm(message),
  sessionTitle: (appSessionId) => {
    const record = useSessions.getState().records.get(appSessionId as AppSessionId);
    return record ? displayTitle(record) : undefined;
  },
  sessions: () =>
    [...useSessions.getState().records.values()]
      .filter((record) => !record.archived)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
      .map((record) => ({ appSessionId: record.appId, title: displayTitle(record) })),
});

/** Registers the document editor (App.tsx's P3-B block); returns the registration's removal. */
export function registerDocumentEditor(deps: () => DocumentTabDeps = documentWindowDeps): () => void {
  const offEditor = registerArtifactEditor<DocumentTabState>('document', {
    Panel: DocumentPanel,
    Main: DocumentMain,
    createState: (target) => new DocumentTabState(target, deps()),
    dispose: (state) => state.dispose(),
    handOver: (from, to) => handCommentCardOver(from.artifactId, from.commentHostId, to.commentHostId), // P4-B3 (Decision Log 39)
  });
  const offActions = registerCommentsViewActions(); // P4-B1: View › Comments (per user, so every document follows)
  return () => {
    offActions();
    offEditor();
  };
}
