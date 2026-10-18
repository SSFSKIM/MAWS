// E3 M3 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R4; X16): the owner's Start for a dashboard whose live
// query found no session. H's policy alone (../../artifacts/session-context.ts): the artifact's durable context read
// when the owner presses Start (its library row, the window's sessions and projects, the library's Spaces), then
// `startArtifactSession` with its empty-message guard, so no model turn runs. Nothing calls it but that gesture.
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { artifactSessionContext, startArtifactSession, type ArtifactSessionContext, type ArtifactSessionStart } from '../../artifacts/session-context';
import { ipc } from '../../ipc/client';
import { useLayout } from '../../stores/layout';
import { useSessions } from '../../stores/sessions';

export interface DashboardLiveDeps {
  startSession(artifactId: string, previous: AppSessionId | null): Promise<ArtifactSessionStart>;
  openSession?(appSessionId: AppSessionId): void;
}

/** The artifact's session context as the window knows it now (`useArtifactSessionContext`'s facts, read once). */
export async function dashboardSessionContext(artifactId: string, client: Pick<MawsBridge, 'invoke'> = ipc): Promise<ArtifactSessionContext> {
  const [row, spaces] = await Promise.all([client.invoke('library.get', { artifactId }), client.invoke('library.spaces', undefined)]);
  if (!row.ok || row.value.row === null) return { kind: 'none' };
  const { records, projects } = useSessions.getState();
  return artifactSessionContext(row.value.row, { records, projects, spaces: spaces.ok ? spaces.value.spaces : [] });
}

export const dashboardLiveDeps: DashboardLiveDeps = {
  startSession: async (artifactId, previous) => startArtifactSession(await dashboardSessionContext(artifactId), previous),
  openSession: (appSessionId) => useLayout.getState().openSession(appSessionId, { how: 'tab' }),
};
