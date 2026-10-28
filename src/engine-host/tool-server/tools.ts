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
import { artifactSearchTool } from './artifact-search'; // P4-B4
import { artifactCreateTool, artifactDescribeTypeTool, artifactListTool, artifactReadTool } from './artifact-tools';
import { artifactScreenshotTool, type CaptureBridge } from './artifacts';
import { askTool } from './ask';
import type { AskCancelReason, AskTable } from './asks';
import type { PaneBridge } from './panes';
import { sendFileTool } from './send-file';
import type { McpToolDefinition } from './server';
import { showPaneTool } from './show-pane';
import { documentCreateTool, documentReadTool, documentTools, DocumentToolSession } from './documents'; // P3-B (M7)
import { presentationThreadTools } from '../presentations/threads'; // P3-C (M7)
import { designThreadTools } from '../designs/threads'; // P3-E (E1's M2)
import { dashboardThreadTools } from '../dashboards/threads'; // P3-E (E2 M2)
import { legacyDashboardTools } from '../dashboards/legacy'; // P3-E (E2 M2 fix wave)
import { artifactDatasetTool } from './datasets'; // P3-E (E2 M2)
import type { DatasetRefreshRequests } from '../connectors/dataset-requests'; // E3
import type { ProvisionalEmitter } from './provisional'; // P4-A2 (X35)

export function mawsTools(deps: {
  bridge: PaneBridge; capture: CaptureBridge; asks: AskTable; askCancelled: (ask: PendingAsk, reason: AskCancelReason) => void;
  artifactScope?: readonly AppSessionId[]; // P2-E1: a side thread's ancestors, which the artifact tools also resolve over
  // P3-A start: the host's artifact store (null when it failed to open), main's export service, the session's memory
  artifacts?: () => ArtifactStore | null;
  exporter?: ExportBridge;
  session?: ArtifactSession;
  log?: (line: string) => void;
  // P3-A end
  datasetRefresh?: Pick<DatasetRefreshRequests, 'ask'>; // E3: the host's registry `artifact_dataset`'s refresh asks main through
  provisional?: ProvisionalEmitter; // P4-A2 (X35): the session's provisional layer, which the edit, publish and dataset calls end
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
  const documents = { artifacts: deps.artifacts, artifactScope: deps.artifactScope, session: new DocumentToolSession(artifacts.session.guided), log: deps.log, provisional: deps.provisional /* P4-A2 */ };
  const genericRead = artifactReadTool(artifacts); // P3-E: also the raw read of a held legacy dashboard
  return [
    afterImport(sendFileTool(artifacts)), askTool({ asks: deps.asks, cancelled: deps.askCancelled }), showPaneTool(deps),
    // P3-E (E2 M2 fix wave): a dashboard made from files before E2 is held, read raw and never written
    ...legacyDashboardTools(artifacts, [
      documentCreateTool(documents, artifactCreateTool(artifacts)), artifactListTool(artifacts), artifactScreenshotTool({ ...artifacts, capture: deps.capture, exporter: deps.exporter }), // E2
      // P3-A (M6)
      artifactDescribeTypeTool(artifacts), documentReadTool(documents, genericRead), artifactPublishTool({ ...artifacts, provisional: deps.provisional /* P4-A2 */ }), artifactUploadAssetTool(artifacts), artifactListAssetsTool(artifacts),
      artifactExportTool({ ...artifacts, exporter: deps.exporter }),
      artifactDatasetTool({ ...artifacts, refreshes: deps.datasetRefresh /* E3 */, provisional: deps.provisional /* P4-A2 */ }), // P3-E (E2 M2)
      // P3-B (M7); P3-C (M7): B's thread tools answer a deck from its threads; P3-E: a design (E1's M2) and a dashboard (E2 M2) from their own
      ...dashboardThreadTools(documents, designThreadTools(documents, presentationThreadTools(documents, documentTools(documents)))),
    ], genericRead).map(afterImport),
    afterImport(artifactSearchTool(artifacts)), // P4-B4: after the document tools
  ];
}
