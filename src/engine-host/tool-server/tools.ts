// The `maws` server's tools in `tools/list` order (X9). `ask` is listed from M1 so the list is final, and answers a tool
// error until its lifecycle lands (E1 M2).
import type { DeliverableWriter } from '../deliverables/store';
import type { PaneBridge } from './panes';
import { sendFileTool } from './send-file';
import { defineMawsTool, toolError, type McpToolDefinition } from './server';
import { showPaneTool } from './show-pane';

export const ASK_NOT_YET_SERVED = 'ask: not yet served';

export function mawsTools(deps: { deliverables: DeliverableWriter; bridge: PaneBridge }): McpToolDefinition[] {
  return [sendFileTool(deps), defineMawsTool('ask', async () => toolError(ASK_NOT_YET_SERVED)), showPaneTool(deps)];
}
