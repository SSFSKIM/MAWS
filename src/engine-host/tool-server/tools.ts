// The `maws` server's tools in `tools/list` order (X9; E2 appends the artifact tools after `show_pane`; E4c's six
// browser tools after them were removed on 2026-10-08, P1 A-54: cua_repl drives the in-app browser). P3-A (M6, X25)
// serves the artifact namespace over the engine host's artifact store, `artifact_update` retired into
// `artifact_publish`; one `ArtifactSession` per session holds what its calls remember between them.
import type { AppSessionId } from '@shared/graph/ids';
import type { PendingAsk } from '@shared/maws/ask';
import type { ArtifactStore } from '../documents/store';
import { importSettled } from '../library/import-gate';
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
import { documentCreateTool, documentReadTool, documentTools, DocumentToolSession } from './documents'; // P3-B (M7)

export function mawsTools(deps: {
  bridge: PaneBridge; capture: CaptureBridge; asks: AskTable; askCancelled: (ask: PendingAsk, reason: AskCancelReason) => void;
  artifactScope?: readonly AppSessionId[]; // P2-E1: a side thread's ancestors, which the artifact tools also resolve over
  // P3-A start: the host's artifact store (null when it failed to open), main's export service, the session's memory
  artifacts?: () => ArtifactStore | null;
  exporter?: ExportBridge;
  session?: ArtifactSession;
  log?: (line: string) => void;
  // P3-A end
}): McpToolDefinition[] {
  const artifacts: ArtifactToolDeps = { artifacts: deps.artifacts, artifactScope: deps.artifactScope, session: deps.session ?? new ArtifactSession(), log: deps.log };
  // P3-L (M6b fix wave 1; Decision Log 39a): a call over the store waits for the host's start import of the X12
  // deliverables (`../library/import-gate.ts`), so a deliverable made before P3 is found from the first call on
  const afterImport = (tool: McpToolDefinition): McpToolDefinition => ({
    ...tool,
    call: async (args, ctx) => {
      const store = deps.artifacts?.() ?? null;
      if (store) await importSettled(store);
      return tool.call(args, ctx);
    },
  });
  // P3-B (M7): the document tools' session memory, sharing A's kinds-given-their-guide; A's create and read answer a
  // document through P3-B's wrappers, every other kind as before
  const documents = { artifacts: deps.artifacts, artifactScope: deps.artifactScope, session: new DocumentToolSession(artifacts.session.guided), log: deps.log };
  return [
    afterImport(sendFileTool(artifacts)), askTool({ asks: deps.asks, cancelled: deps.askCancelled }), showPaneTool(deps),
    ...[
      documentCreateTool(documents, artifactCreateTool(artifacts)), artifactListTool(artifacts), artifactScreenshotTool({ ...artifacts, capture: deps.capture }), // E2
      // P3-A (M6)
      artifactDescribeTypeTool(artifacts), documentReadTool(documents, artifactReadTool(artifacts)), artifactPublishTool(artifacts), artifactUploadAssetTool(artifacts), artifactListAssetsTool(artifacts),
      artifactExportTool({ ...artifacts, exporter: deps.exporter }),
      ...documentTools(documents), // P3-B (M7)
    ].map(afterImport),
  ];
}
