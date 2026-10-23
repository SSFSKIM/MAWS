// WR 49: presentations and designs count only open conversations whose element or board still lives.
import { commentCountStore } from '../comments/counts';
import type { Doc } from '../yjs';
import { observeThreads, threadStates } from './threads';

export function deckCommentCounts(doc: Doc) {
  return commentCountStore(doc, () => {
    const counts = new Map<string, number>();
    for (const thread of threadStates(doc)) {
      if (thread.status === 'open' && thread.live) counts.set(thread.slideId, (counts.get(thread.slideId) ?? 0) + 1);
    }
    return counts;
  }, observeThreads);
}
