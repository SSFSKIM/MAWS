// The dashboard kind's editor registered into L's registry (P3-E2 M3; X32, E's Decision Log 19): the panel's Artifacts
// tool mounts `DashboardPanel` and an `artifact` main tab `DashboardMain`, each with the state `createState` made for
// that tab, B's DocumentTabState made with B's window dependencies (`documentWindowDeps`) inside the dashboard's own.
import { registerArtifactEditor } from '../../artifacts/registry';
import { documentWindowDeps } from '../document';
import { handCommentCardOver } from '../document/comments'; // P4-B3
import type { DocumentTabDeps } from '../document/tab-state';
import { DashboardMain, DashboardPanel } from './DashboardPanel';
import { dashboardLiveDeps } from './live-start'; // E3 M3: the owner's Start for a live query
import { DashboardTabState } from './tab-state';

/** Registers the dashboard editor (App.tsx's P3-E block); returns the registration's removal. */
export function registerDashboardEditor(deps: () => DocumentTabDeps = documentWindowDeps): () => void {
  return registerArtifactEditor<DashboardTabState>('dashboard', {
    Panel: DashboardPanel,
    Main: DashboardMain,
    createState: (target) => new DashboardTabState(target, deps(), dashboardLiveDeps), // E3 M3
    dispose: (state) => state.dispose(),
    handOver: (from, to) => handCommentCardOver(from.document.artifactId, from.document.commentHostId, to.document.commentHostId), // P4-B3 (Decision Log 39)
  });
}
