// The `maws` server's tools in `tools/list` order (X9; E2 appends the four artifact tools after `show_pane`; E4c's six
// browser tools after them were removed on 2026-10-08, P1 A-54: cua_repl drives the in-app browser).
import type { PendingAsk } from '@shared/maws/ask';
import type { DeliverableWriter } from '../deliverables/store';
import { artifactCreateTool, artifactListTool, artifactScreenshotTool, artifactUpdateTool, type CaptureBridge } from './artifacts';
import { askTool } from './ask';
import type { AskCancelReason, AskTable } from './asks';
import type { PaneBridge } from './panes';
import { sendFileTool } from './send-file';
import type { McpToolDefinition } from './server';
import { showPaneTool } from './show-pane';

export function mawsTools(deps: {
  deliverables: DeliverableWriter; bridge: PaneBridge; capture: CaptureBridge; asks: AskTable; askCancelled: (ask: PendingAsk, reason: AskCancelReason) => void;
}): McpToolDefinition[] {
  return [
    sendFileTool(deps), askTool({ asks: deps.asks, cancelled: deps.askCancelled }), showPaneTool(deps),
    artifactCreateTool(deps), artifactUpdateTool(deps), artifactListTool(deps), artifactScreenshotTool(deps), // E2
  ];
}
