// E3's renderer registrations, from App.tsx's E3 block (E3 execution document, Interfaces "Renderer"): the Side pane as
// a panel tool, never unregistered (a registration's disposer closes the tool's tabs, which StrictMode's effect replay
// would do, C8a's rule); the comment composer into E5's seam, in place of its placeholder sheet (since P2-E1 the sheet or
// the comment card, by the producer's placement); the transcript's summary-row action; and the side questions'
// completions, which patch the pane's store whether or not the question view is on screen (P5 O7 M8: and a remote
// session's reopened stream, which lists its log again). UX wave U5a: a session that leaves the window's session store
// (its record, or its listed row) ends its unsent comments' passes. The last four are undone by the returned disposer. The `btw` slash widget is C11's registration
// (`widgets/index.ts`), never this module's.
import type { Anchor } from '@shared/anchor/anchor';
import type { MawsBridge } from '@shared/ipc/schema';
import { ipc } from '../ipc/client';
import { registerPanelTool } from '../panel/host';
import { registerCommentComposer, type CommentContext } from '../tools/code/anchor/anchor';
import { registerTranscriptActions } from '../transcript';
import { openSideThread } from './actions';
import { dropSession, openCard, useCommentCard } from './card/store';
import { openComposer } from './CommentComposer';
import { sideTool } from './SideTool';
import { onSideOperation, onSideReopened } from './store';
import { useSessions } from '../stores/sessions';

export function registerSidePane(): void {
  registerPanelTool(sideTool);
}

// The seam's one opener (P2-E1, D2): a card placement opens the comment card in the producer's host, anything else the
// sheet. P4-B1 (M4): a document's margin placement is its card host's card too, drawn in the margin's stack; a pin
// placement (P4-B2's popover) is B2's to route.
export function openComment(anchor: Anchor, context: CommentContext): void {
  if (context.placement?.kind === 'card' || context.placement?.kind === 'margin' /* P4-B1 */) openCard(anchor, context);
  else openComposer(anchor, context);
}

export function connectSide(client: MawsBridge = ipc): () => void {
  const offComposer = registerCommentComposer(openComment);
  const offActions = registerTranscriptActions({ openSideThread });
  const offOperations = client.on('session.operation', (event) => onSideOperation(event, client));
  const offReopened = client.on('remote.reopened', ({ appSessionId }) => onSideReopened(appSessionId, client)); // P5 O7 M8
  // UX wave U5a (§F): the end of a session ends its passes
  const offSessions = useSessions.subscribe((state, previous) => {
    if ((state.records === previous.records && state.listed === previous.listed) || useCommentCard.getState().passes.size === 0) return;
    for (const id of new Set([...previous.records.keys(), ...previous.listed.keys()])) if (!state.records.has(id) && !state.listed.has(id)) dropSession(id);
  });
  return () => {
    offComposer();
    offActions();
    offOperations();
    offReopened();
    offSessions();
  };
}
