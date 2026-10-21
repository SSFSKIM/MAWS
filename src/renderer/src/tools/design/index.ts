// The design kind's editor in L's registry (docs/doperpowers/plans/2026-10-16-p3-e1-design-workbench.md, M3; the
// ledger's X32 and §7 `registerArtifactEditor`): the panel's Artifacts tool mounts `DesignPanel` in its record view and
// an `artifact` main tab `DesignMain`, each with the state `createState` made for that tab (its replica, deck session
// and workbench view, kept until `dispose`), so the X32 header's close guard and Zoom to fit read the tab's state while
// its body is unmounted. In a window main loaded for the e2e harness the design's seam is installed with it.
import type { AppSessionId } from '@shared/graph/ids';
import { artifactHost } from '../../artifacts';
import { e2eRequested } from '../../artifacts/e2e-seam';
import { ipc } from '../../ipc/client';
import { displayTitle } from '../../sessions/title';
import { useSessions } from '../../stores/sessions';
import { registerArtifactEditor } from '../../artifacts/registry';
import { confirm } from '../../sessions/dialogs';
import { handCommentCardOver } from '../document/comments'; // P4-B2
import { DesignMain, DesignPanel } from './DesignBody';
import { installDesignSeam } from './e2e-seam';
import { DesignTabState, type DesignTabDeps } from './tab-state';

const windowDeps = (): DesignTabDeps => ({
  host: artifactHost(),
  log: (line) => console.warn(`[design] ${line}`),
  ipc,
  sessionTitle: (appSessionId) => {
    const record = useSessions.getState().records.get(appSessionId as AppSessionId);
    return record ? displayTitle(record) : undefined;
  },
  confirmDiscard: (title, about) =>
    confirm({
      title: `Close “${title || 'this design'}”?`,
      // P4-B2 (X36's draft rule): the unsent comment in its compose card, asked about as the document's tab asks
      body: about === 'comment' ? 'Your comment is not sent yet. Closing now discards it.' : 'Some of its changes are not saved yet. Closing now loses them.',
      confirmLabel: 'Close and discard',
      destructive: true,
    }),
});

/** Registers the design workbench (App.tsx's P3-E block); returns the registration's removal. */
export function registerDesignEditor(deps: () => DesignTabDeps = windowDeps): () => void {
  if (e2eRequested(location.search)) installDesignSeam(window, artifactHost);
  return registerArtifactEditor<DesignTabState>('design', {
    Panel: DesignPanel,
    Main: DesignMain,
    createState: (target) => new DesignTabState(target, deps()),
    dispose: (state) => state.dispose(),
    moved: (state, target) => state.moveTo(target.surface), // P4-B3: the e2e seam reports the surface it is on
    // P4-B2 (D16; the review's P1): the compose card and its unsent comment go to the view an activate-existing move keeps
    handOver: (from, to) => handCommentCardOver(from.artifactId, from.commentHostId, to.commentHostId),
  });
}
