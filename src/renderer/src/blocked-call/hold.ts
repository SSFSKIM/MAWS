// UX wave U1c (the U1c document, Design 4; M4's prerequisite, Decision Log 35): what a grant out holds of its session
// while it is out, so that the record the grant ends on keeps arriving whatever is mounted, and lets go when the
// session's last grant ends or the session goes (`grants.ts`, `keep`).
import type { AppSessionId } from '@shared/graph/ids';
import { attachQueue } from '../stores/queue';
import { useTranscriptStore } from '../stores/transcript';

/** Holds the session's queue attachment and its transcript until the returned release. */
export function holdSession(appSessionId: AppSessionId): () => void {
  const queue = attachQueue(appSessionId);
  const transcript = useTranscriptStore.getState().hold(appSessionId);
  return () => {
    queue();
    transcript();
  };
}
