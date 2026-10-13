// The Artifacts tool's record view (docs/doperpowers/plans/2026-10-12-p3-l-library.md, M5; Decision Log 8, 15): one
// artifact in its kind's registered `Panel`, through the same body as an `artifact` main tab (`ArtifactView`: the
// library's row, the host's word while the index catches up, a kind with no editor yet, a gone artifact), under a bar
// with Back and Open in tab. The editor's own X32 header shows above the panel tab; Back and Open in tab are the
// surface's, so they sit in the body rather than in the editor's registration. The editor's state is the tab's (the
// registry's hold), given back by the tool state at Back, at a re-target and when the instance goes; Back and a
// re-target ask the editor's closeGuard first.
import { ArtifactView } from '../../library/ArtifactTab';
import { openArtifactTab } from '../../library/actions';
import type { EditorHostScope } from '../../panel/editor-host';
import { ARTIFACTS_TOOL_COPY } from './copy';

const bar = 'h-7 shrink-0 rounded-sm px-2 text-ui-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2';

export function ArtifactRecordView({ artifactId, scope, visible, onBack }: { artifactId: string; scope: EditorHostScope; visible: boolean; onBack(): void }) {
  return (
    <div data-artifact-record={artifactId} className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-1 py-0.5">
        <button type="button" onClick={onBack} className={bar}>
          {ARTIFACTS_TOOL_COPY.back}
        </button>
        <span className="flex-1" />
        <button type="button" onClick={() => openArtifactTab(artifactId)} className={bar}>
          {ARTIFACTS_TOOL_COPY.openInTab}
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <ArtifactView artifactId={artifactId} scope={scope} visible={visible} />
      </div>
    </div>
  );
}
