// The presentation kind's editor in L's registry (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8 "Shell";
// the ledger's §7 `registerArtifactEditor`): the panel's Artifacts tool mounts `DeckPanel` in its record view and an
// `artifact` main tab `DeckMain`, each with the state `createState` made for that tab (its replica and deck session,
// kept until `dispose`), so the X32 header's close guard reads the tab's state while its body is unmounted.
import { artifactHost } from '../../artifacts';
import { registerArtifactEditor } from '../../artifacts/registry';
import { confirm } from '../../sessions/dialogs';
import { DeckMain, DeckPanel } from './DeckBody';
import { DeckTabState, type DeckTabDeps } from './tab-state';

const windowDeps = (): DeckTabDeps => ({
  host: artifactHost(),
  log: (line) => console.warn(`[presentation] ${line}`),
  confirmDiscard: (title) =>
    confirm({
      title: `Close “${title || 'this presentation'}”?`,
      body: 'Some of its changes are not saved yet. Closing now loses them.',
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
  });
}
