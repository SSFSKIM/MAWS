// E6's Source control tool (E6 execution document, Interfaces *Renderer*): registered once from App.tsx's E6 block.
// Static and thin: the diff view loads with the first diff the body draws.
import { registerPanelTool } from '../../panel/host';
import { scmTool } from './ScmTool';

export { groupsOf } from './groups';
export { SCM_TOOL_ID, scmTool } from './ScmTool';
export { connectScmRunEnds, useScm } from './store';
export type { ScmParams } from './view-state';

// Registers the tool. The disposer unregisters it, which closes its tabs (C8a's rule), so App.tsx never calls it; tests
// may.
export function registerScmTool(): () => void {
  return registerPanelTool(scmTool);
}
