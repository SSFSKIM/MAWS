// Send-to-resume (C12 execution document, Interfaces "Send-to-resume"; charter §4.4 as amended by D1): a session the
// engine host released under the memory budget reads idle, and Send resumes it. P2-0's human send seam owns the
// dispatch decision (`submit/send-human-prompt.ts`), the composer owns the draft and button; C10 owns the resume. C10's composition registers its `resumeSession` here, as it
// registers its fork provider in `resubmit-seam.ts`: the message goes with the resume (a trust or relay card docks with
// it if the resume needs one) and is sent once the process is ready.
import type { AppSessionId } from '@shared/graph/ids';
import type { FirstMessage } from '@shared/sessions/intent';

// Answers whether the resume took the message: true when it started or a card now holds the message, false when it was
// refused (the resume says why itself), so the editor keeps the text.
export type ReleasedResume = (appSessionId: AppSessionId, message: FirstMessage) => Promise<boolean>;

let resume: ReleasedResume | null = null;

export function registerReleasedResume(fn: ReleasedResume): () => void {
  resume = fn;
  return () => {
    if (resume === fn) resume = null;
  };
}

export const releasedResume = (): ReleasedResume | null => resume;
