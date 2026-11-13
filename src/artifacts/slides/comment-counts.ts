// WR 49: presentations and designs count only open conversations whose element or board still lives. UX wave U5a
// (docs/doperpowers/plans/2026-11-12-ux-wave-U5a-comment-card.md, M7; A3): and only once a thread holds a message, as a
// document's do, so the thread the editor writes when a comment card opens is no comment until it is sent.
import { commentCountStore } from '../comments/counts';
import type { Doc } from '../yjs';
import { observeThreads, threadStates } from './threads';

export function deckCommentCounts(doc: Doc) {
  return commentCountStore(doc, () => {
    const counts = new Map<string, number>();
    for (const thread of threadStates(doc)) {
      if (thread.status === 'open' && thread.messages.length > 0 /* UX wave U5a */ && thread.live) counts.set(thread.slideId, (counts.get(thread.slideId) ?? 0) + 1);
    }
    return counts;
  }, observeThreads);
}
