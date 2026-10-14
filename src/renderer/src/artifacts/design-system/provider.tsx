// The app-root provider of `DesignSystemHostContext` (X28; D's Decision Log 21): every `useDesignSystem` and
// `<DesignSystemScope>` in the window (B's pages, C's decks, the Design System page's previews) reaches the store through
// the window's one ArtifactHost. The host is made on first use, not at the app's first render, so a window that never
// shows a design system opens nothing.
import type { ReactNode } from 'react';
import type { ArtifactHost } from '@artifacts/host';
import { DesignSystemHostContext } from '@artifacts/design-system/apply';
import { artifactHost } from '..';

function lazyHost(get: () => ArtifactHost): ArtifactHost {
  return {
    open: (artifactId, options) => get().open(artifactId, options),
    assetUrl: (artifactId, ref) => get().assetUrl(artifactId, ref),
    export: (artifactId, format, version, options) => get().export(artifactId, format, version, options),
    versionState: (artifactId, version) => get().versionState(artifactId, version),
    attributions: (artifactId, fromSeq, toSeq, options) => get().attributions(artifactId, fromSeq, toSeq, options),
    // P3-C at its merge of D under review: A's landed required members (Decision Log 45)
    acceptSuggestion: (artifactId, ranges) => get().acceptSuggestion(artifactId, ranges),
    rejectSuggestion: (artifactId, ranges) => get().rejectSuggestion(artifactId, ranges),
    uploadAsset: (artifactId, bytes, meta) => get().uploadAsset(artifactId, bytes, meta),
    identity: () => get().identity(),
  };
}

const appHost = lazyHost(artifactHost);

export function DesignSystemHostProvider({ children, host = appHost }: { children: ReactNode; host?: ArtifactHost }) {
  return <DesignSystemHostContext.Provider value={host}>{children}</DesignSystemHostContext.Provider>;
}
