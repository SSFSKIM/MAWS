// The message a card or a failed start hands back (C10 execution document, "The unstarted session"; M3's carried rule):
// a cancelled card, "Back to editing", a refused continuation and a resume that failed after it started return the
// first message to the editor. The composer's `prefillComposer` is C7's; M4b points this seam at it. Until then the
// text is not lost: an intent keeps it in its draft, and a start is never refused silently (a toast names the refusal).
// Its own module so the setup store and the setup actions both reach it without importing each other.
import type { AppSessionId } from '@shared/graph/ids';
import type { FirstMessage } from '@shared/sessions/intent';

export type MessageReturn = (appSessionId: AppSessionId, message: FirstMessage) => void;
let messageReturn: MessageReturn = () => {};

export function registerMessageReturn(fn: MessageReturn): () => void {
  messageReturn = fn;
  return () => {
    if (messageReturn === fn) messageReturn = () => {};
  };
}

export const returnMessage: MessageReturn = (appSessionId, message) => messageReturn(appSessionId, message);
