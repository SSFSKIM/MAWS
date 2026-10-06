// E3's renderer registrations, from App.tsx's E3 block (E3 execution document, Interfaces "Renderer"): the Side pane as
// a panel tool, never unregistered (a registration's disposer closes the tool's tabs, which StrictMode's effect replay
// would do, C8a's rule); the comment composer into E5's seam, in place of its placeholder sheet; and the transcript's
// summary-row action. The last two are undone by the returned disposer.
import { registerPanelTool } from '../panel/host';
import { registerCommentComposer } from '../tools/code/anchor/anchor';
import { registerTranscriptActions } from '../transcript';
import { openSideThread } from './actions';
import { openComposer } from './CommentComposer';
import { sideTool } from './SideTool';

export function registerSidePane(): void {
  registerPanelTool(sideTool);
}

export function connectSide(): () => void {
  const offComposer = registerCommentComposer(openComposer);
  const offActions = registerTranscriptActions({ openSideThread });
  return () => {
    offComposer();
    offActions();
  };
}
