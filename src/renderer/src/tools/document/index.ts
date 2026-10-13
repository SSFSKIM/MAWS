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

const windowDeps = (): DocumentTabDeps => ({
  host: artifactHost(),
  ipc,
  log: (line) => console.warn(`[document] ${line}`),
  confirm: (message) => window.confirm(message),
  sessionTitle: (appSessionId) => {
    const record = useSessions.getState().records.get(appSessionId as AppSessionId);
    return record ? displayTitle(record) : undefined;
  },
});

/** Registers the document editor (App.tsx's P3-B block); returns the registration's removal. */
export function registerDocumentEditor(deps: () => DocumentTabDeps = windowDeps): () => void {
  return registerArtifactEditor<DocumentTabState>('document', {
    Panel: DocumentPanel,
    Main: DocumentMain,
    createState: (target) => new DocumentTabState(target, deps()),
    dispose: (state) => state.dispose(),
  });
}
