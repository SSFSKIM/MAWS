// The `maws` server's tools in `tools/list` order (X9; E2 appends the artifact tools after `show_pane`; E4c's six
// browser tools after them were removed on 2026-10-08, P1 A-54: cua_repl drives the in-app browser). P3-A (M6, X25)
// serves the artifact namespace over the engine host's artifact store, `artifact_update` retired into
// `artifact_publish`; one `ArtifactSession` per session holds what its calls remember between them.
import type { AppSessionId } from '@shared/graph/ids';
import type { PendingAsk } from '@shared/maws/ask';
import type { DeliverableWriter } from '../deliverables/store';
import type { ArtifactStore } from '../documents/store';
import { artifactListAssetsTool, artifactUploadAssetTool } from './artifact-assets';
import { ArtifactSession, type ArtifactToolDeps } from './artifact-context';
import { artifactExportTool, type ExportBridge } from './artifact-export';
import { artifactPublishTool } from './artifact-publish';
import { artifactCreateTool, artifactDescribeTypeTool, artifactListTool, artifactReadTool } from './artifact-tools';
import { artifactScreenshotTool, type CaptureBridge } from './artifacts';
import { askTool } from './ask';
import type { AskCancelReason, AskTable } from './asks';
import type { PaneBridge } from './panes';
import { sendFileTool } from './send-file';
import type { McpToolDefinition } from './server';
import { showPaneTool } from './show-pane';

export function mawsTools(deps: {
  deliverables: DeliverableWriter; bridge: PaneBridge; capture: CaptureBridge; asks: AskTable; askCancelled: (ask: PendingAsk, reason: AskCancelReason) => void;
  artifactScope?: readonly AppSessionId[]; // P2-E1: a side thread's ancestors, which the artifact tools also resolve over
  // P3-A start: the host's artifact store (null when it failed to open), main's export service, the session's memory
  artifacts?: () => ArtifactStore | null;
  exporter?: ExportBridge;
  session?: ArtifactSession;
  log?: (line: string) => void;
  // P3-A end
}): McpToolDefinition[] {
  const artifacts: ArtifactToolDeps = { artifacts: deps.artifacts, deliverables: deps.deliverables, artifactScope: deps.artifactScope, session: deps.session ?? new ArtifactSession(), log: deps.log };
  return [
    sendFileTool(artifacts), askTool({ asks: deps.asks, cancelled: deps.askCancelled }), showPaneTool(deps),
    artifactCreateTool(artifacts), artifactListTool(artifacts), artifactScreenshotTool({ ...artifacts, capture: deps.capture }), // E2
    // P3-A (M6)
    artifactDescribeTypeTool(artifacts), artifactReadTool(artifacts), artifactPublishTool(artifacts), artifactUploadAssetTool(artifacts), artifactListAssetsTool(artifacts),
    artifactExportTool({ ...artifacts, exporter: deps.exporter }),
  ];
}
