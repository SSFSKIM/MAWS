// The Artifacts tool's record view (docs/doperpowers/plans/2026-10-12-p3-l-library.md, M5; Decision Log 8, 15): one
// artifact in its kind's registered `Panel`, through the same body as an `artifact` main tab (`ArtifactView`: the
// library's row, the host's word while the index catches up, a kind with no editor yet, a gone artifact), under a bar
// with Back and Move to tab. The editor's own X32 header shows above the panel tab; Back and Move to tab are the
// surface's, so they sit in the body rather than in the editor's registration. The editor's state is the tab's (the
// registry's hold), given back by the tool state at Back, at a re-target and when the instance goes; Back and a
// re-target ask the editor's closeGuard first. Move to tab (P3-F wave S, F16; the owner's obs 7; P4-B3, X38: it was
// "Open in tab") moves the artifact to a main tab with its editor's state, as dragging the grip beside it or the panel
// tab does, so its guard has nothing to ask (`shell/transfer.ts`).
import { useEffect } from 'react';
import { ARTIFACTS_TOOL_ID } from '@shared/maws/panes';
import { Icon } from '../../app/IconButton';
import { ArtifactView } from '../../library/ArtifactTab';
import type { EditorHostScope } from '../../panel/editor-host';
import { beginDrag, endDragFrom, moveArtifactToTab, useTransferRefusal } from '../../shell/transfer';
import { ARTIFACTS_TOOL_COPY, TRANSFER_COPY } from './copy';

const bar = 'h-7 shrink-0 rounded-sm px-2 text-ui-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2 disabled:text-fg-faint disabled:hover:bg-transparent';

export function ArtifactRecordView({ artifactId, scope, visible, onBack }: { artifactId: string; scope: EditorHostScope; visible: boolean; onBack(): void }) {
  const refusal = useTransferRefusal({ to: 'tab', panelTabId: scope.tabId });
  useEffect(() => () => endDragFrom('panel', scope.tabId), [scope.tabId]); // INV-5: the grip unmounting mid-drag
  return (
    <div data-artifact-record={artifactId} className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-1 py-0.5">
        <button type="button" onClick={onBack} className={bar}>
          {ARTIFACTS_TOOL_COPY.back}
        </button>
        <span className="flex-1" />
        <span
          role="img"
          aria-label={TRANSFER_COPY.grip}
          title={TRANSFER_COPY.grip}
          draggable
          onDragStart={(event) => beginDrag(event, { source: 'panel', tabId: scope.tabId, toolId: ARTIFACTS_TOOL_ID, artifactId })}
          className="inline-flex size-7 shrink-0 cursor-grab items-center justify-center rounded-sm text-fg-muted hover:bg-bg-hover hover:text-fg"
        >
          <GripIcon />
        </span>
        <button type="button" disabled={refusal !== null} title={refusal ?? undefined} onClick={() => void moveArtifactToTab(scope.tabId)} className={bar}>
          {TRANSFER_COPY.moveToTab}
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <ArtifactView artifactId={artifactId} scope={scope} visible={visible} />
      </div>
    </div>
  );
}

// Six dots, the drag handle's glyph.
const GripIcon = () => (
  <Icon>
    <path d="M6 4h.01M10 4h.01M6 8h.01M10 8h.01M6 12h.01M10 12h.01" />
  </Icon>
);
