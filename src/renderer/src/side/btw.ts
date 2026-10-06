// `/btw` (E3 execution document, Design §7): a side question to the engine beside the running turn, never a prompt.
// C11's widget registration is the only place `btw` is registered (`widgets/index.ts`); this is what it applies. A typed
// `/btw <question>` asks at once when the session has a ready process: the pane's question view opens (on screen when
// the session is the shown one, the panel rule), the question is asked without waiting for its receipt, and the answer
// resolves true at once, so the editor's decision bound never opens the widget for it. Without a ready process the
// answer is false and the widget opens, saying so. A side thread drawn in its parent's pane asks from the pane's
// composer, so its questions answer there, under its thread view (the architect's ruling), not in its own panel.
import type { AppSessionId } from '@shared/graph/ids';
import { useSessions } from '../stores/sessions';
import { revealSideQuestions } from './actions';
import { askSide, hostedInSidePane, setInlineQuestions } from './store';

export const canAskSide = (appSessionId: AppSessionId): boolean => useSessions.getState().engine.get(appSessionId)?.process === 'ready';

// The question asked and its view revealed (the widget's Ask and the typed path alike).
export function askSideQuestion(appSessionId: AppSessionId, question: string): void {
  if (hostedInSidePane(appSessionId)) setInlineQuestions(appSessionId, true);
  else revealSideQuestions(appSessionId);
  void askSide(appSessionId, question);
}

export async function applyBtw(appSessionId: AppSessionId, args: string): Promise<boolean> {
  const question = args.trim();
  if (question === '' || !canAskSide(appSessionId)) return false;
  askSideQuestion(appSessionId, question);
  return true;
}
