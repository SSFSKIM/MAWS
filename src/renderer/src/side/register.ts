// E3's renderer registrations, from App.tsx's E3 block (E3 execution document, Interfaces "Renderer"): the Side pane as
// a panel tool, never unregistered (a registration's disposer closes the tool's tabs, which StrictMode's effect replay
// would do, C8a's rule); the comment composer into E5's seam, in place of its placeholder sheet; the transcript's
// summary-row action; and the side questions' completions, which patch the pane's store whether or not the question
// view is on screen. The last three are undone by the returned disposer. The `btw` slash widget is C11's registration
// (`widgets/index.ts`), never this module's.
import type { MawsBridge } from '@shared/ipc/schema';
import { ipc } from '../ipc/client';
import { registerPanelTool } from '../panel/host';
import { registerCommentComposer } from '../tools/code/anchor/anchor';
import { registerTranscriptActions } from '../transcript';
import { openSideThread } from './actions';
import { openComposer } from './CommentComposer';
import { sideTool } from './SideTool';
import { onSideOperation } from './store';

export function registerSidePane(): void {
  registerPanelTool(sideTool);
}

export function connectSide(client: MawsBridge = ipc): () => void {
  const offComposer = registerCommentComposer(openComposer);
  const offActions = registerTranscriptActions({ openSideThread });
  const offOperations = client.on('session.operation', (event) => onSideOperation(event, client));
  return () => {
    offComposer();
    offActions();
    offOperations();
  };
}
