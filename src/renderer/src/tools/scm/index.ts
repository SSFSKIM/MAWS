// E6's Source control tool (E6 execution document, Interfaces *Renderer*): registered once from App.tsx's E6 block.
// Static and thin: the tool mounts Source control's page, which reads and changes nothing (UX wave U5b-2).
import { registerPanelTool } from '../../panel/host';
import { scmTool } from './ScmTool';

export { SCM_TOOL_ID, scmTool } from './ScmTool';

// Registers the tool. The disposer unregisters it, which closes its tabs (C8a's rule), so App.tsx never calls it; tests
// may.
export function registerScmTool(): () => void {
  return registerPanelTool(scmTool);
}
