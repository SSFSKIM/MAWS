// The presentation kind's editor in L's registry (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8 "Shell";
// the ledger's §7 `registerArtifactEditor`): the panel's Artifacts tool mounts `DeckPanel` in its record view and an
// `artifact` main tab `DeckMain`, each with the state `createState` made for that tab (its replica and deck session,
// kept until `dispose`), so the X32 header's close guard reads the tab's state while its body is unmounted.
import type { AppSessionId } from '@shared/graph/ids';
import { artifactHost } from '../../artifacts';
import { ipc } from '../../ipc/client';
import { displayTitle } from '../../sessions/title';
import { useSessions } from '../../stores/sessions';
import { registerArtifactEditor } from '../../artifacts/registry';
import { confirm } from '../../sessions/dialogs';
import { handCommentCardOver } from '../document/comments'; // P4-B2
import { DeckMain, DeckPanel } from './DeckBody';
import { DeckTabState, type DeckTabDeps } from './tab-state';

const windowDeps = (): DeckTabDeps => ({
  host: artifactHost(),
  log: (line) => console.warn(`[presentation] ${line}`),
  ipc, // M8: the deck's history
  sessionTitle: (appSessionId) => {
    const record = useSessions.getState().records.get(appSessionId as AppSessionId);
    return record ? displayTitle(record) : undefined;
  },
  confirmDiscard: (title, about) =>
    confirm({
      title: `Close “${title || 'this presentation'}”?`,
      // P4-B2 (X36's draft rule): the unsent comment in its compose card, asked about as the document's tab asks
      body: about === 'comment' ? 'Your comment is not sent yet. Closing now discards it.' : 'Some of its changes are not saved yet. Closing now loses them.',
      confirmLabel: 'Close and discard',
      destructive: true,
    }),
});

/** Registers the deck editor (App.tsx's P3-C block); returns the registration's removal. */
export function registerPresentationEditor(deps: () => DeckTabDeps = windowDeps): () => void {
  return registerArtifactEditor<DeckTabState>('presentation', {
    Panel: DeckPanel,
    Main: DeckMain,
    createState: (target) => new DeckTabState(target, deps()),
    dispose: (state) => state.dispose(),
    moved: (state, target) => state.moveTo(target.surface), // P4-B3: the e2e seam reports the surface it is on
    // P4-B2 (D16; the review's P1): a move onto a view already showing the deck hands that view the compose card and its
    // unsent comment, as the document's does (P4-B3 Decision Log 39), so the close guard's `moving` skip loses nothing
    handOver: (from, to) => handCommentCardOver(from.artifactId, from.commentHostId, to.commentHostId),
  });
}
