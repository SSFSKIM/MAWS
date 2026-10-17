// The app-root provider of `DesignSystemHostContext` (X28; D's Decision Log 21): every `useDesignSystem` and
// `<DesignSystemScope>` in the window (B's pages, C's decks, the Design System page's previews) reaches the store through
// the window's one ArtifactHost. The host is made on first use, not at the app's first render, so a window that never
// shows a design system opens nothing. Beside it, `DesignSystemHouseContext` carries the window's followed house system
// (`./house.ts`; the P3 spec's Decision Log 61), which `useGoverningSystem` resolves with; it too is read only once a
// render asks for it.
import type { ReactNode } from 'react';
import type { ArtifactHost } from '@artifacts/host';
import { DesignSystemHostContext, DesignSystemHouseContext, type HouseDesignSystem } from '@artifacts/design-system/apply';
import { artifactHost } from '..';
import { houseDesignSystem } from './house';

function lazyHost(get: () => ArtifactHost): ArtifactHost {
  return {
    open: (artifactId, options) => get().open(artifactId, options),
    assetUrl: (artifactId, ref, revision) => get().assetUrl(artifactId, ref, revision),
    export: (artifactId, format, version, options) => get().export(artifactId, format, version, options),
    versionState: (artifactId, version) => get().versionState(artifactId, version),
    attributions: (artifactId, fromSeq, toSeq, options) => get().attributions(artifactId, fromSeq, toSeq, options),
    acceptSuggestion: (artifactId, ranges) => get().acceptSuggestion(artifactId, ranges), // A's required members (P3-D re-merge)
    rejectSuggestion: (artifactId, ranges) => get().rejectSuggestion(artifactId, ranges),
    uploadAsset: (artifactId, bytes, meta) => get().uploadAsset(artifactId, bytes, meta),
    copyAsset: (from, ref, to) => get().copyAsset(from, ref, to), // P3-C (Decision Log 25)
    readDataset: (artifactId, ref, options) => get().readDataset(artifactId, ref, options), // P3-E (E2 M2)
    downloadAsset: (artifactId, ref, options) => get().downloadAsset(artifactId, ref, options), // P3-E (E2 M3)
    holdDatasets: (artifactId, refs) => get().holdDatasets(artifactId, refs), // E3: a window's snapshot holds
    identity: () => get().identity(),
    openConnectors: (artifactId) => get().openConnectors(artifactId), // P3-H H4: the connector family
    connectorGrants: (artifactId) => get().connectorGrants(artifactId),
    grantConnectorTool: (artifactId, tool) => get().grantConnectorTool(artifactId, tool),
    revokeConnectorTool: (artifactId, tool) => get().revokeConnectorTool(artifactId, tool),
  };
}

const appHost = lazyHost(artifactHost);

export function DesignSystemHostProvider({ children, host = appHost, house = houseDesignSystem }: { children: ReactNode; host?: ArtifactHost; house?: HouseDesignSystem }) {
  return (
    <DesignSystemHostContext.Provider value={host}>
      <DesignSystemHouseContext.Provider value={house}>{children}</DesignSystemHouseContext.Provider>
    </DesignSystemHostContext.Provider>
  );
}
