// WR 49: documents and dashboards count only open conversations whose passage or block still lives. UX wave U5a
// (docs/doperpowers/plans/2026-11-12-ux-wave-U5a-comment-card.md, M7; A3): and only once a thread holds a message, so
// the thread the editor writes when a comment card opens is no comment until it is sent.
import { commentCountStore } from '../comments/counts';
import type { Doc } from '../yjs';
import { listThreads, liveThreadIds, observeThreads, type Thread } from './threads';

const spoken = (thread: Thread): boolean => thread.status === 'open' && thread.messages.length > 0; // UX wave U5a

export function documentCommentCounts(doc: Doc) {
  return commentCountStore(doc, () => {
    const counts = new Map<string, number>();
    const threads = listThreads(doc);
    if (!threads.some(spoken)) return counts; // UX wave U5a: spoken
    const live = liveThreadIds(doc);
    for (const thread of threads) {
      if (spoken(thread) && live.has(thread.id)) counts.set(thread.tabId, (counts.get(thread.tabId) ?? 0) + 1);
    }
    return counts;
  }, observeThreads);
}
