// `/btw` (E3 execution document, Design §7): a side question to the engine beside the running turn, never a prompt.
// C11's widget registration is the only place `btw` is registered (`widgets/index.ts`); this is what it applies. A typed
// `/btw <question>` asks at once when the session has a ready process: the pane's question view opens (on screen when
// the session is the shown one, the panel rule), the question is asked without waiting for its receipt, and the answer
// resolves true at once, so the editor's decision bound never opens the widget for it. A session that cannot take a
// question at all answers false and the widget opens, saying so. A side thread drawn in its parent's pane asks from the pane's
// composer, so its questions answer there, under its thread view (the architect's ruling), not in its own panel.
// P2-A (2026-10-09; the execution document §5.6): on a session with a record and no ready process, Ask, Retry and a
// typed `/btw <question>` (its Enter is the gesture) start the session first (`acquireSession(id, 'side')`) and then
// ask; only a terminal or job holding it, an archive, or no record at all keeps the question from being asked.
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { Availability } from '@shared/ipc/schema/session';
import { acquireSession, refusalWords } from '../sessions/acquire';
import { availabilityIn, availabilityRefusal } from '../sessions/availability';
import { toast } from '../stores/notices';
import { useSessions } from '../stores/sessions';
import { revealSideQuestions } from './actions';
import { SIDE_COPY } from './copy';
import { askSide, hostedInSidePane, setInlineQuestions } from './store';

export const canAskSide = (appSessionId: AppSessionId): boolean => useSessions.getState().engine.get(appSessionId)?.process === 'ready';

// The question's view revealed: under the thread in its parent's pane, else the session's own Side pane.
function revealQuestions(appSessionId: AppSessionId): void {
  if (hostedInSidePane(appSessionId)) setInlineQuestions(appSessionId, true);
  else revealSideQuestions(appSessionId);
}

// The question asked and its view revealed (the widget's Ask and the typed path alike).
export function askSideQuestion(appSessionId: AppSessionId, question: string): void {
  revealQuestions(appSessionId);
  void askSide(appSessionId, question);
}

// P2-A start (2026-10-09)
// Why no side question can be asked of the session now, or null when one can (a ready process, or a start the ask
// begins): a terminal or job holds it, it is archived, or it has no record (an unstarted tab starts with its first message).
export const sideBlock = (availability: Availability | null, holder: SessionRecord['holder'] | null): string | null => availabilityRefusal(availability, holder, SIDE_COPY.btw.notRunning);

// Starts the session for a side question when it has no ready process: null once it can be asked, else the words.
export async function startForSide(appSessionId: AppSessionId): Promise<string | null> {
  if (canAskSide(appSessionId)) return null;
  try {
    return refusalWords(await acquireSession(appSessionId, 'side'));
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
// P2-A end

export async function applyBtw(appSessionId: AppSessionId, args: string): Promise<boolean> {
  const question = args.trim();
  if (question === '') return false;
  if (canAskSide(appSessionId)) {
    askSideQuestion(appSessionId, question);
    return true;
  }
  // P2-A start (2026-10-09): the view opens at once (its line reads Starting… while the session starts), the question
  // is asked once the session is ready, and a refusal is said in a toast, the typed path having no field of its own
  const state = useSessions.getState();
  if (sideBlock(availabilityIn(state, appSessionId), state.records.get(appSessionId)?.holder ?? null) !== null) return false; // the widget opens and says why
  revealQuestions(appSessionId);
  void startForSide(appSessionId).then((refusal) => {
    if (refusal === null) void askSide(appSessionId, question);
    else toast({ level: 'warning', text: refusal, actions: [], dismissible: true });
  });
  return true;
  // P2-A end
}
